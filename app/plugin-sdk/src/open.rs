//! Opens a URL with the user's default handler (browser, or the app registered for a scheme like `meet:`).
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, w};

/// Callers pass only URLs they built from validated parts; anything else could start a program.
pub fn open(url: &str) -> Result<(), String> {
    // SAFETY: both strings are valid, NUL-terminated and outlive the call.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success as a value above 32.
    if result.0 as usize > 32 {
        Ok(())
    } else {
        Err("Could not open the link".into())
    }
}
