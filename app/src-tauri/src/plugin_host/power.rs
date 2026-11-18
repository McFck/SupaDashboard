//! PC sleep and shutdown: runs the plugins' armed `onPowerOff` commands. Windows tells every top-level window, a
//! hidden one included (a message-only window hears no broadcasts), before it suspends or ends the session; the
//! commands run then, while the PC still waits.
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::RegisterSuspendResumeNotification;
use windows::Win32::System::Threading::CREATE_NO_WINDOW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DEVICE_NOTIFY_WINDOW_HANDLE, DefWindowProcW, DispatchMessageW, GetMessageW,
    MSG, PBT_APMSUSPEND, RegisterClassW, WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST,
    WM_QUERYENDSESSION, WNDCLASSW,
};
use windows::core::w;

use super::PluginHost;

/// How long the PC is held for the commands.
const WAIT: Duration = Duration::from_millis(1500);

static APP: OnceLock<AppHandle> = OnceLock::new();
static WATCHING: OnceLock<Result<(), String>> = OnceLock::new();

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
                .stdin(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW.0)
                .spawn()
                .inspect_err(|error| log::warn!("A power-off command did not start: {error}"))
                .ok()
        })
        .collect();
    let end = Instant::now() + WAIT;
    while Instant::now() < end {
        children.retain_mut(|child| match child.try_wait() {
            Ok(None) => true,
            Ok(Some(status)) if status.success() => false,
            Ok(Some(status)) => {
                log::warn!("A power-off command failed: {status}");
                false
            }
            Err(error) => {
                log::warn!("Could not wait for a power-off command: {error}");
                false
            }
        });
        if children.is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    log::warn!("Power-off commands were still running when the wait ended");
}

/// Starts the hidden power window once, when a plugin first arms a command.
/// ponytail: a shutdown that another app then cancels still runs the commands.
pub fn watch(app: &AppHandle) -> Result<(), String> {
    WATCHING
        .get_or_init(|| {
            APP.get_or_init(|| app.clone());
            let (ready, started) = mpsc::sync_channel(1);
            std::thread::Builder::new()
                .name("plugin-power".into())
                .spawn(move || {
                    let window = create_window();
                    let listening = window.is_ok();
                    let _ = ready.send(window.map(|_| ()));
                    if listening {
                        let mut message = MSG::default();
                        unsafe {
                            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                                DispatchMessageW(&message);
                            }
                        }
                    }
                })
                .map_err(|error| error.to_string())?;
            started.recv().map_err(|error| error.to_string())?
        })
        .clone()
}

fn create_window() -> Result<HWND, String> {
    unsafe {
        let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: w!("SupaDashboardPluginPower"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(windows::core::Error::from_thread().to_string());
        }
        // A hidden top-level window receives broadcasts, including WM_QUERYENDSESSION.
        let window = CreateWindowExW(
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
        .map_err(|error| error.to_string())?;
        // Modern Standby sends suspend events to desktop applications that opt in.
        if let Err(error) =
            RegisterSuspendResumeNotification(window.into(), DEVICE_NOTIFY_WINDOW_HANDLE)
        {
            log::warn!("Could not register for Modern Standby suspend events: {error}");
        }
        Ok(window)
    }
}

fn is_power_off(message: u32, wparam: usize) -> bool {
    message == WM_QUERYENDSESSION
        || (message == WM_POWERBROADCAST && wparam == PBT_APMSUSPEND as usize)
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if is_power_off(message, wparam.0) {
        power_off();
        return LRESULT(1);
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        PBT_APMRESUMEAUTOMATIC, PBT_POWERSETTINGCHANGE, WM_ENDSESSION,
    };

    #[test]
    fn only_suspend_and_end_session_queries_run_power_off_commands() {
        assert!(is_power_off(WM_QUERYENDSESSION, 0));
        assert!(is_power_off(WM_POWERBROADCAST, PBT_APMSUSPEND as usize));
        assert!(!is_power_off(WM_ENDSESSION, 1));
        assert!(!is_power_off(
            WM_POWERBROADCAST,
            PBT_APMRESUMEAUTOMATIC as usize
        ));
        assert!(!is_power_off(
            WM_POWERBROADCAST,
            PBT_POWERSETTINGCHANGE as usize
        ));
    }
}
