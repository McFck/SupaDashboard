//! The audio worker thread, its request channel and the two commands that talk to it.
use super::core_audio::{read_device, read_device_id, write_device};
use super::model::{
    AudioSnapshot, AudioUpdateResult, Channel, canonical_channels, snapshot_changed, validate_patch,
};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use windows::Win32::Media::Audio::{
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};

const POLL_INTERVAL: Duration = Duration::from_millis(200);

pub struct AudioService {
    sender: mpsc::Sender<Request>,
    thread: Option<JoinHandle<()>>,
}

enum Request {
    Snapshot(tauri::async_runtime::Sender<Result<AudioSnapshot, String>>),
    Update {
        target: String,
        value: Option<f32>,
        muted: Option<bool>,
        device_id: String,
        reply: tauri::async_runtime::Sender<Result<AudioUpdateResult, String>>,
    },
    Stop,
}

impl AudioService {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("SupaDashboard Core Audio".into())
            .spawn(move || run(app, receiver))
            .map_err(|error| format!("could not start Core Audio worker: {error}"))?;
        Ok(Self {
            sender,
            thread: Some(worker),
        })
    }
}

impl Drop for AudioService {
    fn drop(&mut self) {
        let _ = self.sender.send(Request::Stop);
        if let Some(worker) = self.thread.take() {
            let _ = worker.join();
        }
    }
}

#[tauri::command]
pub async fn audio_snapshot(service: State<'_, AudioService>) -> Result<AudioSnapshot, String> {
    let (reply, mut receiver) = tauri::async_runtime::channel(1);
    service
        .sender
        .send(Request::Snapshot(reply))
        .map_err(|_| "Core Audio worker stopped".to_owned())?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Core Audio worker dropped the snapshot result".to_owned())?
}

#[tauri::command]
pub async fn audio_update(
    target: String,
    value: Option<f32>,
    muted: Option<bool>,
    device_id: String,
    service: State<'_, AudioService>,
) -> Result<AudioUpdateResult, String> {
    let (target, value) = validate_patch(&target, value, muted)?;
    let (reply, mut receiver) = tauri::async_runtime::channel(1);
    service
        .sender
        .send(Request::Update {
            target,
            value,
            muted,
            device_id,
            reply,
        })
        .map_err(|_| "Core Audio worker stopped".to_owned())?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Core Audio worker dropped the update result".to_owned())?
}

struct Worker {
    app: AppHandle,
    enumerator: IMMDeviceEnumerator,
    snapshot: AudioSnapshot,
    last_error: Option<String>,
}

fn run(app: AppHandle, requests: Receiver<Request>) {
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if initialized.is_err() {
        log::error!("Core Audio worker COM initialization failed: {initialized:?}");
        return;
    }
    let enumerator: IMMDeviceEnumerator =
        match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
            Ok(enumerator) => enumerator,
            Err(error) => {
                log::error!("Core Audio enumerator creation failed: {error}");
                unsafe { CoUninitialize() };
                return;
            }
        };

    let mut worker = Worker {
        app,
        enumerator,
        snapshot: AudioSnapshot {
            revision: 0,
            device_id: None,
            channels: Vec::new(),
        },
        last_error: None,
    };
    worker.refresh();
    let mut deadline = Instant::now() + POLL_INTERVAL;
    loop {
        let timeout = deadline.saturating_duration_since(Instant::now());
        match requests.recv_timeout(timeout) {
            Ok(Request::Snapshot(reply)) => {
                worker.refresh();
                let _ = reply.try_send(Ok(worker.snapshot.clone()));
            }
            Ok(Request::Update {
                target,
                value,
                muted,
                device_id,
                reply,
            }) => {
                let result = worker.update(&target, value, muted, &device_id);
                let _ = reply.try_send(result);
            }
            Ok(Request::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {
                worker.refresh();
                deadline += POLL_INTERVAL;
                let now = Instant::now();
                while deadline <= now {
                    deadline += POLL_INTERVAL;
                }
            }
        }
    }
    drop(worker);
    unsafe { CoUninitialize() };
}

impl Worker {
    fn refresh(&mut self) {
        match self.read_default() {
            Ok((device_id, channels)) => {
                self.set_error(None);
                self.commit(device_id, channels, false);
            }
            Err(error) => {
                self.set_error(Some(error));
                self.commit(None, Vec::new(), false);
            }
        }
    }

    fn read_default(&self) -> Result<(Option<String>, Vec<Channel>), String> {
        let device = unsafe {
            self.enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
        }
        .map_err(|error| error.to_string())?;
        let device_id = read_device_id(&device).map_err(|error| error.to_string())?;
        let channels = read_device(&device).map_err(|error| error.to_string())?;
        Ok((Some(device_id), channels))
    }

    fn read_on_device(&mut self, device: &IMMDevice, device_id: String, force_revision: bool) {
        match read_device(device) {
            Ok(channels) => {
                self.set_error(None);
                self.commit(Some(device_id), channels, force_revision);
            }
            Err(error) => {
                self.set_error(Some(error.to_string()));
                self.commit(None, Vec::new(), force_revision);
            }
        }
    }

    fn update(
        &mut self,
        target: &str,
        value: Option<f32>,
        muted: Option<bool>,
        expected_device_id: &str,
    ) -> Result<AudioUpdateResult, String> {
        let device = match unsafe {
            self.enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
        } {
            Ok(device) => device,
            Err(error) => {
                self.set_error(Some(error.to_string()));
                self.commit(None, Vec::new(), false);
                return Ok(self.update_result(false));
            }
        };
        let device_id = read_device_id(&device).map_err(|error| error.to_string())?;
        if expected_device_id != device_id {
            self.read_on_device(&device, device_id, false);
            return Ok(self.update_result(false));
        }

        let applied = match write_device(&device, target, value, muted) {
            Ok(applied) => applied,
            Err(error) => {
                self.read_on_device(&device, device_id, false);
                return Err(error.to_string());
            }
        };
        self.read_on_device(&device, device_id, applied);
        Ok(self.update_result(applied))
    }

    fn update_result(&self, applied: bool) -> AudioUpdateResult {
        AudioUpdateResult {
            applied,
            snapshot: self.snapshot.clone(),
        }
    }

    fn commit(&mut self, device_id: Option<String>, channels: Vec<Channel>, force_revision: bool) {
        let channels = canonical_channels(channels);
        let changed = snapshot_changed(&self.snapshot, &device_id, &channels);
        if !changed && !force_revision {
            return;
        }
        self.snapshot = AudioSnapshot {
            revision: self.snapshot.revision.wrapping_add(1),
            device_id,
            channels,
        };
        let _ = self.app.emit("audio-state", self.snapshot.clone());
    }

    fn set_error(&mut self, error: Option<String>) {
        if self.last_error != error {
            if let Some(message) = error.as_deref() {
                log::warn!("Core Audio worker unavailable: {message}");
            } else if self.last_error.is_some() {
                log::info!("Core Audio worker recovered");
            }
            self.last_error = error;
        }
    }
}
