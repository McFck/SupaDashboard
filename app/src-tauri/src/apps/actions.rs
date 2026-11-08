//! What app commands do to windows: launch, focus, move to a display, minimize, close.
use super::identity::{Matcher, init_com};
use super::model::{Command, Hide, Op, Plan, Win, is_app_window, plan_toggle};
use super::placement::move_to;
use super::selection::{select, toggle_facts};
use super::windows::{Scan, hwnd};
use std::mem::size_of;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    CloseHandle, E_ACCESSDENIED, ERROR_INVALID_PARAMETER, HWND, LPARAM, WAIT_OBJECT_0, WPARAM,
};
use windows::Win32::System::Threading::{
    GetProcessId, OpenProcess, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess,
    WaitForSingleObject,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
    VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::Shell::{
    QUNS_RUNNING_D3D_FULL_SCREEN, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    SHQueryUserNotificationState, ShellExecuteExW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GA_ROOTOWNER, GetAncestor, GetForegroundWindow, GetLastActivePopup,
    IsIconic, IsWindow, IsWindowVisible, PostMessageW, SW_MINIMIZE, SW_RESTORE, SW_SHOWNORMAL,
    SetForegroundWindow, ShowWindow, ShowWindowAsync, WM_CLOSE,
};
use windows::core::{Error, HSTRING, Owned};

const WINDOW_WAIT: Duration = Duration::from_secs(5);

/// A short toast title for a failed window call; an elevated app gets its own reason.
fn failed(error: &Error, verb: &str, label: &str) -> String {
    if error.code() == E_ACCESSDENIED {
        format!("{label} is running as administrator")
    } else {
        format!("Couldn't {verb} {label}")
    }
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

fn alt_tap() -> bool {
    // Never release a modifier the user is holding or turn their shortcut into another one.
    if [VK_MENU, VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(i32::from(key.0)) } < 0)
    {
        return false;
    }
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
    unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) == inputs.len() as u32 }
}

