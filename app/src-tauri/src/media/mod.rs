//! Windows media sessions: transport commands, the shared session worker and its artwork cache,
//! and the asset grants for saved slideshow files.
mod artwork;
mod model;
mod sessions;
mod target;

use artwork::ArtworkCache;
use model::Snapshot;
use sessions::Message;
use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::mpsc::{self, Sender};
use std::thread;
use target::Candidate;
use tauri::{AppHandle, Emitter as _, Manager as _, State, Webview};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};

struct Running {
    generation: u64,
    sender: Sender<Message>,
}

#[derive(Default)]
struct Inner {
    /// Webview labels, so a reloaded window re-subscribing does not stack up.
    subscribers: HashSet<String>,
    running: Option<Running>,
    generation: u64,
    latest: Option<Snapshot>,
}

/// One worker serves every subscriber; it runs only while at least one window is subscribed.
pub struct MediaHub {
    inner: Mutex<Inner>,
    artwork: Mutex<ArtworkCache>,
}

impl MediaHub {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("media-artwork");
        let artwork = ArtworkCache::new(dir)
            .map_err(|error| format!("could not prepare the artwork cache: {error}"))?;
        Ok(Self {
            inner: Mutex::default(),
            artwork: Mutex::new(artwork),
        })
    }

    fn sender(&self) -> Option<Sender<Message>> {
        let inner = self.inner.lock().ok()?;
        inner.running.as_ref().map(|running| running.sender.clone())
    }

    fn subscribe(&self, app: &AppHandle, label: &str) -> Result<Option<Snapshot>, String> {
        let mut inner = self.inner.lock().map_err(|_| "media hub poisoned")?;
        if inner.running.is_none() {
            let generation = inner.generation + 1;
            let (sender, receiver) = mpsc::channel();
            let app = app.clone();
            thread::Builder::new()
                .name("SupaDashboard media sessions".into())
                .spawn(move || sessions::run(app, generation, receiver))
                .map_err(|error| format!("could not start the media session worker: {error}"))?;
            inner.generation = generation;
            inner.running = Some(Running { generation, sender });
        }
        inner.subscribers.insert(label.to_owned());
        Ok(inner.latest.clone())
    }

    fn unsubscribe(&self, label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.subscribers.remove(label);
        if inner.subscribers.is_empty() {
            if let Some(running) = inner.running.take() {
                let _ = running.sender.send(Message::Stop);
            }
            inner.latest = None;
        }
    }

    /// Polls promptly: players answer a transport command a little late.
    fn wake(&self) {
        if let Some(sender) = self.sender() {
            let _ = sender.send(Message::Wake);
        }
    }

    /// A stopped worker cannot publish: its generation no longer matches.
    fn publish(&self, app: &AppHandle, generation: u64, snapshot: &Snapshot) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner
            .running
            .as_ref()
            .is_some_and(|running| running.generation == generation)
        {
            inner.latest = Some(snapshot.clone());
            let _ = app.emit("media-sessions", snapshot);
        }
    }

    fn pin_artwork<'a>(&self, current: impl Iterator<Item = &'a str>) {
        if let Ok(mut cache) = self.artwork.lock() {
            cache.pin(current);
        }
    }

    fn insert_artwork(&self, bytes: &[u8], declared: &str) -> Result<String, String> {
        self.artwork
            .lock()
            .map_err(|_| "artwork cache poisoned".to_owned())?
            .insert(bytes, declared)
    }

    async fn transport(&self, id: String, command: String) -> Result<bool, String> {
        let sender = self.sender().ok_or("media session is gone")?;
        let (reply, mut receiver) = tauri::async_runtime::channel(1);
        sender
            .send(Message::Transport { id, command, reply })
            .map_err(|_| "media session is gone".to_owned())?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "media worker stopped".to_owned())?
    }
}

