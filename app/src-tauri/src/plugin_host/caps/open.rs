//! `open`: a link opened with the app registered for its scheme (`meet://...`), for schemes the plugin declared.
use tauri::State;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, w};

use crate::plugin_host::PluginHost;
use crate::plugin_host::permissions::Permissions;

/// `<declared scheme>:<rest>` of printable ASCII without quotes or backslashes, so ShellExecute sees one URL and
/// never a path or program.
fn check(permissions: &Permissions, url: &str) -> Result<(), String> {
    let (scheme, rest) = url.split_once(':').ok_or("Invalid link")?;
    if !permissions.open.iter().any(|declared| declared == scheme) {
        return Err("This link is not allowed".into());
    }
    if rest.is_empty()
        || url.len() > 2048
        || !rest
            .bytes()
            .all(|b| b.is_ascii_graphic() && !b"\"'`<>\\^|".contains(&b))
    {
        return Err("Invalid link".into());
    }
    Ok(())
}

/// Opens a URL with the user's default handler. Callers pass only URLs they checked or built from checked parts;
/// anything else could start a program.
pub(super) fn open(url: &str) -> Result<(), String> {
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

#[tauri::command]
pub fn plugin_open(host: State<'_, PluginHost>, plugin: String, url: String) -> Result<(), String> {
    check(&host.installed(&plugin)?.manifest.permissions, &url)?;
    open(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_declared_schemes_open_and_nothing_else_reaches_the_shell() {
        let permissions = Permissions {
            open: vec!["meet".into()],
            ..Permissions::default()
        };
        assert_eq!(check(&permissions, "meet://space.example.com/room"), Ok(()));
        for url in [
            "https://evil.com",
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "calc.exe",
            "MEET://x",
            "meet:",
            "meet://x y",
            "meet://x\"y",
            "meet://x\ny",
            "meet://x\\..\\y",
        ] {
            assert!(check(&permissions, url).is_err(), "{url}");
        }
    }
}
