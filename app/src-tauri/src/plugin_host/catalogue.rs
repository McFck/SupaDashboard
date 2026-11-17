//! The plugin catalogue: `catalogue.json` and `catalogue.sig` from the plugins repository's `catalogue-v2` release,
//! checked against the pinned key and validated strictly before anything in it is shown or downloaded. Version 1
//! catalogues (folders of files, tag `catalogue`) are frozen for older app releases.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::archive::MAX_PLUGIN;
use super::manifest::valid_id;
use super::permissions::Permissions;
use super::secure::valid_sha256;
use super::trust;

const URL: &str =
    "https://github.com/McFck/supadashboard-plugins/releases/download/catalogue-v2/catalogue.json";
const SIG_URL: &str =
    "https://github.com/McFck/supadashboard-plugins/releases/download/catalogue-v2/catalogue.sig";
const MAX_CATALOGUE: u64 = 1 << 20;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalogue {
    format: u32,
    #[serde(rename = "published")]
    _published: String,
    plugins: Vec<Entry>,
}

/// One plugin as the Market shows it; the file's URL and hash stay native, the frontend installs by id only.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    title: String,
    description: String,
    icon: String,
    pub version: String,
    pub api: u32,
    published: String,
    /// Bytes of the `.sdplugin`.
    pub size: u64,
    source: String,
    guide: String,
    pub permissions: Permissions,
    #[serde(skip_serializing)]
    pub url: String,
    #[serde(skip_serializing)]
    pub sha256: String,
}

fn valid_url(url: &str) -> bool {
    url.len() <= 2048 && url.starts_with("https://") && !url.chars().any(char::is_whitespace)
}

fn valid_entry(entry: &Entry) -> bool {
    valid_id(&entry.id)
        && !entry.version.is_empty()
        && entry.version.len() <= 32
        && valid_url(&entry.source)
        && valid_url(&entry.url)
        && entry.size <= MAX_PLUGIN
        && valid_sha256(&entry.sha256)
        && entry.permissions.validate().is_ok()
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let catalogue: Catalogue =
        serde_json::from_slice(bytes).map_err(|error| format!("Invalid catalogue: {error}"))?;
    if catalogue.format != 2 {
        return Err("Unsupported catalogue format".into());
    }
    let mut ids = HashSet::new();
    for entry in &catalogue.plugins {
        if !valid_entry(entry) || !ids.insert(entry.id.as_str()) {
            return Err(format!("Invalid catalogue entry {:?}", entry.id));
        }
    }
    Ok(catalogue.plugins)
}

/// Where the catalogue and plugin files come from. Debug builds can read them from a local folder instead
/// (`SUPADASHBOARD_PLUGIN_SOURCE`, files named like each URL's last segment) while the repository is private.
pub enum Source {
    Remote,
    #[cfg(debug_assertions)]
    Local(std::path::PathBuf),
}

impl Source {
    pub fn new() -> Self {
        #[cfg(debug_assertions)]
        if let Some(folder) = std::env::var_os("SUPADASHBOARD_PLUGIN_SOURCE") {
            return Self::Local(folder.into());
        }
        Self::Remote
    }

    pub async fn fetch(&self, url: &str, limit: u64) -> Result<Vec<u8>, String> {
        match self {
            Self::Remote => {
                let limit = usize::try_from(limit).map_err(|_| "File too large")?;
                super::http::download(url, limit).await
            }
            #[cfg(debug_assertions)]
            Self::Local(folder) => {
                let name = url.rsplit('/').next().unwrap_or("");
                if !super::manifest::valid_file_name(name) {
                    return Err(format!("Invalid file name in {url}"));
                }
                let bytes = std::fs::read(folder.join(name)).map_err(|e| format!("{name}: {e}"))?;
                if bytes.len() as u64 > limit {
                    return Err(format!("{name} is too large"));
                }
                Ok(bytes)
            }
        }
    }

    pub async fn catalogue(&self) -> Result<Vec<Entry>, String> {
        let bytes = self.fetch(URL, MAX_CATALOGUE).await?;
        let signature = self.fetch(SIG_URL, 1024).await?;
        trust::signed(&bytes, &signature)?;
        parse(&bytes)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// One entry granting `http` to example.com; `extra` is spliced into its fields.
    pub fn entry(id: &str, sha256: &str, size: u64, extra: &str) -> String {
        format!(
            r#"{{"id":"{id}","title":"Spike","description":"","icon":"box","version":"1.0.0","api":1,
            "published":"2026-11-09","size":{size},"source":"https://github.com/McFck/supadashboard-plugins",
            "guide":"","permissions":{{"http":["example.com"]}},
            "url":"https://github.com/McFck/supadashboard-plugins/releases/download/spike-1.0.0/spike-1.0.0.sdplugin",
            "sha256":"{sha256}"{extra}}}"#
        )
    }

    pub fn catalogue(entries: &[String]) -> String {
        format!(
            r#"{{"format":2,"published":"2026-11-09","plugins":[{}]}}"#,
            entries.join(",")
        )
    }

    #[test]
    fn nothing_over_http_unhashed_over_the_limit_or_over_granted_is_accepted() {
        let sha = "ab".repeat(32);
        let ok = entry("spike", &sha, 3, "");
        let entries = parse(catalogue(std::slice::from_ref(&ok)).as_bytes()).unwrap();
        assert_eq!(entries[0].permissions.http, ["example.com"]);
        let single = |entry: String| catalogue(&[entry]);
        let bad = [
            single(ok.replace(
                "https://github.com/McFck/supadashboard-plugins/releases",
                "http://x.com",
            )),
            single(entry("spike", &"AB".repeat(32), 3, "")),
            single(entry("spike", &sha[2..], 3, "")),
            single(entry("spike", &sha, MAX_PLUGIN + 1, "")),
            single(entry("../spike", &sha, 3, "")),
            single(entry("spike", &sha, 3, r#","author":"x""#)),
            single(ok.replace(r#""example.com""#, r#""*.example.com""#)),
            single(ok.replace(
                r#""version":"1.0.0""#,
                &format!(r#""version":"{}""#, "1".repeat(33)),
            )),
            single(ok.clone()).replace(r#""format":2"#, r#""format":1"#),
            catalogue(&[ok.clone(), ok.clone()]),
        ];
        for text in bad {
            assert!(parse(text.as_bytes()).is_err(), "{text}");
        }
    }
}
