//! A `.sdplugin` file: an uncompressed ustar archive of regular files, written by `plugin-tools/release.mjs`. It holds
//! `plugin.json`, the `release.json` + `release.sig` pair when signed, `ui/*` and `assets/**`. The file is opened
//! without write or delete sharing before anything in it is checked and stays open while installed, so the bytes the
//! plugin scheme serves are the ones that were checked, and the file cannot be replaced underneath.
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::os::windows::fs::{FileExt, OpenOptionsExt};
use std::path::Path;

/// A whole plugin, sound packs included.
pub const MAX_PLUGIN: u64 = 256 << 20;
const FILE_SHARE_READ: u32 = 1;
const BLOCK: u64 = 512;

pub struct Archive {
    file: File,
    length: u64,
    /// Entry name to (offset, size) in bytes.
    index: BTreeMap<String, (u64, u64)>,
}

/// `/`-separated segments of `[A-Za-z0-9._-]`, none empty or starting with `.`; ustar names hold 99 bytes.
pub(super) fn valid_entry_name(path: &str) -> bool {
    path.len() <= 99
        && path.split('/').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('.')
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
}

/// The layout of a plugin: the manifest and release pair at the top, the UI bundle in `ui/`, static files in `assets/`.
pub(super) fn allowed(name: &str) -> bool {
    matches!(name, "plugin.json" | "release.json" | "release.sig")
        || name
            .strip_prefix("ui/")
            .is_some_and(|rest| !rest.contains('/'))
        || name.starts_with("assets/")
}

fn read_at(file: &File, offset: u64, buffer: &mut [u8]) -> Result<(), String> {
    let mut done = 0;
    while done < buffer.len() {
        match file.seek_read(&mut buffer[done..], offset + done as u64) {
            Ok(0) => return Err("Plugin file is truncated".into()),
            Ok(read) => done += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(error) => return Err(format!("Plugin file: {error}")),
        }
    }
    Ok(())
}

/// A NUL- or space-padded octal header field.
fn octal(field: &[u8]) -> Option<u64> {
    let digits = field
        .iter()
        .take_while(|b| **b != 0 && **b != b' ')
        .map(|b| (*b as char).to_digit(8).map(u64::from))
        .collect::<Option<Vec<_>>>()?;
    (!digits.is_empty()).then(|| digits.into_iter().fold(0, |value, digit| value * 8 + digit))
}

fn index(file: &File, length: u64) -> Result<BTreeMap<String, (u64, u64)>, String> {
    let invalid = |why: &str| format!("Invalid plugin file: {why}");
    let mut index = BTreeMap::new();
    let mut offset = 0;
    let mut header = [0u8; BLOCK as usize];
    loop {
        if offset + BLOCK > length {
            return Err(invalid("no end marker"));
        }
        read_at(file, offset, &mut header)?;
        if header.iter().all(|b| *b == 0) {
            return Ok(index);
        }
        let name_end = header[..100].iter().position(|b| *b == 0).unwrap_or(100);
        let name = std::str::from_utf8(&header[..name_end])
            .ok()
            .filter(|name| valid_entry_name(name) && allowed(name))
            .ok_or_else(|| invalid("unexpected entry"))?;
        // Only regular files; a ustar prefix would extend the name past what was validated.
        if !matches!(header[156], b'0' | 0) || header[345..500].iter().any(|b| *b != 0) {
            return Err(invalid(&format!("{name} is not a plain file")));
        }
        let size = octal(&header[124..136]).ok_or_else(|| invalid("invalid size"))?;
        let data = offset + BLOCK;
        let end = data
            .checked_add(size)
            .filter(|end| *end <= length)
            .ok_or_else(|| invalid(&format!("{name} runs past the end")))?;
        if index.insert(name.to_owned(), (data, size)).is_some() {
            return Err(invalid(&format!("{name} is listed twice")));
        }
        offset = end.div_ceil(BLOCK) * BLOCK;
    }
}

