use super::Client;
use crate::discord::VoiceCommand;
use serde_json::json;

pub(super) async fn execute(client: &mut Client, command: VoiceCommand) -> Result<(), String> {
    match command {
        VoiceCommand::ToggleMute | VoiceCommand::ToggleDeaf => {
            if client.voice.settings.is_none() {
                let settings = client.request("GET_VOICE_SETTINGS", json!({})).await?;
                client.voice = client.voice.event("VOICE_SETTINGS_UPDATE", &settings);
            }
            let (muted, deafened) = client
                .voice
                .settings
                .ok_or("Invalid Discord voice settings")?;
            let args = match command {
                VoiceCommand::ToggleMute => json!({"mute":!muted}),
                VoiceCommand::ToggleDeaf if deafened => {
                    json!({"deaf":false,"mute":false})
                }
                VoiceCommand::ToggleDeaf => json!({"deaf":true}),
                _ => return Err("Invalid Discord voice command".into()),
            };
            client.request("SET_VOICE_SETTINGS", args).await?;
            let settings = client.request("GET_VOICE_SETTINGS", json!({})).await?;
            client.voice = client.voice.event("VOICE_SETTINGS_UPDATE", &settings);
        }
        VoiceCommand::Leave => {
            // Already out of voice: the action's goal is met, so it is not an error.
            if client.voice.channel.is_none() {
                return Ok(());
            }
            client
                .request("SELECT_VOICE_CHANNEL", json!({"channel_id":null}))
                .await?;
            client.selected().await?;
        }
        VoiceCommand::Rejoin => {
            let channel = client
                .voice
                .last_channel
                .as_ref()
                .filter(|channel| channel.kind == "guild" && channel.valid())
                .ok_or("No channel to rejoin")?;
            if client.voice.channel.as_ref().map(|current| &current.id) == Some(&channel.id) {
                return Ok(());
            }
            client
                .request(
                    "SELECT_VOICE_CHANNEL",
                    json!({"channel_id":channel.id,"force":true,"timeout":5}),
                )
                .await?;
            client.selected().await?;
        }
    }
    Ok(())
}
