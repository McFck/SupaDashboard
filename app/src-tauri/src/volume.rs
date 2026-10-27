//! One MTA worker owns Core Audio and polls a canonical snapshot for both app windows.
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, State};

const POLL_INTERVAL: Duration = Duration::from_millis(200);
const VALUE_EPSILON: f32 = 0.0001;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Channel {
    pub target: String,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub revision: u64,
    pub device_id: Option<String>,
    pub channels: Vec<Channel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioUpdateResult {
    pub applied: bool,
    pub snapshot: AudioSnapshot,
}

pub struct AudioService {
    sender: mpsc::Sender<Request>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

enum Request {
    Snapshot(tauri::async_runtime::Sender<Result<AudioSnapshot, String>>),
    Update {
        target: String,
        value: Option<f32>,
        muted: Option<bool>,
        device_id: Option<String>,
        reply: tauri::async_runtime::Sender<Result<AudioUpdateResult, String>>,
    },
    Stop,
}

impl AudioService {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("SupaDashboard Core Audio".into())
            .spawn(move || audio_worker(app, receiver))
            .map_err(|error| format!("could not start Core Audio worker: {error}"))?;
        Ok(Self {
            sender,
            thread: Mutex::new(Some(worker)),
        })
    }
}

impl Drop for AudioService {
    fn drop(&mut self) {
        let _ = self.sender.send(Request::Stop);
        if let Ok(thread) = self.thread.get_mut()
            && let Some(worker) = thread.take()
        {
            let _ = worker.join();
        }
    }
}

async fn request_snapshot(service: &AudioService) -> Result<AudioSnapshot, String> {
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

async fn request_update(
    service: &AudioService,
    target: String,
    value: Option<f32>,
    muted: Option<bool>,
    device_id: Option<String>,
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

#[tauri::command]
pub async fn audio_snapshot(service: State<'_, AudioService>) -> Result<AudioSnapshot, String> {
    request_snapshot(&service).await
}

#[tauri::command]
pub async fn audio_update(
    target: String,
    value: Option<f32>,
    muted: Option<bool>,
    device_id: String,
    service: State<'_, AudioService>,
) -> Result<AudioUpdateResult, String> {
    request_update(&service, target, value, muted, Some(device_id)).await
}

fn normalize_target(target: &str) -> String {
    let target = target.trim().to_lowercase();
    target.strip_suffix(".exe").unwrap_or(&target).to_owned()
}

fn validate_patch(
    target: &str,
    value: Option<f32>,
    muted: Option<bool>,
) -> Result<(String, Option<f32>), String> {
    let target = normalize_target(target);
    if target.is_empty() {
        return Err("volume target cannot be empty".into());
    }
    if value.is_none() && muted.is_none() {
        return Err("volume update has no fields".into());
    }
    if value.is_some_and(|value| !value.is_finite()) {
        return Err("volume must be finite".into());
    }
    Ok((target, value.map(|value| value.clamp(0.0, 1.0))))
}

fn canonical_channels(mut channels: Vec<Channel>) -> Vec<Channel> {
    channels.retain_mut(|channel| {
        channel.target = normalize_target(&channel.target);
        !channel.target.is_empty() && channel.volume.is_finite()
    });
    for channel in &mut channels {
        channel.volume = channel.volume.clamp(0.0, 1.0);
    }
    channels.sort_by(|a, b| match (a.target == "system", b.target == "system") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.target.cmp(&b.target),
    });
    channels.dedup_by(|a, b| a.target == b.target);
    channels
}

fn channels_changed(a: &[Channel], b: &[Channel]) -> bool {
    a.len() != b.len()
        || a.iter().zip(b).any(|(a, b)| {
            a.target != b.target
                || a.muted != b.muted
                || (a.volume - b.volume).abs() > VALUE_EPSILON
        })
}

fn snapshot_changed(
    previous: &AudioSnapshot,
    device_id: &Option<String>,
    channels: &[Channel],
) -> bool {
    previous.device_id != *device_id || channels_changed(&previous.channels, channels)
}

#[derive(Clone, Debug)]
struct SessionSample {
    target: String,
    instance_id: String,
    volume: f32,
    muted: bool,
}

fn representative_channels(samples: Vec<SessionSample>) -> Vec<Channel> {
    let mut representatives: BTreeMap<String, SessionSample> = BTreeMap::new();
    for sample in samples {
        let replace = representatives
            .get(&sample.target)
            .is_none_or(|current| sample.instance_id < current.instance_id);
        if replace {
            representatives.insert(sample.target.clone(), sample);
        }
    }
    representatives
        .into_iter()
        .map(|(target, sample)| Channel {
            target,
            volume: sample.volume,
            muted: sample.muted,
        })
        .collect()
}

#[cfg(windows)]
mod windows_audio {
    use super::{
        AudioSnapshot, AudioUpdateResult, Channel, POLL_INTERVAL, Request, SessionSample,
        canonical_channels, normalize_target, representative_channels, snapshot_changed,
    };
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use std::time::Instant;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator, eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::core::{Interface, PWSTR};

    struct Worker {
        app: AppHandle,
        requests: Receiver<Request>,
        enumerator: IMMDeviceEnumerator,
        snapshot: AudioSnapshot,
        last_error: Option<String>,
    }

    pub(super) fn run(app: AppHandle, requests: Receiver<Request>) {
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
            requests,
            enumerator,
            snapshot: AudioSnapshot {
                revision: 0,
                device_id: None,
                channels: Vec::new(),
            },
            last_error: None,
        };
        worker.refresh(false);
        let mut deadline = Instant::now() + POLL_INTERVAL;
        loop {
            let timeout = deadline.saturating_duration_since(Instant::now());
            match worker.requests.recv_timeout(timeout) {
                Ok(Request::Snapshot(reply)) => {
                    worker.refresh(false);
                    let _ = reply.try_send(Ok(worker.snapshot.clone()));
                }
                Ok(Request::Update {
                    target,
                    value,
                    muted,
                    device_id,
                    reply,
                }) => {
                    let result = worker.update(&target, value, muted, device_id.as_deref());
                    let _ = reply.try_send(result);
                }
                Ok(Request::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {
                    worker.refresh(false);
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
        fn refresh(&mut self, force_revision: bool) {
            match self.read_default() {
                Ok((device_id, channels)) => {
                    self.set_error(None);
                    self.commit(device_id, channels, force_revision);
                }
                Err(error) => {
                    self.set_error(Some(error));
                    self.commit(None, Vec::new(), force_revision);
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

        fn read_on_device(&self, device: &IMMDevice) -> Result<Vec<Channel>, String> {
            read_device(device).map_err(|error| error.to_string())
        }

        fn update(
            &mut self,
            target: &str,
            value: Option<f32>,
            muted: Option<bool>,
            expected_device_id: Option<&str>,
        ) -> Result<AudioUpdateResult, String> {
            let device = match unsafe {
                self.enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
            } {
                Ok(device) => device,
                Err(error) => {
                    self.set_error(Some(error.to_string()));
                    self.commit(None, Vec::new(), false);
                    return Ok(AudioUpdateResult {
                        applied: false,
                        snapshot: self.snapshot.clone(),
                    });
                }
            };
            let device_id = read_device_id(&device).map_err(|error| error.to_string())?;
            if expected_device_id.is_some_and(|expected| expected != device_id) {
                self.set_error(None);
                match self.read_on_device(&device) {
                    Ok(channels) => self.commit(Some(device_id), channels, false),
                    Err(error) => {
                        self.set_error(Some(error));
                        self.commit(None, Vec::new(), false);
                    }
                }
                return Ok(AudioUpdateResult {
                    applied: false,
                    snapshot: self.snapshot.clone(),
                });
            }

            let applied = match write_device(&device, target, value, muted) {
                Ok(applied) => applied,
                Err(error) => {
                    match self.read_on_device(&device) {
                        Ok(channels) => self.commit(Some(device_id), channels, false),
                        Err(read_error) => {
                            self.set_error(Some(read_error));
                            self.commit(None, Vec::new(), false);
                        }
                    }
                    return Err(error.to_string());
                }
            };
            match self.read_on_device(&device) {
                Ok(channels) => {
                    self.set_error(None);
                    self.commit(Some(device_id), channels, applied);
                }
                Err(error) => {
                    self.set_error(Some(error));
                    self.commit(None, Vec::new(), applied);
                }
            }
            Ok(AudioUpdateResult {
                applied,
                snapshot: self.snapshot.clone(),
            })
        }

        fn commit(
            &mut self,
            device_id: Option<String>,
            channels: Vec<Channel>,
            force_revision: bool,
        ) {
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

    fn read_device_id(device: &IMMDevice) -> windows::core::Result<String> {
        let id = unsafe { device.GetId()? };
        let value = String::from_utf16_lossy(unsafe { id.as_wide() });
        unsafe { CoTaskMemFree(Some(id.0 as *const c_void)) };
        Ok(value)
    }

    fn read_session_id(control: &IAudioSessionControl2) -> Option<String> {
        let id = unsafe { control.GetSessionInstanceIdentifier().ok()? };
        let value = String::from_utf16_lossy(unsafe { id.as_wide() });
        unsafe { CoTaskMemFree(Some(id.0 as *const c_void)) };
        Some(value)
    }

    fn process_name(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
        let mut buffer = [0u16; 260];
        let mut length = buffer.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(handle) };
        result.ok()?;
        String::from_utf16_lossy(&buffer[..length as usize])
            .rsplit('\\')
            .next()
            .map(normalize_target)
    }

    struct SessionVolume {
        target: String,
        instance_id: String,
        volume: ISimpleAudioVolume,
    }

    fn session_volumes(device: &IMMDevice) -> Vec<SessionVolume> {
        let manager: IAudioSessionManager2 = match unsafe { device.Activate(CLSCTX_ALL, None) } {
            Ok(manager) => manager,
            Err(_) => return Vec::new(),
        };
        let sessions = match unsafe { manager.GetSessionEnumerator() } {
            Ok(sessions) => sessions,
            Err(_) => return Vec::new(),
        };
        let count = match unsafe { sessions.GetCount() } {
            Ok(count) => count,
            Err(_) => return Vec::new(),
        };
        let mut process_names = HashMap::<u32, Option<String>>::new();
        let mut out = Vec::new();
        for index in 0..count {
            let control: IAudioSessionControl2 =
                match unsafe { sessions.GetSession(index) }.and_then(|session| session.cast()) {
                    Ok(control) => control,
                    Err(_) => continue,
                };
            let pid = match unsafe { control.GetProcessId() } {
                Ok(pid) if pid != 0 => pid,
                _ => continue,
            };
            let target = process_names
                .entry(pid)
                .or_insert_with(|| process_name(pid))
                .clone();
            let Some(target) = target.map(|name| normalize_target(&name)) else {
                continue;
            };
            let Some(instance_id) = read_session_id(&control) else {
                continue;
            };
            let volume: ISimpleAudioVolume = match control.cast() {
                Ok(volume) => volume,
                Err(_) => continue,
            };
            out.push(SessionVolume {
                target,
                instance_id,
                volume,
            });
        }
        out
    }

    fn read_device(device: &IMMDevice) -> windows::core::Result<Vec<Channel>> {
        let endpoint: IAudioEndpointVolume = unsafe { device.Activate(CLSCTX_ALL, None)? };
        let mut channels = vec![Channel {
            target: "system".into(),
            volume: unsafe { endpoint.GetMasterVolumeLevelScalar()? },
            muted: unsafe { endpoint.GetMute()? }.as_bool(),
        }];
        let sessions = session_volumes(device);
        let mut samples = Vec::new();
        for session in sessions {
            let volume = match unsafe { session.volume.GetMasterVolume() } {
                Ok(volume) if volume.is_finite() => volume.clamp(0.0, 1.0),
                _ => continue,
            };
            let muted = match unsafe { session.volume.GetMute() } {
                Ok(muted) => muted.as_bool(),
                Err(_) => continue,
            };
            samples.push(SessionSample {
                target: session.target,
                instance_id: session.instance_id,
                volume,
                muted,
            });
        }
        channels.extend(representative_channels(samples));
        Ok(channels)
    }

    fn write_device(
        device: &IMMDevice,
        target: &str,
        value: Option<f32>,
        muted: Option<bool>,
    ) -> windows::core::Result<bool> {
        if target == "system" {
            let endpoint: IAudioEndpointVolume = unsafe { device.Activate(CLSCTX_ALL, None)? };
            if let Some(value) = value {
                unsafe {
                    endpoint.SetMasterVolumeLevelScalar(value, std::ptr::null())?;
                }
            }
            if let Some(muted) = muted {
                unsafe {
                    endpoint.SetMute(muted, std::ptr::null())?;
                }
            }
            return Ok(true);
        }

        let selector = normalize_target(target);
        let mut found = false;
        let mut first_error = None;
        for session in session_volumes(device)
            .into_iter()
            .filter(|session| session.target.contains(&selector))
        {
            found = true;
            let result = (|| -> windows::core::Result<()> {
                if let Some(value) = value {
                    unsafe {
                        session.volume.SetMasterVolume(value, std::ptr::null())?;
                    }
                }
                if let Some(muted) = muted {
                    unsafe {
                        session.volume.SetMute(muted, std::ptr::null())?;
                    }
                }
                Ok(())
            })();
            if let Err(error) = result
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(found)
    }

    pub(super) fn audio_worker(app: AppHandle, requests: Receiver<Request>) {
        run(app, requests);
    }

    #[cfg(test)]
    pub(super) fn read_snapshot_for_test() -> Result<AudioSnapshot, String> {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        initialized.ok().map_err(|error| error.to_string())?;
        let result = (|| {
            let enumerator: IMMDeviceEnumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                    .map_err(|error| error.to_string())?;
            let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
                .map_err(|error| error.to_string())?;
            let device_id = read_device_id(&device).map_err(|error| error.to_string())?;
            let channels = read_device(&device).map_err(|error| error.to_string())?;
            Ok(AudioSnapshot {
                revision: 1,
                device_id: Some(device_id),
                channels: canonical_channels(channels),
            })
        })();
        unsafe { CoUninitialize() };
        result
    }
}

#[cfg(windows)]
fn audio_worker(app: AppHandle, requests: mpsc::Receiver<Request>) {
    windows_audio::audio_worker(app, requests)
}

#[cfg(not(windows))]
fn audio_worker(_app: AppHandle, requests: mpsc::Receiver<Request>) {
    while !matches!(requests.recv(), Ok(Request::Stop) | Err(_)) {}
}

#[cfg(test)]
mod tests {
    use super::{
        AudioSnapshot, Channel, SessionSample, canonical_channels, channels_changed,
        normalize_target, representative_channels, snapshot_changed, validate_patch,
    };

    fn channel(target: &str, volume: f32, muted: bool) -> Channel {
        Channel {
            target: target.into(),
            volume,
            muted,
        }
    }

    #[test]
    fn snapshots_sort_system_first_and_deduplicate_targets() {
        let channels = canonical_channels(vec![
            channel("Spotify.exe", 0.4, false),
            channel("system", 0.8, false),
            channel("discord", 0.3, true),
            channel("spotify", 0.5, true),
        ]);
        assert_eq!(
            channels
                .iter()
                .map(|channel| channel.target.as_str())
                .collect::<Vec<_>>(),
            ["system", "discord", "spotify"]
        );
    }

    #[test]
    fn value_changes_use_the_audio_epsilon_and_include_mute_and_channel_changes() {
        let before = vec![channel("system", 0.5, false)];
        assert!(!channels_changed(
            &before,
            &[channel("system", 0.50005, false)]
        ));
        assert!(channels_changed(
            &before,
            &[channel("system", 0.5002, false)]
        ));
        assert!(channels_changed(&before, &[channel("system", 0.5, true)]));
        assert!(channels_changed(
            &before,
            &[channel("system", 0.5, false), channel("chrome", 0.2, false)]
        ));
    }

    #[test]
    fn representative_session_is_selected_by_stable_instance_id() {
        let samples = vec![
            SessionSample {
                target: "chrome".into(),
                instance_id: "z-session".into(),
                volume: 0.9,
                muted: true,
            },
            SessionSample {
                target: "chrome".into(),
                instance_id: "a-session".into(),
                volume: 0.4,
                muted: false,
            },
        ];
        assert_eq!(
            representative_channels(samples.clone()),
            representative_channels(samples.into_iter().rev().collect())
        );
        assert_eq!(
            representative_channels(vec![
                SessionSample {
                    target: "chrome".into(),
                    instance_id: "z-session".into(),
                    volume: 0.9,
                    muted: true
                },
                SessionSample {
                    target: "chrome".into(),
                    instance_id: "a-session".into(),
                    volume: 0.4,
                    muted: false
                },
            ])[0]
                .volume,
            0.4
        );
    }

    #[test]
    fn device_switches_are_snapshot_changes_and_missing_device_is_empty() {
        let before = AudioSnapshot {
            revision: 1,
            device_id: Some("device-a".into()),
            channels: vec![channel("system", 0.6, false)],
        };
        assert!(snapshot_changed(
            &before,
            &Some("device-b".into()),
            &before.channels
        ));
        assert!(snapshot_changed(&before, &None, &[]));
        let missing = canonical_channels(Vec::new());
        assert!(missing.is_empty());
    }

    #[test]
    fn target_and_value_validation_preserve_process_substring_compatibility() {
        assert_eq!(normalize_target("  Discord.exe "), "discord");
        assert_eq!(
            validate_patch("SYSTEM", Some(1.4), None).unwrap(),
            ("system".into(), Some(1.0))
        );
        assert_eq!(
            validate_patch("discord", Some(-0.2), None).unwrap(),
            ("discord".into(), Some(0.0))
        );
        assert!(validate_patch(" ", Some(0.5), None).is_err());
        assert!(validate_patch("system", Some(f32::NAN), None).is_err());
        assert!(validate_patch("system", None, None).is_err());
    }
}

#[cfg(windows)]
#[cfg(test)]
mod hardware_tests {
    // Read-only tests are kept for the parent's native checklist, not this browser-only stage.
    #[test]
    #[ignore = "requires the parent's native audio-device checklist"]
    fn reads_system_volume() {
        let snapshot = super::windows_audio::read_snapshot_for_test().unwrap();
        let system = snapshot
            .channels
            .iter()
            .find(|channel| channel.target == "system")
            .unwrap();
        assert!((0.0..=1.0).contains(&system.volume));
    }

    #[test]
    #[ignore = "requires the parent's native audio-device checklist"]
    fn mixer_starts_with_system() {
        let snapshot = super::windows_audio::read_snapshot_for_test().unwrap();
        assert_eq!(
            snapshot
                .channels
                .first()
                .map(|channel| channel.target.as_str()),
            Some("system")
        );
        assert!(
            snapshot
                .channels
                .iter()
                .all(|channel| !channel.target.is_empty() && (0.0..=1.0).contains(&channel.volume))
        );
    }

    #[test]
    #[ignore = "requires the parent's native audio-device checklist"]
    fn missing_app_has_no_volume() {
        let snapshot = super::windows_audio::read_snapshot_for_test().unwrap();
        assert!(
            !snapshot
                .channels
                .iter()
                .any(|channel| channel.target.contains("no-such-app-xyz"))
        );
    }
}
