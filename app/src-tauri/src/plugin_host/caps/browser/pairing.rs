use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use windows::{
    Security::Cryptography::{
        Core::{CryptographicEngine, MacAlgorithmNames, MacAlgorithmProvider},
        CryptographicBuffer,
    },
    core::HSTRING,
};

use crate::plugin_host::{
    permissions::valid_extension_id,
    secure::{ProtectedFile, sha256_hex},
};

use super::wire::{Failure, hex};

const CODE_LIFETIME: Duration = Duration::from_secs(120);

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    extension: String,
    secret: String,
}

impl Credential {
    fn valid(&self) -> bool {
        valid_extension_id(&self.extension) && hex(&self.secret, 64)
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Credentials {
    current: Option<Credential>,
    pending: Option<Credential>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Stored {
    Rotation(Credentials),
    Legacy(Credential),
}

struct Code {
    owner: u32,
    value: String,
    expires: Instant,
}

pub(super) struct Pairing {
    file: Result<ProtectedFile, String>,
    credentials: Credentials,
    repair: bool,
    code: Option<Code>,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(super) enum Mode {
    Pair,
    Auth,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Hello {
    pub mode: Mode,
    pub nonce: String,
    #[serde(rename = "keyId")]
    pub key_id: Option<String>,
}

#[derive(Serialize)]
pub(super) struct Challenge {
    pub nonce: String,
    pub proof: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Proof {
    pub proof: String,
}

pub(super) struct Attempt {
    mode: Mode,
    key: String,
    transcript: String,
}

impl Pairing {
    pub(super) fn open(path: PathBuf) -> Self {
        let inspected = ProtectedFile::inspect::<Stored>(path, "Browser Remote");
        let (file, stored) = match inspected {
            Ok((file, stored)) => (Ok(file), stored),
            Err(error) => (Err(error.clone()), Err(error)),
        };
        let credentials = match stored {
            Ok(Some(Stored::Rotation(credentials)))
                if (credentials.current.is_some() || credentials.pending.is_some())
                    && credentials
                        .current
                        .iter()
                        .chain(&credentials.pending)
                        .all(Credential::valid) =>
            {
                Some(credentials)
            }
            Ok(Some(Stored::Legacy(credential))) if credential.valid() => Some(Credentials {
                current: Some(credential),
                pending: None,
            }),
            Ok(None) => Some(Credentials::default()),
            _ => None,
        };
        Self {
            file,
            repair: credentials.is_none(),
            credentials: credentials.unwrap_or_default(),
            code: None,
        }
    }

    pub(super) fn needs_repair(&self) -> bool {
        self.repair
    }

    pub(super) fn issue(&mut self, owner: u32, now: Instant) -> Result<String, Failure> {
        // The server proof lets a peer guess the code offline. Keep 128 bits of entropy;
        // a shorter human-entered code would require a PAKE.
        let value = random()?;
        self.code = Some(Code {
            owner,
            value: value.clone(),
            expires: now + CODE_LIFETIME,
        });
        Ok(value)
    }

    pub(super) fn cancel(&mut self, owner: u32) {
        if self.code.as_ref().is_some_and(|code| code.owner == owner) {
            self.code = None;
        }
    }

    fn code(&self, now: Instant) -> Option<&str> {
        self.code
            .as_ref()
            .filter(|code| code.expires > now)
            .map(|code| code.value.as_str())
    }

    fn auth_keys(&self, extension: &str) -> impl Iterator<Item = &str> {
        self.credentials
            .current
            .iter()
            .chain(&self.credentials.pending)
            .filter(move |credential| credential.extension == extension)
            .map(|credential| credential.secret.as_str())
    }

    pub(super) fn begin(
        &self,
        hello: Hello,
        extension: &str,
        now: Instant,
    ) -> Result<(Attempt, Challenge), Failure> {
        if !hex(&hello.nonce, 32) {
            return Err("Invalid browser nonce");
        }
        let (mode, key) = match (hello.mode, hello.key_id.as_deref()) {
            (Mode::Pair, None) => ("pair", self.code(now)),
            // Previously installed extensions omit the key ID and try the current credential.
            (Mode::Auth, None) => ("auth", self.auth_keys(extension).next()),
            (Mode::Auth, Some(id)) if hex(id, 64) => (
                "auth",
                self.auth_keys(extension)
                    .find(|key| sha256_hex(key.as_bytes()).is_ok_and(|found| found == id)),
            ),
            _ => return Err("Invalid browser credential ID"),
        };
        let key = key.ok_or("Browser pairing required")?.to_owned();
        let nonce = random()?;
        let transcript = format!(
            "browser-remote-v1:{mode}:{extension}:{}:{nonce}",
            hello.nonce
        );
        let proof = sign(&key, &format!("server:{transcript}"))?;
        Ok((
            Attempt {
                mode: hello.mode,
                key,
                transcript,
            },
            Challenge { nonce, proof },
        ))
    }

    pub(super) fn finish(
        &mut self,
        attempt: Attempt,
        extension: &str,
        proof: Proof,
        now: Instant,
    ) -> Result<Mode, String> {
        let key = attempt.key.as_str();
        let still_valid = match attempt.mode {
            Mode::Pair => self.code(now) == Some(key),
            Mode::Auth => self.auth_keys(extension).any(|secret| secret == key),
        };
        if !still_valid || !verify(key, &format!("client:{}", attempt.transcript), &proof.proof) {
            return Err("Invalid browser proof".into());
        }
        if attempt.mode == Mode::Pair {
            let secret = sign(key, &format!("credential:{}", attempt.transcript))?;
            self.save(Credentials {
                current: self.credentials.current.clone(),
                pending: Some(Credential {
                    extension: extension.into(),
                    secret,
                }),
            })?;
            self.code = None;
        } else if let Some(pending) = self
            .credentials
            .pending
            .as_ref()
            .filter(|item| item.secret == key)
        {
            // Only a login with the replacement proves that the extension could save it.
            self.save(Credentials {
                current: Some(pending.clone()),
                pending: None,
            })?;
        }
        Ok(attempt.mode)
    }

    fn save(&mut self, credentials: Credentials) -> Result<(), String> {
        self.file
            .as_mut()
            .map_err(|error| error.clone())?
            .save(Some(&credentials))?;
        self.credentials = credentials;
        self.repair = false;
        Ok(())
    }
}

fn random() -> Result<String, Failure> {
    CryptographicBuffer::GenerateRandom(16)
        .and_then(|value| CryptographicBuffer::EncodeToHexString(&value))
        .map(|hex| hex.to_string())
        .map_err(|_| "Could not generate browser pairing data")
}

fn hmac(
    key: &str,
) -> windows::core::Result<windows::Security::Cryptography::Core::CryptographicKey> {
    MacAlgorithmProvider::OpenAlgorithm(&MacAlgorithmNames::HmacSha256()?)?
        .CreateKey(&CryptographicBuffer::CreateFromByteArray(key.as_bytes())?)
}

fn sign(key: &str, data: &str) -> Result<String, Failure> {
    let operation = || {
        let digest = CryptographicEngine::Sign(
            &hmac(key)?,
            &CryptographicBuffer::CreateFromByteArray(data.as_bytes())?,
        )?;
        CryptographicBuffer::EncodeToHexString(&digest)
    };
    operation()
        .map(|hex| hex.to_string())
        .map_err(|_| "Could not sign browser challenge")
}

fn verify(key: &str, data: &str, proof: &str) -> bool {
    if !hex(proof, 64) {
        return false;
    }
    let operation = || {
        CryptographicEngine::VerifySignature(
            &hmac(key)?,
            &CryptographicBuffer::CreateFromByteArray(data.as_bytes())?,
            &CryptographicBuffer::DecodeFromHexString(&HSTRING::from(proof))?,
        )
    };
    operation().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::archive::tests::temp;

    const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn hello(mode: Mode) -> Hello {
        Hello {
            mode,
            nonce: "0".repeat(32),
            key_id: None,
        }
    }

    fn response(attempt: &Attempt, key: &str) -> Proof {
        Proof {
            proof: sign(key, &format!("client:{}", attempt.transcript)).unwrap(),
        }
    }

    fn pair(pairing: &mut Pairing, now: Instant) -> String {
        let code = pairing.issue(1, now).unwrap();
        let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let secret = sign(&code, &format!("credential:{}", attempt.transcript)).unwrap();
        let proof = response(&attempt, &code);
        pairing.finish(attempt, ID, proof, now).unwrap();
        secret
    }

    fn login(pairing: &mut Pairing, key: &str, now: Instant) -> Result<Mode, String> {
        let hello = Hello {
            key_id: Some(sha256_hex(key.as_bytes())?),
            ..hello(Mode::Auth)
        };
        let (attempt, _) = pairing.begin(hello, ID, now)?;
        let proof = response(&attempt, key);
        pairing.finish(attempt, ID, proof, now)
    }

    #[test]
    fn pairing_rejects_wrong_expired_and_replayed_proofs_and_restores_only_the_paired_id() {
        let folder = temp("browser-pairing");
        let path = folder.join(".browser-remote.json");
        let mut pairing = Pairing::open(path.clone());
        let now = Instant::now();
        assert!(pairing.begin(hello(Mode::Auth), ID, now).is_err());
        assert!(pairing.begin(hello(Mode::Pair), ID, now).is_err());
        let code = pairing.issue(1, now).unwrap();
        let (attempt, challenge) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        assert!(verify(
            &code,
            &format!("server:{}", attempt.transcript),
            &challenge.proof
        ));
        let wrong = response(&attempt, "wrong");
        assert!(pairing.finish(attempt, ID, wrong, now).is_err());
        let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let proof = response(&attempt, &code);
        assert!(
            pairing
                .finish(attempt, ID, proof, now + CODE_LIFETIME)
                .is_err()
        );
        assert!(!path.exists());
        let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let (replay, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let secret = sign(&code, &format!("credential:{}", attempt.transcript)).unwrap();
        let proof = response(&attempt, &code);
        pairing.finish(attempt, ID, proof, now).unwrap();
        let old = response(&replay, &code);
        assert!(pairing.finish(replay, ID, old, now).is_err());
        assert!(!std::fs::read_to_string(&path).unwrap().contains(&secret));
        let mut reopened = Pairing::open(path);
        assert!(
            reopened
                .begin(hello(Mode::Auth), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", now)
                .is_err()
        );
        let (attempt, _) = reopened.begin(hello(Mode::Auth), ID, now).unwrap();
        let proof = response(&attempt, &secret);
        reopened.finish(attempt, ID, proof, now).unwrap();
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_replacement_cannot_strand_the_old_extension_before_the_new_login() {
        let folder = temp("browser-rotation");
        let path = folder.join(".browser-remote.json");
        let (mut file, _) =
            ProtectedFile::open::<Credential>(path.clone(), "Browser Remote").unwrap();
        let old = "1".repeat(64);
        file.save(Some(&Credential {
            extension: ID.into(),
            secret: old.clone(),
        }))
        .unwrap();
        let now = Instant::now();
        let mut pairing = Pairing::open(path.clone());
        let new = pair(&mut pairing, now);

        let mut reopened = Pairing::open(path.clone());
        assert!(login(&mut reopened, &old, now).is_ok());
        assert!(login(&mut reopened, &new, now).is_ok());

        let mut reopened = Pairing::open(path);
        assert!(login(&mut reopened, &old, now).is_err());
        assert!(login(&mut reopened, &new, now).is_ok());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn damaged_credentials_stay_untouched_until_the_browser_proves_the_pairing_code() {
        let folder = temp("browser-repair");
        let path = folder.join(".browser-remote.json");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(&path, b"old unreadable data").unwrap();
        let now = Instant::now();
        let mut pairing = Pairing::open(path.clone());
        assert!(pairing.needs_repair());
        pairing.issue(1, now).unwrap();
        let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let wrong = response(&attempt, "wrong");
        assert!(pairing.finish(attempt, ID, wrong, now).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"old unreadable data");

        let secret = pair(&mut pairing, now);
        let mut reopened = Pairing::open(path);
        assert!(!reopened.needs_repair());
        assert!(login(&mut reopened, &secret, now).is_ok());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
