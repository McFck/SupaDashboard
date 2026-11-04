//! App control: open, focus, toggle, minimize and close any app, and watch its live state.
mod actions;
mod exit;
mod icon_store;
mod icons;
pub mod identity;
mod list;
mod model;
mod placement;
mod quit;
#[cfg(test)]
mod request_tests;
mod selection;
mod steam;
pub mod watch;
mod windows;

use list::AppRow;
use model::{Request, parse_key, parse_request};
use selection::WindowSelection;
use tauri::{AppHandle, Emitter, Manager, State};
use watch::{AppsHub, WatchSet, Watched};

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn apps_list(keys: Option<Vec<String>>) -> Result<Vec<AppRow>, String> {
    blocking(move || {
        for raw in keys.unwrap_or_default().into_iter().take(512) {
            if let Ok(key) = parse_key(&raw) {
                let _ = identity::matcher(&key);
            }
        }
        list::list()
    })
    .await
}

#[tauri::command]
pub async fn apps_icon(
    handle: AppHandle,
    app: String,
    refresh: Option<bool>,
) -> Result<Option<Vec<u8>>, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("icons");
    let key = app.clone();
    let refresh = refresh.unwrap_or(false);
    let bytes = blocking(move || icons::get(&dir, &app, refresh)).await?;
    if refresh {
        handle
            .emit(
                "app-icon",
                serde_json::json!({ "key": key, "bytes": bytes }),
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn app_command(request: Request) -> Result<(), String> {
    let command = parse_request(request)?;
    blocking(move || {
        let matcher = identity::matcher(&command.key)?;
        actions::execute(&command, &matcher)
    })
    .await
}

/// The titles of the app's windows right now, for the "Specific window" picker.
#[tauri::command]
pub async fn app_windows(app: String) -> Result<Vec<String>, String> {
    let key = parse_key(&app)?;
    blocking(move || {
        let matcher = identity::matcher(&key)?;
        let mut names = identity::Names::default();
        let wins = windows::Scan::new(&mut names).windows(&matcher);
        Ok(selection::titles(&wins))
    })
    .await
}

/// Replaces the watched set and returns its current state. A key that cannot be resolved is left out.
#[tauri::command]
pub async fn apps_watch(
    app: AppHandle,
    hub: State<'_, AppsHub>,
    keys: Vec<String>,
    selections: Vec<WindowSelection>,
) -> Result<Vec<Watched>, String> {
    for selection in &selections {
        selection.validate()?;
    }
    let matchers = blocking(move || {
        Ok(keys
            .iter()
            .filter_map(|key| parse_key(key).ok())
            .filter_map(|key| identity::matcher(&key).ok())
            .collect::<Vec<_>>())
    })
    .await?;
    if matchers.is_empty() {
        hub.unwatch();
        return Ok(Vec::new());
    }
    let matchers = WatchSet {
        matchers,
        selections,
    };
    let initial = matchers.clone();
    hub.watch(&app, matchers)?;
    blocking(move || Ok(watch::current(&initial))).await
}

#[tauri::command]
pub fn apps_unwatch(hub: State<'_, AppsHub>) {
    hub.unwatch();
}
