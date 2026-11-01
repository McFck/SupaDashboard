use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Monitor};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MonitorName {
    pub name: String,
    pub friendly: String,
    pub path: String,
    pub index: usize,
    pub primary: bool,
}

fn decode_utf16(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end]).trim().to_owned()
}

fn source_key(name: &str) -> String {
    name.to_lowercase()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PathNames {
    source: String,
    target_adapter_high: i32,
    target_adapter_low: u32,
    target_id: u32,
    friendly: String,
    device_path: String,
}

fn group_friendly_names(paths: &mut [PathNames]) -> HashMap<String, PathNames> {
    paths.sort_by(|left, right| {
        source_key(&left.source)
            .cmp(&source_key(&right.source))
            .then_with(|| left.target_adapter_high.cmp(&right.target_adapter_high))
            .then_with(|| left.target_adapter_low.cmp(&right.target_adapter_low))
            .then_with(|| left.target_id.cmp(&right.target_id))
    });

    let mut result = HashMap::new();
    for path in paths {
        result
            .entry(source_key(&path.source))
            .or_insert_with(|| path.clone());
    }
    result
}

fn choose_friendly_name(
    display_config: Option<&str>,
    enum_display: Option<&str>,
    raw: &str,
) -> String {
    display_config
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or_else(|| enum_display.map(str::trim).filter(|name| !name.is_empty()))
        .unwrap_or(raw)
        .to_owned()
}

fn map_monitor_names(
    names: &[String],
    display_config: &HashMap<String, PathNames>,
    enum_display: &HashMap<String, String>,
    primary_name: Option<&str>,
) -> Vec<MonitorName> {
    names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let key = source_key(name);
            MonitorName {
                name: name.clone(),
                friendly: choose_friendly_name(
                    display_config.get(&key).map(|info| info.friendly.as_str()),
                    enum_display.get(&key).map(String::as_str),
                    name,
                ),
                path: display_config
                    .get(&key)
                    .map(|info| info.device_path.clone())
                    .unwrap_or_default(),
                index: index + 1,
                primary: primary_name == Some(name.as_str()),
            }
        })
        .collect()
}

fn windows_metadata(names: &[String]) -> (HashMap<String, PathNames>, HashMap<String, String>) {
    let display_config = match display_config_friendly_names() {
        Ok(names) => names,
        Err(error) => {
            log::warn!("DisplayConfig monitor metadata unavailable: {error}");
            HashMap::new()
        }
    };

    let mut enum_display = HashMap::new();
    for name in names {
        let key = source_key(name);
        if !display_config.contains_key(&key)
            && let Some(friendly) = enum_display_friendly_name(name)
        {
            enum_display.insert(key, friendly);
        }
    }
    (display_config, enum_display)
}

fn display_config_friendly_names() -> Result<HashMap<String, PathNames>, String> {
    use std::mem::size_of;

    use windows::Win32::Devices::Display::{
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
        DISPLAYCONFIG_TARGET_DEVICE_NAME, DisplayConfigGetDeviceInfo,
    };

    let paths = active_display_paths()?;
    let mut names = Vec::with_capacity(paths.len());
    let mut warning = None;

    for path in paths {
        let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                size: size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                adapterId: path.sourceInfo.adapterId,
                id: path.sourceInfo.id,
            },
            ..Default::default()
        };
        let source_status = unsafe { DisplayConfigGetDeviceInfo(&mut source.header) };
        if source_status != 0 {
            warning.get_or_insert_with(|| {
                format!("source-name query failed with code {source_status}")
            });
            continue;
        }

        let source_name = decode_utf16(&source.viewGdiDeviceName);
        if source_name.is_empty() {
            warning
                .get_or_insert_with(|| "source-name query returned an empty GDI name".to_owned());
            continue;
        }

        let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
                size: size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
                adapterId: path.targetInfo.adapterId,
                id: path.targetInfo.id,
            },
            ..Default::default()
        };
        let target_status = unsafe { DisplayConfigGetDeviceInfo(&mut target.header) };
        let friendly = if target_status == 0 {
            decode_utf16(&target.monitorFriendlyDeviceName)
        } else {
            warning.get_or_insert_with(|| {
                format!("target-name query failed with code {target_status}")
            });
            String::new()
        };

        names.push(PathNames {
            source: source_name,
            target_adapter_high: path.targetInfo.adapterId.HighPart,
            target_adapter_low: path.targetInfo.adapterId.LowPart,
            target_id: path.targetInfo.id,
            friendly,
            device_path: if target_status == 0 {
                decode_utf16(&target.monitorDevicePath).to_lowercase()
            } else {
                String::new()
            },
        });
    }

    if let Some(warning) = warning {
        log::warn!("Some DisplayConfig monitor metadata was unavailable: {warning}");
    }
    let grouped = group_friendly_names(&mut names);
    Ok(grouped)
}

