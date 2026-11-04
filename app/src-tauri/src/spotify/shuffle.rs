//! Spotify shuffle writes: confirm GSMTC applied the requested state before accepting success.
use super::{Operation, SpotifyHub};
use crate::media::{self, MediaHub};
use serde::Deserialize;
use std::time::Duration;
use tauri::{State, Webview};
use windows::Media::Control::GlobalSystemMediaTransportControlsSession as Session;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    On,
    Off,
    Toggle,
}

impl Mode {
    pub(super) fn enabled(self, current: bool) -> bool {
        match self {
            Self::On => true,
            Self::Off => false,
            Self::Toggle => !current,
        }
    }
}

fn active(session: &Session) -> Result<bool, String> {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.IsShuffleActive())
        .and_then(|value| value.Value())
        .map_err(|_| "Spotify shuffle unavailable".into())
}

async fn apply(session: &Session, enabled: bool) -> Result<(), String> {
    let operation = session
        .TryChangeShuffleActiveAsync(enabled)
        .map_err(|_| "Spotify shuffle unavailable")?;
    let sent = tokio::time::timeout(Duration::from_secs(3), operation)
        .await
        .map_err(|_| "Spotify shuffle timed out")?
        .map_err(|_| "Spotify shuffle failed")?;
    if !sent {
        return Err("Spotify rejected shuffle".into());
    }
    // A successful operation can be ignored by Spotify; allow its state notification to catch up.
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if active(session)? == enabled {
            return Ok(());
        }
    }
    Err("Spotify ignored shuffle".into())
}

#[tauri::command]
pub async fn spotify_shuffle(
    mode: Mode,
    webview: Webview,
    spotify: State<'_, SpotifyHub>,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Spotify access denied".into());
    }
    spotify.operation(Operation::Shuffle(mode)).await
}

pub(super) async fn native(mode: Mode, media: &MediaHub) -> Result<(), String> {
    // The Spotify worker serializes the full operation, including its Web API fallback.
    let _command = media.commands.lock().await;
    let session = media::session(Some("spotify"))
        .await
        .map_err(|_| "Spotify session unavailable")?
        .ok_or("Spotify isn't playing")?
        .0;
    let enabled = match mode {
        Mode::Toggle => mode.enabled(active(&session)?),
        _ => mode.enabled(false),
    };
    let result = apply(&session, enabled).await;
    media.wake();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shuffle_modes_use_the_current_session_state() {
        for (mode, current, expected) in [
            ("on", false, true),
            ("on", true, true),
            ("off", false, false),
            ("off", true, false),
            ("toggle", false, true),
            ("toggle", true, false),
        ] {
            let mode: Mode = serde_json::from_str(&format!("\"{mode}\"")).unwrap();
            assert_eq!(mode.enabled(current), expected);
        }
        assert!(serde_json::from_str::<Mode>("\"smart\"").is_err());
    }
}