impl Archive {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(path)
            .map_err(|e| format!("Could not open plugin file: {e}"))?;
        let length = file
            .metadata()
            .map_err(|e| format!("Plugin file: {e}"))?
            .len();
        if length > MAX_PLUGIN {
            return Err("Plugin is too large".into());
        }
        let index = index(&file, length)?;
        Ok(Self {
            file,
            length,
            index,
        })
    }

    /// Bytes on disk.
    pub fn size(&self) -> u64 {
        self.length
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.index.keys().map(String::as_str)
    }

    pub fn has(&self, name: &str) -> bool {
        self.index.contains_key(name)
    }

    /// The entry's bytes; `None` when there is no such entry or it cannot be read.
    pub fn read(&self, name: &str) -> Option<Vec<u8>> {
        let (offset, size) = *self.index.get(name)?;
        let mut bytes = vec![0; usize::try_from(size).ok()?];
        read_at(&self.file, offset, &mut bytes).ok()?;
        Some(bytes)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::fs;

    /// A ustar entry as `release.mjs` writes it; `kind` and `name` are free so tests can break them.
    pub fn entry(name: &str, kind: u8, data: &[u8]) -> Vec<u8> {
        let mut header = vec![0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[124..135].copy_from_slice(format!("{:011o}", data.len()).as_bytes());
        header[156] = kind;
        header[257..263].copy_from_slice(b"ustar\0");
        let mut bytes = [header, data.to_vec()].concat();
        bytes.resize(bytes.len().div_ceil(512) * 512, 0);
        bytes
    }

    /// The bytes of an archive holding `files` as plain entries.
    pub fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut bytes: Vec<u8> = files
            .iter()
            .flat_map(|(name, data)| entry(name, b'0', data))
            .collect();
        bytes.extend([0; 1024]);
        bytes
    }

    /// A fresh path in the temp folder.
    pub fn temp(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("supa-{name}-{}-{unique}", std::process::id()))
    }

    /// Writes the bytes as a file, opens it and hands it to `check` before cleaning up.
    fn open(bytes: &[u8], check: impl FnOnce(&Archive)) -> Result<(), String> {
        let path = temp("archive");
        fs::write(&path, bytes).unwrap();
        let opened = Archive::open(&path).map(|archive| {
            assert!(
                fs::write(&path, b"changed").is_err(),
                "the archive can be rewritten while it is open"
            );
            assert!(
                fs::rename(&path, path.with_extension("moved")).is_err(),
                "the archive can be moved while it is open"
            );
            check(&archive);
        });
        fs::remove_file(&path).unwrap();
        opened
    }

    #[test]
    fn only_plain_files_inside_the_archive_under_safe_names_and_the_plugin_layout_are_read() {
        let good = entry("assets/lines/a.json", b'0', b"{}");
        let script = entry("ui/index.js", b'0', &[7; 600]);
        let served = open(&[script, good.clone(), vec![0; 1024]].concat(), |archive| {
            assert_eq!(archive.read("ui/index.js"), Some(vec![7; 600]));
            assert_eq!(archive.read("assets/lines/a.json"), Some(b"{}".to_vec()));
            for missing in ["assets/lines", "../ui/index.js", "assets/../ui/index.js"] {
                assert_eq!(archive.read(missing), None, "{missing}");
            }
        });
        assert!(served.is_ok());

        let mut runs_past = entry("assets/x.json", b'0', b"{}");
        runs_past[124..135].copy_from_slice(format!("{:011o}", 1 << 20).as_bytes());
        let mut prefixed = entry("assets/a.json", b'0', b"{}");
        prefixed[345] = b'x';
        let bad = [
            entry("../up.json", b'0', b""),
            entry("/root.json", b'0', b""),
            entry("assets/a\\b.json", b'0', b""),
            entry("assets/.hidden", b'0', b""),
            entry("assets//b.json", b'0', b""),
            entry("helper.dll", b'0', b""),
            entry("ui/nested/a.js", b'0', b""),
            entry("assets/link", b'2', b""),
            entry("assets/dir", b'5', b""),
            good.clone(),
            prefixed,
            runs_past,
        ];
        for broken in bad {
            let bytes = [good.clone(), broken, vec![0; 1024]].concat();
            assert!(open(&bytes, |_| {}).is_err());
        }
        assert!(open(&good, |_| {}).is_err(), "no end");
    }
}
