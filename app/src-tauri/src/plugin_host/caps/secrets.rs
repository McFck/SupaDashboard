//! `secrets`: a plugin's credential records, `plugin-data/<id>/<name>.json` as DPAPI ProtectedFile v1, named after a
//! declared OAuth client. This is the format the native Spotify (`{clientId, tokens?, userName}`) and Discord
//! (`{clientId, tokens, lastChannel}`) plugins wrote, so their users stay signed in. JS reads and writes every field
//! but `tokens`, which never leave native code.
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use super::oauth::client;
use crate::plugin_host::PluginHost;
use crate::plugin_host::secure::ProtectedFile;

const MAX_FIELDS: usize = 16 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: u64,
}

pub fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 8192 && token.bytes().all(|b| b.is_ascii_graphic())
}

impl Tokens {
    fn valid(&self) -> bool {
        valid_token(&self.access_token) && valid_token(&self.refresh_token) && self.expires_at > 0
    }
}

#[derive(Default, Deserialize, Serialize)]
pub struct Record {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<Tokens>,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

/// An open record; it is saved only over the bytes it was read from.
pub struct Secret {
    file: ProtectedFile,
    pub record: Record,
}

impl Secret {
    /// `<data>/<name>.json`; empty when it does not exist. An unreadable record is an error, and stays as it is.
    pub fn open(data: &Path, name: &str) -> Result<Self, String> {
        let (file, record) =
            ProtectedFile::open::<Record>(data.join(format!("{name}.json")), "Plugin secret")?;
        let record = record.unwrap_or_default();
        if record.tokens.as_ref().is_some_and(|tokens| !tokens.valid()) {
            return Err("Unreadable plugin secret".into());
        }
        Ok(Self { file, record })
    }

    /// An empty record deletes the file.
    pub fn save(&mut self) -> Result<(), String> {
        let empty = self.record.tokens.is_none() && self.record.fields.is_empty();
        self.file.save((!empty).then_some(&self.record))
    }
}

/// What JS sees of a record. `expiresAt` in Unix milliseconds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    fields: Map<String, Value>,
    signed_in: bool,
    expires_at: Option<u64>,
}

fn show(record: Record) -> Shown {
    Shown {
        signed_in: record.tokens.is_some(),
        expires_at: record
            .tokens
            .map(|tokens| tokens.expires_at.saturating_mul(1000)),
        fields: record.fields,
    }
}

/// Sets each field (`null` removes it); `tokens` is not a field.
fn merge(record: &mut Record, fields: Map<String, Value>) -> Result<(), String> {
    if fields.contains_key("tokens") {
        return Err("Tokens are not writable".into());
    }
    let mut merged = record.fields.clone();
    for (key, value) in fields {
        if value.is_null() {
            merged.remove(&key);
        } else {
            merged.insert(key, value);
        }
    }
    if !serde_json::to_vec(&merged).is_ok_and(|bytes| bytes.len() <= MAX_FIELDS) {
        return Err("Plugin secret is too large".into());
    }
    record.fields = merged;
    Ok(())
}

#[tauri::command]
pub async fn plugin_secrets_read(
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
) -> Result<Shown, String> {
    client(&host, &plugin, &name)?;
    let _secrets = host.caps.secrets.lock().await;
    Ok(show(Secret::open(&host.data(&plugin), &name)?.record))
}

#[tauri::command]
pub async fn plugin_secrets_write(
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
    fields: Map<String, Value>,
) -> Result<(), String> {
    client(&host, &plugin, &name)?;
    let _secrets = host.caps.secrets.lock().await;
    let mut secret = Secret::open(&host.data(&plugin), &name)?;
    merge(&mut secret.record, fields)?;
    secret.save()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::archive::tests::temp;

    fn tokens() -> Tokens {
        Tokens {
            access_token: "private-access".into(),
            refresh_token: "private-refresh".into(),
            expires_at: 999,
        }
    }

    /// Writes a record the way the native version 1 plugins did.
    fn legacy(data: &Path, name: &str, json: Value) {
        let (mut file, _) =
            ProtectedFile::open::<Value>(data.join(format!("{name}.json")), "Test").unwrap();
        file.save(Some(&json)).unwrap();
    }

    #[test]
    fn spotify_and_discord_records_stay_signed_in_and_never_show_tokens() {
        let data = temp("secrets-legacy");
        legacy(
            &data,
            "spotify",
            serde_json::json!({"clientId": "0123456789abcdef0123456789abcdef", "userName": "Listener",
                "tokens": tokens()}),
        );
        legacy(
            &data,
            "discord",
            serde_json::json!({"clientId": "123456789012345678",
                "tokens": {"accessToken": "private-access", "refreshToken": "private-refresh", "expiresAt": 999},
                "lastChannel": {"id": "2", "name": "Voice", "kind": "guild", "guildId": "3"}}),
        );
        let spotify =
            serde_json::to_value(show(Secret::open(&data, "spotify").unwrap().record)).unwrap();
        assert_eq!(
            spotify,
            serde_json::json!({"fields": {"clientId": "0123456789abcdef0123456789abcdef", "userName": "Listener"},
                "signedIn": true, "expiresAt": 999_000})
        );
        let discord =
            serde_json::to_value(show(Secret::open(&data, "discord").unwrap().record)).unwrap();
        assert_eq!(
            discord,
            serde_json::json!({"fields": {"clientId": "123456789012345678",
                "lastChannel": {"id": "2", "name": "Voice", "kind": "guild", "guildId": "3"}},
                "signedIn": true, "expiresAt": 999_000})
        );

        // A logged-out Spotify record (`tokens: null`) keeps its client id.
        legacy(
            &data,
            "spotify",
            serde_json::json!({"clientId": "c", "tokens": null, "userName": ""}),
        );
        assert!(!show(Secret::open(&data, "spotify").unwrap().record).signed_in);
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn js_writes_merge_fields_but_cannot_touch_tokens_or_unreadable_records() {
        let data = temp("secrets-write");
        let mut secret = Secret::open(&data, "spotify").unwrap();
        secret.record.tokens = Some(tokens());
        secret.record.fields.insert("clientId".into(), "c".into());
        secret.save().unwrap();

        let mut secret = Secret::open(&data, "spotify").unwrap();
        let fields = |json: Value| json.as_object().unwrap().clone();
        merge(
            &mut secret.record,
            fields(serde_json::json!({"userName": "Me", "clientId": null})),
        )
        .unwrap();
        assert!(
            merge(
                &mut secret.record,
                fields(serde_json::json!({"tokens": null}))
            )
            .is_err()
        );
        let large = "x".repeat(MAX_FIELDS);
        assert!(
            merge(
                &mut secret.record,
                fields(serde_json::json!({"big": large}))
            )
            .is_err()
        );
        secret.save().unwrap();
        let reopened = Secret::open(&data, "spotify").unwrap().record;
        assert_eq!(
            reopened.tokens,
            Some(tokens()),
            "a field write kept the tokens"
        );
        assert_eq!(
            reopened.fields,
            fields(serde_json::json!({"userName": "Me"}))
        );

        let path = data.join("spotify.json");
        std::fs::write(&path, b"not a record").unwrap();
        assert!(Secret::open(&data, "spotify").is_err());
        std::fs::remove_file(&path).unwrap();
        legacy(
            &data,
            "spotify",
            serde_json::json!({"tokens": {"accessToken": "a b", "refreshToken": "r", "expiresAt": 1}}),
        );
        assert!(Secret::open(&data, "spotify").is_err(), "malformed tokens");
        std::fs::remove_dir_all(data).unwrap();
    }
}
