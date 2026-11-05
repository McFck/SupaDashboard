mod cache;
mod lrc;
mod lrclib;
mod matching;

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LyricsView {
    Synced { lines: Vec<lrc::Line> },
    Plain { text: String },
    Instrumental,
    None,
}

#[derive(Debug)]
struct Track {
    artist: String,
    title: String,
    album: String,
    /// Whole seconds, as LRCLIB takes them.
    duration: u64,
    duration_ms: u64,
}

impl Track {
    fn new(artist: String, title: String, album: String, duration_ms: u64) -> Result<Self, String> {
        let track = Self {
            artist: artist.trim().into(),
            title: title.trim().into(),
            album: album.trim().into(),
            duration: duration_ms.saturating_add(500) / 1000,
            duration_ms,
        };
        if !(1000..=3_600_000).contains(&duration_ms)
            || track.artist.is_empty()
            || track.title.is_empty()
            || [&track.artist, &track.title, &track.album]
                .iter()
                .any(|value| value.chars().count() > 256 || value.chars().any(char::is_control))
        {
            return Err("Invalid lyrics track".into());
        }
        Ok(track)
    }
}

struct Entry {
    key: String,
    at: u64,
    result: Result<LyricsView, String>,
}

#[derive(Default)]
struct State {
    entries: VecDeque<Entry>,
    client: lrclib::Client,
}

#[derive(Default)]
pub struct LyricsHub(tokio::sync::Mutex<State>);

#[tauri::command]
pub async fn lyrics_get(
    app: tauri::AppHandle,
    hub: tauri::State<'_, LyricsHub>,
    artist: String,
    title: String,
    album: String,
    duration_ms: u64,
) -> Result<LyricsView, String> {
    let track = Track::new(artist, title, album, duration_ms)?;
    let key = cache::key(&track)?;
    // One queue serves both webviews. Completed results also deduplicate failed requests and
    // requests whose optional disk cache could not be written.
    let mut state = hub.0.lock().await;
    let now = cache::now();
    if let Some(entry) = state.entries.iter().find(|entry| {
        entry.key == key
            && now.saturating_sub(entry.at)
                < match &entry.result {
                    Ok(LyricsView::None) => cache::NEGATIVE_TTL,
                    Ok(_) => u64::MAX,
                    Err(_) => 5,
                }
    }) {
        return entry.result.clone();
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Lyrics cache unavailable")?
        .join("lyrics");
    let result = if let Some(view) = cache::read(&dir, &key, now) {
        Ok(view)
    } else {
        let result = state.client.fetch(&track).await;
        if let Ok(view) = &result {
            if let Err(error) = cache::write(&dir, &key, view, now) {
                // Lyrics remain usable when this disposable cache cannot be written.
                log::warn!("Could not cache lyrics: {error}");
            }
        }
        result
    };
    state.entries.retain(|entry| entry.key != key);
    if state.entries.len() == 32 {
        state.entries.pop_front();
    }
    state.entries.push_back(Entry {
        key,
        at: now,
        result: result.clone(),
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_command_inputs_before_fetching() {
        for (artist, title, duration) in [
            ("", "title", 1000),
            ("artist", "\ntitle\0", 1000),
            ("artist", "title", 0),
            ("artist", "title", u64::MAX),
        ] {
            assert!(Track::new(artist.into(), title.into(), "".into(), duration).is_err());
        }
        assert!(Track::new("a".repeat(257), "title".into(), "".into(), 1000).is_err());
    }
}
