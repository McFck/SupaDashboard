//! Who an app is: process names, package ids, Start-menu entries, and the rule that matches a process to a key.
use super::model::{Key, slug};
use crate::audio::model::normalize_target;
use std::collections::HashMap;
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY};
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItem2, KF_FLAG_DEFAULT,
    SHCreateItemFromParsingName, SHGetKnownFolderItem, SIGDN_NORMALDISPLAY,
    SIGDN_PARENTRELATIVEPARSING,
};
use windows::core::{GUID, HSTRING, Interface, PWSTR};

/// `PKEY_Link_TargetParsingPath`: the file a Start-menu shortcut runs.
const LINK_TARGET: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25),
    pid: 2,
};

/// Shell items need COM on the calling thread. A thread that already chose another model keeps it.
pub fn init_com() {
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
}

/// The full image path of a running process.
pub fn image_path(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
    let mut buffer = [0u16; 1024];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..length as usize]))
}

pub fn package_aumid(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
    let mut buffer = [0u16; 130];
    let mut length = buffer.len() as u32;
    let status =
        unsafe { GetApplicationUserModelId(handle, &mut length, Some(PWSTR(buffer.as_mut_ptr()))) };
    let _ = unsafe { CloseHandle(handle) };
    // A plain desktop process has no package: the call fails and that is the answer.
    (status.0 == 0 && length > 1).then(|| String::from_utf16_lossy(&buffer[..length as usize - 1]))
}

/// Process names and package ids by pid, for one pass: a reused pid must be looked up again, so never keep it longer.
#[derive(Default)]
pub struct Names {
    names: HashMap<u32, Option<String>>,
    aumids: HashMap<u32, Option<String>>,
}

impl Names {
    pub fn name(&mut self, pid: u32) -> Option<&str> {
        self.names
            .entry(pid)
            .or_insert_with(|| {
                image_path(pid).and_then(|path| path.rsplit('\\').next().map(normalize_target))
            })
            .as_deref()
    }

    fn aumid(&mut self, pid: u32) -> Option<&str> {
        self.aumids
            .entry(pid)
            .or_insert_with(|| package_aumid(pid))
            .as_deref()
    }
}

/// Decides which processes belong to one app. The process name wins when the key has one, because
/// Squirrel apps (Discord) change their install path with every update; packaged apps match by package id.
#[derive(Clone, Debug)]
pub struct Matcher {
    pub key: String,
    pub slug: String,
    /// Normalized image name (lowercase, no `.exe`).
    pub exe: Option<String>,
    pub aumid: Option<String>,
    pub label: String,
}

impl Matcher {
    pub fn matches(&self, names: &mut Names, pid: u32) -> bool {
        if let Some(exe) = &self.exe {
            return names.name(pid) == Some(exe.as_str());
        }
        match (&self.aumid, names.aumid(pid)) {
            (Some(wanted), Some(found)) => wanted.eq_ignore_ascii_case(found),
            _ => false,
        }
    }
}

fn exe_name(path: &str) -> Option<String> {
    let file = path.rsplit('\\').next()?;
    file.to_lowercase()
        .ends_with(".exe")
        .then(|| normalize_target(file))
}

fn apps_folder_item(id: &str) -> windows::core::Result<IShellItem2> {
    let path = HSTRING::from(format!("shell:AppsFolder\\{id}"));
    unsafe { SHCreateItemFromParsingName(&path, None::<&windows::Win32::System::Com::IBindCtx>) }
}

fn take_string(text: PWSTR) -> String {
    let value = unsafe { text.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(text.0 as *const c_void)) };
    value
}

fn link_target(item: &IShellItem2) -> Option<String> {
    let text = unsafe { item.GetString(&LINK_TARGET).ok()? };
    Some(take_string(PWSTR(text.0)))
}

/// The variable name of a Start-menu app: its program's name, else the last part of its package id.
pub fn aumid_slug(id: &str, exe: Option<&str>) -> String {
    slug(exe.unwrap_or_else(|| {
        id.split('!')
            .next()
            .unwrap_or(id)
            .rsplit(['.', '_'])
            .next()
            .unwrap_or(id)
    }))
}

/// Turns a key into a matcher. This is where an unknown Start-menu id or a missing file is refused.
pub fn matcher(key: &Key) -> Result<Matcher, String> {
    let resolved = match key {
        Key::Exe(path) => {
            if !std::path::Path::new(path).is_file() {
                return Err("The app file was not found".into());
            }
            let exe = exe_name(path).ok_or("The app path must be an .exe")?;
            Ok::<_, String>(Matcher {
                key: format!("exe:{path}"),
                slug: slug(&exe),
                label: exe.clone(),
                exe: Some(exe),
                aumid: None,
            })
        }
        Key::Aumid(id) => {
            init_com();
            let item =
                apps_folder_item(id).map_err(|_| "The app was not found in the Start menu")?;
            let exe = link_target(&item).and_then(|target| exe_name(&target));
            let label = unsafe { item.GetDisplayName(SIGDN_NORMALDISPLAY) }
                .map(take_string)
                .unwrap_or_else(|_| id.clone());
            Ok(Matcher {
                key: format!("aumid:{id}"),
                slug: aumid_slug(id, exe.as_deref()),
                exe,
                aumid: Some(id.clone()),
                label,
            })
        }
    }?;
    super::icons::allow(&resolved.key);
    Ok(resolved)
}

/// One Start-menu entry.
pub struct Installed {
    pub key: String,
    pub label: String,
    pub slug: String,
    /// Normalized image name of its target; absent for packaged apps.
    pub exe: Option<String>,
    pub aumid: String,
}

pub fn installed() -> Result<Vec<Installed>, String> {
    init_com();
    let folder: IShellItem =
        unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) }
            .map_err(|error| error.to_string())?;
    let items: IEnumShellItems = unsafe { folder.BindToHandler(None, &BHID_EnumItems) }
        .map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    loop {
        let mut next = [None];
        let mut fetched = 0;
        if unsafe { items.Next(&mut next, Some(&mut fetched)) }.is_err() || fetched == 0 {
            break;
        }
        let Some(Ok(item)) = next[0].take().map(|item| item.cast::<IShellItem2>()) else {
            continue;
        };
        let (Ok(aumid), Ok(label)) = (
            unsafe { item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING) }.map(take_string),
            unsafe { item.GetDisplayName(SIGDN_NORMALDISPLAY) }.map(take_string),
        ) else {
            continue;
        };
        let exe = link_target(&item).and_then(|target| exe_name(&target));
        out.push(Installed {
            key: format!("aumid:{aumid}"),
            label,
            slug: aumid_slug(&aumid, exe.as_deref()),
            exe,
            aumid,
        });
    }
    Ok(out)
}
