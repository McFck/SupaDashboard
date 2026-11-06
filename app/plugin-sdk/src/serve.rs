//! The plugin side of the protocol: requests answered concurrently, events, all written through one stdout task.
use std::future::Future;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

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

/// The plugin's output: events and answers share one writer so lines never interleave.
#[derive(Clone)]
pub struct Events(mpsc::UnboundedSender<String>);

impl Events {
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
        Self(lines)
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
            let _ = self.0.send(line);
        }
    }

    fn answer(&self, id: u64, outcome: Result<Value, String>) {
        let line = encode(&Message::response(id, outcome))
            .or_else(|| encode(&Message::response(id, Err("Answer too long".into()))));
        if let Some(line) = line {
            let _ = self.0.send(line);
        }
    }
}

/// Answers requests until the app closes stdin. Each runs as its own task, so a slow one (a sign-in waiting for
/// the user) holds up no other.
pub async fn serve<F, Fut>(events: &Events, mut handle: F)
where
    F: FnMut(Call) -> Fut,
    Fut: Future<Output = Result<Value, String>> + Send + 'static,
{
    let mut input = tokio::io::BufReader::new(tokio::io::stdin());
    while let Ok(Some(frame)) = read_frame(&mut input).await {
        match decode(&frame) {
            Ok(Message::Request { id, method, .. }) if method == HELLO => {
                events.answer(id, Ok(json!({ "protocol": PROTOCOL })));
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
                let events = events.clone();
                tokio::spawn(async move { events.answer(id, answer.await) });
            }
            Ok(_) => {}
            Err(error) => eprintln!("Ignored a malformed request: {error}"),
        }
    }
}
