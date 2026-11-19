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
pub(super) const VERSION: u8 = 3;
const MAX_ATTEMPTS: u8 = 3;

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
    /// Stores written before credential rotation hold one bare credential.
    Legacy(Credential),
}

struct Code {
    owner: u32,
    id: String,
    value: String,
    expires: Instant,
    failures: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCode {
    code: String,
    expires_in_ms: u64,
}

pub(super) struct Pairing {
    file: Result<ProtectedFile, String>,
    credentials: Credentials,
    repair: bool,
    code: Option<Code>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(super) enum Mode {
    Pair,
    Auth,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Hello {
    #[serde(default)]
    pub v: u8,
    pub mode: Mode,
    pub nonce: String,
    #[serde(rename = "keyId")]
    pub key_id: Option<String>,
}

#[derive(Serialize)]
pub(super) struct Challenge {
    pub nonce: String,
}

#[derive(Debug, Serialize)]
pub(super) struct Ready {
    kind: &'static str,
    proof: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Proof {
    pub proof: String,
}

pub(super) struct Attempt {
    mode: Mode,
    code_id: Option<String>,
    key: String,
    transcript: String,
}

#[derive(Debug, PartialEq)]
pub(super) enum Rejected {
    Code,
    Expired,
    Authentication,
    Storage(String),
}

impl Pairing {
    pub(super) fn open(path: PathBuf) -> Self {
        let inspected = ProtectedFile::inspect::<Stored>(path, "Browser bridge");
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

    pub(super) fn issue(&mut self, owner: u32, now: Instant) -> Result<PairCode, Failure> {
        let value = digits()?;
        self.code = Some(Code {
            owner,
            id: random()?,
            value: value.clone(),
            expires: now + CODE_LIFETIME,
            failures: 0,
        });
        Ok(PairCode {
            code: value,
            expires_in_ms: CODE_LIFETIME.as_secs() * 1000,
        })
    }

    pub(super) fn cancel(&mut self, owner: u32) {
        if self.code.as_ref().is_some_and(|code| code.owner == owner) {
            self.code = None;
        }
    }

    fn code(&self, now: Instant) -> Option<&Code> {
        self.code
            .as_ref()
            .filter(|code| code.expires > now && code.failures < MAX_ATTEMPTS)
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
        let (mode, code_id, key) = match (hello.mode, hello.key_id.as_deref()) {
            (Mode::Pair, None) => {
                let code = self.code(now);
                (
                    "pair",
                    code.map(|code| code.id.clone()),
                    code.map(|code| code.value.as_str()),
                )
            }
            (Mode::Auth, Some(id)) if hex(id, 64) => {
                let key = self
                    .auth_keys(extension)
                    .find(|key| sha256_hex(key.as_bytes()).is_ok_and(|found| found == id));
                ("auth", None, key)
            }
            _ => return Err("Invalid browser credential ID"),
        };
        let key = match key {
            Some(key) => key.to_owned(),
            None => random()?,
        };
        let nonce = random()?;
        let transcript = format!(
            "supadashboard-browser-v{VERSION}:{mode}:{extension}:{}:{nonce}",
            hello.nonce
        );
        Ok((
            Attempt {
                mode: hello.mode,
                code_id,
                key,
                transcript,
            },
            Challenge { nonce },
        ))
    }

    pub(super) fn finish(
        &mut self,
        attempt: Attempt,
        extension: &str,
        proof: Proof,
        now: Instant,
    ) -> Result<(Mode, Ready), Rejected> {
        let key = attempt.key.as_str();
        let valid = verify(key, &format!("client:{}", attempt.transcript), &proof.proof);
        if attempt.mode == Mode::Pair {
            self.check_code(attempt.code_id.as_deref(), valid, now)?;
        } else if !valid || !self.auth_keys(extension).any(|secret| secret == key) {
            return Err(Rejected::Authentication);
        }
        let proof = sign(key, &format!("server:{}", attempt.transcript))
            .map_err(|error| Rejected::Storage(error.into()))?;
        self.store(&attempt, extension)?;
        Ok((
            attempt.mode,
            Ready {
                kind: "ready",
                proof,
            },
        ))
    }

    fn check_code(
        &mut self,
        issued: Option<&str>,
        valid: bool,
        now: Instant,
    ) -> Result<(), Rejected> {
        if self
            .code(now)
            .is_none_or(|code| Some(code.id.as_str()) != issued)
        {
            return Err(Rejected::Expired);
        }
        if valid {
            return Ok(());
        }
        if let Some(code) = &mut self.code {
            code.failures += 1;
            if code.failures >= MAX_ATTEMPTS {
                self.code = None;
                return Err(Rejected::Expired);
            }
        }
        Err(Rejected::Code)
    }

    /// A pairing saves its credential as pending; only a login with it proves the extension saved it too.
    fn store(&mut self, attempt: &Attempt, extension: &str) -> Result<(), Rejected> {
        if attempt.mode == Mode::Pair {
            let secret = sign(&attempt.key, &format!("credential:{}", attempt.transcript))
                .map_err(|error| Rejected::Storage(error.into()))?;
            self.save(Credentials {
                current: self.credentials.current.clone(),
                pending: Some(Credential {
                    extension: extension.into(),
                    secret,
                }),
            })
            .map_err(Rejected::Storage)?;
            self.code = None;
        } else if let Some(pending) = self
            .credentials
            .pending
            .as_ref()
            .filter(|item| item.secret == attempt.key)
        {
            self.save(Credentials {
                current: Some(pending.clone()),
                pending: None,
            })
            .map_err(Rejected::Storage)?;
        }
        Ok(())
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

// Six digits resist online guessing only (MAX_ATTEMPTS); a peer squatting the port can brute-force them offline without a PAKE.
fn digits() -> Result<String, Failure> {
    loop {
        let value = CryptographicBuffer::GenerateRandomNumber()
            .map_err(|_| "Could not generate browser pairing data")?;
        if value < 4_294_000_000 {
            return Ok(format!("{:06}", value % 1_000_000));
        }
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
            v: VERSION,
            mode,
            nonce: "0".repeat(32),
            key_id: (mode == Mode::Auth).then(|| "0".repeat(64)),
        }
    }

    fn response(attempt: &Attempt, key: &str) -> Proof {
        Proof {
            proof: sign(key, &format!("client:{}", attempt.transcript)).unwrap(),
        }
    }

    fn pair(pairing: &mut Pairing, now: Instant) -> String {
        let code = pairing.issue(1, now).unwrap().code;
        let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let secret = sign(&code, &format!("credential:{}", attempt.transcript)).unwrap();
        let proof = response(&attempt, &code);
        pairing.finish(attempt, ID, proof, now).unwrap();
        secret
    }

    fn login(pairing: &mut Pairing, key: &str, now: Instant) -> Result<(Mode, Ready), Rejected> {
        let hello = Hello {
            key_id: Some(sha256_hex(key.as_bytes()).unwrap()),
            ..hello(Mode::Auth)
        };
        let (attempt, _) = pairing.begin(hello, ID, now).unwrap();
        let proof = response(&attempt, key);
        pairing.finish(attempt, ID, proof, now)
    }

    #[test]
    fn pairing_rejects_wrong_expired_and_replayed_proofs_and_restores_only_the_paired_id() {
        let folder = temp("browser-pairing");
        let path = folder.join(".browser.json");
        let mut pairing = Pairing::open(path.clone());
        let now = Instant::now();
        let (attempt, decoy) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        let wrong = response(&attempt, "000000");
        assert_eq!(
            pairing.finish(attempt, ID, wrong, now).unwrap_err(),
            Rejected::Expired
        );
        let code = pairing.issue(1, now).unwrap().code;
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        let (attempt, challenge) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        for challenge in [decoy, challenge] {
            assert_eq!(
                serde_json::to_value(&challenge).unwrap(),
                serde_json::json!({"nonce": challenge.nonce})
            );
        }
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
        let transcript = attempt.transcript.clone();
        let (_, ready) = pairing.finish(attempt, ID, proof, now).unwrap();
        assert!(verify(&code, &format!("server:{transcript}"), &ready.proof));
        let old = response(&replay, &code);
        assert!(pairing.finish(replay, ID, old, now).is_err());
        assert!(!std::fs::read_to_string(&path).unwrap().contains(&secret));
        let mut reopened = Pairing::open(path);
        let other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let greeting = || Hello {
            key_id: Some(sha256_hex(secret.as_bytes()).unwrap()),
            ..hello(Mode::Auth)
        };
        let (attempt, _) = reopened.begin(greeting(), other, now).unwrap();
        let proof = response(&attempt, &secret);
        assert!(reopened.finish(attempt, other, proof, now).is_err());
        let (attempt, _) = reopened.begin(greeting(), ID, now).unwrap();
        let proof = response(&attempt, &secret);
        reopened.finish(attempt, ID, proof, now).unwrap();
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn three_wrong_proofs_burn_even_an_already_challenged_code() {
        let folder = temp("browser-code-limit");
        let mut pairing = Pairing::open(folder.join(".browser.json"));
        let now = Instant::now();
        let code = pairing.issue(1, now).unwrap().code;
        let (correct, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
        for expected in [Rejected::Code, Rejected::Code, Rejected::Expired] {
            let (attempt, _) = pairing.begin(hello(Mode::Pair), ID, now).unwrap();
            let wrong = response(&attempt, "wrong");
            assert_eq!(
                pairing.finish(attempt, ID, wrong, now).unwrap_err(),
                expected
            );
        }
        let proof = response(&correct, &code);
        assert_eq!(
            pairing.finish(correct, ID, proof, now).unwrap_err(),
            Rejected::Expired
        );
        assert!(!folder.join(".browser.json").exists());
    }

    #[test]
    fn a_replacement_cannot_strand_the_old_extension_before_the_new_login() {
        let folder = temp("browser-rotation");
        let path = folder.join(".browser.json");
        let (mut file, _) =
            ProtectedFile::open::<Credential>(path.clone(), "Browser bridge").unwrap();
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
        let path = folder.join(".browser.json");
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
