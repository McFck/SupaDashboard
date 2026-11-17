//! Installing, updating and removing plugins in `<app data>/plugins`. A new file lands in `.staging.sdplugin` and
//! is checked there; the current file is kept as `.old-<id>.sdplugin` until the new one is in place and checked again,
//! and comes back on any failure. The plugin's data (`plugin-data/<id>`) is never touched. The frontend reloads both
//! windows after.
// ponytail: file work (copy, hash, rename) runs on the async worker; move it to spawn_blocking if installs of the
// largest plugins visibly stall other commands.
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{State, WebviewWindow};

use super::archive::MAX_PLUGIN;
use super::catalogue::{Entry, Source};
use super::manifest::{Manifest, valid_id};
use super::permissions::Permissions;
use super::secure::sha256_hex;
use super::trust::Trust;
use super::{Plugin, PluginHost, load};
use crate::panel::require_panel;

fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            Err(format!("Could not remove {}: {error}", path.display()))
        }
        _ => Ok(()),
    }
}

fn installed(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.sdplugin"))
}

/// Moves `staged` into place as `<id>.sdplugin` and opens it with `open`. The current file moves aside to
/// `.old-<id>.sdplugin` first and comes back if the new one cannot be moved in or opened. A version 1 plugin folder
/// of the same id is deleted once the new file is in.
fn place<T>(
    root: &Path,
    id: &str,
    staged: &Path,
    open: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let (target, old) = (
        installed(root, id),
        root.join(format!(".old-{id}.sdplugin")),
    );
    // An install interrupted between the two renames left only the kept copy.
    if !target.exists() && old.exists() {
        fs::rename(&old, &target).map_err(|e| format!("Could not restore {id}: {e}"))?;
    }
    remove_file(&old)?;
    let had = target.exists();
    if had {
        // Fails while the current file is still open.
        fs::rename(&target, &old).map_err(|e| format!("Could not replace {id}: {e}"))?;
    }
    let placed = fs::rename(staged, &target)
        .map_err(|e| format!("Could not install {id}: {e}"))
        .and_then(|()| open(&target));
    if placed.is_err() {
        // Our own staged or refused file; if a restore fails, the next install of this id restores the kept copy.
        let _ = remove_file(staged);
        let _ = remove_file(&target);
        if had {
            let _ = fs::rename(&old, &target);
        }
        return placed;
    }
    // Harmless if they stay: the next install removes the kept copy, and discovery ignores folders.
    let _ = remove_file(&old);
    if let Err(error) = fs::remove_dir_all(root.join(id))
        && error.kind() != ErrorKind::NotFound
    {
        log::warn!("Could not remove the version 1 folder of {id}: {error}");
    }
    placed
}

/// A catalogue install takes only the verified release the catalogue describes, with exactly its permissions.
fn matches_catalogue(entry: &Entry, manifest: &Manifest, trust: Trust) -> Result<(), String> {
    if trust != Trust::Verified {
        return Err("Plugin is not signed".into());
    }
    if manifest.version != entry.version || manifest.api != entry.api {
        return Err("Plugin does not match the catalogue".into());
    }
    if manifest.permissions != entry.permissions {
        return Err("Plugin permissions differ from the catalogue".into());
    }
    Ok(())
}

impl PluginHost {
    /// Checks a staged file, takes the current plugin out of the host so its file closes, and swaps the new one in.
    /// `id` is the id the file must have; the installed id is returned.
    fn put(
        &self,
        staged: &Path,
        id: Option<&str>,
        accept: impl Fn(&Plugin) -> Result<(), String>,
    ) -> Result<String, String> {
        let check = |plugin: Plugin| {
            if id.is_some_and(|id| id != plugin.manifest.id) {
                return Err("Plugin id does not match".to_owned());
            }
            accept(&plugin).map(|()| plugin)
        };
        let id = match load(staged).and_then(check) {
            Ok(plugin) => plugin.manifest.id,
            Err(error) => {
                remove_file(staged)?;
                return Err(error);
            }
        };
        let root = self.root();
        // Closes the current file, unless a scheme read holds it a moment longer; then the swap fails cleanly.
        self.take(&id);
        match place(&root, &id, staged, |path| load(path).and_then(check)) {
            Ok(plugin) => self.add(plugin),
            Err(error) => {
                // Back in the host: the file the swap restored.
                if let Ok(plugin) = load(&installed(&root, &id)) {
                    self.add(plugin);
                }
                return Err(error);
            }
        }
        Ok(id)
    }

    fn stage(&self, bytes: &[u8]) -> Result<PathBuf, String> {
        let root = self.root();
        let staged = root.join(".staging.sdplugin");
        fs::create_dir_all(&root)
            .and_then(|()| fs::write(&staged, bytes))
            .map_err(|e| format!("Could not stage plugin: {e}"))?;
        Ok(staged)
    }
}

/// The checked catalogue for the Market.
#[tauri::command]
pub async fn plugin_catalogue(window: WebviewWindow) -> Result<Vec<Entry>, String> {
    require_panel(&window)?;
    Source::new().catalogue().await
}

