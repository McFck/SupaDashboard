//! Spotify plugin host. Holds the song lyrics: LRCLIB lookups, their cache and the per-song sync offsets.
// No console window: the app talks to this process over pipes only.
#![windows_subsystem = "windows"]
mod lyrics;

use std::sync::Arc;

use plugin_sdk::{Call, Events, answer};
use serde::Deserialize;
use serde_json::Value;

use lyrics::{LyricsHub, LyricsOffsets, Track};

#[derive(Default)]
struct Plugin {
    lyrics: LyricsHub,
    offsets: LyricsOffsets,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackParams {
    artist: String,
    title: String,
    album: String,
    duration_ms: u64,
    #[serde(default)]
    offset_ms: i64,
}

fn track(params: Value) -> Result<(Track, i64), String> {
    let p: TrackParams = serde_json::from_value(params).map_err(|_| "Invalid lyrics track")?;
    Ok((
        Track::new(p.artist, p.title, p.album, p.duration_ms)?,
        p.offset_ms,
    ))
}

async fn handle(plugin: Arc<Plugin>, Call { method, params, .. }: Call) -> Result<Value, String> {
    match method.as_str() {
        "lyrics-get" => answer(plugin.lyrics.get(track(params)?.0).await),
        "lyrics-offset-get" => answer(plugin.offsets.get(&track(params)?.0)),
        "lyrics-offset-set" => {
            let (track, offset_ms) = track(params)?;
            answer(plugin.offsets.set(&track, offset_ms))
        }
        _ => Err(format!("Unknown method {method}")),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let plugin = Arc::new(Plugin::default());
    plugin_sdk::serve(&Events::connect(), |call| handle(plugin.clone(), call)).await;
}
