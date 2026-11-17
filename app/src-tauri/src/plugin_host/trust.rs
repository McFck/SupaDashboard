//! Release signatures. A signed `.sdplugin` holds `release.json` (written by `plugin-tools/release.mjs`) and
//! `release.sig`, base64 of its P-256 signature by the SupaDashboard key pinned here. The catalogue is signed the
//! same way. Rotating the key takes an app release.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::archive::Archive;
use super::manifest::Manifest;
use super::secure::{sha256_hex, verify_p256};

/// The uncompressed point of `keys/plugin-signing-pub.pem`.
const KEY: [u8; 65] = [
    0x04, 0x6d, 0xd0, 0x8c, 0x45, 0xf9, 0xd3, 0x63, 0x4e, 0x65, 0x53, 0xd1, 0x03, 0x19, 0x76, 0xd8,
    0x6f, 0x7b, 0x4b, 0x17, 0xf1, 0xff, 0x43, 0x10, 0xbb, 0xf0, 0xc1, 0x0b, 0x10, 0xcb, 0x5c, 0xa0,
    0xce, 0xc4, 0xcb, 0xe8, 0x55, 0xe4, 0x58, 0xb4, 0xaf, 0xe8, 0xab, 0x2b, 0xc2, 0x66, 0x17, 0x23,
    0x53, 0x67, 0x21, 0xea, 0x95, 0xfa, 0xd2, 0x0b, 0x0f, 0x13, 0x54, 0xa2, 0x1f, 0x00, 0x2e, 0x7b,
    0x66,
];
const RELEASE: [&str; 2] = ["release.json", "release.sig"];

/// A plugin whose signature or hashes do not hold is neither: it is refused.
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
    api: u32,
    /// Every entry of the archive but the release pair, to lowercase hex SHA-256.
    files: BTreeMap<String, String>,
}

pub fn signed(message: &[u8], signature: &[u8]) -> Result<(), String> {
    if verify_p256(&KEY, message, signature) {
        Ok(())
    } else {
        Err("Invalid signature".into())
    }
}

/// Release builds take only verified plugins, at discovery and install: every bundle runs in the app's one JS realm,
/// so an unverified bundle could call capabilities under another plugin's id and use its grants. Debug builds also
/// take unverified ones, after the install confirmation.
pub fn admitted(trust: Trust, debug: bool) -> Result<(), String> {
    if trust == Trust::Verified || debug {
        Ok(())
    } else {
        Err("Plugin is not signed".into())
    }
}

pub fn check(archive: &Archive, manifest: &Manifest) -> Result<Trust, String> {
    check_with(&KEY, archive, manifest)
}

