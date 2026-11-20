use std::ffi::OsString;
use std::path::PathBuf;

fn folders(debug: bool, value: Option<OsString>) -> Vec<PathBuf> {
    value
        .filter(|_| debug)
        .into_iter()
        .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

#[cfg(debug_assertions)]
pub(super) use debug::{discover, read, start};

#[cfg(debug_assertions)]
mod debug {
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{
        Arc, PoisonError,
        atomic::{AtomicU32, Ordering},
    };
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use tauri::{AppHandle, Manager};

    use super::super::archive::{MAX_PLUGIN, allowed, valid_entry_name};
    use super::super::manifest::{Manifest, PLUGIN_API};
    use super::super::{NEXT_REVISION, Plugin, PluginHost, Source, Trust, notify_changed};

    pub(in crate::plugin_host) fn read(root: &Path, name: &str) -> Option<Vec<u8>> {
        if !valid_entry_name(name) || !allowed(name) {
            return None;
        }
        let path = root.join(name).canonicalize().ok()?;
        let info = path.metadata().ok()?;
        if !path.starts_with(root) || !info.is_file() || info.len() > MAX_PLUGIN {
            return None;
        }
        fs::read(path).ok()
    }

    fn load(path: &Path, changed: Option<SystemTime>) -> Result<Plugin, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let manifest = Manifest::parse(&read(&path, "plugin.json").ok_or("No plugin.json")?)?;
        if manifest.api != PLUGIN_API {
            return Err(format!("Plugin needs plugin API {}", manifest.api));
        }
        if changed.is_none() || !path.join("ui/index.css").is_file() {
            return Err("The plugin has no UI bundle".into());
        }
        let updated = changed
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_millis() as u64);
        Ok(Plugin {
            manifest,
            source: Source::Folder(path),
            trust: Trust::Dev,
            updated,
            revision: AtomicU32::new(NEXT_REVISION.fetch_add(1, Ordering::Relaxed)),
        })
    }

    fn stamp(path: &Path) -> Option<SystemTime> {
        fs::metadata(path.join("ui/index.js")).ok()?.modified().ok()
    }

    fn discover_paths(paths: &[PathBuf]) -> HashMap<String, Arc<Plugin>> {
        let mut plugins = HashMap::new();
        for path in paths {
            match load(path, stamp(path)) {
                Ok(plugin) => {
                    let id = plugin.manifest.id.clone();
                    if let std::collections::hash_map::Entry::Vacant(entry) = plugins.entry(id) {
                        entry.insert(Arc::new(plugin));
                    } else {
                        log::warn!("Skipped duplicate dev plugin {}", path.display());
                    }
                }
                Err(error) => log::warn!("Skipped dev plugin {}: {error}", path.display()),
            }
        }
        plugins
    }

    pub(in crate::plugin_host) fn discover() -> HashMap<String, Arc<Plugin>> {
        discover_paths(&super::folders(
            true,
            std::env::var_os("SUPADASHBOARD_DEV_PLUGINS"),
        ))
    }

    fn refresh(host: &PluginHost, paths: &[PathBuf]) {
        let plugins = discover_paths(paths);
        let affected = {
            let mut dev = host.dev.lock().unwrap_or_else(PoisonError::into_inner);
            let affected = dev
                .keys()
                .chain(plugins.keys())
                .cloned()
                .collect::<std::collections::HashSet<_>>();
            *dev = plugins;
            affected
        };
        for id in affected {
            host.caps.forget(&id);
        }
    }

    pub(in crate::plugin_host) fn start(app: &AppHandle) -> std::io::Result<()> {
        let paths = super::folders(true, std::env::var_os("SUPADASHBOARD_DEV_PLUGINS"));
        if paths.is_empty() {
            return Ok(());
        }
        let stamps = |paths: &[PathBuf]| {
            paths
                .iter()
                .map(|path| {
                    (
                        stamp(path),
                        fs::metadata(path.join("plugin.json"))
                            .and_then(|meta| meta.modified())
                            .ok(),
                    )
                })
                .collect::<Vec<_>>()
        };
        let mut previous = stamps(&paths);
        refresh(&app.state::<PluginHost>(), &paths);
        let app = app.clone();
        thread::Builder::new()
            .name("dev-plugins".into())
            .spawn(move || {
                let mut changed = None;
                loop {
                    thread::sleep(Duration::from_millis(125));
                    let now = stamps(&paths);
                    if now != previous {
                        previous = now;
                        changed = Some(Instant::now());
                    }
                    if changed.is_some_and(|time| time.elapsed() >= Duration::from_millis(250)) {
                        changed = None;
                        let host = app.state::<PluginHost>();
                        let _changing = host.changing.blocking_lock();
                        refresh(&host, &paths);
                        notify_changed(&app);
                    }
                }
            })?;
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::plugin_host::archive::tests::temp;

        #[test]
        fn folders_validate_permissions_and_serve_only_plugin_files() {
            let root = temp("dev-plugin");
            fs::create_dir_all(root.join("ui")).unwrap();
            fs::write(root.join("ui/index.js"), b"first").unwrap();
            fs::write(root.join("ui/index.css"), b"").unwrap();
            let manifest = root.join("plugin.json");
            fs::write(
                &manifest,
                r#"{"id":"dev","version":"1","api":2,"permissions":{"http":["*.example.com"]}}"#,
            )
            .unwrap();
            assert!(load(&root, stamp(&root)).is_err());
            fs::write(
                &manifest,
                r#"{"id":"dev","version":"1","api":2,"permissions":{"http":["example.com"]}}"#,
            )
            .unwrap();
            let plugin = load(&root, stamp(&root)).unwrap();
            assert_eq!(plugin.manifest.permissions.http, ["example.com"]);
            let Source::Folder(path) = plugin.source else {
                panic!("expected a dev folder");
            };
            assert_eq!(read(&path, "ui/index.js").as_deref(), Some(&b"first"[..]));
            fs::write(root.join("ui/index.js"), b"second").unwrap();
            assert_eq!(read(&path, "ui/index.js").as_deref(), Some(&b"second"[..]));
            assert_eq!(read(&path, "ui/../plugin.json"), None);
            assert_eq!(read(&path, "assets/../plugin.json"), None);
            fs::remove_dir_all(root).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_ignores_the_development_folder_list() {
        let paths = [PathBuf::from("some folder"), PathBuf::from("another")];
        let value = std::env::join_paths(&paths).unwrap();
        assert!(folders(false, Some(value.clone())).is_empty());
        assert!(folders(true, None).is_empty());
        assert_eq!(folders(true, Some(value)), paths);
    }
}
