use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs,
    io::{ErrorKind, Read, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
};
use windows::Security::Cryptography::{Core::HashAlgorithmProvider, CryptographicBuffer};
use windows::Storage::Streams::IBuffer;
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALG_HANDLE, BCRYPT_ECDSA_PUBLIC_P256_MAGIC,
    BCRYPT_FLAGS, BCRYPT_KEY_HANDLE, BCRYPT_SHA256_ALG_HANDLE, BCryptDestroyKey, BCryptHash,
    BCryptImportKeyPair, BCryptVerifySignature, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    CryptProtectData, CryptUnprotectData,
};
use windows::Win32::Storage::FileSystem::{
    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
};
use windows::core::{HSTRING, PCWSTR};

fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "Credential store too large")?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // DPAPI allocates output with LocalAlloc; release it even if decoding later fails.
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| {
            if encrypt {
                "Could not protect credentials"
            } else {
                "Could not unlock credentials"
            }
        })?;
        let bytes = if output.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}

#[derive(Deserialize, Serialize)]
struct Envelope {
    version: u32,
    protected: Vec<u8>,
}

/// A credential file: JSON `{version: 1, protected: <DPAPI bytes>}`, at most 128 KiB. It is only ever replaced
/// when it still holds the bytes it was opened with, so unreadable or externally changed data is never lost.
pub struct ProtectedFile {
    path: PathBuf,
    original: Option<Vec<u8>>,
    /// The service name in error titles, like "Spotify".
    label: &'static str,
}

impl ProtectedFile {
    /// The file and its decrypted value; `None` while the file does not exist.
    pub fn open<T: DeserializeOwned>(
        path: PathBuf,
        label: &'static str,
    ) -> Result<(Self, Option<T>), String> {
        let (file, value) = Self::inspect(path, label)?;
        Ok((file, value?))
    }

    /// Keeps the original bytes for recovery after the user successfully signs in again.
    pub(super) fn inspect<T: DeserializeOwned>(
        path: PathBuf,
        label: &'static str,
    ) -> Result<(Self, Result<Option<T>, String>), String> {
        let original = read(&path, label)?;
        let value = original
            .as_ref()
            .map(|bytes| -> Result<T, String> {
                if bytes.len() as u64 > MAX_STORE {
                    return Err(format!("Unreadable {label} store"));
                }
                let envelope: Envelope = serde_json::from_slice(bytes)
                    .map_err(|_| format!("Unreadable {label} store"))?;
                if envelope.version != 1 {
                    return Err(format!("Unsupported {label} store version"));
                }
                serde_json::from_slice(&protect(&envelope.protected, false)?)
                    .map_err(|_| format!("Unreadable {label} credentials"))
            })
            .transpose();
        let file = Self {
            path,
            original,
            label,
        };
        Ok((file, value))
    }

    /// Encrypts `value` into a temporary file and moves it over the store; `None` deletes the store.
    pub fn save<T: Serialize>(&mut self, value: Option<&T>) -> Result<(), String> {
        let label = self.label;
        if read(&self.path, label)? != self.original {
            return Err(format!("{label} store changed externally"));
        }
        let Some(value) = value else {
            if self.original.is_some() {
                fs::remove_file(&self.path)
                    .map_err(|_| format!("Could not remove {label} credentials"))?;
            }
            self.original = None;
            return Ok(());
        };
        let clear = serde_json::to_vec(value)
            .map_err(|_| format!("Could not encode {label} credentials"))?;
        let bytes = serde_json::to_vec(&Envelope {
            version: 1,
            protected: protect(&clear, true)?,
        })
        .map_err(|_| format!("Could not encode {label} store"))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| format!("Could not create {label} store"))?;
        }
        let temp = self.path.with_extension(format!(
            "json.{}-{}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| format!("Could not create {label} store"))?;
        let result = (|| {
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| format!("Could not save {label} credentials"))?;
            drop(file);
            replace(&temp, &self.path).map_err(|_| format!("Could not replace {label} store"))
        })();
        if result.is_err() {
            // Only our own encrypted temporary file.
            let _ = fs::remove_file(temp);
        }
        result?;
        self.original = Some(bytes);
        Ok(())
    }
}

/// `fs::rename` without write-through could leave an empty store after a power loss.
pub fn replace(from: &Path, to: &Path) -> windows::core::Result<()> {
    let wide =
        |path: &Path| -> Vec<u16> { path.as_os_str().encode_wide().chain(Some(0)).collect() };
    let (from, to) = (wide(from), wide(to));
    // SAFETY: both paths are NUL-terminated and outlive the call.
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
}

const MAX_STORE: u64 = 131_072;

/// Reads at most one byte past the limit, so an oversized store is rejected without loading it.
fn read(path: &Path, label: &str) -> Result<Option<Vec<u8>>, String> {
    let mut bytes = Vec::new();
    match fs::File::open(path).and_then(|file| file.take(MAX_STORE + 1).read_to_end(&mut bytes)) {
        Ok(_) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        _ => Err(format!("Could not read {label} store")),
    }
}

