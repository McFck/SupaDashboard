//! The plugin host protocol: newline-delimited JSON messages over the plugin process's stdin and stdout.
//! The app sends requests, the plugin answers each one and may emit events; stderr is the plugin's log.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

#[cfg(feature = "http")]
pub mod http;
#[cfg(feature = "open")]
mod open;
#[cfg(feature = "secure")]
pub mod secure;
mod serve;

#[cfg(feature = "open")]
pub use open::open;
pub use serve::{Call, DATA_DIR_VAR, Host, answer, data_dir, serve};

/// Bumped on any incompatible change; the app refuses a plugin that answers the handshake with another.
pub const PROTOCOL: u32 = 1;
/// The first request of every process; plugins never see it as a method call.
pub const HELLO: &str = "hello";
/// Sent by the app when one of its windows closes, with `window` set, so subscriptions it held end.
pub const WINDOW_CLOSED: &str = "window-closed";
/// Longest accepted message line in bytes, without the newline.
pub const MAX_FRAME: usize = 1 << 20;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Message {
    Request {
        id: u64,
        method: String,
        #[serde(default)]
        params: Value,
        /// The window that called; set by the app, never by the frontend.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
    },
    /// `error` set means the call failed; otherwise `result` (absent reads as null) is the answer.
    Response {
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Event {
        name: String,
        #[serde(default)]
        data: Value,
    },
}

impl Message {
    pub fn response(id: u64, outcome: Result<Value, String>) -> Self {
        match outcome {
            Ok(result) => Message::Response {
                id,
                result: Some(result),
                error: None,
            },
            Err(error) => Message::Response {
                id,
                result: None,
                error: Some(error),
            },
        }
    }
}

/// Method and event names: a lowercase letter, then up to 63 letters, digits, `_` or `-`.
pub fn valid_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && name.len() <= 64
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// One message as a line, newline included; `None` when it would exceed `MAX_FRAME`.
pub fn encode(message: &Message) -> Option<String> {
    let line = serde_json::to_string(message).ok()?;
    (line.len() <= MAX_FRAME).then(|| line + "\n")
}

pub fn decode(frame: &[u8]) -> Result<Message, String> {
    let message: Message = serde_json::from_slice(frame).map_err(|error| error.to_string())?;
    match &message {
        Message::Request { method: name, .. } | Message::Event { name, .. }
            if !valid_name(name) =>
        {
            Err(format!("Invalid name {name:?}"))
        }
        _ => Ok(message),
    }
}

/// The next line without its newline; `Ok(None)` at end of stream. A line longer than `MAX_FRAME` is an error,
/// so a misbehaving peer cannot make the reader buffer without bound.
pub async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::new();
    let limit = MAX_FRAME as u64 + 1;
    let read = (&mut *reader)
        .take(limit)
        .read_until(b'\n', &mut frame)
        .await?;
    if read == 0 {
        return Ok(None);
    }
    if frame.last() == Some(&b'\n') {
        frame.pop();
    } else if frame.len() > MAX_FRAME {
        return Err(std::io::Error::other("Message too long"));
    }
    Ok(Some(frame))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_response_survives_the_round_trip() {
        let sent = Message::response(7, Err("No device".into()));
        let line = encode(&sent).unwrap();
        assert_eq!(decode(line.trim_end().as_bytes()), Ok(sent));
        let ok = decode(br#"{"type":"response","id":1}"#).unwrap();
        assert_eq!(
            ok,
            Message::Response {
                id: 1,
                result: None,
                error: None
            }
        );
    }

    #[test]
    fn names_that_could_escape_the_event_namespace_are_rejected() {
        for name in ["", "Hello", "a/b", "a:b", "a.b", &"a".repeat(65)] {
            let event = format!(r#"{{"type":"event","name":{name:?}}}"#);
            assert!(decode(event.as_bytes()).is_err(), "{name:?} accepted");
        }
        assert!(decode(br#"{"type":"event","name":"voice-state"}"#).is_ok());
    }

    #[tokio::test]
    async fn an_oversized_line_is_refused_instead_of_buffered() {
        let mut input = vec![b'x'; MAX_FRAME + 10];
        input.push(b'\n');
        assert!(read_frame(&mut input.as_slice()).await.is_err());
        let mut ok = b"{}\n{}".as_slice();
        assert_eq!(read_frame(&mut ok).await.unwrap(), Some(b"{}".to_vec()));
        assert_eq!(read_frame(&mut ok).await.unwrap(), Some(b"{}".to_vec()));
        assert_eq!(read_frame(&mut ok).await.unwrap(), None);
    }
}
