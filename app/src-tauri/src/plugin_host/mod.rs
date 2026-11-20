//! Plugin host: plugins are JS/TS bundles in one `.sdplugin` file each (`<app data>/plugins/<id>.sdplugin`), checked
//! and kept open from discovery on and served by the `plugin` scheme. What a plugin may reach natively is declared in
//! its manifest's `permissions`, subject to the owner's saved approval.
mod archive;
pub mod caps;
mod catalogue;
mod consent;
#[cfg(any(debug_assertions, test))]
mod dev;
mod http;
pub mod install;
mod job;
mod manifest;
mod migrate;
pub mod opened;
mod permissions;
pub mod power;
pub mod protocol;
mod secure;
mod state;
mod trust;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex, MutexGuard, PoisonError,
    atomic::{AtomicU32, Ordering},
};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use archive::Archive;
use consent::Approvals;
use manifest::{Manifest, valid_id};
use permissions::Permissions;
use state::PluginState;
use trust::Trust;

static NEXT_REVISION: AtomicU32 = AtomicU32::new(1);

pub struct Plugin {
    manifest: Manifest,
    source: Source,
    trust: Trust,
    /// Unix milliseconds of the file's last change.
    updated: u64,
    revision: AtomicU32,
}

impl Plugin {
    fn is_dev(&self) -> bool {
        match self.source {
            Source::Archive(_) => false,
            #[cfg(debug_assertions)]
            Source::Folder(_) => true,
        }
    }
}

enum Source {
    Archive(Archive),
    #[cfg(debug_assertions)]
    Folder(PathBuf),
}

pub struct PluginHost {
    plugins: Mutex<HashMap<String, Arc<Plugin>>>,
    #[cfg(debug_assertions)]
    dev: Mutex<HashMap<String, Arc<Plugin>>>,
    /// The app data root: plugins live in `plugins/`, their data in `plugin-data/`.
    legacy: PathBuf,
    approvals: Mutex<Result<Approvals, String>>,
    state: Mutex<Result<PluginState, String>>,
    /// One install or removal at a time, so two never share a staging file.
    changing: tokio::sync::Mutex<()>,
    caps: caps::Caps,
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
    trust::admitted(trust, cfg!(debug_assertions))?;
    let updated = std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as u64);
    Ok(Plugin {
        manifest,
        source: Source::Archive(archive),
        trust,
        updated,
        revision: AtomicU32::new(NEXT_REVISION.fetch_add(1, Ordering::Relaxed)),
    })
}

impl PluginHost {
    /// The plugins in `<app data>/plugins/<id>.sdplugin`; files that do not check out are skipped. Folders are the
    /// version 1 install form and are ignored.
    pub fn discover(app: &AppHandle) -> Result<Self, String> {
        let legacy = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let root = legacy.join("plugins");
        install::recover(&root);
        let mut plugins = HashMap::new();
        let entries = std::fs::read_dir(&root).into_iter().flatten().flatten();
        for name in entries.filter_map(|entry| entry.file_name().into_string().ok()) {
            // Dot files are an install's staging and kept copies.
            let Some(id) = name.strip_suffix(".sdplugin").filter(|id| valid_id(id)) else {
                continue;
            };
            match load(&root.join(&name)) {
                Ok(plugin) if plugin.manifest.id == id => {
                    plugins.insert(id.to_owned(), plugin);
                }
                Ok(_) => log::warn!("Skipped plugin {name}: its id differs from the file name"),
                Err(error) => log::warn!("Skipped plugin {name}: {error}"),
            }
        }
        #[cfg(debug_assertions)]
        let dev = dev::discover();
        let approvals = Approvals::load(&legacy, || {
            let installed = plugins.values();
            #[cfg(debug_assertions)]
            let installed = installed.chain(dev.values().map(Arc::as_ref));
            installed
                .map(|plugin| {
                    (
                        plugin.manifest.id.clone(),
                        plugin.manifest.permissions.clone(),
                    )
                })
                .collect()
        });
        if let Err(error) = &approvals {
            log::warn!("Could not read plugin approvals: {error}");
        }
        let state = PluginState::load(&legacy);
        if let Err(error) = &state {
            log::warn!("{error}");
        }
        let host = Self {
            plugins: Mutex::default(),
            #[cfg(debug_assertions)]
            dev: Mutex::new(dev),
            legacy,
            approvals: Mutex::new(approvals),
            state: Mutex::new(state),
            changing: tokio::sync::Mutex::default(),
            caps: caps::Caps::default(),
        };
        for plugin in plugins.into_values() {
            host.add(plugin);
        }
        Ok(host)
    }

