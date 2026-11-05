//! Debug-only data isolation and the panel's explicit release export.
mod copy;
mod processes;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindow};

static COPYING: Mutex<()> = Mutex::new(());

pub fn context(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    context.config_mut().app.app_directories_override =
        Some(tauri::utils::config::AppDirectoriesOverride::Root(
            format!("$DATA/{}.dev", context.config().identifier).into(),
        ));
    context
}

pub fn seed(app: &AppHandle) -> Result<(), String> {
    let dev = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let release = app
        .path()
        .data_dir()
        .map_err(|e| e.to_string())?
        .join(&app.config().identifier);
    copy::seed(&release, &dev).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_settings_to_release(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    crate::panel::require_panel(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COPYING.try_lock().map_err(|_| "Copy already in progress")?;
        processes::require_release_stopped()?;
        let dev = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let release = app
            .path()
            .data_dir()
            .map_err(|e| e.to_string())?
            .join(&app.config().identifier);
        use std::os::windows::fs::OpenOptionsExt;
        // Deny sharing also excludes an export from a second dev process.
        let _lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .share_mode(0)
            .open(release.with_extension("copy-lock"))
            .map_err(|_| "Copy already in progress")?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
            .to_string();
        copy::export(&dev, &release, &stamp, processes::require_release_stopped)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
