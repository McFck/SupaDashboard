//! What app commands do to windows: launch, focus, move to a display, minimize, close.
use super::identity::{Matcher, init_com};
use super::model::{
    Command, Hide, Op, Plan, ToggleFacts, Win, is_app_window, plan_toggle, relocate,
};
use super::windows::{Monitor, Scan, hwnd, rect};
use std::mem::size_of;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{CloseHandle, E_ACCESSDENIED, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{MONITOR_DEFAULTTONEAREST, MonitorFromWindow};
use windows::Win32::System::Threading::{
    GetProcessId, OpenProcess, PROCESS_TERMINATE, TerminateProcess,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VK_MENU,
};
use windows::Win32::UI::Shell::{
    QUNS_RUNNING_D3D_FULL_SCREEN, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    SHQueryUserNotificationState, ShellExecuteExW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetForegroundWindow, GetWindowPlacement, GetWindowRect, IsIconic,
    IsZoomed, PostMessageW, SW_MINIMIZE, SW_RESTORE, SW_SHOWNORMAL, SWP_NOACTIVATE, SWP_NOZORDER,
    SetForegroundWindow, SetWindowPlacement, SetWindowPos, ShowWindow, WINDOWPLACEMENT, WM_CLOSE,
};
use windows::core::{Error, HSTRING};

const WINDOW_WAIT: Duration = Duration::from_secs(5);

/// A short toast title for a failed window call; an elevated app gets its own reason.
fn failed(error: &Error, verb: &str, label: &str) -> String {
    if error.code() == E_ACCESSDENIED {
        format!("{label} is running as administrator")
    } else {
        format!("Couldn't {verb} {label}")
    }
}

fn not_running(label: &str) -> String {
    format!("{label} isn't running")
}

/// A Direct3D exclusive full-screen game (borderless ones are fine) breaks when another app takes the foreground, so focus changes are refused.
fn guard_focus() -> Result<(), String> {
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN => {
            Err("Can't switch apps over a full-screen game".into())
        }
        _ => Ok(()),
    }
}

fn launch(matcher: &Matcher) -> Result<(), String> {
    init_com();
    let (file, directory) = match &matcher.key.split_once(':') {
        Some(("aumid", id)) => (format!("shell:AppsFolder\\{id}"), None),
        Some((_, path)) => (
            (*path).to_owned(),
            std::path::Path::new(path)
                .parent()
                .map(|dir| HSTRING::from(dir.as_os_str())),
        ),
        None => return Err("The app is not valid".into()),
    };
    let file = HSTRING::from(file);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: windows::core::w!("open"),
        lpFile: windows::core::PCWSTR(file.as_ptr()),
        lpDirectory: directory
            .as_ref()
            .map_or(windows::core::PCWSTR::null(), |dir| {
                windows::core::PCWSTR(dir.as_ptr())
            }),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe { ShellExecuteExW(&mut info) }
        .map_err(|_| format!("Couldn't open {}", matcher.label))?;
    if !info.hProcess.is_invalid() {
        // Only the process just started may take the foreground, never any process.
        let _ = unsafe { AllowSetForegroundWindow(GetProcessId(info.hProcess)) };
        let _ = unsafe { CloseHandle(info.hProcess) };
    }
    Ok(())
}

fn alt_tap() {
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_MENU,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let inputs = [key(Default::default()), key(KEYEVENTF_KEYUP)];
    unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
}

fn bring_to_front(win: HWND) -> bool {
    if unsafe { IsIconic(win) }.as_bool() {
        let _ = unsafe { ShowWindow(win, SW_RESTORE) };
    }
    let front = || {
        let _ = unsafe { SetForegroundWindow(win) };
        let foreground = unsafe { GetForegroundWindow() };
        foreground == win
    };
    if front() {
        return true;
    }
    // Windows refused: a synthetic Alt press lifts the foreground lock, then one more try.
    alt_tap();
    front()
}