    #[cfg(debug_assertions)]
    pub fn watch_dev(app: &AppHandle) -> std::io::Result<()> {
        dev::start(app)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<Plugin>>> {
        self.plugins.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn get(&self, id: &str) -> Option<Arc<Plugin>> {
        #[cfg(debug_assertions)]
        if let Some(plugin) = self
            .dev
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
        {
            return Some(plugin.clone());
        }
        self.lock().get(id).cloned()
    }

    fn approvals(&self) -> MutexGuard<'_, Result<Approvals, String>> {
        self.approvals
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn state(&self) -> MutexGuard<'_, Result<PluginState, String>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn change_state(
        &self,
        change: impl FnOnce(&mut PluginState) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut state = self.state();
        let current = state.as_mut().map_err(|error| error.clone())?;
        let mut next = current.clone();
        change(&mut next)?;
        next.save(&self.legacy)?;
        *current = next;
        Ok(())
    }

    fn pending(plugin: &Plugin, approvals: Option<&Approvals>) -> Option<Permissions> {
        let empty = Permissions::default();
        let approved = approvals
            .and_then(|store| store.get(&plugin.manifest.id))
            .unwrap_or(&empty);
        let added = plugin.manifest.permissions.added_since(approved);
        (added != empty).then_some(added)
    }

    /// Every native grant comes from the current manifest after checking it is covered by approval.
    fn installed(&self, id: &str) -> Result<Arc<Plugin>, String> {
        let plugin = self.get(id).ok_or("Plugin is not installed")?;
        if !plugin.is_dev() {
            let state = self.state();
            if !state.as_ref().map_err(|error| error.clone())?.enabled(id) {
                return Err("Plugin is disabled".into());
            }
        }
        if Self::pending(&plugin, self.approvals().as_ref().ok()).is_some() {
            return Err("Plugin permissions need approval".into());
        }
        Ok(plugin)
    }

    fn approve(&self, id: &str, added: &Permissions) -> Result<(), String> {
        let plugin = self.get(id).ok_or("Plugin is not installed")?;
        let mut approvals = self.approvals();
        let store = approvals.as_mut().map_err(|error| error.clone())?;
        if Self::pending(&plugin, Some(store)).as_ref() != Some(added) {
            return Err("Plugin permission request changed".into());
        }
        store.approve(&self.legacy, id, &plugin.manifest.permissions)
    }

    fn require_installed_source(&self, id: &str) -> Result<(), String> {
        #[cfg(debug_assertions)]
        if self
            .get(id)
            .is_some_and(|plugin| plugin.trust == Trust::Dev)
        {
            return Err("Plugin is loaded from a development folder".into());
        }
        let _ = id;
        Ok(())
    }

    /// `<app data>/plugins`, where installs go.
    fn root(&self) -> PathBuf {
        self.legacy.join("plugins")
    }

    /// `<app data>/plugin-data/<id>`, the plugin's own files.
    fn data(&self, id: &str) -> PathBuf {
        self.legacy.join("plugin-data").join(id)
    }

    /// Unlists a plugin (its file closes once no scheme read holds it) and releases its native resources.
    fn take(&self, id: &str) {
        drop(self.lock().remove(id));
        self.caps.forget(id);
    }

    /// Moves what the in-app version kept in the app data root into the plugin's data folder, then lists it.
    fn add(&self, plugin: Plugin) {
        let id = plugin.manifest.id.clone();
        let data = self.data(&id);
        if let Err(error) = migrate::migrate(&self.legacy, &data, &plugin.manifest.migrate) {
            log::warn!("Plugin {id} data was not moved: {error}");
        }
        self.lock().insert(id, Arc::new(plugin));
    }

    /// Only the UI bundle and assets are served. Reads outside the lock: an entry read goes to disk.
    fn ui_file(&self, id: &str, file: &str, revision: Option<u32>) -> Option<Vec<u8>> {
        if !file.starts_with("ui/") && !file.starts_with("assets/") {
            return None;
        }
        let plugin = self.installed(id).ok()?;
        if revision.is_some_and(|revision| revision != plugin.revision.load(Ordering::Relaxed)) {
            return None;
        }
        match &plugin.source {
            Source::Archive(archive) => archive.read(file),
            #[cfg(debug_assertions)]
            Source::Folder(path) => dev::read(path, file),
        }
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
    #[serde(rename = "newPermissions", skip_serializing_if = "Option::is_none")]
    new_permissions: Option<Permissions>,
    size: u64,
    updated: u64,
    revision: u32,
    enabled: bool,
}

impl Listed {
    fn of(plugin: &Plugin, approvals: Option<&Approvals>, state: Option<&PluginState>) -> Self {
        Self {
            id: plugin.manifest.id.clone(),
            version: plugin.manifest.version.clone(),
            api: plugin.manifest.api,
            trust: plugin.trust,
            permissions: plugin.manifest.permissions.clone(),
            new_permissions: PluginHost::pending(plugin, approvals),
            size: match &plugin.source {
                Source::Archive(archive) => archive.size(),
                #[cfg(debug_assertions)]
                Source::Folder(_) => 0,
            },
            updated: plugin.updated,
            revision: plugin.revision.load(Ordering::Relaxed),
            enabled: plugin.is_dev()
                || state.is_some_and(|state| state.enabled(&plugin.manifest.id)),
        }
    }
}

#[derive(serde::Serialize)]
pub struct Inventory {
    plugins: Vec<Listed>,
    state: Option<PluginState>,
}

#[tauri::command]
pub async fn plugin_list(host: State<'_, PluginHost>) -> Result<Inventory, String> {
    let _changing = host.changing.lock().await;
    #[cfg(debug_assertions)]
    let dev = host.dev.lock().unwrap_or_else(PoisonError::into_inner);
    let installed = host.lock();
    let plugins = installed.values();
    #[cfg(debug_assertions)]
    let plugins = dev
        .values()
        .chain(plugins.filter(|plugin| !dev.contains_key(&plugin.manifest.id)));
    let approvals = host.approvals();
    let state = host.state();
    let plugins = plugins
        .map(|plugin| Listed::of(plugin, approvals.as_ref().ok(), state.as_ref().ok()))
        .collect();
    Ok(Inventory {
        plugins,
        state: state.as_ref().ok().cloned(),
    })
}

#[tauri::command]
pub async fn plugin_set_enabled(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    crate::panel::require_panel(&window)?;
    let _changing = host.changing.lock().await;
    host.require_installed_source(&id)?;
    let plugin = host.get(&id).ok_or("Plugin is not installed")?;
    if enabled && PluginHost::pending(&plugin, host.approvals().as_ref().ok()).is_some() {
        return Err("Plugin permissions need approval".into());
    }
    host.change_state(|state| {
        state.set_enabled(&id, enabled);
        Ok(())
    })?;
    if !enabled {
        host.caps.forget(&id);
        plugin.revision.store(
            NEXT_REVISION.fetch_add(1, Ordering::Relaxed),
            Ordering::Relaxed,
        );
    }
    notify_changed(window.app_handle());
    Ok(())
}

fn notify_changed(app: &AppHandle) {
    if let Err(error) = app.emit("plugins-changed", ()) {
        log::warn!("Could not notify windows of plugin changes: {error}");
    }
}

#[tauri::command]
pub async fn plugin_approve_permissions(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    id: String,
    added: Permissions,
) -> Result<(), String> {
    crate::panel::require_panel(&window)?;
    let _changing = host.changing.lock().await;
    host.approve(&id, &added)?;
    notify_changed(window.app_handle());
    Ok(())
}
