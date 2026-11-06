use super::{
    auth::Tokens,
    model::{Channel, valid_id},
};
use plugin_sdk::secure as crypto;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::PathBuf,
};
use windows::{
    Win32::Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW},
    core::PCWSTR,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub client_id: String,
    pub tokens: Tokens,
    pub last_channel: Option<Channel>,
}

#[derive(Deserialize, Serialize)]
struct Envelope {
    version: u32,
    protected: Vec<u8>,
}

pub struct Store {
    path: PathBuf,
    original: Option<Vec<u8>>,
    pub credentials: Option<Credentials>,
}

impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let original = read(&path)?;
        let credentials = original
            .as_ref()
            .map(|bytes| -> Result<Credentials, String> {
                let envelope: Envelope =
                    serde_json::from_slice(bytes).map_err(|_| "Unreadable Discord store")?;
                if envelope.version != 1 {
                    return Err("Unsupported Discord store version".into());
                }
                let clear = crypto::protect(&envelope.protected, false)?;
                let credentials: Credentials =
                    serde_json::from_slice(&clear).map_err(|_| "Unreadable Discord credentials")?;
                if !valid_id(&credentials.client_id)
                    || credentials.tokens.access_token.is_empty()
                    || credentials.tokens.refresh_token.is_empty()
                    || credentials
                        .last_channel
                        .as_ref()
                        .is_some_and(|channel| !channel.valid() || channel.kind != "guild")
                {
                    return Err("Invalid Discord credentials".into());
                }
                Ok(credentials)
            })
            .transpose()?;
        Ok(Self {
            path,
            original,
            credentials,
        })
    }

    pub fn save(&mut self, credentials: Option<Credentials>) -> Result<(), String> {
        // Never replace an unreadable or externally changed file, even during logout.
        if read(&self.path)? != self.original {
            return Err("Discord store changed externally".into());
        }
        let bytes = credentials
            .as_ref()
            .map(|credentials| -> Result<Vec<u8>, String> {
                let clear = serde_json::to_vec(credentials)
                    .map_err(|_| "Could not encode Discord credentials")?;
                serde_json::to_vec(&Envelope {
                    version: 1,
                    protected: crypto::protect(&clear, true)?,
                })
                .map_err(|_| "Could not encode Discord store".into())
            })
            .transpose()?;
        if let Some(bytes) = &bytes {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent).map_err(|_| "Could not create Discord store")?;
            }
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Invalid Discord store clock")?
                .as_nanos();
            let temp = self
                .path
                .with_extension(format!("json.{}-{stamp}.tmp", std::process::id()));
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Could not create Discord store temporary file")?;
            let result = (|| {
                file.write_all(bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "Could not save Discord credentials")?;
                drop(file);
                use std::os::windows::ffi::OsStrExt;
                let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<u16> = self.path.as_os_str().encode_wide().chain(Some(0)).collect();
                unsafe {
                    MoveFileExW(
                        PCWSTR(from.as_ptr()),
                        PCWSTR(to.as_ptr()),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                }
                .map_err(|_| "Could not replace Discord store")
            })();
            if result.is_err() {
                let _ = fs::remove_file(temp);
            } // Only our disposable encrypted temp file.
            result?;
        } else if self.original.is_some() {
            fs::remove_file(&self.path).map_err(|_| "Could not remove Discord credentials")?;
        }
        self.original = bytes;
        self.credentials = credentials;
        Ok(())
    }
}

fn read(path: &PathBuf) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) if bytes.len() <= 131_072 => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        _ => Err("Could not read Discord store".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_v1_round_trip_preserves_last_channel_and_logout() {
        let dir = std::env::temp_dir().join(format!(
            "supa-discord-{}-{}",
            std::process::id(),
            super::super::auth::now()
        ));
        let path = dir.join("discord.json");
        let mut store = Store::open(path.clone()).unwrap();
        store
            .save(Some(Credentials {
                client_id: "123456789012345678".into(),
                tokens: Tokens {
                    access_token: "private-access-token".into(),
                    refresh_token: "private-refresh-token".into(),
                    expires_at: 999,
                },
                last_channel: Some(Channel {
                    id: "223456789012345678".into(),
                    name: "Voice".into(),
                    kind: "guild".into(),
                    guild_id: Some("323456789012345678".into()),
                }),
            }))
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("private-access-token"));
        assert!(!text.contains("private-refresh-token"));
        assert!(!text.contains("123456789012345678"));
        let mut loaded = Store::open(path.clone()).unwrap();
        assert_eq!(
            loaded
                .credentials
                .as_ref()
                .unwrap()
                .last_channel
                .as_ref()
                .unwrap()
                .name,
            "Voice"
        );
        loaded.save(None).unwrap();
        assert!(!path.exists());
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn unreadable_or_replaced_store_is_never_overwritten() {
        let path =
            std::env::temp_dir().join(format!("supa-discord-corrupt-{}.json", std::process::id()));
        let mut store = Store::open(path.clone()).unwrap();
        for bytes in [
            b"corrupt".as_slice(),
            br#"{"version":2,"protected":[]}"#,
            br#"{"version":1,"protected":[]}"#,
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(Store::open(path.clone()).is_err());
            assert!(store.save(None).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(path).unwrap();
    }
}