fn move_to(win: HWND, target: &Monitor) -> Result<(), String> {
    let source = unsafe { MonitorFromWindow(win, MONITOR_DEFAULTTONEAREST) };
    if source == target.handle {
        return Ok(());
    }
    let monitors = super::windows::monitors();
    let Some(source) = monitors.iter().find(|monitor| monitor.handle == source) else {
        return Ok(());
    };
    let mut bounds = RECT::default();
    unsafe { GetWindowRect(win, &mut bounds) }.map_err(|error| error.message())?;
    if rect(bounds) == source.rect && !unsafe { IsZoomed(win) }.as_bool() {
        // Borderless fullscreen covers its monitor: it takes the whole target monitor.
        let to = target.rect;
        return unsafe {
            SetWindowPos(
                win,
                None,
                to.left,
                to.top,
                to.width(),
                to.height(),
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        }
        .map_err(|error| error.message());
    }
    let mut placement = WINDOWPLACEMENT {
        length: size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    unsafe { GetWindowPlacement(win, &mut placement) }.map_err(|error| error.message())?;
    // Placement uses workspace coordinates: screen coordinates minus the monitor's taskbar offset.
    let offset = |monitor: &Monitor| {
        (
            monitor.work.left - monitor.rect.left,
            monitor.work.top - monitor.rect.top,
        )
    };
    let (sx, sy) = offset(source);
    let (tx, ty) = offset(target);
    let normal = rect(placement.rcNormalPosition);
    let screen = super::model::Rect {
        left: normal.left + sx,
        top: normal.top + sy,
        right: normal.right + sx,
        bottom: normal.bottom + sy,
    };
    let moved = relocate(screen, source.work, target.work);
    placement.rcNormalPosition = RECT {
        left: moved.left - tx,
        top: moved.top - ty,
        right: moved.right - tx,
        bottom: moved.bottom - ty,
    };
    unsafe { SetWindowPlacement(win, &placement) }.map_err(|error| error.message())
}

/// Restores if needed, moves to the display, then takes focus.
fn reveal(win: &Win, display: Option<&Monitor>, label: &str) -> Result<(), String> {
    let handle = hwnd(win);
    if unsafe { IsIconic(handle) }.as_bool() {
        let _ = unsafe { ShowWindow(handle, SW_RESTORE) };
    }
    if let Some(target) = display {
        move_to(handle, target).map_err(|_| format!("Couldn't move {label}"))?;
    }
    if bring_to_front(handle) {
        Ok(())
    } else {
        Err(format!("Couldn't bring {label} to front"))
    }
}

fn minimize(wins: &[Win], label: &str) -> Result<(), String> {
    for win in wins.iter().filter(|win| is_app_window(win)) {
        let handle = hwnd(win);
        let _ = unsafe { ShowWindow(handle, SW_MINIMIZE) };
        if !unsafe { IsIconic(handle) }.as_bool() {
            return Err(format!("Couldn't minimize {label}"));
        }
    }
    Ok(())
}

fn close(scan: &mut Scan, matcher: &Matcher, wins: &[Win], force: bool) -> Result<(), String> {
    if force {
        let mut pids = scan.pids(matcher);
        pids.extend(wins.iter().map(|win| win.pid));
        pids.sort_unstable();
        pids.dedup();
        for pid in pids {
            let process = unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) }
                .map_err(|error| failed(&error, "close", &matcher.label))?;
            let result = unsafe { TerminateProcess(process, 1) };
            let _ = unsafe { CloseHandle(process) };
            result.map_err(|error| failed(&error, "close", &matcher.label))?;
        }
        return Ok(());
    }
    let mut posted = false;
    for win in wins.iter().filter(|win| !win.owned) {
        unsafe { PostMessageW(Some(hwnd(win)), WM_CLOSE, WPARAM(0), LPARAM(0)) }
            .map_err(|error| failed(&error, "close", &matcher.label))?;
        posted = true;
    }
    // A tray app with no window has nothing to ask politely.
    if posted {
        Ok(())
    } else {
        Err(format!("Couldn't close {}", matcher.label))
    }
}

fn top(wins: &[Win]) -> Option<&Win> {
    wins.iter().find(|win| is_app_window(win))
}

/// Launches, then waits for the app's first window so it can be focused.
fn launch_and_wait(names: &mut super::identity::Names, matcher: &Matcher) -> Result<Win, String> {
    launch(matcher)?;
    let started = Instant::now();
    while started.elapsed() < WINDOW_WAIT {
        std::thread::sleep(Duration::from_millis(100));
        let found = Scan::new(names).windows(matcher);
        if let Some(win) = top(&found) {
            return Ok(win.clone());
        }
    }
    Err(format!("{} didn't open a window", matcher.label))
}

pub fn execute(command: &Command, matcher: &Matcher) -> Result<(), String> {
    let mut names = super::identity::Names::default();
    let mut scan = Scan::new(&mut names);
    let wins = scan.windows(matcher);
    let running = !wins.is_empty() || !scan.pids(matcher).is_empty();
    let display = match &command.display {
        Some(path) => Some(
            scan.monitors()
                .iter()
                .position(|monitor| &monitor.path == path)
                .ok_or("The display is not connected")?,
        ),
        None => None,
    };
    let label = matcher.label.as_str();
    let target = display.map(|index| super::windows::monitors().swap_remove(index));
    let shown = top(&wins);
    let reveal_top = |scan: &mut Scan, win: Option<&Win>| match win {
        Some(win) => reveal(win, target.as_ref(), label),
        None => {
            let win = launch_and_wait(scan.names, matcher)?;
            reveal(&win, target.as_ref(), label)
        }
    };
    match command.op {
        Op::Open => {
            guard_focus()?;
            match shown {
                Some(win) => reveal(win, None, label),
                None => launch(matcher),
            }
        }
        Op::Focus => {
            guard_focus()?;
            reveal_top(&mut scan, shown)
        }
        Op::Toggle => {
            let foreground = scan.foreground_pid();
            let facts = ToggleFacts {
                running,
                shown: shown.is_some(),
                top_foreground: shown.is_some_and(|win| foreground == Some(win.pid)),
                top_minimized: shown.is_some_and(|win| win.minimized),
            };
            let plan = plan_toggle(facts);
            if plan != Plan::Hide {
                guard_focus()?;
            }
            match plan {
                Plan::Launch => launch(matcher),
                Plan::Restore | Plan::Raise => reveal_top(&mut scan, shown),
                Plan::Hide => match command.hide {
                    Hide::Minimize => minimize(&wins, label),
                    Hide::Close => close(&mut scan, matcher, &wins, command.force),
                },
            }
        }
        Op::Minimize if !running => Err(not_running(label)),
        Op::Close if !running => Err(not_running(label)),
        Op::Minimize => minimize(&wins, label),
        Op::Close => close(&mut scan, matcher, &wins, command.force),
    }
}
