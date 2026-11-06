//! The plugin side of the protocol: requests answered concurrently, events and calls into the app, all written
//! through one stdout task.
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, oneshot};

use crate::{HELLO, Message, PROTOCOL, decode, encode, read_frame};

/// Environment variable naming the plugin's own data folder; the app creates the folder before starting it.
pub const DATA_DIR_VAR: &str = "SUPADASHBOARD_DATA_DIR";

pub fn data_dir() -> Result<PathBuf, String> {
    std::env::var_os(DATA_DIR_VAR)
        .map(PathBuf::from)
        .ok_or_else(|| "Plugin data folder unavailable".into())
}

/// A typed outcome as the JSON answer `serve` sends.
pub fn answer<T: Serialize>(outcome: Result<T, String>) -> Result<Value, String> {
    outcome.and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
}

pub struct Call {
    pub method: String,
    pub params: Value,
    /// The calling window, as the app reports it.
    pub window: Option<String>,
}

type Waiting = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// The plugin's link to the app: events, calls into the app and answers share one writer so lines never interleave.
#[derive(Clone)]
pub struct Host {
    lines: mpsc::UnboundedSender<String>,
    waiting: Waiting,
    next_id: Arc<AtomicU64>,
}

impl Host {
    /// Starts the stdout writer; needs a running tokio runtime.
    pub fn connect() -> Self {
        let (lines, mut queue) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            let mut output = tokio::io::stdout();
            while let Some(line) = queue.recv().await {
                if output.write_all(line.as_bytes()).await.is_err() || output.flush().await.is_err()
                {
                    return;
                }
            }
        });
        Self {
            lines,
            waiting: Waiting::default(),
            next_id: Arc::default(),
        }
    }

    /// Reaches the frontend as `plugin://<id>/<name>`. `name` must pass `valid_name`, or the app drops it.
    pub fn emit(&self, name: &str, data: impl Serialize) {
        let Ok(data) = serde_json::to_value(data) else {
            return;
        };
        let event = Message::Event {
            name: name.into(),
            data,
        };
        if let Some(line) = encode(&event) {
            let _ = self.lines.send(line);
        }
    }

    /// Asks the app for a service its manifest grants the plugin (`media-command`, `media-shuffle`).
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = Message::Request {
            id,
            method: method.into(),
            params,
            window: None,
        };
        let line = encode(&request).ok_or("Request too long")?;
        let (reply, answer) = oneshot::channel();
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, reply);
        self.lines.send(line).map_err(|_| "App connection closed")?;
        answer.await.map_err(|_| "App connection closed")?
    }

    fn answered(&self, id: u64, outcome: Result<Value, String>) {
        let waiter = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(waiter) = waiter {
            let _ = waiter.send(outcome);
        }
    }

    fn answer(&self, id: u64, outcome: Result<Value, String>) {
        let line = encode(&Message::response(id, outcome))
            .or_else(|| encode(&Message::response(id, Err("Answer too long".into()))));
        if let Some(line) = line {
            let _ = self.lines.send(line);
        }
    }
}

/// Answers requests until the app closes stdin. Each runs as its own task, so a slow one (a sign-in waiting for
/// the user) holds up no other.
pub async fn serve<F, Fut>(host: &Host, mut handle: F)
where
    F: FnMut(Call) -> Fut,
    Fut: Future<Output = Result<Value, String>> + Send + 'static,
{
    let mut input = tokio::io::BufReader::new(tokio::io::stdin());
    while let Ok(Some(frame)) = read_frame(&mut input).await {
        match decode(&frame) {
            Ok(Message::Request { id, method, .. }) if method == HELLO => {
                host.answer(id, Ok(json!({ "protocol": PROTOCOL })));
            }
            Ok(Message::Request {
                id,
                method,
                params,
                window,
            }) => {
                let answer = handle(Call {
                    method,
                    params,
                    window,
                });
                let host = host.clone();
                tokio::spawn(async move { host.answer(id, answer.await) });
            }
            Ok(Message::Response { id, result, error }) => host.answered(
                id,
                match error {
                    Some(error) => Err(error),
                    None => Ok(result.unwrap_or(Value::Null)),
                },
            ),
            Ok(Message::Event { .. }) => {}
            Err(error) => eprintln!("Ignored a malformed request: {error}"),
        }
    }
}
