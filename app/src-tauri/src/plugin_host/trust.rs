//! Release signatures. A signed plugin folder holds `release.json` (written by `plugin-tools/release.mjs`) and
//! `release.sig`, base64 of its P-256 signature by the SupaDashboard key pinned here. The catalogue is signed the
//! same way. Rotating the key takes an app release.
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::Path;

use plugin_sdk::secure::{sha256_hex, verify_p256};
use serde::{Deserialize, Serialize};

use super::manifest::{Manifest, valid_path};
use super::protocol::Ui;

/// The uncompressed point of `keys/plugin-signing-pub.pem`.
const KEY: [u8; 65] = [
    0x04, 0x6d, 0xd0, 0x8c, 0x45, 0xf9, 0xd3, 0x63, 0x4e, 0x65, 0x53, 0xd1, 0x03, 0x19, 0x76, 0xd8,
    0x6f, 0x7b, 0x4b, 0x17, 0xf1, 0xff, 0x43, 0x10, 0xbb, 0xf0, 0xc1, 0x0b, 0x10, 0xcb, 0x5c, 0xa0,
    0xce, 0xc4, 0xcb, 0xe8, 0x55, 0xe4, 0x58, 0xb4, 0xaf, 0xe8, 0xab, 0x2b, 0xc2, 0x66, 0x17, 0x23,
    0x53, 0x67, 0x21, 0xea, 0x95, 0xfa, 0xd2, 0x0b, 0x0f, 0x13, 0x54, 0xa2, 0x1f, 0x00, 0x2e, 0x7b,
    0x66,
];

/// A folder whose signature or hashes do not hold is neither: it is refused.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trust {
    Verified,
    Unverified,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Release {
    format: u32,
    id: String,
    version: String,
    #[serde(default)]
    api: Option<u32>,
    /// Path inside the plugin folder to lowercase hex SHA-256.
    files: BTreeMap<String, String>,
}

pub fn signed(message: &[u8], signature: &[u8]) -> Result<(), String> {
    if verify_p256(&KEY, message, signature) {
        Ok(())
    } else {
        Err("Invalid signature".into())
    }
}

/// `ui` holds the bytes the plugin scheme will serve; every other listed file is read from `folder`.
pub fn check(folder: &Path, manifest: &Manifest, ui: Option<&Ui>) -> Result<Trust, String> {
    check_with(&KEY, folder, manifest, ui)
}

