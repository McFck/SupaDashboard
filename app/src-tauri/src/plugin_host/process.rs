//! One running plugin process: spawn, version handshake, answers matched to requests, events forwarded.
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use plugin_sdk::{DATA_DIR_VAR, HELLO, Message, PROTOCOL, decode, encode, read_frame};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use windows::Win32::Foundation::HANDLE;

use super::job::Job;
use super::{Plugin, host_api};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const HANDSHAKE: Duration = Duration::from_secs(5);
/// Time a plugin gets to exit on its own after its stdin closes.
const GRACE: Duration = Duration::from_secs(2);
pub const STOPPED: &str = "Plugin stopped";

pub type Reply = Result<Value, String>;
/// `None` once the process's output has ended: nothing will answer any more.
#[derive(Clone, Default)]
struct Pending(Arc<Mutex<Option<HashMap<u64, oneshot::Sender<Reply>>>>>);

impl Pending {
    fn lock(&self) -> MutexGuard<'_, Option<HashMap<u64, oneshot::Sender<Reply>>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct Process {
    // Dropping the child kills the process (kill_on_drop).
    child: Child,
    input: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: u64,
    pub started: Instant,
}

impl Process {
    /// Spawns the plugin inside the job and completes the handshake. `on_exit` runs once its output ends.
    pub async fn start(
        plugin: &Arc<Plugin>,
        job: &Job,
        app: &AppHandle,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<Self, String> {
        let id = &plugin.manifest.id;
        let failed = |error: &dyn std::fmt::Display| format!("Plugin {id} did not start: {error}");
        let Some(exe) = &plugin.manifest.exe else {
            return Err(failed(&"no executable"));
        };
        let mut child = Command::new(plugin.folder.join(exe))
            .current_dir(&plugin.folder)
            .env(DATA_DIR_VAR, &plugin.data)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| failed(&error))?;
        if let Some(handle) = child.raw_handle() {
            job.assign(HANDLE(handle)).map_err(|error| failed(&error))?;
        }
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(failed(&"no pipes"));
        };
        let pending = Pending(Arc::new(Mutex::new(Some(HashMap::new()))));
        let input = write_requests(stdin);
        read_answers(
            plugin.clone(),
            stdout,
            &input,
            pending.clone(),
            app.clone(),
            on_exit,
        );
        read_log(id, stderr);
        let mut process = Self {
            child,
            input,
            pending,
            next_id: 0,
            started: Instant::now(),
        };
        let hello = process.call(HELLO, json!({ "protocol": PROTOCOL }), None);
        match timeout(HANDSHAKE, hello).await {
            Ok(Ok(Ok(answer))) if answer["protocol"] == PROTOCOL => Ok(process),
            _ => Err(failed(&"no handshake for this protocol version")),
        }
    }

    pub fn call(
        &mut self,
        method: &str,
        params: Value,
        window: Option<String>,
    ) -> oneshot::Receiver<Reply> {
        let (reply, answer) = oneshot::channel();
        self.next_id += 1;
        let id = self.next_id;
        let request = Message::Request {
            id,
            method: method.into(),
            params,
            window,
        };
        let Some(line) = encode(&request) else {
            let _ = reply.send(Err("Request too long".into()));
            return answer;
        };
        match self.pending.lock().as_mut() {
            Some(pending) => {
                pending.insert(id, reply);
            }
            None => {
                let _ = reply.send(Err(STOPPED.into()));
                return answer;
            }
        }
        // A closed writer means the process is gone; its output ending answers the request.
        let _ = self.input.send(line);
        answer
    }

    /// Closes stdin so the plugin exits on its own, then kills it if it has not.
    pub async fn stop(mut self) {
        drop(self.input);
        if timeout(GRACE, self.child.wait()).await.is_err() {
            let _ = self.child.kill().await;
        }
    }
}

fn write_requests(mut stdin: ChildStdin) -> mpsc::UnboundedSender<String> {
    let (input, mut lines) = mpsc::unbounded_channel::<String>();
    tauri::async_runtime::spawn(async move {
        while let Some(line) = lines.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                return;
            }
        }
    });
    input
}

fn read_answers(
    plugin: Arc<Plugin>,
    stdout: ChildStdout,
    input: &mpsc::UnboundedSender<String>,
    pending: Pending,
    app: AppHandle,
    on_exit: impl FnOnce() + Send + 'static,
) {
    let input = input.clone();
    tauri::async_runtime::spawn(async move {
        let id = &plugin.manifest.id;
        let mut output = BufReader::new(stdout);
        // An oversized line ends the process like end of output: its stream cannot be trusted any more.
        while let Ok(Some(frame)) = read_frame(&mut output).await {
            match decode(&frame) {
                Ok(Message::Response {
                    id: request,
                    result,
                    error,
                }) => {
                    let waiter = pending.lock().as_mut().and_then(|p| p.remove(&request));
                    if let Some(waiter) = waiter {
                        let _ = waiter.send(match error {
                            Some(error) => Err(error),
                            None => Ok(result.unwrap_or(Value::Null)),
                        });
                    }
                }
                Ok(Message::Event { name, data }) => {
                    // Only the windows the plugin serves; never embedded content webviews.
                    let event = format!("plugin://{id}/{name}");
                    for window in &plugin.manifest.windows {
                        let _ = app.emit_to(window.as_str(), &event, &data);
                    }
                }
                Ok(Message::Request {
                    id: request,
                    method,
                    params,
                    ..
                }) => {
                    let (plugin, app, input) = (plugin.clone(), app.clone(), input.clone());
                    tauri::async_runtime::spawn(async move {
                        let outcome = host_api::handle(&app, &plugin, &method, params).await;
                        if let Some(line) = encode(&Message::response(request, outcome)) {
                            let _ = input.send(line);
                        }
                    });
                }
                Err(_) => {
                    log::warn!("Plugin {id} sent an invalid message");
                }
            }
        }
        let waiters = pending.lock().take().unwrap_or_default();
        for waiter in waiters.into_values() {
            let _ = waiter.send(Err(STOPPED.into()));
        }
        on_exit();
    });
}

/// A plugin's stderr is its log.
fn read_log(id: &str, stderr: ChildStderr) {
    let id = id.to_owned();
    tauri::async_runtime::spawn(async move {
        let mut log = BufReader::new(stderr);
        while let Ok(Some(line)) = read_frame(&mut log).await {
            log::info!("[{id}] {}", String::from_utf8_lossy(&line).trim_end());
        }
    });
}
