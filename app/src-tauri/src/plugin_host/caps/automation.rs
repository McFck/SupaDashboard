//! `automation`: the buttons in the visible windows of a declared program, read and pressed through UI Automation.
//! Out-of-context WinEvent hooks wake a watcher thread when the program's windows or accessible names change, and a
//! light re-read runs every 5 s while it runs. Reading names and invoking buttons never activates the program, so the
//! foreground app keeps focus. One watcher per (plugin, webview); it stops with its page.
mod scanner;

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{State, Webview};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, HWINEVENTHOOK, IUIAutomation, SetWinEventHook, UnhookWinEvent,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EVENT_OBJECT_CREATE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_REORDER, EVENT_OBJECT_STATECHANGE,
    EnumWindows, GetMessageW, GetWindowThreadProcessId, IsWindowVisible, KillTimer, MSG,
    OBJID_WINDOW, PM_NOREMOVE, PeekMessageW, PostThreadMessageW, SetTimer, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_APP, WM_QUIT, WM_TIMER,
};
use windows::core::{BOOL, PWSTR};

use crate::plugin_host::PluginHost;
use crate::plugin_host::permissions::Permissions;
use scanner::{Scanner, Snapshot};

/// Coalesces a burst of events into one read; structure events ask for a full rescan.
const SETTLE_MS: u32 = 250;
/// Chromium switches its accessibility tree off after user input with no accessibility API use in between, and then
/// raises no more events. A light re-read this often keeps the tree on and corrects a change missed meanwhile.
const KEEPALIVE_MS: u32 = 5000;
/// A full rescan walks the program's whole accessibility tree, so busy windows rescan at most this often.
const FULL_SCAN_GAP: Duration = Duration::from_secs(1);

struct Invoke {
    snapshot: u64,
    index: usize,
    reply: tokio::sync::oneshot::Sender<Result<(), String>>,
}

pub struct Watcher {
    thread: u32,
    requests: mpsc::Sender<Invoke>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        // SAFETY: posting to a thread that already ended fails harmlessly.
        let _ = unsafe { PostThreadMessageW(self.thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}

/// What the WinEvent callback, which cannot capture, shares with the watcher loop on the same thread.
#[derive(Default)]
struct Watch {
    exe: String,
    pid: u32,
    timer: usize,
    full: bool,
    names: HashMap<u32, bool>,
}

thread_local! {
    static WATCH: RefCell<Watch> = RefCell::default();
}

fn schedule(full: bool) {
    WATCH.with_borrow_mut(|watch| {
        watch.full |= full;
        if watch.timer == 0 {
            // SAFETY: a thread timer; its id comes back in WM_TIMER.
            watch.timer = unsafe { SetTimer(None, 0, SETTLE_MS, None) };
        }
    });
}

/// Whether a process image path is the declared program `exe` (lowercase file name).
fn is_exe(image: &str, exe: &str) -> bool {
    image
        .to_lowercase()
        .strip_suffix(exe)
        .is_some_and(|folder| folder.ends_with('\\'))
}

fn is_target(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    if let Some(known) = WATCH.with_borrow(|watch| watch.names.get(&pid).copied()) {
        return known;
    }
    // SAFETY: the buffer outlives the call and the handle is closed.
    let image = unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .ok()
            .and_then(|process| {
                let mut buffer = [0u16; 1024];
                let mut length = buffer.len() as u32;
                let named = QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut length,
                )
                .is_ok()
                .then(|| String::from_utf16_lossy(&buffer[..length as usize]));
                let _ = CloseHandle(process);
                named
            })
    };
    WATCH.with_borrow_mut(|watch| {
        let found = image.is_some_and(|image| is_exe(&image, &watch.exe));
        // Process ids are reused; a bounded cache keeps a recycled id from staying misclassified for long.
        if watch.names.len() > 512 {
            watch.names.clear();
        }
        watch.names.insert(pid, found);
        found
    })
}

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    let watched = WATCH.with_borrow(|watch| watch.pid);
    let window = object == OBJID_WINDOW.0;
    // The global hook sees every process; most events are dropped before any lookup.
    if !window && watched == 0 {
        return;
    }
    let mut pid = 0;
    // SAFETY: a plain query of a window handle the system passed.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if (EVENT_OBJECT_STATECHANGE..=EVENT_OBJECT_NAMECHANGE).contains(&event) {
        if pid == watched {
            schedule(false);
        }
    } else if pid == watched || (window && is_target(pid)) {
        // Structure inside the watched program, or a window of it opening or closing.
        schedule(true);
    }
}