fn check_with(key: &[u8; 65], archive: &Archive, manifest: &Manifest) -> Result<Trust, String> {
    let (bytes, signature) = match RELEASE.map(|name| archive.read(name)) {
        [None, None] => return Ok(Trust::Unverified),
        [Some(bytes), Some(signature)] => (bytes, signature),
        _ => return Err("Incomplete release signature".into()),
    };
    if !verify_p256(key, &bytes, &signature) {
        return Err("Invalid release signature".into());
    }
    let release: Release =
        serde_json::from_slice(&bytes).map_err(|error| format!("release.json: {error}"))?;
    if release.format != 2
        || release.id != manifest.id
        || release.version != manifest.version
        || release.api != manifest.api
    {
        return Err("release.json does not match plugin.json".into());
    }
    let entries = archive.names().filter(|name| !RELEASE.contains(name));
    if !entries.eq(release.files.keys().map(String::as_str)) {
        return Err("release.json does not list exactly the plugin's files".into());
    }
    for (name, hash) in &release.files {
        let bytes = archive
            .read(name)
            .ok_or_else(|| format!("Could not read {name}"))?;
        if sha256_hex(&bytes)? != *hash {
            return Err(format!("{name} was changed after signing"));
        }
    }
    Ok(Trust::Verified)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::archive::tests::{archive, temp};

    /// A throwaway key generated for these vectors; its private half was never kept.
    const TEST_KEY: [u8; 65] = [
        0x04, 0xe6, 0x01, 0xbf, 0xfd, 0x24, 0x76, 0x78, 0xf3, 0x4f, 0x4a, 0x06, 0xed, 0xd8, 0xa3,
        0x8f, 0x1a, 0x45, 0xf3, 0x3d, 0xca, 0xcd, 0xd3, 0x70, 0x28, 0xc8, 0x77, 0x1d, 0xc2, 0x4a,
        0x05, 0xfe, 0x86, 0x85, 0x02, 0xd4, 0x38, 0x4e, 0x7a, 0xc6, 0xfc, 0x69, 0x73, 0x0b, 0xb1,
        0x7a, 0x36, 0xc8, 0x0d, 0xf3, 0xd2, 0x07, 0x3e, 0x00, 0xea, 0xb9, 0x77, 0x48, 0xf0, 0xb0,
        0x69, 0xae, 0xcc, 0x62, 0xd2,
    ];
    const PLUGIN: &str = r#"{"id":"spike","version":"1.0.0","api":1}"#;
    const RELEASE_JSON: &str = r#"{"format":2,"id":"spike","version":"1.0.0","api":1,"files":{"assets/a.txt":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb","plugin.json":"1705dbc3caaa0e895bcad5939c8e53fbbb10d475f6a80f00b428af571e7cc08d","ui/index.css":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ui/index.js":"0a286891c11c056e1ab5bfc25bf5d6b2f5b06d38eac10944f678fd8a2e70c393"}}"#;
    const SIG: &str =
        "j9Xw9etYUBwKhd1fsjYA07ZzQUxxyWA+Vj7iAAFJxZ66l1i3wkoKuVDDUj8MY2SQMnPTUWFBMjiixoQX9AOv3A==";
    /// Signed by the same key, for a plugin with the id "other".
    const OTHER: &str = r#"{"format":2,"id":"other","version":"1.0.0","api":1,"files":{"assets/a.txt":"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb","plugin.json":"1705dbc3caaa0e895bcad5939c8e53fbbb10d475f6a80f00b428af571e7cc08d","ui/index.css":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ui/index.js":"0a286891c11c056e1ab5bfc25bf5d6b2f5b06d38eac10944f678fd8a2e70c393"}}"#;
    const OTHER_SIG: &str =
        "bvoGUED3oVHVCo2WgI9IY0xwt3baUWZrksL115xryYK3gCYKuOjxErlrK35PxJsQjoNqQKNnGBZe05IpfvHZtg==";

    /// The trust of an archive with the vector's files, `script` as `ui/index.js`, plus `extra` entries.
    fn trust_with(key: &[u8; 65], extra: &[(&str, &[u8])], script: &str) -> Result<Trust, String> {
        let mut files: Vec<(&str, &[u8])> = vec![
            ("plugin.json", PLUGIN.as_bytes()),
            ("ui/index.js", script.as_bytes()),
            ("ui/index.css", b""),
        ];
        files.extend_from_slice(extra);
        let path = temp("trust");
        std::fs::write(&path, archive(&files)).unwrap();
        let opened = Archive::open(&path).unwrap();
        let trust = check_with(key, &opened, &Manifest::parse(PLUGIN.as_bytes()).unwrap());
        drop(opened);
        std::fs::remove_file(path).unwrap();
        trust
    }

    #[test]
    fn a_release_build_refuses_unverified_plugins() {
        assert!(admitted(Trust::Unverified, false).is_err());
        assert_eq!(admitted(Trust::Unverified, true), Ok(()));
        assert_eq!(admitted(Trust::Verified, false), Ok(()));
    }

    #[test]
    fn only_an_untouched_archive_signed_for_its_own_id_and_files_is_verified() {
        let asset: (&str, &[u8]) = ("assets/a.txt", b"a");
        let signed = |release: &str, sig: &str, extra: &[(&str, &[u8])], script: &str| {
            let mut files = vec![
                asset,
                ("release.json", release.as_bytes()),
                ("release.sig", sig.as_bytes()),
            ];
            files.extend_from_slice(extra);
            trust_with(&TEST_KEY, &files, script)
        };
        let good = "console.log(1)";
        assert_eq!(signed(RELEASE_JSON, SIG, &[], good), Ok(Trust::Verified));
        assert_eq!(
            trust_with(&TEST_KEY, &[asset], "anything"),
            Ok(Trust::Unverified)
        );
        assert!(
            signed(RELEASE_JSON, SIG, &[], "console.log(2)").is_err(),
            "tampered"
        );
        assert!(
            signed(RELEASE_JSON, SIG, &[("assets/b.txt", b"")], good).is_err(),
            "an entry the release does not list"
        );
        let pair: [(&str, &[u8]); 2] = [
            ("release.json", RELEASE_JSON.as_bytes()),
            ("release.sig", SIG.as_bytes()),
        ];
        assert!(
            trust_with(&TEST_KEY, &pair, good).is_err(),
            "a listed entry is missing"
        );
        assert!(
            trust_with(&TEST_KEY, &[asset, pair[0]], good).is_err(),
            "release.json without a signature"
        );
        assert!(
            trust_with(&TEST_KEY, &[asset, ("release.sig", SIG.as_bytes())], good).is_err(),
            "a signature without release.json"
        );
        assert!(signed(OTHER, OTHER_SIG, &[], good).is_err(), "id");
        let flipped = SIG.replacen('j', "k", 1);
        assert!(signed(RELEASE_JSON, &flipped, &[], good).is_err(), "sig");
        assert!(
            trust_with(&KEY, &[asset, pair[0], pair[1]], good).is_err(),
            "pinned key"
        );
    }
}
