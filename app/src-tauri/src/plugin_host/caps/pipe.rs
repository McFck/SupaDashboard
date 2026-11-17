//! `pipes`: a local app's named pipe (`\\.\pipe\<declared prefix>-<0..9>`, Discord's IPC). The host frames each
//! message as `u32 LE op, u32 LE length, JSON` (op <= 4, body <= 64 KiB). A string exactly `"{{secret:<name>}}"` in
//! a sent frame is replaced natively by that token when its client may send to `pipe:<prefix>`.
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Webview};
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::task::AbortHandle;

use super::token;
use crate::plugin_host::PluginHost;
use crate::plugin_host::permissions::Permissions;

const MAX_BODY: usize = 65_536;
const INVALID: &str = "Invalid pipe frame";

type Writer = Arc<tokio::sync::Mutex<WriteHalf<NamedPipeClient>>>;

pub struct Pipe {
    prefix: String,
    writer: Writer,
    reader: AbortHandle,
}

impl Drop for Pipe {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PipeEvent {
    Frame {
        op: u32,
        data: Value,
    },
    /// The app closed the pipe or sent an invalid frame; the handle is gone.
    Closed,
}

fn encode(op: u32, value: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(value).map_err(|_| INVALID)?;
    if op > 4 || body.len() > MAX_BODY {
        return Err(INVALID.into());
    }
    let mut bytes = Vec::with_capacity(8 + body.len());
    bytes.extend(op.to_le_bytes());
    bytes.extend((body.len() as u32).to_le_bytes());
    bytes.extend(body);
    Ok(bytes)
}

/// Incomplete frames remain buffered; an invalid frame ends the connection.
fn decode(bytes: &mut Vec<u8>) -> Result<Option<(u32, Value)>, String> {
    if bytes.len() < 8 {
        return Ok(None);
    }
    let word =
        |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (op, len) = (word(0), word(4) as usize);
    if op > 4 || len > MAX_BODY {
        return Err(INVALID.into());
    }
    if bytes.len() < 8 + len {
        return Ok(None);
    }
    let value = serde_json::from_slice(&bytes[8..8 + len]).map_err(|_| INVALID)?;
    bytes.drain(..8 + len);
    Ok(Some((op, value)))
}

/// The declared prefix of a pipe name `<prefix>-<digit>`.
fn prefix<'a>(permissions: &Permissions, name: &'a str) -> Result<&'a str, String> {
    let (prefix, digit) = name.rsplit_once('-').ok_or("This pipe is not allowed")?;
    let numbered = digit.len() == 1 && digit.bytes().all(|b| b.is_ascii_digit());
    if !numbered || !permissions.pipes.iter().any(|declared| declared == prefix) {
        return Err("This pipe is not allowed".into());
    }
    Ok(prefix)
}

/// Every string of `value`, depth first.
fn strings(
    value: &mut Value,
    visit: &mut dyn FnMut(&mut String) -> Result<(), String>,
) -> Result<(), String> {
    match value {
        Value::String(text) => visit(text),
        Value::Array(items) => items.iter_mut().try_for_each(|item| strings(item, visit)),
        Value::Object(fields) => fields
            .values_mut()
            .try_for_each(|item| strings(item, visit)),
        _ => Ok(()),
    }
}

/// The secret names of a frame's placeholders, each allowed to go to `pipe:<prefix>`. A placeholder must be the
/// whole string, so a token is never spliced into text the plugin chose.
fn placeholders(
    permissions: &Permissions,
    prefix: &str,
    data: &mut Value,
) -> Result<Vec<String>, String> {
    let target = format!("pipe:{prefix}");
    let mut names = Vec::new();
    strings(data, &mut |text| {
        let Some(name) = text
            .strip_prefix("{{secret:")
            .and_then(|rest| rest.strip_suffix("}}"))
        else {
            return if text.contains("{{secret:") {
                Err("Invalid secret placeholder".into())
            } else {
                Ok(())
            };
        };
        if !permissions.sends(name, &target) {
            return Err("This secret is not sent to this pipe".into());
        }
        names.push(name.to_owned());
        Ok(())
    })?;
    Ok(names)
}

async fn read(mut reader: ReadHalf<NamedPipeClient>, events: &Channel<PipeEvent>) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        loop {
            match decode(&mut buffer) {
                Ok(Some((op, data))) => {
                    let _ = events.send(PipeEvent::Frame { op, data });
                }
                Ok(None) => break,
                Err(_) => return,
            }
        }
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
}

#[tauri::command]
pub async fn plugin_pipe_open(
    app: AppHandle,
    webview: Webview,
    plugin: String,
    name: String,
    events: Channel<PipeEvent>,
) -> Result<u32, String> {
    let host = app.state::<PluginHost>();
    let installed = host.installed(&plugin)?;
    let prefix = prefix(&installed.manifest.permissions, &name)?.to_owned();
    let client = ClientOptions::new()
        .open(format!(r"\\.\pipe\{name}"))
        .map_err(|_| "Could not connect to the app")?;
    let (reader, writer) = tokio::io::split(client);
    let handle = host.caps.handle();
    let label = webview.label().to_owned();
    // Spawned under the registry lock, so a pipe that closes at once is listed before its reader unlists it.
    host.caps.with(&plugin, &label, |owned| {
        let task = tauri::async_runtime::spawn({
            let (app, plugin, label) = (app.clone(), plugin.clone(), label.clone());
            async move {
                read(reader, &events).await;
                let _ = events.send(PipeEvent::Closed);
                let pipe = app
                    .state::<PluginHost>()
                    .caps
                    .with(&plugin, &label, |owned| owned.pipes.remove(&handle));
                drop(pipe);
            }
        });
        let pipe = Pipe {
            prefix,
            writer: Arc::new(tokio::sync::Mutex::new(writer)),
            reader: task.inner().abort_handle(),
        };
        owned.pipes.insert(handle, pipe);
    });
    Ok(handle)
}

