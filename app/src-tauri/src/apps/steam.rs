//! Steam library artwork for an executable with no embedded icon.
use std::path::{Path, PathBuf};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};
use windows::core::w;

fn field<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let mut quoted = text.split('"').skip(1).step_by(2);
    while let Some(key) = quoted.next() {
        if key == name {
            return quoted.next();
        }
    }
    None
}

fn app_id(manifest: &str, folder: &str) -> Option<String> {
    if !field(manifest, "installdir")?.eq_ignore_ascii_case(folder) {
        return None;
    }
    let id = field(manifest, "appid")?;
    (!id.is_empty() && id.len() <= 10 && id.bytes().all(|c| c.is_ascii_digit()))
        .then(|| id.to_owned())
}

fn steam_root() -> Option<PathBuf> {
    let mut buffer = [0u16; 1024];
    let mut bytes = std::mem::size_of_val(&buffer) as u32;
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Valve\\Steam"),
            w!("SteamPath"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
        .ok()
        .ok()?;
    }
    let end = buffer.iter().position(|c| *c == 0)?;
    let root = PathBuf::from(String::from_utf16(&buffer[..end]).ok()?);
    root.is_absolute().then_some(root)
}

pub fn icons(exe: &str) -> Vec<PathBuf> {
    let Some(game) = Path::new(exe).ancestors().find(|path| {
        path.parent().is_some_and(|p| {
            p.file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("common"))
                && p.parent().is_some_and(|p| {
                    p.file_name()
                        .is_some_and(|n| n.eq_ignore_ascii_case("steamapps"))
                })
        })
    }) else {
        return Vec::new();
    };
    let Some((folder, manifests)) = game
        .file_name()
        .and_then(|n| n.to_str())
        .zip(game.parent().and_then(Path::parent))
    else {
        return Vec::new();
    };
    let id = std::fs::read_dir(manifests)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .find_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if !name.starts_with("appmanifest_")
                || !name.ends_with(".acf")
                || entry.metadata().ok()?.len() > 128 * 1024
            {
                return None;
            }
            app_id(&std::fs::read_to_string(entry.path()).ok()?, folder)
        });
    let Some(cache) = steam_root()
        .zip(id)
        .map(|(root, id)| root.join("appcache/librarycache").join(id))
    else {
        return Vec::new();
    };
    std::fs::read_dir(cache)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let stem = path.file_stem()?.to_str()?;
            (stem.len() == 40
                && stem.bytes().all(|c| c.is_ascii_hexdigit())
                && path.extension()? == "jpg"
                && entry.metadata().ok()?.len() <= 1024 * 1024)
                .then_some(path)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn library_metadata_cannot_redirect_icon_reads_outside_the_cache() {
        assert_eq!(
            super::app_id(
                "\"AppState\" { \"appid\" \"123\" \"installdir\" \"Game\" }",
                "game"
            ),
            Some("123".into())
        );
        for id in ["../secret", "", "1/2", "12345678901"] {
            assert!(
                super::app_id(
                    &format!("\"appid\" \"{id}\" \"installdir\" \"Game\""),
                    "game"
                )
                .is_none()
            );
        }
        assert!(super::app_id("\"appid\" \"123\" \"installdir\" \"Other\"", "game").is_none());
    }
}
