//! Bounded, validated cache of session artwork. Only host-named files inside the cache directory exist,
//! and the webview reaches one only through a handle that the cache issued.
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash as _, Hasher as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const MAX_BYTES: u64 = 1024 * 1024;
const MAX_SIDE: u32 = 2048;
const MAX_ENTRIES: usize = 32;
const MAX_TOTAL: u64 = 32 * 1024 * 1024;
/// An image that left the current sessions stays protected so a cover mid-transition is not deleted.
const OUTGOING_PIN: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Format {
    Png,
    Jpeg,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
        }
    }
}

fn be16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes([
        *bytes.get(at)?,
        *bytes.get(at + 1)?,
    ])))
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([
        *bytes.get(at)?,
        *bytes.get(at + 1)?,
        *bytes.get(at + 2)?,
        *bytes.get(at + 3)?,
    ]))
}

fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const IEND: &[u8] = b"\0\0\0\0IEND\xaeB`\x82";
    if !bytes.starts_with(SIGNATURE) || bytes.get(12..16)? != b"IHDR" || !bytes.ends_with(IEND) {
        return None;
    }
    Some((be32(bytes, 16)?, be32(bytes, 20)?))
}

fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return None;
    }
    let mut at = 2;
    loop {
        while *bytes.get(at)? == 0xff && *bytes.get(at + 1)? == 0xff {
            at += 1;
        }
        if *bytes.get(at)? != 0xff {
            return None;
        }
        let marker = *bytes.get(at + 1)?;
        match marker {
            // Start of frame (not DHT, JPG or DAC): precision byte, then height and width.
            0xc0..=0xcf if !matches!(marker, 0xc4 | 0xc8 | 0xcc) => {
                return Some((be16(bytes, at + 7)?, be16(bytes, at + 5)?));
            }
            0xd0..=0xd7 | 0x01 => at += 2,
            0xd9 | 0xda => return None,
            _ => at += 2 + be16(bytes, at + 2)? as usize,
        }
    }
}

/// Accepts only PNG and JPEG that are complete, within the size limits and, when the source declared a
/// content type, labelled correctly. SVG and every other format are rejected.
fn inspect(bytes: &[u8], declared: &str) -> Result<Format, &'static str> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {
        return Err("artwork size out of range");
    }
    let (format, (width, height)) = if let Some(size) = png_size(bytes) {
        (Format::Png, size)
    } else if let Some(size) = jpeg_size(bytes) {
        (Format::Jpeg, size)
    } else {
        return Err("artwork is not a complete PNG or JPEG");
    };
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err("artwork dimensions out of range");
    }
    let declared = declared.to_ascii_lowercase();
    let matches = match declared.as_str() {
        "" => true,
        "image/png" => format == Format::Png,
        "image/jpeg" | "image/jpg" => format == Format::Jpeg,
        _ => false,
    };
    if matches {
        Ok(format)
    } else {
        Err("artwork content type does not match its bytes")
    }
}

struct Entry {
    handle: String,
    file: PathBuf,
    size: u64,
    used: u64,
}

pub struct ArtworkCache {
    dir: PathBuf,
    entries: Vec<Entry>,
    pins: HashMap<String, Instant>,
    clock: u64,
}