fn bring_to_front(win: HWND) -> bool {
    if unsafe { IsIconic(win) }.as_bool() {
        // A hung target must not block the action worker on a synchronous restore.
        let _ = unsafe { ShowWindowAsync(win, SW_RESTORE) };
    }
    let front = || {
        let popup = unsafe { GetLastActivePopup(win) };
        let target = if unsafe { IsWindowVisible(popup) }.as_bool() {
            popup
        } else {
            win
        };
        let _ = unsafe { SetForegroundWindow(target) };
        // Activation crosses input queues asynchronously; an owned modal dialog counts too.
        let deadline = Instant::now() + Duration::from_millis(750);
        loop {
            let foreground = unsafe { GetForegroundWindow() };
            if !foreground.is_invalid()
                && unsafe { GetAncestor(foreground, GA_ROOTOWNER) } == win
                && !unsafe { IsIconic(win) }.as_bool()
            {
                return true;
            }
            if Instant::now() >= deadline || !unsafe { IsWindow(Some(win)) }.as_bool() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    if front() {
        return true;
    }
    // Retry the target only, never activate the dashboard or attach its input queue.
    alt_tap() && front()
}

/// Show first: tray apps can restore their saved position while taking focus.
fn reveal(win: &Win, display: Option<&str>, label: &str) -> Result<(), String> {
    let handle = hwnd(win);
    if !bring_to_front(handle) {
        return Err(format!("Couldn't bring {label} to front"));
    }
    if let Some(path) = display {
        move_to(handle, path).map_err(|_| format!("Couldn't move {label}"))?;
    }
    Ok(())
}

fn reveal_selected(wins: &[Win], display: Option<&str>, label: &str) -> Result<(), String> {
    // Restore each window through the same path, back to front, so the most recently active window ends up in front.
    for win in wins.iter().rev() {
        reveal(win, display, label)?;
    }
    if let Some(path) = display {
        // Telegram, Discord and Steam may apply saved bounds after their first show.
        for delay in [250, 750] {
            std::thread::sleep(Duration::from_millis(delay));
            for win in wins {
                let handle = hwnd(win);
                if unsafe { IsWindowVisible(handle) }.as_bool()
                    && !unsafe { IsIconic(handle) }.as_bool()
                {
                    move_to(handle, path).map_err(|_| format!("Couldn't move {label}"))?;
                }
            }
        }
    }
    Ok(())
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
        let mut processes = Vec::new();
        let mut failure = None;
        for pid in pids {
            let process =
                match unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid) } {
                    Ok(process) => unsafe { Owned::new(process) },
                    // Another process in the app may have already shut this one down.
                    Err(error) if error.code() == ERROR_INVALID_PARAMETER.to_hresult() => continue,
                    Err(error) => {
                        failure = Some(failed(&error, "close", &matcher.label));
                        continue;
                    }
                };
            let result = unsafe { TerminateProcess(*process, 1) };
            processes.push((process, result));
        }
        let deadline = Instant::now() + WINDOW_WAIT;
        for (process, result) in processes {
            let remaining = deadline
                .saturating_duration_since(Instant::now())
                .as_millis() as u32;
            if unsafe { WaitForSingleObject(*process, remaining) } != WAIT_OBJECT_0 {
                return Err(result.err().map_or_else(
                    || format!("Couldn't close {}", matcher.label),
                    |error| failed(&error, "close", &matcher.label),
                ));
            }
        }
        return failure.map_or(Ok(()), Err);
    }
    let targets: Vec<_> = wins.iter().filter(|win| is_app_window(win)).collect();
    let mut failure = None;
    for win in &targets {
        if let Err(error) = unsafe { PostMessageW(Some(hwnd(win)), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        {
            failure = Some(failed(&error, "close", &matcher.label));
        }
    }
    // A tray app with no window has nothing to ask politely.
    if targets.is_empty() {
        return Err(format!("Couldn't close {}", matcher.label));
    }
    let deadline = Instant::now() + WINDOW_WAIT;
    loop {
        // Close-to-tray is success even though the app's process stays alive.
        if targets
            .iter()
            .all(|win| !unsafe { IsWindowVisible(hwnd(win)) }.as_bool())
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(failure.unwrap_or_else(|| format!("Couldn't close {}", matcher.label)));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn top(wins: &[Win]) -> Option<&Win> {
    wins.iter().find(|win| is_app_window(win))
}

/// Launches, then waits for the app's first window so it can be focused.
fn launch_and_wait(
    names: &mut super::identity::Names,
    matcher: &Matcher,
    command: &Command,
) -> Result<Vec<Win>, String> {
    launch(matcher)?;
    let started = Instant::now();
    while started.elapsed() < WINDOW_WAIT {
        std::thread::sleep(Duration::from_millis(100));
        let found = Scan::new(names).windows(matcher);
        let selected = select(&found, command.windows, &command.title);
        if !selected.is_empty() {
            return Ok(selected);
        }
    }
    Err(format!("{} didn't open a window", matcher.label))
}

pub fn execute(command: &Command, matcher: &Matcher) -> Result<(), String> {
    let mut names = super::identity::Names::default();
    let mut scan = Scan::new(&mut names);
    let wins = scan.windows(matcher);
    let running = !wins.is_empty() || !scan.pids(matcher).is_empty();
    let display = command.display.as_deref().filter(|path| {
        scan.monitors()
            .iter()
            .any(|monitor| monitor.path.eq_ignore_ascii_case(path))
    });
    let label = matcher.label.as_str();
    let shown = top(&wins);
    let selected = select(&wins, command.windows, &command.title);
    if matches!(command.op, Op::Focus | Op::Toggle | Op::Minimize)
        && selected.is_empty()
        && shown.is_some()
    {
        return Err(format!("No matching window for {label}"));
    }
    let reveal_targets = |scan: &mut Scan| {
        if selected.is_empty() {
            let opened = launch_and_wait(scan.names, matcher, command)?;
            reveal_selected(&opened, display, label)
        } else {
            reveal_selected(&selected, display, label)
        }
    };
    match command.op {
        // Open only starts the app; a running app's windows are left as they are (Focus and Toggle reveal them).
        Op::Open if running => Ok(()),
        Op::Open => {
            guard_focus()?;
            if display.is_some() {
                reveal_targets(&mut scan)
            } else {
                launch(matcher)
            }
        }
        Op::Focus => {
            guard_focus()?;
            reveal_targets(&mut scan)
        }
        Op::Toggle => {
            let facts = toggle_facts(&selected, running, scan.foreground_root());
            let plan = plan_toggle(facts);
            if plan != Plan::Hide {
                guard_focus()?;
            }
            match plan {
                Plan::Launch if display.is_none() => launch(matcher),
                Plan::Launch | Plan::Restore | Plan::Raise => reveal_targets(&mut scan),
                Plan::Hide => match command.hide {
                    Hide::Minimize => minimize(&selected, label),
                    Hide::Close => close(&mut scan, matcher, &selected, command.force),
                },
            }
        }
        Op::Minimize | Op::Close | Op::Quit if !running => Err(format!("{label} isn't running")),
        Op::Minimize => minimize(&selected, label),
        Op::Close => close(&mut scan, matcher, &wins, command.force),
        Op::Quit => {
            let mut pids = scan.pids(matcher);
            pids.extend(wins.iter().map(|win| win.pid));
            pids.sort_unstable();
            pids.dedup();
            super::quit::quit(&pids, label)
        }
    }
}
