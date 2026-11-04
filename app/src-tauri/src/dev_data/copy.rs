use std::fs;
use std::io::{self, Error, ErrorKind, Write};
use std::path::{Path, PathBuf};

const ENTRIES: [&str; 4] = ["settings.json", "variables.json", "plugins.json", "icons"];

struct Plan {
    entries: [&'static str; 4],
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
        if name == "icons" && source_meta.is_some_and(|meta| !meta.is_dir()) {
            return Err(Error::other("Invalid icons cache"));
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

pub(super) fn export(
    dev: &Path,
    release: &Path,
    stamp: &str,
    stopped: impl Fn() -> Result<(), String>,
) -> io::Result<()> {
    let plan = plan(release, stamp)?;
    let stage = release.with_extension(format!("copy-{stamp}"));
    let old = release.with_extension(format!("previous-{stamp}"));
    fs::create_dir(&stage)?;
    let result = (|| {
        copy_tree(release, &stage)?;
        let backup = stage.join(plan.backup.strip_prefix(release).map_err(Error::other)?);
        fs::create_dir_all(stage.join("backups"))?;
        fs::create_dir(&backup)?;
        if metadata(release)?.is_some() {
            for entry in fs::read_dir(release)? {
                let entry = entry?;
                if entry.file_name() != "backups" {
                    copy_tree(&entry.path(), &backup.join(entry.file_name()))?;
                }
            }
        }
        copy_data(dev, &stage, &plan.entries, true)?;
        stopped().map_err(Error::other)?;
        let had_release = metadata(release)?.is_some();
        super::publish::publish(&stage, release, &old, had_release)?;
        if had_release {
            // The published backup already owns these bytes; leftover staging data is harmless.
            if let Err(error) = fs::remove_dir_all(&old) {
                log::warn!("Could not remove {}: {error}", old.display());
            }
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
