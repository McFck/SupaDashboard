//! The audio worker thread, its request channel and the two commands that talk to it.
use super::core_audio::{ProcessNames, read_device, read_device_id, write_device};
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
    process_names: ProcessNames,
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
        process_names: ProcessNames::default(),
        last_error: None,
    };
    // Nobody reads audio until a window asks for the first snapshot, so polling starts then.
    let mut deadline: Option<Instant> = None;
    loop {
        let received = match deadline {
            Some(deadline) => {
                requests.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            }
            None => requests.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match received {
            Ok(Request::Snapshot(reply)) => {
                worker.refresh();
                let _ = reply.try_send(Ok(worker.snapshot.clone()));
                deadline.get_or_insert_with(|| Instant::now() + POLL_INTERVAL);
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
                let now = Instant::now();
                let mut next = deadline.unwrap_or(now) + POLL_INTERVAL;
                while next <= now {
                    next += POLL_INTERVAL;
                }
                deadline = Some(next);
            }
        }
    }
    drop(worker);
    unsafe { CoUninitialize() };
}

impl Worker {
    fn refresh(&mut self) {
        let device = unsafe {
            self.enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
        };
        let result = device
            .as_ref()
            .map_err(|error| error.to_string())
            .and_then(|device| {
                read_device_id(device)
                    .map(|id| (device, id))
                    .map_err(|error| error.to_string())
            });
        self.resync(result, false);
    }

    /// Polls and writes share the same readback, error state and revision rules.
    fn resync(&mut self, device: Result<(&IMMDevice, String), String>, force_revision: bool) {
        let result = device.and_then(|(device, id)| {
            read_device(device, &mut self.process_names)
                .map(|channels| (id, channels))
                .map_err(|error| error.to_string())
        });
        match result {
            Ok((device_id, channels)) => {
                self.set_error(None);
                self.commit(Some(device_id), channels, force_revision);
            }
            Err(error) => {
                self.set_error(Some(error));
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
                self.resync(Err(error.to_string()), false);
                return Ok(self.update_result(false));
            }
        };
        let device_id = read_device_id(&device).map_err(|error| error.to_string())?;
        if expected_device_id != device_id {
            self.resync(Ok((&device, device_id)), false);
            return Ok(self.update_result(false));
        }

        let applied = match write_device(&device, &mut self.process_names, target, value, muted) {
            Ok(applied) => applied,
            Err(error) => {
                self.resync(Ok((&device, device_id)), false);
                return Err(error.to_string());
            }
        };
        self.resync(Ok((&device, device_id)), applied);
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