#[tauri::command]
pub async fn plugin_pipe_send(
    app: AppHandle,
    webview: Webview,
    plugin: String,
    handle: u32,
    op: u32,
    mut data: Value,
) -> Result<(), String> {
    let host = app.state::<PluginHost>();
    let installed = host.installed(&plugin)?;
    let (prefix, writer) = host
        .caps
        .with(&plugin, webview.label(), |owned| {
            owned
                .pipes
                .get(&handle)
                .map(|pipe| (pipe.prefix.clone(), pipe.writer.clone()))
        })
        .ok_or("The pipe is closed")?;
    let names = placeholders(&installed.manifest.permissions, &prefix, &mut data)?;
    let mut tokens = Vec::with_capacity(names.len());
    for name in &names {
        tokens.push(token(&host, &plugin, name).await?);
    }
    let mut tokens = tokens.into_iter();
    strings(&mut data, &mut |text| {
        if text.starts_with("{{secret:") {
            *text = tokens.next().unwrap_or_default();
        }
        Ok(())
    })?;
    let frame = encode(op, &data)?;
    let mut writer = writer.lock().await;
    writer
        .write_all(&frame)
        .await
        .map_err(|_| "The pipe is closed".into())
}

#[tauri::command]
pub fn plugin_pipe_close(webview: Webview, plugin: String, handle: u32) {
    let host = webview.state::<PluginHost>();
    let pipe = host.caps.with(&plugin, webview.label(), |owned| {
        owned.pipes.remove(&handle)
    });
    drop(pipe);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fragmented_and_coalesced_frames_keep_their_boundaries() {
        let frame = encode(1, &json!({"cmd":"DISPATCH","evt":"READY"})).unwrap();
        let mut buffer = frame[..10].to_vec();
        assert!(decode(&mut buffer).unwrap().is_none());
        buffer.extend(&frame[10..]);
        buffer.extend(&frame);
        assert_eq!(decode(&mut buffer).unwrap().unwrap().1["evt"], "READY");
        assert!(decode(&mut buffer).unwrap().is_some());
        assert!(buffer.is_empty());
    }

    #[test]
    fn rejects_oversized_bad_opcode_and_invalid_utf8_frames() {
        for (op, len, body) in [(1u32, 65_537u32, vec![]), (5, 0, vec![]), (1, 1, vec![255])] {
            let mut bytes = [op.to_le_bytes().to_vec(), len.to_le_bytes().to_vec(), body].concat();
            assert!(decode(&mut bytes).is_err());
        }
        assert!(encode(5, &json!({})).is_err());
        assert!(encode(1, &json!("x".repeat(MAX_BODY))).is_err());
    }

    #[test]
    fn only_declared_pipes_open_and_tokens_reach_only_their_pipe_as_whole_strings() {
        let permissions: Permissions = serde_json::from_str(
            r#"{"pipes":["discord-ipc","other"],"http":["discord.com"],"oauth":{"discord":{
            "token":"https://discord.com/t","redirect":"http://127.0.0.1","scopes":[],"send":["pipe:discord-ipc"]},
            "web":{"token":"https://discord.com/t","redirect":"http://127.0.0.1","scopes":[],"send":["discord.com"]}}}"#,
        )
        .unwrap();
        assert_eq!(prefix(&permissions, "discord-ipc-0"), Ok("discord-ipc"));
        assert_eq!(prefix(&permissions, "discord-ipc-9"), Ok("discord-ipc"));
        for name in [
            "discord-ipc",
            "discord-ipc-10",
            "discord-ipc-a",
            "spotify-0",
            "..\\discord-ipc-0",
            "discord-ipc-0\\x",
        ] {
            assert!(prefix(&permissions, name).is_err(), "{name}");
        }
        let mut frame =
            json!({"cmd":"AUTHENTICATE","args":{"access_token":"{{secret:discord}}"},"n":[1]});
        assert_eq!(
            placeholders(&permissions, "discord-ipc", &mut frame),
            Ok(vec!["discord".to_owned()])
        );
        for (prefix, mut refused) in [
            ("other", json!({"t":"{{secret:discord}}"})),
            ("discord-ipc", json!({"t":"{{secret:web}}"})),
            ("discord-ipc", json!({"t":"{{secret:nobody}}"})),
            ("discord-ipc", json!({"t":["Bearer {{secret:discord}}"]})),
        ] {
            assert!(
                placeholders(&permissions, prefix, &mut refused).is_err(),
                "{refused}"
            );
        }
    }
}
