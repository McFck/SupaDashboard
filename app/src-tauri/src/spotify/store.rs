use super::auth::{Tokens, valid_id, valid_tokens};
use crate::secure;
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

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub client_id: String,
    pub tokens: Option<Tokens>,
    pub user_name: String,
}

#[derive(Deserialize, Serialize)]
struct Envelope {
    version: u32,
    protected: Vec<u8>,
}

pub struct Store {
    path: PathBuf,
    original: Option<Vec<u8>>,
    pub credentials: Credentials,
}

impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let original = read(&path)?;
        let credentials = original
            .as_ref()
            .map(|bytes| -> Result<Credentials, String> {
                let envelope: Envelope =
                    serde_json::from_slice(bytes).map_err(|_| "Unreadable Spotify store")?;
                if envelope.version != 1 {
                    return Err("Unsupported Spotify store version".into());
                }
                let credentials: Credentials =
                    serde_json::from_slice(&secure::protect(&envelope.protected, false)?)
                        .map_err(|_| "Unreadable Spotify credentials")?;
                if !valid_id(&credentials.client_id)
                    || credentials
                        .tokens
                        .as_ref()
                        .is_some_and(|t| !valid_tokens(t))
                    || credentials.user_name.len() > 512
                    || credentials.user_name.chars().any(char::is_control)
                {
                    return Err("Invalid Spotify credentials".into());
                }
                Ok(credentials)
            })
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            path,
            original,
            credentials,
        })
    }

    pub fn save(&mut self, credentials: Credentials) -> Result<(), String> {
        // A corrupt store cannot be opened, and an externally changed store cannot be replaced.
        if read(&self.path)? != self.original {
            return Err("Spotify store changed externally".into());
        }
        if !valid_id(&credentials.client_id)
            || credentials
                .tokens
                .as_ref()
                .is_some_and(|t| !valid_tokens(t))
        {
            return Err("Invalid Spotify credentials".into());
        }
        let clear =
            serde_json::to_vec(&credentials).map_err(|_| "Could not encode Spotify credentials")?;
        let bytes = serde_json::to_vec(&Envelope {
            version: 1,
            protected: secure::protect(&clear, true)?,
        })
        .map_err(|_| "Could not encode Spotify store")?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| "Could not create Spotify store")?;
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Invalid Spotify clock")?
            .as_nanos();
        let temp = self
            .path
            .with_extension(format!("{}.{}.tmp", std::process::id(), stamp));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "Could not create Spotify store")?;
        let result = (|| {
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not save Spotify credentials")?;
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
            .map_err(|_| "Could not replace Spotify store")
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        } // Only our disposable encrypted temp file.
        result?;
        self.original = Some(bytes);
        self.credentials = credentials;
        Ok(())
    }

    pub fn logout(&mut self) -> Result<(), String> {
        if self.credentials.client_id.is_empty() {
            return Ok(());
        }
        self.save(Credentials {
            tokens: None,
            user_name: String::new(),
            ..self.credentials.clone()
        })
    }
}

fn read(path: &PathBuf) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) if bytes.len() <= 131_072 => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        _ => Err("Could not read Spotify store".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypts_tokens_and_logout_keeps_client_id() {
        let dir = std::env::temp_dir().join(format!(
            "supa-spotify-{}-{}",
            std::process::id(),
            super::super::auth::now()
        ));
        let path = dir.join("spotify.json");
        let mut store = Store::open(path.clone()).unwrap();
        let id = "0123456789abcdef0123456789abcdef";
        store
            .save(Credentials {
                client_id: id.into(),
                user_name: "Listener".into(),
                tokens: Some(Tokens {
                    access_token: "private-access".into(),
                    refresh_token: "private-refresh".into(),
                    expires_at: 999,
                }),
            })
            .unwrap();
        let bytes = fs::read_to_string(&path).unwrap();
        assert!(!bytes.contains("private-access") && !bytes.contains("private-refresh"));
        let mut loaded = Store::open(path.clone()).unwrap();
        assert_eq!(
            loaded.credentials.tokens.as_ref().unwrap().refresh_token,
            "private-refresh"
        );
        loaded.logout().unwrap();
        let logged_out = Store::open(path).unwrap();
        assert_eq!(logged_out.credentials.client_id, id);
        assert!(logged_out.credentials.tokens.is_none());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn never_overwrites_unreadable_or_replaced_data() {
        let path =
            std::env::temp_dir().join(format!("supa-spotify-corrupt-{}.json", std::process::id()));
        let mut store = Store::open(path.clone()).unwrap();
        for bytes in [
            b"broken".as_slice(),
            br#"{"version":2,"protected":[]}"#,
            br#"{"version":1,"protected":[]}"#,
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(Store::open(path.clone()).is_err());
            assert!(
                store
                    .save(Credentials {
                        client_id: "0123456789abcdef0123456789abcdef".into(),
                        ..Credentials::default()
                    })
                    .is_err()
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(path).unwrap();
    }
}
