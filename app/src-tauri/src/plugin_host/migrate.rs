//! One-time move of a plugin's files from the app data root (where the in-app version kept them) into the
//! plugin's own data folder. The copy lands under a temporary name, is compared byte for byte with the original
//! and only then renamed into place; a marker then records the entry as done, so data the plugin later deletes
//! (a sign-out) is never brought back. Originals stay where they were.
use std::fs;
use std::io;
use std::path::Path;

pub fn migrate(legacy: &Path, data: &Path, names: &[String]) -> io::Result<()> {
    fs::create_dir_all(data)?;
    for name in names {
        let marker = data.join(format!(".migrated-{name}"));
        if marker.exists() {
            continue;
        }
        let (from, to) = (legacy.join(name), data.join(name));
        if from.exists() && !to.exists() {
            let partial = data.join(format!("{name}.migrating"));
            remove(&partial)?;
            copy(&from, &partial)?;
            if !same(&from, &partial)? {
                remove(&partial)?;
                return Err(io::Error::other(format!("Copy of {name} differs")));
            }
            fs::rename(&partial, &to)?;
        }
        fs::write(marker, [])?;
    }
    Ok(())
}

fn remove(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn copy(from: &Path, to: &Path) -> io::Result<()> {
    if !from.is_dir() {
        return fs::copy(from, to).map(|_| ());
    }
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        copy(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

fn same(a: &Path, b: &Path) -> io::Result<bool> {
    if !a.is_dir() {
        return Ok(!b.is_dir() && fs::read(a)? == fs::read(b)?);
    }
    let names = |dir: &Path| -> io::Result<Vec<_>> {
        let mut names = fs::read_dir(dir)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<io::Result<Vec<_>>>()?;
        names.sort();
        Ok(names)
    };
    let entries = names(a)?;
    if !b.is_dir() || entries != names(b)? {
        return Ok(false);
    }
    for name in entries {
        if !same(&a.join(&name), &b.join(&name))? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_moves_once_and_a_later_deletion_is_not_undone() {
        let root = std::env::temp_dir().join(format!("supa-migrate-{}", std::process::id()));
        let (legacy, data) = (root.join("legacy"), root.join("plugin-data"));
        fs::create_dir_all(legacy.join("lyrics")).unwrap();
        fs::write(legacy.join("store.json"), b"\x01dpapi blob\xff").unwrap();
        fs::write(legacy.join("lyrics/a.json"), b"{}").unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("store.json.migrating"), b"half").unwrap();
        let names = ["store.json".into(), "lyrics".into(), "absent.json".into()];

        migrate(&legacy, &data, &names).unwrap();
        assert_eq!(
            fs::read(data.join("store.json")).unwrap(),
            b"\x01dpapi blob\xff"
        );
        assert_eq!(fs::read(data.join("lyrics/a.json")).unwrap(), b"{}");
        assert!(legacy.join("store.json").exists(), "the original is kept");
        assert!(!data.join("store.json.migrating").exists());

        fs::remove_file(data.join("store.json")).unwrap();
        fs::write(legacy.join("absent.json"), b"late").unwrap();
        migrate(&legacy, &data, &names).unwrap();
        assert!(
            !data.join("store.json").exists(),
            "a signed-out store came back"
        );
        assert!(!data.join("absent.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