fn check_with(
    key: &[u8; 65],
    folder: &Path,
    manifest: &Manifest,
    ui: Option<&Ui>,
) -> Result<Trust, String> {
    let bytes = match std::fs::read(folder.join("release.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Trust::Unverified),
        Err(error) => return Err(format!("release.json: {error}")),
    };
    let signature =
        std::fs::read(folder.join("release.sig")).map_err(|_| "release.sig is missing")?;
    if !verify_p256(key, &bytes, &signature) {
        return Err("Invalid release signature".into());
    }
    let release: Release =
        serde_json::from_slice(&bytes).map_err(|error| format!("release.json: {error}"))?;
    if release.format != 1
        || release.id != manifest.id
        || release.version != manifest.version
        || release.api != manifest.api
    {
        return Err("release.json does not match plugin.json".into());
    }
    let ui_files = ui.map_or(&[][..], |_| &["ui/index.js", "ui/index.css"][..]);
    let required = ["plugin.json"]
        .into_iter()
        .chain(manifest.exe.as_deref())
        .chain(ui_files.iter().copied());
    for path in required {
        if !release.files.contains_key(path) {
            return Err(format!("{path} is not signed"));
        }
    }
    for (path, hash) in &release.files {
        if !valid_path(path) {
            return Err(format!("Invalid signed path {path:?}"));
        }
        let served = ui.and_then(|ui| ui.file(path));
        let read;
        let bytes = match served {
            Some(bytes) => bytes,
            None => {
                read = std::fs::read(folder.join(path)).map_err(|e| format!("{path}: {e}"))?;
                &read
            }
        };
        if sha256_hex(bytes)? != *hash {
            return Err(format!("{path} was changed after signing"));
        }
    }
    if has_unsigned(folder, "", &release.files) {
        return Ok(Trust::Unverified);
    }
    Ok(Trust::Verified)
}

/// Whether `folder` holds anything besides the signed files and the release pair: a DLL beside a signed exe
/// would load into it, so such a folder counts as unverified.
fn has_unsigned(folder: &Path, prefix: &str, signed: &BTreeMap<String, String>) -> bool {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return true;
    };
    entries.into_iter().any(|entry| {
        let Ok(entry) = entry else {
            return true;
        };
        let path = format!("{prefix}{}", entry.file_name().to_string_lossy());
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            return has_unsigned(&entry.path(), &format!("{path}/"), signed);
        }
        let release = prefix.is_empty() && (path == "release.json" || path == "release.sig");
        !release && !signed.contains_key(&path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A throwaway key generated for these vectors; its private half was never kept.
    const TEST_KEY: [u8; 65] = [
        0x04, 0xf1, 0xae, 0x99, 0x3c, 0x19, 0x92, 0xf5, 0x06, 0xe3, 0x77, 0x65, 0xba, 0xa6, 0x23,
        0xfd, 0xc3, 0x41, 0x96, 0x03, 0x22, 0x05, 0x69, 0xd6, 0xba, 0x30, 0xfc, 0xbc, 0xd7, 0xfa,
        0x82, 0x69, 0xea, 0x8a, 0x50, 0x3d, 0x38, 0xc1, 0x97, 0x60, 0x89, 0x02, 0xa6, 0xf5, 0x86,
        0xe8, 0x5f, 0x2d, 0xb4, 0xba, 0x80, 0xd6, 0x8e, 0x82, 0xe1, 0x4c, 0x46, 0xcf, 0x6e, 0x56,
        0x1d, 0x69, 0x74, 0xf2, 0x9c,
    ];
    const PLUGIN: &str =
        r#"{"id":"spike","version":"1.0.0","protocol":1,"windows":["main"],"methods":[],"api":1}"#;
    const RELEASE: &str = r#"{"format":1,"id":"spike","version":"1.0.0","api":1,"files":{"plugin.json":"9d54aa3466e0599bb50c5e710ec961a6fe66f70078b3d3743f5b0ff4713e6168","ui/index.css":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ui/index.js":"0a286891c11c056e1ab5bfc25bf5d6b2f5b06d38eac10944f678fd8a2e70c393"}}"#;
    const SIG: &str =
        "5z6/ahmfAX88+2QJbPY60XXLJRkY9tX1Vkrqu07IQkLDaFbVjxjsuODzV2Yg/8wlIcYuVGwYE7XsObGwitoG7w==";
    /// Signed by the same key, for a plugin with the id "other".
    const OTHER: &str = r#"{"format":1,"id":"other","version":"1.0.0","api":1,"files":{"plugin.json":"2ddcd0e0d91e0740219c39cbee9d5e687d53c69f2937aea98dd23773153c0d06","ui/index.css":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ui/index.js":"0a286891c11c056e1ab5bfc25bf5d6b2f5b06d38eac10944f678fd8a2e70c393"}}"#;
    const OTHER_SIG: &str =
        "TaR/6h0sr31Ne0CtHhlDFnAJKSAvwrYxaQepH3idcWszFWwQIKS58WWRMNVWLgwoVFO+eGiAGsqr6Fst79In+Q==";

    fn folder(release: Option<(&str, &str)>, script: &str) -> std::path::PathBuf {
        let unique = format!("supa-trust-{}-{}", std::process::id(), rand());
        let folder = std::env::temp_dir().join(unique);
        fs::create_dir_all(folder.join("ui")).unwrap();
        fs::write(folder.join("plugin.json"), PLUGIN).unwrap();
        fs::write(folder.join("ui/index.js"), script).unwrap();
        fs::write(folder.join("ui/index.css"), "").unwrap();
        if let Some((json, sig)) = release {
            fs::write(folder.join("release.json"), json).unwrap();
            fs::write(folder.join("release.sig"), sig).unwrap();
        }
        folder
    }

    fn rand() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }

    fn trust(folder: &Path) -> Result<Trust, String> {
        let manifest = Manifest::parse(PLUGIN, "spike").unwrap();
        let ui = Ui::read(folder).unwrap();
        let trust = check_with(&TEST_KEY, folder, &manifest, Some(&ui));
        fs::remove_dir_all(folder).unwrap();
        trust
    }

    #[test]
    fn only_an_untouched_folder_signed_for_its_own_id_is_verified() {
        let good = Some((RELEASE, SIG));
        assert_eq!(trust(&folder(good, "console.log(1)")), Ok(Trust::Verified));
        assert_eq!(trust(&folder(None, "anything")), Ok(Trust::Unverified));
        assert!(trust(&folder(good, "console.log(2)")).is_err(), "tampered");
        for extra in ["version.dll", "ui/extra.js", "lib/helper.dll"] {
            let signed = folder(good, "console.log(1)");
            fs::create_dir_all(signed.join("lib")).unwrap();
            fs::write(signed.join(extra), "").unwrap();
            assert_eq!(
                trust(&signed),
                Ok(Trust::Unverified),
                "{extra} beside signed files"
            );
        }
        assert!(
            trust(&folder(Some((OTHER, OTHER_SIG)), "console.log(1)")).is_err(),
            "id"
        );
        let flipped = SIG.replacen('5', "6", 1);
        assert!(
            trust(&folder(Some((RELEASE, &flipped)), "console.log(1)")).is_err(),
            "sig"
        );
        let mut unsigned = folder(good, "console.log(1)");
        fs::remove_file(unsigned.join("release.sig")).unwrap();
        assert!(
            trust(&unsigned).is_err(),
            "release.json without a signature"
        );
        unsigned = folder(good, "console.log(1)");
        let manifest = Manifest::parse(PLUGIN, "spike").unwrap();
        let ui = Ui::read(&unsigned).unwrap();
        assert!(
            check(&unsigned, &manifest, Some(&ui)).is_err(),
            "pinned key"
        );
        fs::remove_dir_all(unsigned).unwrap();
    }
}