impl ArtworkCache {
    /// Starts empty: files left by a previous run are deleted because nothing can reference them.
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        for item in fs::read_dir(&dir)?.flatten() {
            let _ = fs::remove_file(item.path());
        }
        Ok(Self {
            dir,
            entries: Vec::new(),
            pins: HashMap::new(),
            clock: 0,
        })
    }

    /// Marks the images the current sessions show; they, and ones that just left, are never evicted.
    pub fn pin<'a>(&mut self, current: impl Iterator<Item = &'a str>) {
        let now = Instant::now();
        for handle in current {
            self.pins.insert(handle.to_owned(), now);
        }
        self.pins
            .retain(|_, at| now.duration_since(*at) < OUTGOING_PIN);
    }

    /// The file for an issued handle; anything else (including path-like input) is unknown.
    pub fn path(&self, handle: &str) -> Option<&Path> {
        self.entries
            .iter()
            .find(|entry| entry.handle == handle)
            .map(|entry| entry.file.as_path())
    }

    pub fn insert(&mut self, bytes: &[u8], declared: &str) -> Result<String, String> {
        let format = inspect(bytes, declared).map_err(str::to_owned)?;
        let mut hasher = DefaultHasher::new();
        bytes.hash(&mut hasher);
        let handle = format!("{:016x}", hasher.finish());
        self.clock += 1;
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.handle == handle) {
            entry.used = self.clock;
            return Ok(handle);
        }
        let size = bytes.len() as u64;
        while self.entries.len() >= MAX_ENTRIES
            || self.entries.iter().map(|entry| entry.size).sum::<u64>() + size > MAX_TOTAL
        {
            let oldest = self
                .entries
                .iter()
                .enumerate()
                .filter(|(_, entry)| !self.pins.contains_key(&entry.handle))
                .min_by_key(|(_, entry)| entry.used)
                .map(|(index, _)| index)
                .ok_or("artwork cache is full of pinned images")?;
            let _ = fs::remove_file(&self.entries.remove(oldest).file);
        }
        let file = self.dir.join(format!("{handle}.{}", format.extension()));
        let partial = self.dir.join(format!("{handle}.tmp"));
        fs::write(&partial, bytes)
            .and_then(|()| fs::rename(&partial, &file))
            .map_err(|error| {
                let _ = fs::remove_file(&partial);
                format!("could not cache artwork: {error}")
            })?;
        self.entries.push(Entry {
            handle: handle.clone(),
            file,
            size,
            used: self.clock,
        });
        Ok(handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 2, 0, 0, 0, 0, 0, 0, 0]);
        bytes.extend(b"\0\0\0\0IEND\xaeB`\x82");
        bytes
    }

    fn jpeg(width: u16, height: u16) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8];
        bytes.extend(height.to_be_bytes());
        bytes.extend(width.to_be_bytes());
        bytes.extend([1, 1, 0x11, 0, 0xff, 0xd9]);
        bytes
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("supadashboard-art-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn rejects_images_that_are_unsafe_or_not_what_they_claim() {
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec();
        let truncated_png = png(10, 10)[..30].to_vec();
        let mut truncated_jpeg = jpeg(10, 10);
        truncated_jpeg.pop();
        let cases: [(&[u8], &str); 8] = [
            (&svg, "image/svg+xml"),
            (&svg, ""),
            (&truncated_png, "image/png"),
            (&truncated_jpeg, "image/jpeg"),
            (&png(10, 10), "image/jpeg"),
            (&jpeg(10, 10), "image/png"),
            (&png(2049, 10), "image/png"),
            (&jpeg(10, 0), ""),
        ];
        for (bytes, declared) in cases {
            assert!(inspect(bytes, declared).is_err(), "{declared}");
        }
        assert!(inspect(&vec![0; MAX_BYTES as usize + 1], "").is_err());
        assert_eq!(inspect(&png(2048, 1), "IMAGE/PNG"), Ok(Format::Png));
        assert_eq!(inspect(&jpeg(300, 300), "image/jpeg"), Ok(Format::Jpeg));
    }

    #[test]
    fn serves_only_issued_handles_inside_the_cache_directory() {
        let dir = scratch("confine");
        let mut cache = ArtworkCache::new(dir.clone()).unwrap();
        let handle = cache.insert(&png(4, 4), "image/png").unwrap();
        assert_eq!(cache.insert(&png(4, 4), "").unwrap(), handle);
        assert!(cache.path(&handle).unwrap().starts_with(&dir));
        assert!(cache.path("../settings").is_none());
        assert!(cache.path("0000000000000000").is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn evicts_unpinned_images_but_never_pinned_ones() {
        let dir = scratch("evict");
        let mut cache = ArtworkCache::new(dir.clone()).unwrap();
        let first = cache.insert(&png(1, 1), "").unwrap();
        cache.pin(std::iter::once(first.as_str()));
        for width in 2..=MAX_ENTRIES as u32 {
            cache.insert(&png(width, 1), "").unwrap();
        }
        cache.insert(&png(100, 1), "").unwrap();
        assert!(cache.path(&first).is_some());
        assert_eq!(cache.entries.len(), MAX_ENTRIES);

        let all: Vec<String> = cache
            .entries
            .iter()
            .map(|entry| entry.handle.clone())
            .collect();
        cache.pin(all.iter().map(String::as_str));
        assert!(cache.insert(&png(200, 1), "").is_err());
        assert!(cache.path(&first).is_some());
        let _ = fs::remove_dir_all(dir);
    }
}
