//! Media transport via Windows' global media sessions (Spotify, browsers, players all register there).
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
};

/// `target` None / "any" = the session Windows considers current; otherwise a case-insensitive
/// match on the app id (e.g. "spotify").
fn session(target: Option<&str>) -> windows::core::Result<Option<Session>> {
    let manager = Manager::RequestAsync()?.join()?;
    match target.filter(|t| !t.is_empty() && *t != "any") {
        None => Ok(manager.GetCurrentSession().ok()),
        Some(t) => {
            let t = t.to_lowercase();
            for s in manager.GetSessions()? {
                if s.SourceAppUserModelId()?
                    .to_string()
                    .to_lowercase()
                    .contains(&t)
                {
                    return Ok(Some(s));
                }
            }
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn media_command(target: Option<String>, command: String) -> Result<bool, String> {
    let run = || -> windows::core::Result<bool> {
        let Some(s) = session(target.as_deref())? else {
            return Ok(false);
        };
        let op = match command.as_str() {
            "prev" => s.TrySkipPreviousAsync()?,
            "next" => s.TrySkipNextAsync()?,
            "toggle" => s.TryTogglePlayPauseAsync()?,
            "play" => s.TryPlayAsync()?,
            "pause" => s.TryPauseAsync()?,
            other => {
                return Err(windows::core::Error::new(
                    windows::core::HRESULT(-1),
                    format!("unknown media command {other}"),
                ));
            }
        };
        op.join()
    };
    run().map_err(|e| e.to_string())
}
