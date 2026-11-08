//! Installing, updating and removing user plugins in `<app data>/plugins`. New files land in `.staging-<id>` and
//! are checked there; the current folder is kept as `.old-<id>` until the new one is in place and is restored on
//! any failure. The plugin's data (`plugin-data/<id>`) is never touched. The frontend reloads both windows after.
// ponytail: file work (copy, hash, rename) runs on the async worker; move it to spawn_blocking if installs of the
// largest plugins visibly stall other commands.
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use plugin_sdk::secure::sha256_hex;
use tauri::{State, WebviewWindow};

use super::catalogue::{Entry, MAX_FILE, MAX_PLUGIN, Source};
use super::manifest::{valid_file_name, valid_id};
use super::trust::Trust;
use super::{PluginHost, load};
use crate::panel::require_panel;

fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            Err(format!("Could not remove {}: {error}", path.display()))
        }
        _ => Ok(()),
    }
}

fn staging(root: &Path, id: &str) -> Result<PathBuf, String> {
    let folder = root.join(format!(".staging-{id}"));
    remove(&folder)?;
    fs::create_dir_all(folder.join("ui")).map_err(|e| format!("Could not stage plugin: {e}"))?;
    Ok(folder)
}

/// Downloads every file of `entry` into a fresh staging folder, each checked against its catalogue size and hash.
async fn download(root: &Path, entry: &Entry, source: &Source) -> Result<PathBuf, String> {
    let folder = staging(root, &entry.id)?;
    for file in &entry.files {
        let written = source.fetch(&file.url, file.size).await.and_then(|bytes| {
            if bytes.len() as u64 != file.size || sha256_hex(&bytes)? != file.sha256 {
                return Err(format!("{} does not match the catalogue", file.path));
            }
            fs::write(folder.join(&file.path), bytes).map_err(|e| format!("{}: {e}", file.path))
        });
        if let Err(error) = written {
            remove(&folder)?;
            return Err(error);
        }
    }
    Ok(folder)
}

/// Copies the top-level and `ui/` files of a plugin folder into staging; nothing else is part of a plugin.
fn copy_folder(root: &Path, from: &Path) -> Result<(String, PathBuf), String> {
    let text = fs::read_to_string(from.join("plugin.json"))
        .map_err(|_| "No plugin.json in this folder")?;
    let id = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|manifest| manifest["id"].as_str().map(str::to_owned))
        .filter(|id| valid_id(id))
        .ok_or("Invalid plugin id")?;
    let folder = staging(root, &id)?;
    let mut total = 0;
    let copied = copy_files(from, &folder, &mut total)
        .and_then(|()| copy_files(&from.join("ui"), &folder.join("ui"), &mut total));
    if let Err(error) = copied {
        remove(&folder)?;
        return Err(error);
    }
    Ok((id, folder))
}

fn copy_files(from: &Path, to: &Path, total: &mut u64) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(from) else {
        // Only `ui/` can be missing: the folder itself held plugin.json.
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|name| valid_file_name(name)) else {
            continue;
        };
        if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let size = entry.metadata().map_or(u64::MAX, |meta| meta.len());
        *total = total.saturating_add(size);
        if size > MAX_FILE || *total > MAX_PLUGIN {
            return Err("Plugin is too large".into());
        }
        fs::copy(entry.path(), to.join(name)).map_err(|e| format!("{name}: {e}"))?;
    }
    Ok(())
}

/// Moves `staging` into place as `root/<id>`. The current folder moves aside to `.old-<id>` first and comes back if
/// the new one cannot be moved in.
fn swap(root: &Path, id: &str, staging: &Path) -> Result<(), String> {
    let (target, old) = (root.join(id), root.join(format!(".old-{id}")));
    // An install interrupted between the two renames left only the kept copy.
    if !target.exists() && old.exists() {
        fs::rename(&old, &target).map_err(|e| format!("Could not restore {id}: {e}"))?;
    }
    remove(&old)?;
    let had = target.exists();
    if had {
        fs::rename(&target, &old).map_err(|e| format!("Could not replace {id}: {e}"))?;
    }
    if let Err(error) = fs::rename(staging, &target) {
        if had {
            // If this fails too, the next install of this id restores the kept copy (above).
            let _ = fs::rename(&old, &target);
        }
        return Err(format!("Could not install {id}: {error}"));
    }
    // Harmless if it stays: the next install of this id removes it, and discovery skips dot folders.
    let _ = remove(&old);
    Ok(())
}

