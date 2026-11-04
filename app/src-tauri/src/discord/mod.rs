mod auth;
mod client;
mod crypto;
mod frame;
mod model;
mod rpc;
mod store;
mod voice;

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
pub enum VoiceCommand {
    ToggleMute,
    ToggleDeaf,
    Leave,
    Rejoin,
}

enum Operation {
    Authorize(String),
    Logout,
    Voice(VoiceCommand),
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
pub struct DiscordHub {
    inner: Mutex<Inner>,
    worker: Arc<tokio::sync::Mutex<()>>,
}

impl DiscordHub {
    fn subscribe(&self, app: &AppHandle, label: &str) -> Result<Value, String> {
        allowed_window(label)?;
        let mut inner = self.inner.lock().map_err(|_| "Discord hub unavailable")?;
        if inner.running.is_none() {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|_| "Discord data directory unavailable")?
                .join("discord.json");
            inner.generation = inner
                .generation
                .checked_add(1)
                .ok_or("Discord generation exhausted")?;
            let (sender, receiver) = mpsc::channel(32);
            let worker = self.worker.clone();
            let app = app.clone();
            let generation = inner.generation;
            let task = tauri::async_runtime::spawn(async move {
                // Abort releases the old pipe before a replacement worker can open another.
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

    fn unsubscribe(&self, label: &str) {
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
        if inner.running.is_some() && inner.generation == generation {
            inner.latest = Some(view.clone());
            // Never expose account/channel state to embedded content webviews.
            for label in &inner.subscribers {
                if let Err(error) = app.emit_to(label, "discord-state", &view) {
                    log::warn!("Could not publish Discord state: {error}");
                }
            }
        }
    }

    async fn operation(&self, operation: Operation) -> Result<(), String> {
        let sender = self
            .inner
            .lock()
            .map_err(|_| "Discord hub unavailable")?
            .running
            .as_ref()
            .map(|running| running.sender.clone())
            .ok_or("Connect Discord first")?;
        let (reply, receiver) = oneshot::channel();
        sender
            .try_send(Message { operation, reply })
            .map_err(|_| "Discord is busy")?;
        tokio::time::timeout(Duration::from_secs(185), receiver)
            .await
            .map_err(|_| "Discord operation timed out")?
            .map_err(|_| "Discord connection stopped")?
    }
}

fn allowed_window(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "panel") {
        Ok(())
    } else {
        Err("Discord access denied".into())
    }
}

#[tauri::command]
pub fn discord_subscribe(
    app: AppHandle,
    webview: Webview,
    hub: State<'_, DiscordHub>,
) -> Result<Value, String> {
    hub.subscribe(&app, webview.label())
}

#[tauri::command]
pub fn discord_unsubscribe(webview: Webview, hub: State<'_, DiscordHub>) {
    hub.unsubscribe(webview.label());
}

#[tauri::command]
pub async fn discord_authorize(
    client_id: String,
    webview: Webview,
    hub: State<'_, DiscordHub>,
) -> Result<(), String> {
    if webview.label() != "panel" {
        return Err("Discord access denied".into());
    }
    let client_id = client_id.trim();
    if !model::valid_id(client_id) {
        return Err("Invalid Discord client ID".into());
    }
    hub.operation(Operation::Authorize(client_id.into())).await
}

#[tauri::command]
pub async fn discord_logout(webview: Webview, hub: State<'_, DiscordHub>) -> Result<(), String> {
    if webview.label() != "panel" {
        return Err("Discord access denied".into());
    }
    hub.operation(Operation::Logout).await
}

#[tauri::command]
pub async fn discord_voice(
    command: VoiceCommand,
    webview: Webview,
    hub: State<'_, DiscordHub>,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Discord access denied".into());
    }
    hub.operation(Operation::Voice(command)).await
}
