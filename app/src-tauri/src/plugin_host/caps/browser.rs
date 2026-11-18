//! A loopback bridge shared by a plugin's open pages, with one channel per webview.
mod pairing;
mod server;
mod wire;

use std::sync::{Arc, Weak};

use tauri::{Manager, Webview, ipc::Channel};
use tokio::{
    sync::oneshot,
    task::{AbortHandle, JoinHandle},
    time::timeout,
};

use crate::plugin_host::PluginHost;

use server::{Activation, Bridge, Snapshot};

#[derive(Default)]
pub(super) struct Listener {
    bridge: Weak<Bridge>,
    task: Option<JoinHandle<()>>,
}

pub(super) struct Watcher {
    id: u32,
    bridge: Arc<Bridge>,
    task: AbortHandle,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.task.abort();
        self.bridge.cancel(self.id);
    }
}

fn grant(host: &PluginHost, plugin: &str) -> Result<String, String> {
    host.installed(plugin)?
        .manifest
        .permissions
        .browser
        .clone()
        .ok_or_else(|| "Plugin has no browser permission".into())
}

#[tauri::command]
pub async fn plugin_browser_watch(
    webview: Webview,
    plugin: String,
    events: Channel<Snapshot>,
) -> Result<u32, String> {
    let host = webview.state::<PluginHost>();
    grant(&host, &plugin)?;
    let id = host.caps.handle();
    host.caps.with(&plugin, webview.label(), |owned| {
        owned.browser_start = Some(id)
    });
    let mut active = host.caps.browser.lock().await;
    let bridge = active.bridge.upgrade();
    if bridge.is_none() {
        if let Some(task) = active.task.as_mut() {
            // The last watcher aborts the server. Await it before rebinding the listener.
            let _ = task.await;
        }
        active.task = None;
    }
    host.caps.with(&plugin, webview.label(), |owned| {
        if owned.browser_start != Some(id) {
            return Err("Browser Remote page closed".into());
        }
        owned.browser_start = None;
        let extension = grant(&host, &plugin)?;
        let bridge = match bridge {
            Some(bridge) if bridge.plugin == plugin && bridge.extension() == extension => bridge,
            Some(_) => return Err("Browser Remote is in use".into()),
            None => {
                let path = host.data(&plugin).join(".browser-remote.json");
                let (bridge, task) = Bridge::start(plugin.clone(), extension, path)?;
                let bridge = Arc::new(bridge);
                *active = Listener {
                    bridge: Arc::downgrade(&bridge),
                    task: Some(task),
                };
                bridge
            }
        };
        let mut snapshots = bridge.snapshots();
        let task = tauri::async_runtime::spawn(async move {
            loop {
                let snapshot = snapshots.borrow_and_update().clone();
                if events.send(snapshot).is_err() || snapshots.changed().await.is_err() {
                    break;
                }
            }
        })
        .inner()
        .abort_handle();
        owned.browser = Some(Watcher { id, bridge, task });
        Ok(id)
    })
}

#[tauri::command]
pub fn plugin_browser_unwatch(webview: Webview, plugin: String, watch: u32) -> Result<(), String> {
    let host = webview.state::<PluginHost>();
    grant(&host, &plugin)?;
    host.caps.with(&plugin, webview.label(), |owned| {
        if owned
            .browser
            .as_ref()
            .is_some_and(|watcher| watcher.id == watch)
        {
            owned.browser = None;
        }
    });
    Ok(())
}

fn watched<T>(
    webview: &Webview,
    plugin: &str,
    watch: u32,
    use_watch: impl FnOnce(&Watcher) -> Result<T, wire::Failure>,
) -> Result<T, String> {
    let host = webview.state::<PluginHost>();
    let extension = grant(&host, plugin)?;
    host.caps.with(plugin, webview.label(), |owned| {
        let watcher = owned
            .browser
            .as_ref()
            .filter(|entry| entry.id == watch && entry.bridge.extension() == extension)
            .ok_or("Browser Remote is not watching")?;
        use_watch(watcher).map_err(String::from)
    })
}

#[tauri::command]
pub fn plugin_browser_pair(webview: Webview, plugin: String, watch: u32) -> Result<String, String> {
    if webview.label() != "panel" {
        return Err("Pair Browser Remote from the control panel".into());
    }
    watched(&webview, &plugin, watch, |watcher| {
        watcher.bridge.pair(watch)
    })
}

#[tauri::command]
pub async fn plugin_browser_activate(
    webview: Webview,
    plugin: String,
    watch: u32,
    revision: u32,
    tab: i32,
) -> Result<(), String> {
    if tab < 0 {
        return Err("Invalid browser tab ID".into());
    }
    let (reply, result) = oneshot::channel();
    watched(&webview, &plugin, watch, |watcher| {
        watcher.bridge.activate(Activation {
            revision,
            tab,
            reply,
        })
    })?;
    timeout(wire::DEADLINE * 2, result)
        .await
        .map_err(|_| "Browser did not respond")?
        .map_err(|_| "Browser disconnected")?
        .map_err(String::from)
}
