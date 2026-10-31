//! Core Audio reads and writes on one device. Every call must run on the worker's MTA thread.
use super::model::{
    Channel, SessionSample, normalize_target, representative_channels, write_target,
};
use std::collections::HashMap;
use std::ffi::c_void;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, ISimpleAudioVolume,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoTaskMemFree};
use windows::core::Interface;

pub fn read_device_id(device: &IMMDevice) -> windows::core::Result<String> {
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
    crate::apps::identity::image_path(pid)?
        .rsplit('\\')
        .next()
        .map(normalize_target)
}

struct SessionVolume {
    target: String,
    instance_id: String,
    volume: ISimpleAudioVolume,
}

/// Process names by pid, kept across polls: resolving one costs an OpenProcess call per session. Pids that no longer
/// have a session are dropped on every enumeration, so a reused pid is looked up again. Failed lookups are not kept.
#[derive(Default)]
pub struct ProcessNames(HashMap<u32, String>);

impl ProcessNames {
    fn resolve(&mut self, pid: u32) -> Option<String> {
        if let Some(name) = self.0.get(&pid) {
            return Some(name.clone());
        }
        let name = process_name(pid)?;
        self.0.insert(pid, name.clone());
        Some(name)
    }
}

fn session_volumes(device: &IMMDevice, names: &mut ProcessNames) -> Vec<SessionVolume> {
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
    let mut seen = Vec::new();
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
        seen.push(pid);
        let Some(target) = names.resolve(pid) else {
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
    names.0.retain(|pid, _| seen.contains(pid));
    out
}

pub fn read_device(
    device: &IMMDevice,
    names: &mut ProcessNames,
) -> windows::core::Result<Vec<Channel>> {
    let endpoint: IAudioEndpointVolume = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let mut channels = vec![Channel {
        target: "system".into(),
        volume: unsafe { endpoint.GetMasterVolumeLevelScalar()? },
        muted: unsafe { endpoint.GetMute()? }.as_bool(),
    }];
    let sessions = session_volumes(device, names);
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

pub fn write_device(
    device: &IMMDevice,
    names: &mut ProcessNames,
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
    let sessions = session_volumes(device, names);
    let targets: Vec<&str> = sessions
        .iter()
        .map(|session| session.target.as_str())
        .collect();
    let Some(chosen) = write_target(&targets, &selector) else {
        return Ok(false);
    };
    let mut first_error = None;
    for session in sessions.iter().filter(|session| session.target == chosen) {
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
    Ok(true)
}