/// Installs or updates `id` from the catalogue; only the verified release it describes is accepted. Not panel-only:
/// the dashboard owner restores former bundled plugins at start-up, and a signed catalogue release is all this can
/// install.
#[tauri::command]
pub async fn plugin_install(host: State<'_, PluginHost>, id: String) -> Result<(), String> {
    let _changing = host.changing.lock().await;
    let source = Source::new();
    let entries = source.catalogue().await?;
    let entry = entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or("Plugin is not in the catalogue")?;
    let bytes = source.fetch(&entry.url, entry.size).await?;
    if bytes.len() as u64 != entry.size || sha256_hex(&bytes)? != entry.sha256 {
        return Err("Plugin file does not match the catalogue".into());
    }
    let staged = host.stage(&bytes)?;
    host.put(&staged, Some(&id), |plugin| {
        matches_catalogue(entry, &plugin.manifest, plugin.trust)
    })
    .map(|_| ())
}

/// A plugin file the user picked, dropped or opened, as the install confirmation shows it. `sha256` names these
/// exact bytes for `plugin_install_file`.
#[derive(Serialize)]
pub struct Inspected {
    id: String,
    version: String,
    trust: Trust,
    permissions: Permissions,
    sha256: String,
}

fn read_plugin_file(path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(path);
    if path
        .extension()
        .is_none_or(|extension| extension != "sdplugin")
    {
        return Err("Not a plugin file".into());
    }
    let size = fs::metadata(path)
        .map_err(|e| format!("Could not read plugin file: {e}"))?
        .len();
    if size > MAX_PLUGIN {
        return Err("Plugin is too large".into());
    }
    fs::read(path).map_err(|e| format!("Could not read plugin file: {e}"))
}

#[tauri::command]
pub async fn plugin_inspect_file(window: WebviewWindow, path: String) -> Result<Inspected, String> {
    require_panel(&window)?;
    let bytes = read_plugin_file(&path)?;
    let plugin = load(Path::new(&path))?;
    Ok(Inspected {
        id: plugin.manifest.id,
        version: plugin.manifest.version,
        trust: plugin.trust,
        permissions: plugin.manifest.permissions,
        sha256: sha256_hex(&bytes)?,
    })
}

/// Installs the file the user confirmed after `plugin_inspect_file`, signed or not, and returns its id; a file that
/// changed since is refused.
#[tauri::command]
pub async fn plugin_install_file(
    window: WebviewWindow,
    host: State<'_, PluginHost>,
    path: String,
    sha256: String,
) -> Result<String, String> {
    require_panel(&window)?;
    let _changing = host.changing.lock().await;
    let bytes = read_plugin_file(&path)?;
    if sha256_hex(&bytes)? != sha256 {
        return Err("The plugin file changed".into());
    }
    let staged = host.stage(&bytes)?;
    host.put(&staged, None, |_| Ok(()))
}

/// Deletes the plugin's file; its data, settings and `plugins.json` entry stay.
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
    host.take(&id);
    let path = installed(&host.root(), &id);
    let removed = remove_file(&path);
    if removed.is_err()
        && let Ok(plugin) = load(&path)
    {
        host.add(plugin);
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::archive::tests::temp;
    use crate::plugin_host::catalogue::{parse, tests as catalogue};
    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn a_failed_install_leaves_the_installed_plugin_as_it_was() {
        let root = temp("install");
        fs::create_dir_all(root.join("spike")).unwrap();
        let (current, staged) = (installed(&root, "spike"), root.join(".staging.sdplugin"));
        fs::write(&current, "installed").unwrap();
        fs::write(&staged, "refused").unwrap();
        let refused = place(&root, "spike", &staged, |_| Err::<(), _>("bad".into()));
        assert!(refused.is_err());
        assert_eq!(fs::read(&current).unwrap(), b"installed");
        assert!(!staged.exists() && !root.join(".old-spike.sdplugin").exists());
        assert!(
            root.join("spike").exists(),
            "the folder went with a failed install"
        );

        // The served file is open without delete sharing, so it cannot be swapped out underneath.
        fs::write(&staged, "new").unwrap();
        let open = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&current)
            .unwrap();
        assert!(place(&root, "spike", &staged, |_| Ok(())).is_err());
        drop(open);
        assert_eq!(fs::read(&current).unwrap(), b"installed");

        fs::write(&staged, "new").unwrap();
        let placed = place(&root, "spike", &staged, |path| Ok(fs::read(path).unwrap()));
        assert_eq!(placed.unwrap(), b"new");
        assert!(!root.join("spike").exists(), "the version 1 folder stayed");
        assert!(!root.join(".old-spike.sdplugin").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_catalogue_install_takes_only_the_signed_release_with_the_listed_permissions() {
        let text = catalogue::catalogue(&[catalogue::entry("spike", &"ab".repeat(32), 3, "")]);
        let entry = &parse(text.as_bytes()).unwrap()[0];
        let manifest = |permissions: &str| {
            let text = format!(
                r#"{{"id":"spike","version":"1.0.0","api":1,"permissions":{permissions}}}"#
            );
            Manifest::parse(text.as_bytes()).unwrap()
        };
        let listed = manifest(r#"{"http":["example.com"]}"#);
        assert_eq!(matches_catalogue(entry, &listed, Trust::Verified), Ok(()));
        assert!(matches_catalogue(entry, &listed, Trust::Unverified).is_err());
        let more = manifest(r#"{"http":["example.com","evil.com"]}"#);
        assert!(matches_catalogue(entry, &more, Trust::Verified).is_err());
        assert!(matches_catalogue(entry, &manifest("{}"), Trust::Verified).is_err());
    }
}
