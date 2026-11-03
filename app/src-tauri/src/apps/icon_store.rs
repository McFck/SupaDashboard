//! Persistent PNGs addressed only by validated app keys, never WebView paths.
use super::model::parse_key;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn path(dir: &Path, key: &str) -> Result<PathBuf, String> {
    parse_key(key)?;
    // FNV-1a keeps filenames stable across Rust/toolchain upgrades.
    let hash = key.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    Ok(dir.join(format!("{hash:016x}.png")))
}

pub fn validate(bytes: &[u8]) -> Result<(), String> {
    let invalid = || "Invalid app icon PNG".to_owned();
    if bytes.len() > 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid());
    }
    let mut at = 8;
    let mut data = false;
    while at + 12 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let end = at + 12 + length;
        if end > bytes.len() {
            return Err(invalid());
        }
        let kind = &bytes[at + 4..at + 8];
        if at == 8 {
            if kind != b"IHDR" || length != 13 {
                return Err(invalid());
            }
            for offset in [16, 20] {
                let side = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap());
                if side == 0 || side > 512 {
                    return Err(invalid());
                }
            }
        } else if kind == b"IHDR" {
            return Err(invalid());
        }
        data |= kind == b"IDAT" && length > 0;
        if kind == b"IEND" {
            return if length == 0 && data && end == bytes.len() {
                Ok(())
            } else {
                Err(invalid())
            };
        }
        at = end;
    }
    Err(invalid())
}

pub fn read(dir: &Path, key: &str) -> Result<Option<Vec<u8>>, String> {
    let file = match File::open(path(dir, key)?) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    validate(&bytes)?;
    Ok(Some(bytes))
}

pub fn write(dir: &Path, key: &str, bytes: &[u8]) -> Result<(), String> {
    let file = path(dir, key)?;
    validate(bytes)?;
    // Even refresh must preserve an existing file that cannot be read and validated.
    read(dir, key)?;
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let partial = file.with_extension("tmp");
    let result = (|| {
        let mut output = File::create(&partial)?;
        output.write_all(bytes)?;
        output.sync_all()?;
        drop(output);
        fs::rename(&partial, &file)
    })();
    result.map_err(|error| {
        let _ = fs::remove_file(&partial);
        error.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend(16u32.to_be_bytes());
        bytes.extend(16u32.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes.extend(b"\0\0\0\x01IDAT\0\0\0\0\0\0\0\0\0IEND\xaeB`\x82");
        bytes
    }

    #[test]
    fn confines_keys_and_rejects_unsafe_bytes() {
        let dir = Path::new("icons");
        assert!(read(dir, "../settings.json").is_err());
        assert!(read(dir, "exe:C:\\secret.png").is_err());
        assert!(validate(&png()).is_ok());
        for bytes in [
            b"<svg/>".to_vec(),
            png()[..30].to_vec(),
            vec![0; 1024 * 1024 + 1],
        ] {
            assert!(validate(&bytes).is_err());
        }
        let mut oversized = png();
        oversized[16..20].copy_from_slice(&513u32.to_be_bytes());
        assert!(validate(&oversized).is_err());
    }

    #[test]
    fn persists_replaces_and_preserves_unreadable_icons() {
        let dir = std::env::temp_dir().join(format!("supa-icons-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let key = "aumid:cache-test";
        let file = path(&dir, key).unwrap();
        let _ = fs::remove_file(&file);
        assert_eq!(read(&dir, key).unwrap(), None);
        write(&dir, key, &png()).unwrap();
        assert_eq!(read(&dir, key).unwrap(), Some(png()));
        let mut next = png();
        next[19] = 32;
        write(&dir, key, &next).unwrap();
        assert_eq!(read(&dir, key).unwrap(), Some(next));
        fs::write(&file, b"unreadable PNG").unwrap();
        assert!(write(&dir, key, &png()).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"unreadable PNG");
        fs::remove_dir_all(dir).unwrap();
    }
}
