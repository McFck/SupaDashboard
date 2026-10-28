//! Media transport via Windows' global media sessions (Spotify, browsers, players all register there).
use tauri::{AppHandle, Manager as _};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
};

/// `target` None / "any" = the session Windows considers current; otherwise a case-insensitive
/// match on the app id (e.g. "spotify").
async fn session(target: Option<&str>) -> windows::core::Result<Option<Session>> {
    let manager = Manager::RequestAsync()?.await?;
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
    let result: windows::core::Result<bool> = async {
        let Some(s) = session(target.as_deref()).await? else {
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
        op.await
    }
    .await;
    result.map_err(|e| e.to_string())
}

/// Re-grants the asset protocol only the files that saved media controls still reference, and
/// forgets the grants older versions persisted. Access for a removed source ends at the next launch.
pub fn grant_saved_files(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let saved = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let scope = app.asset_protocol_scope();
    let controls = saved.as_ref().and_then(|s| s["settings"]["controls"].as_array());
    for control in controls.into_iter().flatten().filter(|c| c["type"] == "media") {
        for source in control["options"]["sources"].as_array().into_iter().flatten() {
            if let (Some("file"), Some(path)) = (source["kind"].as_str(), source["value"].as_str()) {
                let _ = scope.allow_file(path);
            }
        }
    }
    for name in [".persisted-scope", ".persisted-scope-asset"] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}