fn sha256(bytes: &[u8]) -> windows::core::Result<IBuffer> {
    let input = CryptographicBuffer::CreateFromByteArray(bytes)?;
    HashAlgorithmProvider::OpenAlgorithm(&HSTRING::from("SHA256"))?.HashData(&input)
}

/// Lowercase hex SHA-256, as `sha256_hex` writes it.
pub fn valid_sha256(hex: &str) -> bool {
    hex.len() == 64
        && hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn sha256_hex(bytes: &[u8]) -> Result<String, String> {
    sha256(bytes)
        .and_then(|hash| CryptographicBuffer::EncodeToHexString(&hash))
        .map(|hex| hex.to_string())
        .map_err(|_| "Could not hash".into())
}

/// ECDSA P-256 with SHA-256 through CNG. `public` is the uncompressed point (0x04, X, Y); `signature` is base64 of
/// the 64-byte r || s form (Node's `dsaEncoding: 'ieee-p1363'`), surrounding whitespace allowed. Anything
/// malformed is simply not a valid signature.
pub fn verify_p256(public: &[u8; 65], message: &[u8], signature: &[u8]) -> bool {
    let Some(signature) = std::str::from_utf8(signature)
        .ok()
        .and_then(|text| {
            CryptographicBuffer::DecodeFromBase64String(&HSTRING::from(text.trim())).ok()
        })
        .and_then(|buffer| {
            let mut bytes = windows::core::Array::new();
            CryptographicBuffer::CopyToByteArray(&buffer, &mut bytes).ok()?;
            Some(bytes.to_vec())
        })
    else {
        return false;
    };
    if signature.len() != 64 || public[0] != 4 {
        return false;
    }
    let mut blob = Vec::with_capacity(72);
    blob.extend(BCRYPT_ECDSA_PUBLIC_P256_MAGIC.to_le_bytes());
    blob.extend(32u32.to_le_bytes());
    blob.extend(&public[1..]);
    let mut hash = [0u8; 32];
    let mut key = BCRYPT_KEY_HANDLE::default();
    // SAFETY: every buffer outlives its call; the key handle is destroyed once imported.
    unsafe {
        if BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, message, &mut hash).is_err()
            || BCryptImportKeyPair(
                BCRYPT_ECDSA_P256_ALG_HANDLE,
                None,
                BCRYPT_ECCPUBLIC_BLOB,
                &mut key,
                &blob,
                0,
            )
            .is_err()
        {
            return false;
        }
        let valid = BCryptVerifySignature(key, None, &hash, &signature, BCRYPT_FLAGS(0)).is_ok();
        let _ = BCryptDestroyKey(key);
        valid
    }
}

pub fn pkce() -> Result<(String, String), String> {
    let bytes = CryptographicBuffer::GenerateRandom(32).map_err(|_| "Could not create verifier")?;
    let verifier = base64url(
        &CryptographicBuffer::EncodeToBase64String(&bytes)
            .map_err(|_| "Could not encode verifier")?
            .to_string(),
    );
    let hash = sha256(verifier.as_bytes()).map_err(|_| "Could not hash verifier")?;
    let challenge = CryptographicBuffer::EncodeToBase64String(&hash)
        .map_err(|_| "Could not encode challenge")?;
    Ok((verifier, base64url(&challenge.to_string())))
}

fn base64url(value: &str) -> String {
    value
        .trim_end_matches('=')
        .replace('+', "-")
        .replace('/', "_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_encrypted_and_logout_removes_the_file() {
        let path = std::env::temp_dir().join(format!("supa-protected-{}.json", std::process::id()));
        let (mut file, value) = ProtectedFile::open::<String>(path.clone(), "Test").unwrap();
        assert!(value.is_none());
        file.save(Some(&"private-token".to_owned())).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("private-token"));
        let (mut file, value) = ProtectedFile::open::<String>(path.clone(), "Test").unwrap();
        assert_eq!(value.as_deref(), Some("private-token"));
        file.save::<String>(None).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn unreadable_or_replaced_store_is_never_overwritten() {
        let path = std::env::temp_dir().join(format!(
            "supa-protected-corrupt-{}.json",
            std::process::id()
        ));
        let (mut file, _) = ProtectedFile::open::<String>(path.clone(), "Test").unwrap();
        for bytes in [
            b"corrupt".as_slice(),
            br#"{"version":2,"protected":[]}"#,
            br#"{"version":1,"protected":[]}"#,
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(ProtectedFile::open::<String>(path.clone(), "Test").is_err());
            assert!(file.save::<String>(None).is_err());
            assert!(file.save(Some(&"x".to_owned())).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(path).unwrap();
    }
}
