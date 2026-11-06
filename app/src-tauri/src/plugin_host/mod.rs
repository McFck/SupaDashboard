//! Plugin host: each plugin's native part runs as its own process, started while the plugin is enabled.
//! The frontend reaches it only through `plugin_call`; its events arrive as `plugin://<id>/<event>`.
mod job;
mod manifest;
mod process;
mod restarts;
mod supervisor;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use job::Job;
use manifest::Manifest;
use supervisor::Supervisor;

pub struct PluginHost {
    plugins: HashMap<String, (Manifest, Supervisor)>,
}

impl PluginHost {
    /// Bundled plugins first, then the user's; a user folder cannot replace a bundled plugin.
    pub fn discover(app: &AppHandle) -> Result<Self, String> {
        let job = Arc::new(Job::new().map_err(|error| error.to_string())?);
        let roots = [app.path().resource_dir(), app.path().app_data_dir()];
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
                    Ok(manifest) if plugins.contains_key(&manifest.id) => {
                        log::warn!("Plugin {} is installed twice", manifest.id);
                    }
                    Ok(manifest) => {
                        let exe = folder.join(&manifest.exe);
                        let supervisor =
                            Supervisor::new(manifest.id.clone(), exe, job.clone(), app.clone());
                        plugins.insert(manifest.id.clone(), (manifest, supervisor));
                    }
                    Err(error) => log::warn!("Skipped plugin {}: {error}", folder.display()),
                }
            }
        }
        Ok(Self { plugins })
    }
}

fn load(folder: &Path) -> Result<Manifest, String> {
    let name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid folder name")?;
    let text = std::fs::read_to_string(folder.join("plugin.json")).map_err(|e| e.to_string())?;
    let manifest = Manifest::parse(&text, name)?;
    if !folder.join(&manifest.exe).is_file() {
        return Err(format!("{} is missing", manifest.exe));
    }
    Ok(manifest)
}

#[tauri::command]
pub async fn plugin_call(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    plugin: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let (manifest, supervisor) = host.plugins.get(&plugin).ok_or("Plugin is not installed")?;
    if !manifest.allows(window.label(), &method) {
        return Err(format!("Plugin {plugin} does not allow {method}"));
    }
    supervisor.call(method, params).await
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
