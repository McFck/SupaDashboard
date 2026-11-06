//! What a plugin process may ask of the app. Each call is checked against the plugin's manifest grants.
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::Plugin;
use crate::media::{self, MediaHub};

#[derive(Deserialize)]
struct MediaCommand {
    command: String,
}

pub async fn handle(
    app: &AppHandle,
    plugin: &Plugin,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        // A transport command for the plugin's own player only, e.g. Spotify skipping after a dislike.
        "media-command" => {
            let target = plugin
                .manifest
                .media
                .as_deref()
                .ok_or("Media control is not granted")?;
            let MediaCommand { command } =
                serde_json::from_value(params).map_err(|_| "Invalid media command")?;
            let hub = app.state::<MediaHub>();
            Ok(media::run_command(&hub, Some(target), command, None)
                .await?
                .into())
        }
        _ => Err(format!("Unknown app method {method}")),
    }
}
