//! Owns one plugin's process: starts it on the first call, restarts it with backoff after it dies, stops it on
//! disable. Every state change happens on one task, so a call never races a restart.
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep, timeout};

use super::Plugin;
use super::job::Job;
use super::migrate::migrate;
use plugin_sdk::WINDOW_CLOSED;

use super::process::{Process, Reply, STOPPED};
use super::restarts::Restarts;

/// A call that takes longer means the plugin hangs; it is killed and restarted. Sign-ins wait for the user for
/// up to about five minutes inside the plugin, so this only catches a plugin that stopped answering at all.
const CALL_TIMEOUT: Duration = Duration::from_secs(360);

type Started = Result<(u64, oneshot::Receiver<Reply>), String>;

enum Msg {
    Call {
        method: String,
        params: Value,
        window: String,
        reply: oneshot::Sender<Started>,
    },
    WindowClosed(String),
    SetEnabled(bool, oneshot::Sender<()>),
    Exited(u64),
    Restart(u64),
    Hung(u64),
}

/// Processes are numbered so a late notice about an old one never touches its successor.
enum State {
    Idle,
    Running(u64, Process),
    Waiting(u64),
}

pub struct Supervisor {
    tx: mpsc::UnboundedSender<Msg>,
}

impl Supervisor {
    pub fn new(plugin: Arc<Plugin>, job: Arc<Job>, app: AppHandle) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let owner = Owner {
            plugin,
            job,
            app,
            tx: tx.clone(),
            enabled: true,
            state: State::Idle,
            restarts: Restarts::default(),
            generation: 0,
        };
        tauri::async_runtime::spawn(owner.run(rx));
        Self { tx }
    }

    pub async fn call(&self, method: String, params: Value, window: String) -> Reply {
        let (reply, started) = oneshot::channel();
        let message = Msg::Call {
            method,
            params,
            window,
            reply,
        };
        self.tx.send(message).map_err(|_| STOPPED)?;
        let (generation, answer) = started.await.map_err(|_| STOPPED)??;
        match timeout(CALL_TIMEOUT, answer).await {
            Ok(reply) => reply.unwrap_or_else(|_| Err(STOPPED.into())),
            Err(_) => {
                let _ = self.tx.send(Msg::Hung(generation));
                Err("Plugin did not answer".into())
            }
        }
    }

    /// Tells a running plugin that `window` closed; starts nothing.
    pub fn window_closed(&self, window: &str) {
        let _ = self.tx.send(Msg::WindowClosed(window.into()));
    }

    /// Disabling stops the process and refuses calls until enabled again; enabling starts nothing by itself.
    pub async fn set_enabled(&self, enabled: bool) {
        let (done, stopped) = oneshot::channel();
        if self.tx.send(Msg::SetEnabled(enabled, done)).is_ok() {
            let _ = stopped.await;
        }
    }
}

struct Owner {
    plugin: Arc<Plugin>,
    job: Arc<Job>,
    app: AppHandle,
    tx: mpsc::UnboundedSender<Msg>,
    enabled: bool,
    state: State,
    restarts: Restarts,
    generation: u64,
}

impl Owner {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Msg>) {
        while let Some(message) = rx.recv().await {
            match message {
                Msg::Call {
                    method,
                    params,
                    window,
                    reply,
                } => {
                    let _ = reply.send(self.call(&method, params, window).await);
                }
                Msg::WindowClosed(window) => {
                    if let State::Running(_, process) = &mut self.state {
                        // No one waits for the answer; a plugin without subscriptions ignores it.
                        drop(process.call(WINDOW_CLOSED, Value::Null, Some(window)));
                    }
                }
                Msg::SetEnabled(enabled, done) => {
                    self.enabled = enabled;
                    if !enabled
                        && let State::Running(_, process) =
                            std::mem::replace(&mut self.state, State::Idle)
                    {
                        process.stop().await;
                    }
                    let _ = done.send(());
                }
                Msg::Exited(generation) => self.exited(generation, "exited"),
                Msg::Hung(generation) => self.exited(generation, "stopped answering"),
                Msg::Restart(generation) => {
                    let waiting = matches!(self.state, State::Waiting(g) if g == generation);
                    if self.enabled && waiting && self.start().await.is_ok() {
                        // The new process has none of the old one's state; the frontend applies it again.
                        let event = format!("plugin://{}/restarted", self.plugin.manifest.id);
                        let _ = self.app.emit(&event, ());
                    }
                }
            }
        }
    }

    async fn call(&mut self, method: &str, params: Value, window: String) -> Started {
        if !self.enabled {
            return Err("Plugin is disabled".into());
        }
        if matches!(self.state, State::Idle) {
            self.start().await?;
        }
        match &mut self.state {
            State::Running(generation, process) => {
                Ok((*generation, process.call(method, params, Some(window))))
            }
            _ => Err("Plugin is restarting".into()),
        }
    }

    async fn start(&mut self) -> Result<(), String> {
        self.generation += 1;
        let generation = self.generation;
        let tx = self.tx.clone();
        let on_exit = move || {
            let _ = tx.send(Msg::Exited(generation));
        };
        match self.launch(on_exit).await {
            Ok(process) => {
                self.state = State::Running(generation, process);
                Ok(())
            }
            Err(error) => {
                log::warn!("{error}");
                self.retry(generation, Duration::ZERO);
                Err(error)
            }
        }
    }

    async fn launch(&self, on_exit: impl FnOnce() + Send + 'static) -> Result<Process, String> {
        let plugin = self.plugin.clone();
        let id = plugin.manifest.id.clone();
        // The plugin never runs on half-moved data: a failed move fails the start and is retried with it.
        tauri::async_runtime::spawn_blocking(move || {
            migrate(&plugin.legacy, &plugin.data, &plugin.manifest.migrate)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|moved| moved.map_err(|error| error.to_string()))
        .map_err(|error| format!("Plugin {id} data could not be moved: {error}"))?;
        Process::start(&self.plugin, &self.job, &self.app, on_exit).await
    }

    /// Replacing the state drops the process, which kills it if it is still running.
    fn exited(&mut self, generation: u64, how: &str) {
        let State::Running(current, process) = &self.state else {
            return;
        };
        if *current != generation {
            return;
        }
        let uptime = process.started.elapsed();
        log::warn!("Plugin {} {how}", self.plugin.manifest.id);
        self.retry(generation, uptime);
    }

    fn retry(&mut self, generation: u64, uptime: Duration) {
        let delay = self.restarts.after_exit(uptime);
        self.state = State::Waiting(generation);
        let tx = self.tx.clone();
        tauri::async_runtime::spawn(async move {
            sleep(delay).await;
            let _ = tx.send(Msg::Restart(generation));
        });
    }
}
