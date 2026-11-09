//! Plugin host: plugins are JS/TS bundles in one `.sdplugin` file each (`<app data>/plugins/<id>.sdplugin`), checked
//! and kept open from discovery on and served by the `plugin` scheme. What a plugin may reach natively is declared in
//! its manifest's `permissions`.
mod archive;
mod catalogue;
#[expect(dead_code, reason = "the plugin capability commands use the rest")]
mod http;
pub mod install;
#[expect(dead_code, reason = "the plugin capability commands use it")]
mod job;
mod manifest;
mod migrate;
#[expect(dead_code, reason = "the plugin capability commands use it")]
mod open;
pub mod opened;
mod permissions;
pub mod protocol;
#[expect(dead_code, reason = "the plugin capability commands use the rest")]
mod secure;
mod trust;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager, State};

use archive::Archive;
use manifest::{Manifest, valid_id};
use permissions::Permissions;
use trust::Trust;

pub struct Plugin {
    manifest: Manifest,
    archive: Archive,
    trust: Trust,
    /// Unix milliseconds of the file's last change.
    updated: u64,
}

pub struct PluginHost {
    plugins: Mutex<HashMap<String, Arc<Plugin>>>,
    /// The app data root: plugins live in `plugins/`, their data in `plugin-data/`.
    legacy: PathBuf,
    /// One install or removal at a time, so two never share a staging file.
    changing: tokio::sync::Mutex<()>,
}

/// Opens and checks a plugin file; the archive stays open, so what is served later is what was checked here.
fn load(path: &Path) -> Result<Plugin, String> {
    let archive = Archive::open(path)?;
    let manifest = archive
        .read("plugin.json")
        .ok_or("No plugin.json in this file")?;
    let manifest = Manifest::parse(&manifest)?;
    if !archive.has("ui/index.js") || !archive.has("ui/index.css") {
        return Err("The plugin has no UI bundle".into());
    }
    let trust = trust::check(&archive, &manifest)?;
    let updated = std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64);
    Ok(Plugin {
        manifest,
        archive,
        trust,
        updated,
    })
}

impl PluginHost {
    /// The plugins in `<app data>/plugins/<id>.sdplugin`; files that do not check out are skipped. Folders are the
    /// version 1 install form and are ignored.
    pub fn discover(app: &AppHandle) -> Result<Self, String> {
        let host = Self {
            plugins: Mutex::default(),
            legacy: app.path().app_data_dir().map_err(|e| e.to_string())?,
            changing: tokio::sync::Mutex::default(),
        };
        let root = host.root();
        let entries = std::fs::read_dir(&root).into_iter().flatten().flatten();
        for name in entries.filter_map(|entry| entry.file_name().into_string().ok()) {
            // Dot files are an install's staging and kept copies.
            let Some(id) = name.strip_suffix(".sdplugin").filter(|id| valid_id(id)) else {
                continue;
            };
            match load(&root.join(&name)) {
                Ok(plugin) if plugin.manifest.id == id => host.add(plugin),
                Ok(_) => log::warn!("Skipped plugin {name}: its id differs from the file name"),
                Err(error) => log::warn!("Skipped plugin {name}: {error}"),
            }
        }
        Ok(host)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<Plugin>>> {
        self.plugins.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// `<app data>/plugins`, where installs go.
    fn root(&self) -> PathBuf {
        self.legacy.join("plugins")
    }

    /// Moves what the in-app version kept in the app data root into the plugin's data folder, then lists it.
    fn add(&self, plugin: Plugin) {
        let id = plugin.manifest.id.clone();
        let data = self.legacy.join("plugin-data").join(&id);
        if let Err(error) = migrate::migrate(&self.legacy, &data, &plugin.manifest.migrate) {
            log::warn!("Plugin {id} data was not moved: {error}");
        }
        self.lock().insert(id, Arc::new(plugin));
    }

    /// Only the UI bundle and assets are served. Reads outside the lock: an entry read goes to disk.
    fn ui_file(&self, id: &str, file: &str) -> Option<Vec<u8>> {
        if !file.starts_with("ui/") && !file.starts_with("assets/") {
            return None;
        }
        let plugin = self.lock().get(id)?.clone();
        plugin.archive.read(file)
    }
}

/// What the frontend learns about an installed plugin; `size` in bytes, `updated` in Unix milliseconds.
#[derive(serde::Serialize)]
pub struct Listed {
    id: String,
    version: String,
    api: u32,
    trust: Trust,
    permissions: Permissions,
    size: u64,
    updated: u64,
}

impl Listed {
    fn of(plugin: &Plugin) -> Self {
        Self {
            id: plugin.manifest.id.clone(),
            version: plugin.manifest.version.clone(),
            api: plugin.manifest.api,
            trust: plugin.trust,
            permissions: plugin.manifest.permissions.clone(),
            size: plugin.archive.size(),
            updated: plugin.updated,
        }
    }
}

#[tauri::command]
pub fn plugin_list(host: State<'_, PluginHost>) -> Vec<Listed> {
    host.lock()
        .values()
        .map(|plugin| Listed::of(plugin))
        .collect()
}