impl PluginHost {
    /// Takes the plugin out of the host and stops its process, so its folder can be moved.
    async fn take(&self, id: &str) {
        let installed = self.lock().remove(id);
        if let Some(supervisor) = installed.and_then(|installed| installed.supervisor) {
            supervisor.shutdown().await;
        }
    }

    /// Checks a staged folder and swaps it in. Without `unverified` an unsigned folder is discarded and `false`
    /// returned; a folder whose signature does not hold always is.
    async fn put(&self, id: &str, staged: PathBuf, unverified: bool) -> Result<bool, String> {
        match load(&staged, id) {
            Ok(loaded) if loaded.trust == Trust::Verified || unverified => {}
            other => {
                remove(&staged)?;
                return other.map(|_| false);
            }
        }
        self.take(id).await;
        let root = self.root();
        let swapped = swap(&root, id, &staged);
        if swapped.is_err() {
            remove(&staged)?;
        }
        // Back in the host either way: the new folder, or the old one the swap restored.
        match load(&root.join(id), id) {
            Ok(loaded) => self.add(root.join(id), loaded),
            Err(error) => log::warn!("Plugin {id} is not loaded: {error}"),
        }
        swapped.map(|()| true)
    }
}

/// The checked catalogue for the Market.
#[tauri::command]
pub async fn plugin_catalogue(window: WebviewWindow) -> Result<Vec<Entry>, String> {
    require_panel(&window)?;
    Source::new().catalogue().await
}

/// Installs or updates `id` from the catalogue; only a verified release is accepted. Not panel-only: the dashboard
/// owner restores former bundled plugins at start-up, and a signed catalogue release is all this can install.
#[tauri::command]
pub async fn plugin_install(host: State<'_, PluginHost>, id: String) -> Result<(), String> {
    let _changing = host.changing.lock().await;
    let source = Source::new();
    let entries = source.catalogue().await?;
    let entry = entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or("Plugin is not in the catalogue")?;
    let staged = download(&host.root(), entry, &source).await?;
    if host.put(&id, staged, false).await? {
        Ok(())
    } else {
        Err("Plugin is not signed".into())
    }
}

/// Installs a plugin folder and returns its id. `None` means it is unsigned and was not installed; the panel asks
/// and calls again with `unverified`.
#[tauri::command]
pub async fn plugin_install_folder(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    path: String,
    unverified: bool,
) -> Result<Option<String>, String> {
    require_panel(&window)?;
    let _changing = host.changing.lock().await;
    let (id, staged) = copy_folder(&host.root(), Path::new(&path))?;
    Ok(host.put(&id, staged, unverified).await?.then_some(id))
}

/// Deletes the plugin's folder; its data, settings and `plugins.json` entry stay.
#[tauri::command]
pub async fn plugin_uninstall(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    id: String,
) -> Result<(), String> {
    require_panel(&window)?;
    if !valid_id(&id) {
        return Err("Invalid plugin id".into());
    }
    let _changing = host.changing.lock().await;
    host.take(&id).await;
    let folder = host.root().join(&id);
    let removed = remove(&folder);
    if removed.is_err()
        && let Ok(loaded) = load(&folder, &id)
    {
        host.add(folder, loaded);
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_install_leaves_the_installed_plugin_as_it_was() {
        let base = std::env::temp_dir().join(format!("supa-install-{}", std::process::id()));
        let (root, source) = (base.join("plugins"), base.join("source"));
        fs::create_dir_all(root.join("spike")).unwrap();
        fs::create_dir_all(&source).unwrap();
        fs::write(root.join("spike/plugin.json"), "installed").unwrap();
        fs::write(source.join("index.js"), "changed").unwrap();
        let sha = sha256_hex(b"original").unwrap();
        let catalogue = format!(
            r#"{{"format":1,"published":"","plugins":[{{"id":"spike","title":"","description":"","icon":"",
            "version":"1.0.0","api":1,"published":"","size":7,"source":"https://example.com","guide":"",
            "files":[{{"path":"ui/index.js","url":"https://example.com/index.js","sha256":"{sha}","size":7}}]}}]}}"#
        );
        let entry = &super::super::catalogue::parse(catalogue.as_bytes()).unwrap()[0];
        let downloaded =
            tauri::async_runtime::block_on(download(&root, entry, &Source::Local(source)));
        assert!(
            downloaded.is_err(),
            "a file that does not match its hash was accepted"
        );
        assert!(!root.join(".staging-spike").exists());

        assert!(swap(&root, "spike", &root.join(".staging-spike")).is_err());
        assert_eq!(
            fs::read(root.join("spike/plugin.json")).unwrap(),
            b"installed"
        );
        assert!(!root.join(".old-spike").exists());
        fs::remove_dir_all(base).unwrap();
    }
}
