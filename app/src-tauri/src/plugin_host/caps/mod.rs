//! Native capabilities for plugin JS: `plugin_<capability>_*(plugin, ...)` commands. Every plugin shares one JS realm,
//! so a call is bound to the plugin id it names: each grant checks the approved manifest for the reach it asks for.
//! Native resources (a pending PKCE verifier, a sign-in in progress, an open pipe, a child process,
//! a window watcher) belong to the plugin and the webview that started them, and go when that webview navigates or
//! closes, or when the plugin is removed.
pub mod automation;
pub mod browser;
pub mod displays;
pub mod http;
pub mod oauth;
pub mod open;
pub mod pipe;
pub mod process;
pub mod secrets;
pub mod signin;
pub mod storage;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager};
use tokio::task::AbortHandle;

use super::PluginHost;

/// What one plugin started from one webview.
#[derive(Default)]
struct Owned {
    /// PKCE verifiers by secret name, waiting for `exchange`.
    verifiers: HashMap<String, String>,
    /// Loopback and web sign-ins by secret name.
    signins: HashMap<String, AbortHandle>,
    pipes: HashMap<u32, pipe::Pipe>,
    processes: HashMap<u32, process::Spawned>,
    /// The command to run when the PC sleeps or shuts down.
    power_off: Option<process::Armed>,
    watcher: Option<automation::Watcher>,
    browser: Option<browser::Watcher>,
    browser_start: Option<u32>,
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
    /// Web sign-in tokens by (plugin id, sign-in name), in memory only: the session itself lives in the sign-in
    /// window's profile.
    signed_in: Mutex<HashMap<(String, String), signin::Session>>,
    /// The plugin's sign-in window, shared by the sign-ins using it; it closes with the last one.
    signin_windows: Mutex<HashMap<String, std::sync::Weak<signin::Window>>>,
    browser: tokio::sync::Mutex<browser::Listener>,
    /// Handles of pipes and processes.
    next: AtomicU32,
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

    /// The plugin is removed: everything it owns goes, its sign-in tokens too.
    pub fn forget(&self, plugin: &str) {
        self.release(|owner, _| owner == plugin);
        self.signed_in
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|(owner, _), _| owner != plugin);
    }

    fn handle(&self) -> u32 {
        self.next.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// The access token of OAuth client or sign-in `name`; the caller checked that it may go where it is sent.
async fn token(host: &PluginHost, plugin: &str, name: &str) -> Result<String, String> {
    if host
        .installed(plugin)?
        .manifest
        .permissions
        .signin
        .contains_key(name)
    {
        signin::token(host, plugin, name)
    } else {
        oauth::access_token(host, plugin, name).await
    }
}

/// A webview navigated or closed: its plugins' native resources go with its page.
pub fn release_webview(app: &AppHandle, label: &str) {
    if let Some(host) = app.try_state::<PluginHost>() {
        host.caps.release(|_, owner| owner == label);
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
