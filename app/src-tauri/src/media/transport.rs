use windows::Media::{
    Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    },
    MediaPlaybackAutoRepeatMode as Repeat,
};
use windows::core::HRESULT;
use windows_future::IAsyncOperation;

pub fn repeat_name(mode: Repeat) -> Option<&'static str> {
    match mode {
        Repeat::None => Some("off"),
        Repeat::List => Some("context"),
        Repeat::Track => Some("track"),
        _ => None,
    }
}

pub fn operation(session: &Session, command: &str) -> windows::core::Result<IAsyncOperation<bool>> {
    match command {
        "prev" => session.TrySkipPreviousAsync(),
        "next" => session.TrySkipNextAsync(),
        // Chromium ignores TryTogglePlayPause; an explicit command works for every player.
        "toggle" => match session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
        {
            Ok(Status::Playing) => session.TryPauseAsync(),
            _ => session.TryPlayAsync(),
        },
        "play" => session.TryPlayAsync(),
        "pause" => session.TryPauseAsync(),
        "shuffle:on" | "shuffle:off" | "shuffle:toggle" => {
            let info = session.GetPlaybackInfo()?;
            if !info.Controls()?.IsShuffleEnabled()? {
                return Err(unsupported());
            }
            let enabled = match command {
                "shuffle:on" => true,
                "shuffle:off" => false,
                _ => !info.IsShuffleActive()?.Value()?,
            };
            session.TryChangeShuffleActiveAsync(enabled)
        }
        "repeat:off" | "repeat:context" | "repeat:track" | "repeat:cycle" => {
            let info = session.GetPlaybackInfo()?;
            if !info.Controls()?.IsRepeatEnabled()? {
                return Err(unsupported());
            }
            let mode = match command {
                "repeat:off" => Repeat::None,
                "repeat:context" => Repeat::List,
                "repeat:track" => Repeat::Track,
                _ => match info.AutoRepeatMode()?.Value()? {
                    Repeat::None => Repeat::List,
                    Repeat::List => Repeat::Track,
                    _ => Repeat::None,
                },
            };
            session.TryChangeAutoRepeatModeAsync(mode)
        }
        _ => Err(windows::core::Error::new(
            HRESULT(-1),
            "Unknown media command",
        )),
    }
}

fn unsupported() -> windows::core::Error {
    windows::core::Error::new(HRESULT(-1), "Spotify control unavailable")
}
