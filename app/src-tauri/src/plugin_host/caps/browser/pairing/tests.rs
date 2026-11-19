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
fn revocation_survives_restart_and_cannot_authenticate_a_browser() {
    let folder = temp("browser-unpair");
    let path = folder.join(".browser.json");
    let mut pairing = Pairing::open(path.clone());
    let now = Instant::now();
    let current = pair(&mut pairing, now);
    assert!(login(&mut pairing, &current, now).is_ok());
    let greeting = |key: &str| Hello {
        key_id: Some(sha256_hex(key.as_bytes()).unwrap()),
        ..hello(Mode::Auth)
    };
    let (in_flight, _) = pairing.begin(greeting(&current), ID, now).unwrap();
    let pending = pair(&mut pairing, now);
    pairing.revoke().unwrap();
    let mut reopened = Pairing::open(path);
    assert!(!reopened.is_paired());
    let (after_restart, _) = reopened.begin(greeting(&pending), ID, now).unwrap();
    for (key, attempt) in [(current, in_flight), (pending, after_restart)] {
        let transcript = attempt.transcript.clone();
        let proof = response(&attempt, &key);
        let Err(Rejected::Revoked(proof)) = reopened.finish(attempt, ID, proof, now) else {
            panic!("revoked keys must receive a signed revocation");
        };
        let revocation_key = sign(&key, "revocation").unwrap();
        assert!(verify(
            &revocation_key,
            &format!("revoked:{transcript}"),
            &proof
        ));
    }
    let fresh = pair(&mut reopened, now);
    assert!(login(&mut reopened, &fresh, now).is_ok());
    std::fs::remove_dir_all(folder).unwrap();
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
    let now = Instant::now();
    let mut pairing = Pairing::open(path.clone());
    let old = pair(&mut pairing, now);
    login(&mut pairing, &old, now).unwrap();
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