fn active_display_paths()
-> Result<Vec<windows::Win32::Devices::Display::DISPLAYCONFIG_PATH_INFO>, String> {
    use windows::Win32::Devices::Display::{
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, GetDisplayConfigBufferSizes,
        QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig,
    };
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;

    for _ in 0..3 {
        let mut path_count = 0;
        let mut mode_count = 0;
        let size_status = unsafe {
            GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
        };
        if size_status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if size_status.0 != 0 {
            return Err(format!(
                "GetDisplayConfigBufferSizes returned {}",
                size_status.0
            ));
        }

        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        let query_status = unsafe {
            QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if query_status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if query_status.0 != 0 {
            return Err(format!("QueryDisplayConfig returned {}", query_status.0));
        }
        paths.truncate(path_count as usize);
        return Ok(paths);
    }

    Err("DisplayConfig topology changed during three query attempts".to_owned())
}

fn enum_display_friendly_name(source_name: &str) -> Option<String> {
    use std::mem::size_of;

    use windows::Win32::Graphics::Gdi::{
        DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICEW, EnumDisplayDevicesW,
    };
    use windows::core::PCWSTR;

    let source_name = source_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    for child_index in 0..32 {
        let mut child = DISPLAY_DEVICEW {
            cb: size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        let found = unsafe {
            EnumDisplayDevicesW(PCWSTR(source_name.as_ptr()), child_index, &mut child, 0)
        };
        if !found.as_bool() {
            break;
        }
        if child.StateFlags.contains(DISPLAY_DEVICE_ACTIVE) {
            let friendly = decode_utf16(&child.DeviceString);
            if !friendly.is_empty() {
                return Some(friendly);
            }
        }
    }
    None
}

/// Names and device paths of GDI-named monitors, for code that has no Tauri handle.
/// Display-config queries reach the display drivers and were run on every app-watcher refresh; with a virtual display
/// (spacedesk) that frequency made the dashboard drop frames. The answer only changes with the monitor set.
// ponytail: keyed by GDI names only, so a different monitor re-plugged under the same name keeps the old friendly name
// until the set changes; key by device path if that ever matters.
pub(crate) fn describe(names: &[String]) -> Vec<MonitorName> {
    static CACHE: std::sync::Mutex<Option<(Vec<String>, Vec<MonitorName>)>> =
        std::sync::Mutex::new(None);
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((key, rows)) = cache.as_ref()
        && key.as_slice() == names
    {
        return rows.clone();
    }
    let (display_config, enum_display) = windows_metadata(names);
    let rows = map_monitor_names(names, &display_config, &enum_display, None);
    *cache = Some((names.to_vec(), rows.clone()));
    rows
}

#[tauri::command]
pub async fn monitor_names(app: AppHandle) -> Result<Vec<MonitorName>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if monitors.is_empty() {
        return Ok(Vec::new());
    }

    let primary = app.primary_monitor().map_err(|error| error.to_string())?;
    let primary_name = primary.as_ref().and_then(Monitor::name).map(String::as_str);
    let names = monitors
        .iter()
        .map(|monitor| {
            monitor
                .name()
                .filter(|name| !name.trim().is_empty())
                .cloned()
                .ok_or_else(|| {
                    let message = "Tauri returned a monitor without a selectable GDI name";
                    log::error!("{message}");
                    message.to_owned()
                })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let (display_config, enum_display) = windows_metadata(&names);

    Ok(map_monitor_names(
        &names,
        &display_config,
        &enum_display,
        primary_name,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(source: &str, high: i32, low: u32, target: u32, friendly: &str) -> PathNames {
        PathNames {
            source: source.to_owned(),
            target_adapter_high: high,
            target_adapter_low: low,
            target_id: target,
            friendly: friendly.to_owned(),
            device_path: format!("path-{high}-{low}-{target}"),
        }
    }

    #[test]
    fn mirrored_targets_collapse_deterministically_by_source() {
        let mut forward = vec![
            metadata("\\\\.\\DISPLAY1", 0, 2, 4, "Later target"),
            metadata("\\\\.\\display1", 0, 1, 9, "First target"),
            metadata("\\\\.\\DISPLAY2", 0, 1, 1, "Other monitor"),
        ];
        let mut reversed = forward.iter().cloned().rev().collect::<Vec<_>>();
        let a = group_friendly_names(&mut forward);
        let b = group_friendly_names(&mut reversed);
        assert_eq!(a, b);
        assert_eq!(a.len(), 2);
        assert_eq!(a[&source_key("\\\\.\\DISPLAY1")].friendly, "First target");
        assert_eq!(a[&source_key("\\\\.\\DISPLAY1")].device_path, "path-0-1-9");
    }

    #[test]
    fn mapping_keeps_snapshot_order_one_based_ids_and_os_primary_name() {
        let names = vec!["DISPLAY2".to_owned(), "DISPLAY1".to_owned()];
        let display = HashMap::from([
            (
                source_key("DISPLAY1"),
                metadata("DISPLAY1", 0, 1, 1, "Same product"),
            ),
            (
                source_key("DISPLAY2"),
                metadata("DISPLAY2", 0, 1, 2, "Same product"),
            ),
        ]);
        let rows = map_monitor_names(&names, &display, &HashMap::new(), Some("DISPLAY1"));
        assert_eq!(rows[0].index, 1);
        assert_eq!(rows[1].index, 2);
        assert_eq!(rows[0].friendly, rows[1].friendly);
        assert!(!rows[0].primary);
        assert!(rows[1].primary);
        assert_eq!(rows[1].name, "DISPLAY1");
    }
}