/// `target` None / "any" = the session the system rules pick (see `target::pick_system`); otherwise an
/// app id, matched exactly first and by case-insensitive substring second (e.g. "spotify").
async fn session(target: Option<&str>) -> windows::core::Result<Option<(Session, String)>> {
    let manager = Manager::RequestAsync()?.await?;
    let current = manager.GetCurrentSession().ok();
    let sessions: Vec<Session> = manager.GetSessions()?.into_iter().collect();
    let ids = sessions
        .iter()
        .map(|s| s.SourceAppUserModelId().map(|id| id.to_string()))
        .collect::<windows::core::Result<Vec<_>>>()?;
    let candidates: Vec<Candidate> = sessions
        .iter()
        .zip(&ids)
        .map(|(s, app_id)| Candidate {
            app_id,
            playing: s
                .GetPlaybackInfo()
                .and_then(|info| info.PlaybackStatus())
                .is_ok_and(|status| status == Status::Playing),
            current: current.as_ref().is_some_and(|c| sessions::same(c, s)),
        })
        .collect();
    let picked = match target.filter(|t| !t.is_empty() && *t != "any") {
        None => target::pick_system(&candidates),
        Some(t) => target::pick_app(&candidates, t),
    };
    Ok(picked.map(|i| (sessions[i].clone(), ids[i].clone())))
}

/// With `session_id` the command goes to exactly that session of the running worker and fails when it
/// is gone; it never falls back to another app. Without it the target rules above apply.
#[tauri::command]
pub async fn media_command(
    target: Option<String>,
    command: String,
    session_id: Option<String>,
    hub: State<'_, MediaHub>,
) -> Result<bool, String> {
    let result = match session_id {
        Some(id) => hub.transport(id, command).await,
        None => {
            let result: windows::core::Result<Option<(String, windows::core::Result<bool>)>> =
                async {
                    let Some((s, app_id)) = session(target.as_deref()).await? else {
                        return Ok(None);
                    };
                    let sent = sessions::transport_op(&s, &command)?.await;
                    Ok(Some((app_id, sent)))
                }
                .await;
            match result {
                Ok(None) => Ok(false),
                Ok(Some((_, Ok(true)))) => Ok(true),
                Ok(Some((app_id, Ok(false)))) => {
                    Err(format!("{app_id} rejected the media command"))
                }
                Ok(Some((app_id, Err(error)))) => Err(format!("{app_id}: {error}")),
                Err(error) => Err(error.to_string()),
            }
        }
    };
    hub.wake();
    result
}

/// Starts (or joins) the shared session worker. Returns the latest snapshot when one exists; every
/// change arrives as the `media-sessions` event.
#[tauri::command]
pub fn media_sessions_subscribe(
    app: AppHandle,
    webview: Webview,
    hub: State<'_, MediaHub>,
) -> Result<Option<Snapshot>, String> {
    hub.subscribe(&app, webview.label())
}

#[tauri::command]
pub fn media_sessions_unsubscribe(webview: Webview, hub: State<'_, MediaHub>) {
    hub.unsubscribe(webview.label());
}

/// Grants the webview one cached cover and returns its file path. Only a handle from a session
/// snapshot resolves, and the grant covers that single file.
#[tauri::command]
pub fn media_artwork_resolve(
    app: AppHandle,
    handle: String,
    hub: State<'_, MediaHub>,
) -> Result<Option<String>, String> {
    let cache = hub.artwork.lock().map_err(|_| "artwork cache poisoned")?;
    let Some(path) = cache.path(&handle) else {
        return Ok(None);
    };
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Re-grants the asset protocol only the files that saved media controls still reference, and
/// forgets the grants older versions persisted. Access for a removed source ends at the next launch.
pub fn grant_saved_files(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let saved = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let scope = app.asset_protocol_scope();
    let controls = saved
        .as_ref()
        .and_then(|s| s["settings"]["controls"].as_array());
    for control in controls
        .into_iter()
        .flatten()
        .filter(|c| c["type"] == "media")
    {
        for source in control["options"]["sources"]
            .as_array()
            .into_iter()
            .flatten()
        {
            if let (Some("file"), Some(path)) = (source["kind"].as_str(), source["value"].as_str())
            {
                let _ = scope.allow_file(path);
            }
        }
    }
    for name in [".persisted-scope", ".persisted-scope-asset"] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}