/// The process id and visible top-level windows of the program.
fn target_windows() -> (u32, Vec<HWND>) {
    unsafe extern "system" fn collect(hwnd: HWND, found: LPARAM) -> BOOL {
        // SAFETY: `found` is the vector passed to EnumWindows below, alive for the call.
        let found = unsafe { &mut *(found.0 as *mut Vec<(u32, HWND)>) };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if unsafe { IsWindowVisible(hwnd) }.as_bool() && is_target(pid) {
            found.push((pid, hwnd));
        }
        true.into()
    }
    let mut found: Vec<(u32, HWND)> = Vec::new();
    // SAFETY: the callback only runs during the call.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&raw mut found as isize)) };
    let pid = found.first().map_or(0, |(pid, _)| *pid);
    (pid, found.into_iter().map(|(_, hwnd)| hwnd).collect())
}

/// The name and state hook and the keep-alive timer of the running program's process.
#[derive(Default)]
struct Followed {
    hook: Option<(u32, HWINEVENTHOOK)>,
    /// The periodic re-read while the program runs; 0 when it does not.
    keepalive: usize,
}

impl Followed {
    /// Name and state events are hooked only for the running program's process.
    fn follow(&mut self, pid: u32) {
        if self.hook.as_ref().map(|(hooked, _)| *hooked) == Some(pid) {
            return;
        }
        // SAFETY: hooks and timers of this thread.
        unsafe {
            if let Some((_, hook)) = self.hook.take() {
                let _ = UnhookWinEvent(hook);
            }
            WATCH.with_borrow_mut(|watch| watch.pid = pid);
            if self.keepalive != 0 {
                let _ = KillTimer(None, self.keepalive);
                self.keepalive = 0;
            }
            if pid != 0 {
                self.keepalive = SetTimer(None, 0, KEEPALIVE_MS, None);
                let hook = SetWinEventHook(
                    EVENT_OBJECT_STATECHANGE,
                    EVENT_OBJECT_NAMECHANGE,
                    None,
                    Some(on_event),
                    pid,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );
                if !hook.is_invalid() {
                    self.hook = Some((pid, hook));
                }
            }
        }
    }
}

/// Reads the program's windows, following its process.
fn refresh(scanner: &mut Scanner, followed: &mut Followed, full: bool) -> Snapshot {
    let (pid, windows) = target_windows();
    followed.follow(pid);
    scanner.refresh(&windows, full)
}

fn start() -> Result<(Scanner, HWINEVENTHOOK), String> {
    let failed = |_| "Could not start UI Automation".to_owned();
    // SAFETY: COM is initialised for this thread before its first use.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(failed)?;
        let uia: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(failed)?;
        // Window lifecycle of every process: the only way to notice the program starting without polling.
        let hook = SetWinEventHook(
            EVENT_OBJECT_CREATE,
            EVENT_OBJECT_REORDER,
            None,
            Some(on_event),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.is_invalid() {
            return Err("Could not watch the program".into());
        }
        Ok((Scanner::new(uia), hook))
    }
}

