//! Core Audio reads and writes on one device. Every call must run on the worker's MTA thread.
use super::model::{
    Channel, SessionSample, normalize_target, representative_channels, write_target,
};
use std::collections::HashMap;
use std::ffi::c_void;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionManager2, IMMDevice, ISimpleAudioVolume,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoTaskMemFree};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{Interface, PWSTR};

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

pub fn read_device(device: &IMMDevice) -> windows::core::Result<Vec<Channel>> {
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

pub fn write_device(
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
    let sessions = session_volumes(device);
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
