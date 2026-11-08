//! Shell icons for app identities resolved by this module; never a caller-supplied image path.
use super::{icon_store, identity, model::parse_key};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use windows::Win32::Foundation::{GENERIC_READ, HGLOBAL, SIZE};
use windows::Win32::Graphics::Gdi::{DeleteObject, HPALETTE};
use windows::Win32::Graphics::Imaging::*;
use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, IPropertyBag2};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, CoCreateInstance, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::UI::Shell::{
    ExtractIconExW, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
    SIIGBF_ICONONLY,
};
use windows::core::HSTRING;

#[derive(Default)]
struct Cache {
    allowed: HashSet<String>,
    images: HashMap<String, Option<Vec<u8>>>,
}
static ICONS: OnceLock<Mutex<Cache>> = OnceLock::new();

pub fn allow(key: &str) {
    ICONS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap()
        .allowed
        .insert(key.to_owned());
}

pub fn get(dir: &Path, key: &str, refresh: bool) -> Result<Option<Vec<u8>>, String> {
    parse_key(key)?;
    let mut cache = ICONS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|e| e.to_string())?;
    if !refresh && let Some(bytes) = cache.images.get(key) {
        return Ok(bytes.clone());
    }
    let saved = icon_store::read(dir, key)?;
    if !refresh && saved.is_some() {
        cache.images.insert(key.to_owned(), saved.clone());
        return Ok(saved);
    }
    if !cache.allowed.contains(key) {
        drop(cache);
        identity::matcher(&parse_key(key)?)?;
        return get(dir, key, refresh);
    }
    identity::init_com();
    let path = match parse_key(key)? {
        super::model::Key::Exe(path) => path.replace('/', "\\"),
        super::model::Key::Aumid(id) => format!("shell:AppsFolder\\{id}"),
    };
    // Missing artwork is harmless: the picker keeps its brand or neutral icon.
    let bytes = shell_png(&path).ok();
    if let Some(bytes) = &bytes {
        icon_store::write(dir, key, bytes)?;
    } else if refresh {
        return Err("Could not extract app icon".into());
    }
    // Evicts an arbitrary entry: HashMap keys have no age order.
    if cache.images.len() >= 256
        && let Some(any) = cache.images.keys().next().cloned()
    {
        cache.images.remove(&any);
    }
    cache.images.insert(key.to_owned(), bytes.clone());
    Ok(bytes)
}

fn shell_png(path: &str) -> windows::core::Result<Vec<u8>> {
    let factory: IWICImagingFactory =
        unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }?;
    if path.to_lowercase().ends_with(".exe")
        && unsafe { ExtractIconExW(&HSTRING::from(path), -1, None, None, 0) } == 0
    {
        for icon in super::steam::icons(path) {
            let decoded = unsafe {
                factory.CreateDecoderFromFilename(
                    &HSTRING::from(icon.to_string_lossy().as_ref()),
                    None,
                    GENERIC_READ,
                    WICDecodeMetadataCacheOnLoad,
                )
            };
            if let Ok(frame) = decoded.and_then(|decoder| unsafe { decoder.GetFrame(0) }) {
                let (mut width, mut height) = (0, 0);
                if unsafe { frame.GetSize(&mut width, &mut height) }.is_ok()
                    && width > 0
                    && width <= 512
                    && width == height
                {
                    return encode(&factory, &frame.into());
                }
            }
        }
        return Err(windows::core::Error::from_thread());
    }
    let item: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(&HSTRING::from(path), None) }?;
    let bitmap = unsafe {
        item.GetImage(
            SIZE { cx: 256, cy: 256 },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        )
    }?;
    let result = unsafe {
        factory.CreateBitmapFromHBITMAP(bitmap, HPALETTE::default(), WICBitmapUsePremultipliedAlpha)
    }
    .and_then(|source| encode(&factory, &source.into()));
    let _ = unsafe { DeleteObject(bitmap.into()) };
    result
}

fn encode(
    factory: &IWICImagingFactory,
    source: &IWICBitmapSource,
) -> windows::core::Result<Vec<u8>> {
    unsafe {
        let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
        let encoder = factory.CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())?;
        encoder.Initialize(&stream, WICBitmapEncoderNoCache)?;
        let mut frame = None;
        encoder.CreateNewFrame(&mut frame, std::ptr::null_mut())?;
        let frame = frame.ok_or_else(windows::core::Error::from_thread)?;
        frame.Initialize(None::<&IPropertyBag2>)?;
        frame.WriteSource(source, std::ptr::null())?;
        frame.Commit()?;
        encoder.Commit()?;
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME)?;
        if stat.cbSize > 1024 * 1024 {
            return Err(windows::core::Error::from_thread());
        }
        let mut bytes = vec![0; stat.cbSize as usize];
        stream.Seek(0, STREAM_SEEK_SET, None)?;
        let mut read = 0;
        stream
            .Read(
                bytes.as_mut_ptr().cast(),
                bytes.len() as u32,
                Some(&mut read),
            )
            .ok()?;
        bytes.truncate(read as usize);
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn refuses_unresolved_paths_and_non_app_files() {
        for key in [
            "exe:C:\\secret.png",
            "exe:C:\\unresolved.exe",
            "aumid:unresolved-icon-test",
            "../settings.json",
        ] {
            assert!(
                super::get(
                    &std::env::temp_dir().join("supa-unresolved-icons"),
                    key,
                    false
                )
                .is_err()
            );
        }
    }
}