fn run(
    exe: String,
    events: Channel<Snapshot>,
    requests: mpsc::Receiver<Invoke>,
    ready: tokio::sync::oneshot::Sender<Result<u32, String>>,
) {
    WATCH.with_borrow_mut(|watch| watch.exe = exe);
    let (mut scanner, global) = match start() {
        Ok(started) => started,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    let mut message = MSG::default();
    // SAFETY: creates this thread's message queue before anyone posts to it.
    let _ = unsafe { PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE) };
    let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));
    let mut followed = Followed::default();
    let mut sent = refresh(&mut scanner, &mut followed, true);
    let _ = events.send(sent.clone());
    let mut publish = |next: Snapshot| {
        if next != sent {
            sent = next;
            let _ = events.send(sent.clone());
        }
    };
    // SAFETY: the loop ends with WM_QUIT from `Watcher::drop`.
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
        if message.message == WM_TIMER && message.wParam.0 == followed.keepalive {
            publish(refresh(&mut scanner, &mut followed, false));
        } else if message.message == WM_TIMER {
            let timer = WATCH.with_borrow(|watch| watch.timer);
            if message.wParam.0 != timer {
                continue;
            }
            let _ = unsafe { KillTimer(None, timer) };
            let full = WATCH.with_borrow_mut(|watch| {
                watch.timer = 0;
                std::mem::take(&mut watch.full)
            });
            let wait = scanner
                .last_full
                .map(|at| FULL_SCAN_GAP.saturating_sub(at.elapsed()))
                .unwrap_or_default();
            if full && !wait.is_zero() {
                WATCH.with_borrow_mut(|watch| {
                    watch.full = true;
                    watch.timer = unsafe { SetTimer(None, 0, wait.as_millis() as u32, None) };
                });
                continue;
            }
            publish(refresh(&mut scanner, &mut followed, full));
        } else if message.message == WM_APP {
            while let Ok(request) = requests.try_recv() {
                let _ = request
                    .reply
                    .send(scanner.invoke(request.snapshot, request.index));
            }
            schedule(false);
        }
    }
    // SAFETY: this thread's hooks.
    unsafe {
        if let Some((_, hook)) = followed.hook.take() {
            let _ = UnhookWinEvent(hook);
        }
        let _ = UnhookWinEvent(global);
    }
}

fn check(permissions: &Permissions, exe: &str) -> Result<(), String> {
    if !permissions
        .automation
        .iter()
        .any(|declared| declared == exe)
    {
        return Err("This program is not allowed".into());
    }
    Ok(())
}

/// Sends a snapshot now and whenever the program's buttons change; replaces this page's earlier watch.
#[tauri::command]
pub async fn plugin_automation_watch(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    exe: String,
    events: Channel<Snapshot>,
) -> Result<(), String> {
    check(&host.installed(&plugin)?.manifest.permissions, &exe)?;
    let (requests, receiver) = mpsc::channel();
    let (ready, started) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("plugin-automation".into())
        .spawn(move || run(exe, events, receiver, ready))
        .map_err(|_| "Could not watch the program")?;
    let thread = tokio::time::timeout(Duration::from_secs(5), started)
        .await
        .map_err(|_| "Could not watch the program")?
        .map_err(|_| "Could not watch the program")??;
    let watcher = Watcher { thread, requests };
    let replaced = host.caps.with(&plugin, webview.label(), |owned| {
        owned.watcher.replace(watcher)
    });
    drop(replaced);
    Ok(())
}

/// Presses button `index` of snapshot `snapshot` without focusing its window.
#[tauri::command]
pub async fn plugin_automation_invoke(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    snapshot: u64,
    index: usize,
) -> Result<(), String> {
    let (reply, answer) = tokio::sync::oneshot::channel();
    host.caps.with(&plugin, webview.label(), |owned| {
        let watcher = owned.watcher.as_ref().ok_or("Not watching")?;
        watcher
            .requests
            .send(Invoke {
                snapshot,
                index,
                reply,
            })
            .map_err(|_| "Not watching")?;
        // SAFETY: a plain post to the watcher thread.
        unsafe { PostThreadMessageW(watcher.thread, WM_APP, WPARAM(0), LPARAM(0)) }
            .map_err(|_| "Not watching".to_owned())
    })?;
    tokio::time::timeout(Duration::from_secs(5), answer)
        .await
        .map_err(|_| "The program did not respond")?
        .map_err(|_| "Not watching")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_declared_program_is_watched() {
        let permissions: Permissions =
            serde_json::from_str(r#"{"automation":["talk.exe"]}"#).unwrap();
        assert_eq!(check(&permissions, "talk.exe"), Ok(()));
        for refused in ["TALK.EXE", "other.exe", "", r"C:\talk.exe"] {
            assert!(check(&permissions, refused).is_err(), "{refused}");
        }
        assert!(is_exe(r"C:\Program Files\Talk\Talk.exe", "talk.exe"));
        for other in [r"C:\x\mytalk.exe", r"C:\talk.exe\x.exe", "talk.exe"] {
            assert!(!is_exe(other, "talk.exe"), "{other}");
        }
    }
}
