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

use crate::plugin_host::{permissions::valid_extension_id, secure::ProtectedFile};

use super::wire::{Failure, hex};

const CODE_LIFETIME: Duration = Duration::from_secs(120);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    extension: String,
    secret: String,
}

struct Code {
    owner: u32,
    value: String,
    expires: Instant,
}

pub(super) struct Pairing {
    file: ProtectedFile,
    credential: Option<Credential>,
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
    pub(super) fn open(path: PathBuf) -> Result<Self, String> {
        let (file, credential) = ProtectedFile::open::<Credential>(path, "Browser Remote")?;
        if credential.as_ref().is_some_and(|stored| {
            !valid_extension_id(&stored.extension) || !hex(&stored.secret, 64)
        }) {
            return Err("Unreadable Browser Remote credentials".into());
        }
        Ok(Self {
            file,
            credential,
            code: None,
        })
    }

    pub(super) fn issue(&mut self, owner: u32, now: Instant) -> Result<String, Failure> {
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

    fn key(&self, mode: Mode, extension: &str, now: Instant) -> Result<&str, Failure> {
        match mode {
            Mode::Pair => self
                .code
                .as_ref()
                .filter(|code| code.expires > now)
                .map(|code| code.value.as_str()),
            Mode::Auth => self
                .credential
                .as_ref()
                .filter(|stored| stored.extension == extension)
                .map(|stored| stored.secret.as_str()),
        }
        .ok_or("Browser pairing required")
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
        let key = self.key(hello.mode, extension, now)?.to_owned();
        let nonce = random()?;
        let mode = match hello.mode {
            Mode::Pair => "pair",
            Mode::Auth => "auth",
        };
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
    ) -> Result<(), String> {
        let key = self.key(attempt.mode, extension, now)?;
        if key != attempt.key
            || !verify(key, &format!("client:{}", attempt.transcript), &proof.proof)
        {
            return Err("Invalid browser proof".into());
        }
        if attempt.mode == Mode::Pair {
            let secret = sign(key, &format!("credential:{}", attempt.transcript))?;
            let credential = Credential {
                extension: extension.into(),
                secret,
            };
            self.file.save(Some(&credential))?;
            self.credential = Some(credential);
            self.code = None;
        }
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
        }
    }

    fn response(attempt: &Attempt, key: &str) -> Proof {
        Proof {
            proof: sign(key, &format!("client:{}", attempt.transcript)).unwrap(),
        }
    }

    #[test]
    fn pairing_rejects_wrong_expired_and_replayed_proofs_and_restores_only_the_paired_id() {
        let folder = temp("browser-pairing");
        let path = folder.join(".browser-remote.json");
        let mut pairing = Pairing::open(path.clone()).unwrap();
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
        let mut reopened = Pairing::open(path).unwrap();
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
}
