//! App control: open, focus, toggle, minimize and close any app, and watch its live state.
mod actions;
mod exit;
pub mod identity;
mod list;
mod model;
#[cfg(test)]
mod request_tests;
mod selection;
pub mod watch;
mod windows;

use list::AppRow;
use model::{Request, parse_key, parse_request};
use tauri::{AppHandle, State};
use watch::{AppsHub, Watched};

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn apps_list() -> Result<Vec<AppRow>, String> {
    blocking(list::list).await
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

/// Replaces the watched set and returns its current state. A key that cannot be resolved is left out.
#[tauri::command]
pub async fn apps_watch(
    app: AppHandle,
    hub: State<'_, AppsHub>,
    keys: Vec<String>,
) -> Result<Vec<Watched>, String> {
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
    let initial = matchers.clone();
    hub.watch(&app, matchers)?;
    blocking(move || Ok(watch::current(&initial))).await
}

#[tauri::command]
pub fn apps_unwatch(hub: State<'_, AppsHub>) {
    hub.unwatch();
}
