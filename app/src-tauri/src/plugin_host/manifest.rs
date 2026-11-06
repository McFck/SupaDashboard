//! `plugin.json`: what a plugin folder declares. Read from a folder anyone could drop into the plugins
//! directory, so everything that reaches a path, an event name or a permission is checked here.
use plugin_sdk::{HELLO, PROTOCOL, WINDOW_CLOSED, valid_name};
use serde::Deserialize;

const WINDOWS: [&str; 2] = ["main", "panel"];

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub version: String,
    pub protocol: u32,
    /// File name of the plugin host executable inside the plugin folder.
    pub exe: String,
    /// Windows allowed to call the plugin; stateful plugins list only the dashboard owner, `main`.
    pub windows: Vec<String>,
    /// Methods the frontend may call.
    pub methods: Vec<String>,
    /// Files and folders the in-app version kept in the app data root, moved once into the plugin's data folder.
    #[serde(default)]
    pub migrate: Vec<String>,
    /// The media session app the plugin may send transport commands to (matched like a media target).
    #[serde(default)]
    pub media: Option<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A bare file or folder name: no separators, no `..`, no drive.
fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn valid_exe(exe: &str) -> bool {
    valid_file_name(exe) && exe.len() > 4 && exe.ends_with(".exe")
}

impl Manifest {
    /// `folder` is the plugin folder's name, which must be the id.
    pub fn parse(text: &str, folder: &str) -> Result<Self, String> {
        let manifest: Manifest = serde_json::from_str(text).map_err(|error| error.to_string())?;
        if !valid_id(&manifest.id) || manifest.id != folder {
            return Err(format!(
                "Plugin id {:?} does not match its folder",
                manifest.id
            ));
        }
        if manifest.protocol != PROTOCOL {
            return Err(format!(
                "Plugin protocol {} is not supported",
                manifest.protocol
            ));
        }
        if !valid_exe(&manifest.exe) {
            return Err(format!("Invalid plugin executable {:?}", manifest.exe));
        }
        if manifest.version.is_empty() || manifest.version.len() > 32 {
            return Err("Invalid plugin version".into());
        }
        if !manifest
            .windows
            .iter()
            .all(|w| WINDOWS.contains(&w.as_str()))
        {
            return Err("Unknown window in plugin permissions".into());
        }
        if manifest
            .media
            .as_deref()
            .is_some_and(|target| !valid_id(target))
        {
            return Err("Invalid media target".into());
        }
        if !manifest.migrate.iter().all(|name| valid_file_name(name)) {
            return Err("Invalid migrated file name".into());
        }
        if !manifest
            .methods
            .iter()
            .all(|m| valid_name(m) && m != HELLO && m != WINDOW_CLOSED)
        {
            return Err("Invalid method in plugin permissions".into());
        }
        Ok(manifest)
    }

    pub fn allows(&self, window: &str, method: &str) -> bool {
        self.windows.iter().any(|w| w == window) && self.methods.iter().any(|m| m == method)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(exe: &str, extra: &str) -> String {
        format!(
            r#"{{"id":"haptics","version":"1.0.0","protocol":1,"exe":"{exe}","windows":["main"],"methods":["pulse"]{extra}}}"#
        )
    }

    #[test]
    fn a_folder_cannot_point_outside_itself_or_grant_more_than_it_lists() {
        let ok = Manifest::parse(&manifest("haptics.exe", ""), "haptics").unwrap();
        assert!(ok.allows("main", "pulse"));
        assert!(!ok.allows("panel", "pulse"));
        assert!(!ok.allows("main", "configure"));
        for exe in [
            "..\\\\x.exe",
            "../x.exe",
            "C:x.exe",
            "x.bat",
            ".exe",
            "a/b.exe",
        ] {
            assert!(
                Manifest::parse(&manifest(exe, ""), "haptics").is_err(),
                "{exe}"
            );
        }
        assert!(Manifest::parse(&manifest("haptics.exe", ""), "other").is_err());
        assert!(Manifest::parse(&manifest("haptics.exe", r#","extra":1"#), "haptics").is_err());
        let escape = manifest("haptics.exe", r#","migrate":["../settings.json"]"#);
        assert!(Manifest::parse(&escape, "haptics").is_err());
        let hello = manifest("haptics.exe", "").replace(r#"["pulse"]"#, r#"["hello"]"#);
        assert!(Manifest::parse(&hello, "haptics").is_err());
        let old = manifest("haptics.exe", "").replace(r#""protocol":1"#, r#""protocol":0"#);
        assert!(Manifest::parse(&old, "haptics").is_err());
    }
}
