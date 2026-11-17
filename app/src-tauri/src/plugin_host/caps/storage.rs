//! `storage`: text files in the plugin's own data folder, `plugin-data/<id>/`. Every plugin has it. Secrets and
//! sign-in profiles stored there are native-only, and dot files are the host's (migration markers, temporary writes).
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::plugin_host::manifest::valid_file_name;
use crate::plugin_host::permissions::Permissions;
use crate::plugin_host::secure::replace;
use crate::plugin_host::{Plugin, PluginHost};

const MAX_FILE: u64 = 16 * 1024 * 1024;

/// `path` (`/`-separated, `""` for the folder itself) inside `data`, refusing anything the plugin's JS may not touch.
fn resolve(data: &Path, permissions: &Permissions, path: &str) -> Result<PathBuf, String> {
    let segments: Vec<&str> = if path.is_empty() {
        Vec::new()
    } else {
        path.split('/').collect()
    };
    if segments.len() > 8 || !segments.iter().all(|segment| valid_file_name(segment)) {
        return Err("Invalid plugin file path".into());
    }
    if let Some(first) = segments.first() {
        let secret = first.strip_suffix(".json").is_some_and(|name| {
            permissions.oauth.contains_key(name) || permissions.signin.contains_key(name)
        });
        let profile = permissions
            .signin
            .values()
            .any(|signin| signin.profile == *first);
        if secret || profile {
            return Err("This plugin file is not readable".into());
        }
    }
    Ok(segments
        .iter()
        .fold(data.to_path_buf(), |path, segment| path.join(segment)))
}

fn file(host: &PluginHost, plugin: &str, path: &str) -> Result<(Arc<Plugin>, PathBuf), String> {
    let installed = host.installed(plugin)?;
    let resolved = resolve(&host.data(plugin), &installed.manifest.permissions, path)?;
    Ok((installed, resolved))
}

/// The file's text, or `None` when it does not exist.
#[tauri::command]
pub fn plugin_storage_read(
    host: State<'_, PluginHost>,
    plugin: String,
    path: String,
) -> Result<Option<String>, String> {
    let (_, path) = file(&host, &plugin, &path)?;
    match fs::metadata(&path) {
        Ok(meta) if meta.len() > MAX_FILE => return Err("Plugin file is too large".into()),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        _ => {}
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|_| "Could not read the plugin file".into())
}

/// Replaces the file through a temporary file, so a crash leaves the old or the new text, never half.
#[tauri::command]
pub fn plugin_storage_write(
    host: State<'_, PluginHost>,
    plugin: String,
    path: String,
    text: String,
) -> Result<(), String> {
    let (_, target) = file(&host, &plugin, &path)?;
    if path.is_empty() {
        return Err("Invalid plugin file path".into());
    }
    if text.len() as u64 > MAX_FILE {
        return Err("Plugin file is too large".into());
    }
    let failed = |_| "Could not save the plugin file".to_owned();
    let parent = target.parent().ok_or("Invalid plugin file path")?;
    fs::create_dir_all(parent).map_err(failed)?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = parent.join(format!(".{name}.{}-{nanos}.tmp", std::process::id()));
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| {
            file.write_all(text.as_bytes())
                .and_then(|()| file.sync_all())
        })
        .map_err(failed)
        .and_then(|()| {
            replace(&temp, &target).map_err(|_| "Could not save the plugin file".into())
        });
    if written.is_err() {
        // Only our own temporary file.
        let _ = fs::remove_file(&temp);
    }
    written
}

/// Deletes a file; one that does not exist is already gone.
#[tauri::command]
pub fn plugin_storage_remove(
    host: State<'_, PluginHost>,
    plugin: String,
    path: String,
) -> Result<(), String> {
    let (_, path) = file(&host, &plugin, &path)?;
    match fs::remove_file(path) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            Err("Could not delete the plugin file".into())
        }
        _ => Ok(()),
    }
}

/// A file in a listed folder; `modified` in Unix milliseconds.
#[derive(Serialize)]
pub struct Listed {
    name: String,
    size: u64,
    modified: u64,
}

/// The files (not folders) directly in `dir` that the plugin may read; none when it does not exist.
#[tauri::command]
pub fn plugin_storage_list(
    host: State<'_, PluginHost>,
    plugin: String,
    dir: String,
) -> Result<Vec<Listed>, String> {
    let (installed, path) = file(&host, &plugin, &dir)?;
    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("Could not list the plugin files".into()),
    };
    let data = host.data(&plugin);
    let permissions = &installed.manifest.permissions;
    Ok(entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let inner = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            resolve(&data, permissions, &inner).ok()?;
            let meta = entry.metadata().ok().filter(|meta| meta.is_file())?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_millis() as u64);
            Some(Listed {
                name,
                size: meta.len(),
                modified,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_reaches_only_its_own_plain_files() {
        let permissions: Permissions = serde_json::from_str(
            r#"{"http":["a.com"],"oauth":{"spotify":{"token":"https://a.com/t","redirect":"http://127.0.0.1",
            "scopes":[],"send":[]}},"signin":{"staff":{"url":"https://a.com","storage":"k","profile":"web",
            "send":[]}}}"#,
        )
        .unwrap();
        let data = Path::new("C:\\data\\plugin-data\\spotify");
        assert_eq!(
            resolve(data, &permissions, "lyrics/a b.json").err(),
            Some("Invalid plugin file path".into())
        );
        assert_eq!(
            resolve(data, &permissions, "lyrics/a.json"),
            Ok(data.join("lyrics").join("a.json"))
        );
        assert_eq!(resolve(data, &permissions, ""), Ok(data.to_path_buf()));
        assert!(resolve(data, &permissions, "lyrics/spotify.json").is_ok());
        // Spotify's lyrics cache names files by a SHA-256 hex key.
        let cached = format!("lyrics/{}.json", "a".repeat(64));
        assert!(resolve(data, &permissions, &cached).is_ok());
        for path in [
            "spotify.json",
            "staff.json",
            "web",
            "web/Local Storage",
            "web/x.json",
            "..",
            "../discord/discord.json",
            "lyrics/../spotify.json",
            ".migrated-spotify.json",
            ".spotify.json.1-2.tmp",
            "C:\\x",
            "lyrics\\a.json",
            "/abs",
            "a//b",
            "lyrics/",
            "a/b/c/d/e/f/g/h/i",
        ] {
            assert!(resolve(data, &permissions, path).is_err(), "{path}");
        }
    }
}
