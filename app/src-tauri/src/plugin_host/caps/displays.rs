use serde::Serialize;
use tauri::{AppHandle, State};

use crate::monitors::named_monitors;
use crate::plugin_host::{PluginHost, permissions::Permissions};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    label: String,
    left: i32,
    top: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

fn check(permissions: &Permissions) -> Result<(), String> {
    if permissions.displays {
        Ok(())
    } else {
        Err("Display information is not allowed".into())
    }
}

#[tauri::command]
pub async fn plugin_displays_list(
    app: AppHandle,
    host: State<'_, PluginHost>,
    plugin: String,
) -> Result<Vec<Display>, String> {
    check(&host.installed(&plugin)?.manifest.permissions)?;
    Ok(named_monitors(&app)?
        .into_iter()
        .map(|(monitor, name)| Display {
            label: name.friendly,
            left: monitor.position().x,
            top: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale_factor: monitor.scale_factor(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_information_requires_an_explicit_grant() {
        for (manifest, granted) in [
            ("{}", false),
            (r#"{"displays":false}"#, false),
            (r#"{"displays":true}"#, true),
        ] {
            let permissions = serde_json::from_str(manifest).unwrap();
            assert_eq!(check(&permissions).is_ok(), granted);
        }
    }
}
