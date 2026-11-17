//! PC sleep and shutdown: runs the plugins' armed `onPowerOff` commands. Windows tells every top-level window, a
//! hidden one included (a message-only window hears no broadcasts), before it suspends or ends the session; the
//! commands run then, while the PC still waits.
use std::os::windows::process::CommandExt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::CREATE_NO_WINDOW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, PBT_APMSUSPEND,
    RegisterClassW, WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST, WM_QUERYENDSESSION,
    WNDCLASSW,
};
use windows::core::w;

use super::PluginHost;

/// How long the PC is held for the commands.
const WAIT: Duration = Duration::from_millis(1500);

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Runs every armed command in parallel and waits for them up to 1.5 s; one still running then is left to finish.
fn power_off() {
    let Some(host) = APP.get().and_then(|app| app.try_state::<PluginHost>()) else {
        return;
    };
    let mut children: Vec<_> = host
        .caps
        .power_off()
        .into_iter()
        .filter_map(|armed| {
            std::process::Command::new(&armed.program)
                .args(&armed.args)
                .creation_flags(CREATE_NO_WINDOW.0)
                .spawn()
                .inspect_err(|error| log::warn!("A power-off command did not start: {error}"))
                .ok()
        })
        .collect();
    let end = Instant::now() + WAIT;
    while Instant::now() < end {
        children.retain_mut(|child| child.try_wait().is_ok_and(|status| status.is_none()));
        if children.is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Starts the hidden power window once, when a plugin first arms a command.
/// ponytail: a shutdown that another app then cancels still runs the commands.
pub fn watch(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    std::thread::spawn(|| unsafe {
        let Ok(module) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: w!("SupaDashboardPluginPower"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            log::warn!("Power-off commands are off: no window class");
            return;
        }
        // Never shown: no WS_VISIBLE, zero size.
        if CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class.lpszClassName,
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(class.hInstance),
            None,
        )
        .is_err()
        {
            log::warn!("Power-off commands are off: no window");
            return;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
    });
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let suspend = message == WM_POWERBROADCAST && wparam.0 == PBT_APMSUSPEND as usize;
    if suspend || message == WM_QUERYENDSESSION {
        power_off();
    }
    // Agrees to the session ending and acknowledges power events.
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}
