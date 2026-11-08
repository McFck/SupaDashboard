//! Plugin host: each plugin's native part runs as its own process, started while the plugin is enabled.
//! The frontend reaches it only through `plugin_call`; its events arrive as `plugin://<id>/<event>`.
mod host_api;
mod job;
mod manifest;
mod migrate;
mod process;
pub mod protocol;
mod restarts;
mod supervisor;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use job::Job;
use manifest::Manifest;
use protocol::Ui;
use supervisor::Supervisor;

pub struct Plugin {
    manifest: Manifest,
    exe: PathBuf,
    /// The plugin's own data folder, `<app data>/plugin-data/<id>`.
    data: PathBuf,
    /// The app data root, where the in-app version kept the files listed in `migrate`.
    legacy: PathBuf,
    ui: Option<Ui>,
}

pub struct PluginHost {
    plugins: HashMap<String, (Arc<Plugin>, Supervisor)>,
}

impl PluginHost {
    /// Bundled plugins first, then the user's; a user folder cannot replace a bundled plugin.
    pub fn discover(app: &AppHandle) -> Result<Self, String> {
        let job = Arc::new(Job::new().map_err(|error| error.to_string())?);
        let legacy = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let roots = [app.path().resource_dir(), Ok(legacy.clone())];
        let mut plugins = HashMap::new();
        for root in roots.into_iter().flatten() {
            let Ok(entries) = std::fs::read_dir(root.join("plugins")) else {
                continue;
            };
            for folder in entries.flatten().map(|entry| entry.path()) {
                if !folder.is_dir() {
                    continue;
                }
                match load(&folder) {
                    Ok((manifest, _)) if plugins.contains_key(&manifest.id) => {
                        log::warn!("Plugin {} is installed twice", manifest.id);
                    }
                    Ok((manifest, ui)) => {
                        let plugin = Arc::new(Plugin {
                            exe: folder.join(&manifest.exe),
                            data: legacy.join("plugin-data").join(&manifest.id),
                            legacy: legacy.clone(),
                            ui,
                            manifest,
                        });
                        let supervisor = Supervisor::new(plugin.clone(), job.clone(), app.clone());
                        plugins.insert(plugin.manifest.id.clone(), (plugin, supervisor));
                    }
                    Err(error) => log::warn!("Skipped plugin {}: {error}", folder.display()),
                }
            }
        }
        Ok(Self { plugins })
    }

    /// Ends what running plugins hold for a closed window (subscriptions).
    pub fn window_closed(&self, window: &str) {
        for (_, supervisor) in self.plugins.values() {
            supervisor.window_closed(window);
        }
    }

    fn ui(&self, id: &str) -> Option<&Ui> {
        self.plugins.get(id)?.0.ui.as_ref()
    }
}

fn load(folder: &Path) -> Result<(Manifest, Option<Ui>), String> {
    let name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid folder name")?;
    let text = std::fs::read_to_string(folder.join("plugin.json")).map_err(|e| e.to_string())?;
    let manifest = Manifest::parse(&text, name)?;
    if !folder.join(&manifest.exe).is_file() {
        return Err(format!("{} is missing", manifest.exe));
    }
    let ui = manifest.api.map(|_| Ui::read(folder)).transpose()?;
    Ok((manifest, ui))
}

#[derive(serde::Serialize)]
pub struct Listed {
    id: String,
    api: u32,
}

/// The plugins with a UI for the frontend to load; `load` read the UI of every plugin that declares an API.
#[tauri::command]
pub fn plugin_list(host: State<'_, PluginHost>) -> Vec<Listed> {
    host.plugins
        .values()
        .filter_map(|(plugin, _)| {
            Some(Listed {
                id: plugin.manifest.id.clone(),
                api: plugin.manifest.api?,
            })
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
    let (entry, supervisor) = host.plugins.get(&plugin).ok_or("Plugin is not installed")?;
    let label = window.label();
    if !entry.manifest.allows(label, &method) {
        return Err(format!("Plugin {plugin} does not allow {method}"));
    }
    supervisor.call(method, params, label.into()).await
}

#[tauri::command]
pub async fn plugin_set_enabled(
    host: State<'_, PluginHost>,
    plugin: String,
    enabled: bool,
) -> Result<(), String> {
    // Plugins without a native part have nothing to start or stop.
    if let Some((_, supervisor)) = host.plugins.get(&plugin) {
        supervisor.set_enabled(enabled).await;
    }
    Ok(())
}
