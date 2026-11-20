use std::time::Duration;

use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct UpdateState(Mutex<Option<Result<Option<Update>, String>>>);

impl UpdateState {
    async fn check(&self, app: &AppHandle, refresh: bool) -> Result<Option<String>, String> {
        let mut cached = self.0.lock().await;
        if refresh || cached.is_none() {
            *cached = Some(fetch_update(app).await.map_err(|error| error.to_string()));
        }
        match &*cached {
            Some(Ok(Some(update))) => Ok(Some(update.version.clone())),
            Some(Err(error)) => Err(error.clone()),
            _ => Ok(None),
        }
    }
}

async fn fetch_update(app: &AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    app.updater_builder()
        .timeout(Duration::from_secs(15))
        .build()?
        .check()
        .await
}

pub fn start(app: &AppHandle) {
    app.manage(UpdateState::default());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = app.state::<UpdateState>().check(&app, false).await {
            log::warn!("Update check failed: {error}");
        }
    });
}

#[tauri::command]
pub async fn update_check(
    window: WebviewWindow,
    state: State<'_, UpdateState>,
    refresh: bool,
) -> Result<Option<String>, String> {
    crate::panel::require_panel(&window)?;
    state.check(window.app_handle(), refresh).await
}

#[tauri::command]
pub async fn update_install(
    window: WebviewWindow,
    state: State<'_, UpdateState>,
    version: String,
) -> Result<(), String> {
    crate::panel::require_panel(&window)?;
    let cached = state.0.lock().await;
    let Some(Ok(Some(update))) = &*cached else {
        return Err("No update available".into());
    };
    if update.version != version {
        return Err("The available update changed".into());
    }
    // On Windows the updater exits the app and NSIS relaunches it after replacing the executable.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())
}
