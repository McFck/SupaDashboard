//! Native capabilities for plugin JS: `plugin_<capability>_*(plugin, ...)` commands. Every plugin shares one JS realm,
//! so a call is bound to the plugin id it names: each command checks that the plugin is installed and declared the
//! reach it asks for. Native resources (a pending PKCE verifier, a sign-in in progress) belong to the plugin and the
//! webview that started them, and go when that webview navigates or closes, or when the plugin is removed.
pub mod http;
pub mod oauth;
pub mod open;
pub mod secrets;
pub mod storage;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager};
use tokio::task::AbortHandle;

use super::{Plugin, PluginHost};

/// What one plugin started from one webview.
#[derive(Default)]
struct Owned {
    /// PKCE verifiers by secret name, waiting for `exchange`.
    verifiers: HashMap<String, String>,
    /// Loopback sign-ins by secret name.
    signins: HashMap<String, AbortHandle>,
}

impl Drop for Owned {
    fn drop(&mut self) {
        for task in self.signins.values() {
            task.abort();
        }
    }
}

#[derive(Default)]
pub struct Caps {
    /// Keyed by (plugin id, webview label).
    owned: Mutex<HashMap<(String, String), Owned>>,
    /// One secret change at a time across plugins, so a refresh never races another refresh of the same rotating
    /// token. ponytail: one lock for every plugin; per-secret locks if a slow token endpoint stalls other plugins.
    secrets: tokio::sync::Mutex<()>,
}

impl Caps {
    fn lock(&self) -> MutexGuard<'_, HashMap<(String, String), Owned>> {
        self.owned.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs `change` on what `plugin` owns in `label`.
    fn with<T>(&self, plugin: &str, label: &str, change: impl FnOnce(&mut Owned) -> T) -> T {
        change(
            self.lock()
                .entry((plugin.to_owned(), label.to_owned()))
                .or_default(),
        )
    }

    /// Drops (and so stops) everything owned by a matching (plugin, webview label).
    pub fn release(&self, matches: impl Fn(&str, &str) -> bool) {
        let released: Vec<Owned> = {
            let mut owned = self.lock();
            let keys: Vec<_> = owned
                .keys()
                .filter(|(plugin, label)| matches(plugin, label))
                .cloned()
                .collect();
            keys.iter().filter_map(|key| owned.remove(key)).collect()
        };
        drop(released);
    }
}

/// A webview navigated or closed: its plugins' native resources go with its page.
pub fn release_webview(app: &AppHandle, label: &str) {
    if let Some(host) = app.try_state::<PluginHost>() {
        host.caps.release(|_, owner| owner == label);
    }
}

impl PluginHost {
    /// The installed plugin a capability call names.
    fn installed(&self, id: &str) -> Result<Arc<Plugin>, String> {
        self.lock()
            .get(id)
            .cloned()
            .ok_or_else(|| "Plugin is not installed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn released_resources_stop_only_for_the_navigated_webview_or_removed_plugin() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let caps = Caps::default();
        let start = |plugin: &str, label: &str| {
            let task = runtime.spawn(std::future::pending::<()>());
            let abort = task.abort_handle();
            caps.with(plugin, label, |owned| {
                owned.signins.insert("x".into(), abort);
                owned.verifiers.insert("x".into(), "v".into());
            });
            task
        };
        let (a_main, a_panel, b_panel) =
            (start("a", "main"), start("a", "panel"), start("b", "panel"));
        caps.release(|_, label| label == "panel");
        assert!(runtime.block_on(a_panel).unwrap_err().is_cancelled());
        assert!(runtime.block_on(b_panel).unwrap_err().is_cancelled());
        assert!(!a_main.is_finished());
        assert!(caps.with("b", "panel", |owned| owned.verifiers.is_empty()));
        caps.release(|plugin, _| plugin == "a");
        assert!(runtime.block_on(a_main).unwrap_err().is_cancelled());
        assert!(caps.with("a", "main", |owned| owned.verifiers.is_empty()));
    }
}
