mod api;
mod auth;
mod client;
pub(crate) mod shuffle;
mod store;

use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Command {
    Like,
    Unlike,
    Dislike,
}
enum Operation {
    Authorize(String),
    Logout,
    Command(Command),
    Shuffle(shuffle::Mode),
}
struct Message {
    operation: Operation,
    reply: oneshot::Sender<Result<(), String>>,
}
struct Running {
    sender: mpsc::Sender<Message>,
    task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
struct Inner {
    subscribers: HashSet<String>,
    generation: u64,
    running: Option<Running>,
    latest: Option<Value>,
}
#[derive(Default)]
pub struct SpotifyHub {
    inner: Mutex<Inner>,
    worker: Arc<tokio::sync::Mutex<()>>,
}

impl SpotifyHub {
    fn subscribe(&self, app: &AppHandle, label: &str) -> Result<Value, String> {
        allowed(label)?;
        let mut inner = self.inner.lock().map_err(|_| "Spotify unavailable")?;
        if inner.running.is_none() {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|_| "Spotify data directory unavailable")?
                .join("spotify.json");
            inner.generation = inner
                .generation
                .checked_add(1)
                .ok_or("Spotify generation exhausted")?;
            let generation = inner.generation;
            let (sender, receiver) = mpsc::channel(32);
            let app = app.clone();
            let worker = self.worker.clone();
            let task = tauri::async_runtime::spawn(async move {
                let _lease = worker.lock().await;
                client::run(app, generation, path, receiver).await;
            });
            inner.running = Some(Running { sender, task });
        }
        inner.subscribers.insert(label.into());
        Ok(inner
            .latest
            .clone()
            .unwrap_or_else(|| json!({"state":"connecting"})))
    }

    pub fn unsubscribe(&self, label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.subscribers.remove(label);
        if inner.subscribers.is_empty() {
            if let Some(running) = inner.running.take() {
                running.task.abort();
            }
            inner.latest = None;
        }
    }

    fn publish(&self, app: &AppHandle, generation: u64, view: Value) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.running.is_none()
            || generation != inner.generation
            || inner.latest.as_ref() == Some(&view)
        {
            return;
        }
        inner.latest = Some(view.clone());
        for label in &inner.subscribers {
            if let Err(error) = app.emit_to(label, "spotify-state", &view) {
                log::warn!("Could not publish Spotify state: {error}");
            }
        }
    }

    async fn operation(&self, operation: Operation) -> Result<(), String> {
        let sender = self
            .inner
            .lock()
            .map_err(|_| "Spotify unavailable")?
            .running
            .as_ref()
            .map(|r| r.sender.clone())
            .ok_or("Connect Spotify first")?;
        let (reply, receiver) = oneshot::channel();
        sender
            .try_send(Message { operation, reply })
            .map_err(|_| "Spotify is busy")?;
        tokio::time::timeout(Duration::from_secs(325), receiver)
            .await
            .map_err(|_| "Spotify operation timed out")?
            .map_err(|_| "Spotify connection stopped")?
    }
}

fn allowed(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "panel") {
        Ok(())
    } else {
        Err("Spotify access denied".into())
    }
}

#[tauri::command]
pub fn spotify_subscribe(
    app: AppHandle,
    webview: Webview,
    hub: State<'_, SpotifyHub>,
) -> Result<Value, String> {
    hub.subscribe(&app, webview.label())
}
#[tauri::command]
pub fn spotify_unsubscribe(webview: Webview, hub: State<'_, SpotifyHub>) {
    hub.unsubscribe(webview.label());
}
#[tauri::command]
pub async fn spotify_authorize(
    client_id: String,
    webview: Webview,
    hub: State<'_, SpotifyHub>,
) -> Result<(), String> {
    if webview.label() != "panel" {
        return Err("Spotify access denied".into());
    }
    let id = client_id.trim();
    if !auth::valid_id(id) {
        return Err("Invalid Spotify client ID".into());
    }
    hub.operation(Operation::Authorize(id.into())).await
}
#[tauri::command]
pub async fn spotify_logout(webview: Webview, hub: State<'_, SpotifyHub>) -> Result<(), String> {
    if webview.label() != "panel" {
        return Err("Spotify access denied".into());
    }
    hub.operation(Operation::Logout).await
}
#[tauri::command]
pub async fn spotify_command(
    op: Command,
    webview: Webview,
    hub: State<'_, SpotifyHub>,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Spotify access denied".into());
    }
    hub.operation(Operation::Command(op)).await
}
