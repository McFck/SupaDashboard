use std::fs;
use std::io::{self, Error, ErrorKind, Write};
use std::path::{Path, PathBuf};

// Only app data: webview profile, caches, logs and window state stay out.
const ENTRIES: [&str; 7] = [
    "settings.json",
    "variables.json",
    "plugins.json",
    "discord.json",
    "spotify.json",
    "icons",
    "lyrics",
];

struct Plan {
    entries: [&'static str; 7],
    backup: PathBuf,
}

fn plan(release: &Path, stamp: &str) -> io::Result<Plan> {
    if stamp.is_empty() || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::other("Invalid backup timestamp"));
    }
    Ok(Plan {
        entries: ENTRIES,
        backup: release.join("backups").join(stamp),
    })
}

// Reject junctions and symlinks: a cache or backup must never reach outside these roots.
fn metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(Error::other("Linked data paths are not supported"));
            }
            Ok(Some(meta))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    let Some(meta) = metadata(source)? else {
        return Ok(());
    };
    if meta.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        fs::copy(source, destination)?;
        fs::OpenOptions::new()
            .write(true)
            .open(destination)?
            .sync_all()?;
    } else {
        return Err(Error::other("Unsupported data file"));
    }
    Ok(())
}

fn copy_data(
    source: &Path,
    destination: &Path,
    entries: &[&str],
    required: bool,
) -> io::Result<()> {
    metadata(source)?;
    for &name in entries {
        let from = source.join(name);
        let to = destination.join(name);
        let source_meta = metadata(&from)?;
        let exists = source_meta.is_some();
        let json = if name.ends_with(".json") && exists {
            let bytes = fs::read(&from)?;
            let value: serde_json::Value = serde_json::from_slice(&bytes)?;
            if !value.is_object() {
                return Err(Error::other("Invalid saved data"));
            }
            Some(bytes)
        } else {
            None
        };
        if matches!(name, "icons" | "lyrics") && source_meta.is_some_and(|meta| !meta.is_dir()) {
            return Err(Error::other("Invalid cache folder"));
        }
        if required && name == "settings.json" && !exists {
            return Err(Error::other("No saved dev settings"));
        }
        if let Some(meta) = metadata(&to)? {
            if meta.is_dir() {
                fs::remove_dir_all(&to)?;
            } else {
                fs::remove_file(&to)?;
            }
        }
        if let Some(bytes) = json {
            let mut file = fs::File::create(&to)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        } else {
            copy_tree(&from, &to)?;
        }
    }
    Ok(())
}

pub(super) fn seed(release: &Path, dev: &Path) -> io::Result<()> {
    if let Some(meta) = metadata(dev)? {
        if !meta.is_dir() {
            return Err(Error::other("Invalid dev data directory"));
        }
        if fs::read_dir(dev)?.next().transpose()?.is_some() {
            return Ok(());
        }
        fs::remove_dir(dev)?;
    }
    let stage = dev.with_extension(format!("seed-{}", std::process::id()));
    fs::create_dir(&stage)?;
    let result = copy_data(release, &stage, &ENTRIES, false).and_then(|()| fs::rename(&stage, dev));
    if result.is_err() {
        fs::remove_dir_all(&stage)?;
    }
    result
}

// A same-volume rename replaces a file atomically; a folder is swapped by removing the old one first.
fn replace_entry(stage: &Path, release: &Path, name: &str) -> io::Result<()> {
    let from = stage.join(name);
    let to = release.join(name);
    if metadata(&to)?.is_some_and(|meta| meta.is_dir()) {
        fs::remove_dir_all(&to)?;
    }
    if metadata(&from)?.is_some() {
        fs::rename(&from, &to)
    } else if metadata(&to)?.is_some() {
        fs::remove_file(&to)
    } else {
        Ok(())
    }
}

pub(super) fn export(
    dev: &Path,
    release: &Path,
    stamp: &str,
    stopped: impl Fn() -> Result<(), String>,
) -> io::Result<()> {
    let plan = plan(release, stamp)?;
    let stage = release.with_extension(format!("copy-{stamp}"));
    fs::create_dir(&stage)?;
    let result = (|| {
        copy_data(dev, &stage, &plan.entries, true)?;
        stopped().map_err(Error::other)?;
        fs::create_dir_all(&plan.backup)?;
        for name in plan.entries {
            copy_tree(&release.join(name), &plan.backup.join(name))?;
        }
        for name in plan.entries {
            replace_entry(&stage, release, name)?;
        }
        Ok(())
    })();
    if stage.exists() {
        fs::remove_dir_all(&stage)?;
    }
    result
}

#[cfg(test)]
mod tests;
