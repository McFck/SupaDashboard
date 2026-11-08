//! Plugin host: each plugin's native part runs as its own process, started while the plugin is enabled.
//! The frontend reaches it only through `plugin_call`; its events arrive as `plugin://<id>/<event>`.
mod catalogue;
mod host_api;
pub mod install;
mod job;
mod manifest;
mod migrate;
mod process;
pub mod protocol;
mod restarts;
mod supervisor;
mod trust;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use job::Job;
use manifest::Manifest;
use protocol::Ui;
use supervisor::Supervisor;
use trust::Trust;

pub struct Plugin {
    manifest: Manifest,
    folder: PathBuf,
    /// The plugin's own data folder, `<app data>/plugin-data/<id>`.
    data: PathBuf,
    /// The app data root, where the in-app version kept the files listed in `migrate`.
    legacy: PathBuf,
    ui: Option<Ui>,
    trust: Trust,
    /// Bytes on disk.
    size: u64,
    /// Unix milliseconds of `plugin.json`'s last change.
    updated: u64,
}

/// A plugin without an executable has no supervisor.
#[derive(Clone)]
struct Installed {
    plugin: Arc<Plugin>,
    supervisor: Option<Supervisor>,
}

pub struct PluginHost {
    plugins: Mutex<HashMap<String, Installed>>,
    job: Arc<Job>,
    app: AppHandle,
    /// The app data root: user plugins live in `plugins/`, their data in `plugin-data/`.
    legacy: PathBuf,
    /// One install or removal at a time, so two never share a staging folder.
    changing: tokio::sync::Mutex<()>,
}

/// What `load` read and checked in a plugin folder.
struct Loaded {
    manifest: Manifest,
    ui: Option<Ui>,
    trust: Trust,
    size: u64,
    updated: u64,
}

impl PluginHost {
    /// The plugins in `<app data>/plugins`; folders whose release signature does not hold are skipped.
    pub fn discover(app: &AppHandle) -> Result<Self, String> {
        let host = Self {
            plugins: Mutex::default(),
            job: Arc::new(Job::new().map_err(|error| error.to_string())?),
            app: app.clone(),
            legacy: app.path().app_data_dir().map_err(|e| e.to_string())?,
            changing: tokio::sync::Mutex::default(),
        };
        let entries = std::fs::read_dir(host.root())
            .into_iter()
            .flatten()
            .flatten();
        for folder in entries.map(|entry| entry.path()) {
            let name = folder.file_name().and_then(|name| name.to_str());
            // Dot folders are an install's staging and kept copies.
            let Some(id) = name.filter(|name| !name.starts_with('.') && folder.is_dir()) else {
                continue;
            };
            match load(&folder, id) {
                Ok(loaded) => host.add(folder, loaded),
                Err(error) => log::warn!("Skipped plugin {}: {error}", folder.display()),
            }
        }
        Ok(host)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Installed>> {
        self.plugins.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// `<app data>/plugins`, where installs go.
    fn root(&self) -> PathBuf {
        self.legacy.join("plugins")
    }

    fn get(&self, id: &str) -> Option<Installed> {
        self.lock().get(id).cloned()
    }

    fn add(&self, folder: PathBuf, loaded: Loaded) {
        let id = loaded.manifest.id.clone();
        let plugin = Arc::new(Plugin {
            folder,
            data: self.legacy.join("plugin-data").join(&id),
            legacy: self.legacy.clone(),
            ui: loaded.ui,
            trust: loaded.trust,
            size: loaded.size,
            updated: loaded.updated,
            manifest: loaded.manifest,
        });
        let supervisor = plugin
            .manifest
            .exe
            .is_some()
            .then(|| Supervisor::new(plugin.clone(), self.job.clone(), self.app.clone()));
        self.lock().insert(id, Installed { plugin, supervisor });
    }

    /// Ends what running plugins hold for a closed window (subscriptions).
    pub fn window_closed(&self, window: &str) {
        for installed in self.lock().values() {
            if let Some(supervisor) = &installed.supervisor {
                supervisor.window_closed(window);
            }
        }
    }

    fn ui_file(&self, id: &str, file: &str) -> Option<Vec<u8>> {
        Some(
            self.lock()
                .get(id)?
                .plugin
                .ui
                .as_ref()?
                .file(file)?
                .to_vec(),
        )
    }
}

/// Reads and checks the folder of plugin `id`; the UI bytes read here are the ones the plugin scheme serves.
fn load(folder: &Path, id: &str) -> Result<Loaded, String> {
    let text = std::fs::read_to_string(folder.join("plugin.json")).map_err(|e| e.to_string())?;
    let manifest = Manifest::parse(&text, id)?;
    if let Some(exe) = &manifest.exe
        && !folder.join(exe).is_file()
    {
        return Err(format!("{exe} is missing"));
    }
    let ui = manifest.api.map(|_| Ui::read(folder)).transpose()?;
    let trust = trust::check(folder, &manifest, ui.as_ref())?;
    let updated = std::fs::metadata(folder.join("plugin.json"))
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64);
    Ok(Loaded {
        manifest,
        ui,
        trust,
        size: size(folder),
        updated,
    })
}

fn size(path: &Path) -> u64 {
    let entries = std::fs::read_dir(path).into_iter().flatten().flatten();
    entries
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |meta| meta.len()),
            _ => 0,
        })
        .sum()
}

#[derive(serde::Serialize)]
pub struct Listed {
    id: String,
    version: String,
    /// `None` for a plugin without a UI bundle.
    api: Option<u32>,
    trust: Trust,
    size: u64,
    updated: u64,
}

#[tauri::command]
pub fn plugin_list(host: State<'_, PluginHost>) -> Vec<Listed> {
    host.lock()
        .values()
        .map(|Installed { plugin, .. }| Listed {
            id: plugin.manifest.id.clone(),
            version: plugin.manifest.version.clone(),
            api: plugin.manifest.api,
            trust: plugin.trust,
            size: plugin.size,
            updated: plugin.updated,
        })
        .collect()
}

#[tauri::command]
pub async fn plugin_call(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    plugin: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let installed = host.get(&plugin).ok_or("Plugin is not installed")?;
    let label = window.label();
    if !installed.plugin.manifest.allows(label, &method) {
        return Err(format!("Plugin {plugin} does not allow {method}"));
    }
    let supervisor = installed.supervisor.ok_or("Plugin has no native part")?;
    supervisor.call(method, params, label.into()).await
}

#[tauri::command]
pub async fn plugin_set_enabled(
    host: State<'_, PluginHost>,
    plugin: String,
    enabled: bool,
) -> Result<(), String> {
    // Plugins without a native part have nothing to start or stop.
    if let Some(supervisor) = host.get(&plugin).and_then(|installed| installed.supervisor) {
        supervisor.set_enabled(enabled).await;
    }
    Ok(())
}
