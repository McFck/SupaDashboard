//! `plugin.json`: what a plugin file declares. Read from a file anyone could hand the app, so everything that
//! reaches a path or a permission is checked here.
use serde::Deserialize;

use super::permissions::Permissions;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    /// The plugin UI API (`PLUGIN_API` in plugin-kit.ts) of `ui/index.js` and `ui/index.css`.
    pub api: u32,
    /// Files and folders the in-app version kept in the app data root, moved once into the plugin's data folder.
    #[serde(default)]
    pub migrate: Vec<String>,
    #[serde(default)]
    pub permissions: Permissions,
}

pub(super) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A bare file or folder name: no separators, no `..`, no drive.
pub(super) fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let manifest: Manifest =
            serde_json::from_slice(bytes).map_err(|error| format!("plugin.json: {error}"))?;
        if !valid_id(&manifest.id) {
            return Err(format!("Invalid plugin id {:?}", manifest.id));
        }
        if manifest.version.is_empty() || manifest.version.len() > 32 {
            return Err("Invalid plugin version".into());
        }
        if !manifest.migrate.iter().all(|name| valid_file_name(name)) {
            return Err("Invalid migrated file name".into());
        }
        manifest.permissions.validate()?;
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_cannot_point_outside_the_plugin_or_carry_v1_grants() {
        let ok = r#"{"id":"spotify","version":"2.0.0","api":2,"migrate":["spotify.json","lyrics"],
            "permissions":{"http":["api.spotify.com"]}}"#;
        let manifest = Manifest::parse(ok.as_bytes()).unwrap();
        assert_eq!(manifest.permissions.http, ["api.spotify.com"]);
        let bad = [
            ok.replace(r#""lyrics""#, r#""../settings.json""#),
            ok.replace(r#""spotify","version""#, r#""../spotify","version""#),
            ok.replace(r#""api":2,"#, ""),
            ok.replace(r#""api.spotify.com""#, r#""*.spotify.com""#),
            // Version 1 manifests: an executable and window grants.
            ok.replace(r#""api":2"#, r#""api":1,"protocol":1,"exe":"x.exe""#),
            ok.replace(r#""api":2"#, r#""api":2,"windows":["main"],"methods":[]"#),
        ];
        for text in bad {
            assert!(Manifest::parse(text.as_bytes()).is_err(), "{text}");
        }
    }
}
