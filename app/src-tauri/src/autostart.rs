//! Start with Windows: the current user's Run key names this exe. The key is the only record, so the setting
//! follows what Windows will actually do, also after the user removes the entry in Task Manager.
use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
use windows::Win32::System::Registry::{
    HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW,
};
use windows::core::{HSTRING, w};

/// Debug builds register under their own name, so a dev build never replaces the release app's entry.
const NAME: &str = if cfg!(debug_assertions) {
    "SupaDashboard Dev"
} else {
    "SupaDashboard"
};

/// The Run value for this exe; quoted, as the path may contain spaces.
fn command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("\"{}\"", exe.display()))
}

fn registered() -> Option<String> {
    let mut buffer = [0u16; 2048];
    let mut bytes = std::mem::size_of_val(&buffer) as u32;
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Run"),
            &HSTRING::from(NAME),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
        .ok()
        .ok()?;
    }
    let end = buffer.iter().position(|unit| *unit == 0)?;
    String::from_utf16(&buffer[..end]).ok()
}

/// On only when the entry starts this exe; an entry left by a moved or older install counts as off.
#[tauri::command]
pub fn autostart_get() -> Result<bool, String> {
    Ok(registered().is_some_and(|value| Ok(value) == command()))
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> Result<(), String> {
    let name = HSTRING::from(NAME);
    let key = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
    let status = if enabled {
        let value: Vec<u16> = command()?.encode_utf16().chain([0]).collect();
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key,
                &name,
                REG_SZ.0,
                Some(value.as_ptr().cast()),
                (value.len() * 2) as u32,
            )
        }
    } else {
        match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key, &name) } {
            // Already off.
            ERROR_FILE_NOT_FOUND => return Ok(()),
            status => status,
        }
    };
    status.ok().map_err(|error| error.message())
}
