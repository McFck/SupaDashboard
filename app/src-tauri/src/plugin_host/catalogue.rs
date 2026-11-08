//! The plugin catalogue: `catalogue.json` and `catalogue.sig` from the plugins repository's `catalogue` release,
//! checked against the pinned key and validated strictly before anything in it is shown or downloaded.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::manifest::{valid_file_name, valid_id, valid_path};
use super::trust;

const URL: &str =
    "https://github.com/McFck/supadashboard-plugins/releases/download/catalogue/catalogue.json";
const SIG_URL: &str =
    "https://github.com/McFck/supadashboard-plugins/releases/download/catalogue/catalogue.sig";
const MAX_CATALOGUE: u64 = 1 << 20;
/// Sound packs ship as plugin files, so a single file can be large.
pub const MAX_FILE: u64 = 128 << 20;
pub const MAX_PLUGIN: u64 = 256 << 20;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalogue {
    format: u32,
    #[serde(rename = "published")]
    _published: String,
    plugins: Vec<Entry>,
}

/// One plugin as the Market shows it; `files` stay native, the frontend installs by id only.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    title: String,
    description: String,
    icon: String,
    pub version: String,
    api: u32,
    published: String,
    size: u64,
    source: String,
    guide: String,
    #[serde(skip_serializing)]
    pub files: Vec<File>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct File {
    pub path: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

fn valid_url(url: &str) -> bool {
    url.len() <= 2048 && url.starts_with("https://") && !url.chars().any(char::is_whitespace)
}

fn valid_entry(entry: &Entry) -> bool {
    let mut paths = HashSet::new();
    let total: u64 = entry.files.iter().map(|file| file.size).sum();
    valid_id(&entry.id)
        && !entry.version.is_empty()
        && entry.version.len() <= 32
        && valid_url(&entry.source)
        && total <= MAX_PLUGIN
        && entry.files.iter().all(|file| {
            valid_path(&file.path)
                && paths.insert(file.path.as_str())
                && valid_url(&file.url)
                && file.size <= MAX_FILE
                && file.sha256.len() == 64
                && file
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

pub fn parse(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let catalogue: Catalogue =
        serde_json::from_slice(bytes).map_err(|error| format!("Invalid catalogue: {error}"))?;
    if catalogue.format != 1 {
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
                plugin_sdk::http::download(url, limit).await
            }
            #[cfg(debug_assertions)]
            Self::Local(folder) => {
                let name = url.rsplit('/').next().unwrap_or("");
                if !valid_file_name(name) {
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
mod tests {
    use super::*;

    fn entry(id: &str, files: &[String]) -> String {
        format!(
            r#"{{"id":"{id}","title":"Spike","description":"","icon":"box","version":"1.0.0","api":1,
            "published":"2026-11-09","size":3,"source":"https://github.com/McFck/supadashboard-plugins",
            "guide":"","files":[{}]}}"#,
            files.join(",")
        )
    }

    fn catalogue(entries: &[String]) -> String {
        format!(
            r#"{{"format":1,"published":"2026-11-09","plugins":[{}]}}"#,
            entries.join(",")
        )
    }

    fn file(path: &str, url: &str, sha256: &str, size: u64) -> String {
        format!(r#"{{"path":"{path}","url":"{url}","sha256":"{sha256}","size":{size}}}"#)
    }

    #[test]
    fn nothing_outside_the_plugin_folder_over_http_or_over_the_limits_is_accepted() {
        let sha = "ab".repeat(32);
        let url =
            "https://github.com/McFck/supadashboard-plugins/releases/download/spike-v1/index.js";
        let ok = file("ui/index.js", url, &sha, 3);
        let single = |f: String| catalogue(&[entry("spike", &[f])]);
        let entries = parse(single(ok.clone()).as_bytes()).unwrap();
        assert_eq!(entries[0].files[0].path, "ui/index.js");
        let big = |name: &str, size| file(name, url, &sha, size);
        let bad = [
            single(file("../index.js", url, &sha, 3)),
            single(file("ui/a/b.js", url, &sha, 3)),
            single(file("C:x.js", url, &sha, 3)),
            single(file("ui/index.js", "http://example.com/x", &sha, 3)),
            single(file("ui/index.js", url, &"AB".repeat(32), 3)),
            single(file("ui/index.js", url, &sha[2..], 3)),
            single(big("ui/index.js", MAX_FILE + 1)),
            catalogue(&[entry(
                "spike",
                &[big("a", MAX_FILE), big("b", MAX_FILE), big("c", 1)],
            )]),
            catalogue(&[entry("spike", &[ok.clone(), ok.clone()])]),
            catalogue(&[
                entry("spike", std::slice::from_ref(&ok)),
                entry("spike", std::slice::from_ref(&ok)),
            ]),
            catalogue(&[entry("../spike", std::slice::from_ref(&ok))]),
            single(ok.clone()).replace(r#""format":1"#, r#""format":2"#),
            single(ok.clone()).replace(r#""guide":"""#, r#""guide":"","author":"x""#),
            single(ok.clone()).replace(
                r#""version":"1.0.0""#,
                &format!(r#""version":"{}""#, "1".repeat(33)),
            ),
        ];
        for text in bad {
            assert!(parse(text.as_bytes()).is_err(), "{text}");
        }
    }
}
