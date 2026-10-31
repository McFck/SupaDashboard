//! Live app state without polling. A thread with a message loop holds WinEvent hooks that only wake it;
//! it recomputes the watched apps from the desktop (coalesced) and emits `apps-state` when something changed.
use super::identity::{Matcher, Names};
use super::model::AppState;
use super::windows::Scan;
use serde::Serialize;
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter as _};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY,
    EVENT_OBJECT_HIDE, EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_UNCLOAKED,
    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GA_PARENT,
    GetAncestor, GetDesktopWindow, GetMessageW, KillTimer, MSG, OBJID_WINDOW, PostThreadMessageW,
    SetTimer, TranslateMessage, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP, WM_QUIT,
    WM_TIMER,
};

/// Events arrive in bursts (a window opening fires several); one recompute serves the burst.
const DEBOUNCE_MS: u32 = 150;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Watched {
    pub key: String,
    pub slug: String,
    #[serde(flatten)]
    pub state: AppState,
}

fn snapshot(matchers: &[Matcher], names: &mut Names) -> (Vec<Watched>, HashSet<isize>) {
    let mut scan = Scan::new(names);
    let mut windows = HashSet::new();
    let states = matchers
        .iter()
        .map(|matcher| {
            windows.extend(scan.windows(matcher).iter().map(|win| win.hwnd));
            Watched {
                key: matcher.key.clone(),
                slug: matcher.slug.clone(),
                state: scan.state(matcher),
            }
        })
        .collect();
    (states, windows)
}

pub fn current(matchers: &[Matcher]) -> Vec<Watched> {
    snapshot(matchers, &mut Names::default()).0
}

thread_local! {
    /// Windows of watched apps: only their moves matter, and move events are the busiest.
    static TRACKED: RefCell<HashSet<isize>> = RefCell::default();
    static TIMER: Cell<Option<usize>> = const { Cell::new(None) };
}

fn schedule() {
    TIMER.with(|timer| {
        if let Some(id) = timer.take() {
            let _ = unsafe { KillTimer(None, id) };
        }
        timer.set(Some(unsafe { SetTimer(None, 0, DEBOUNCE_MS, None) }));
    });
}

unsafe extern "system" fn on_event(
    _: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    // Everything fires system-wide: drop all but top-level window events before doing any work.
    if object != OBJID_WINDOW.0 || child != 0 || hwnd.is_invalid() {
        return;
    }
    let relevant = match event {
        EVENT_OBJECT_LOCATIONCHANGE => {
            TRACKED.with(|set| set.borrow().contains(&(hwnd.0 as isize)))
        }
        EVENT_OBJECT_DESTROY => true,
        _ => {
            let parent = unsafe { GetAncestor(hwnd, GA_PARENT) };
            parent == unsafe { GetDesktopWindow() }
        }
    };
    if relevant {
        schedule();
    }
}

fn run(app: AppHandle, shared: Arc<Mutex<Vec<Matcher>>>, ready: mpsc::Sender<Result<u32, String>>) {
    let ranges = [
        (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
        (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
        (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
        (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
        (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
    ];
    let hooks: Vec<HWINEVENTHOOK> = ranges
        .iter()
        .map(|(low, high)| unsafe {
            SetWinEventHook(
                *low,
                *high,
                None,
                Some(on_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        })
        .collect();
    if hooks.iter().any(|hook| hook.is_invalid()) {
        for hook in hooks.iter().filter(|hook| !hook.is_invalid()) {
            let _ = unsafe { UnhookWinEvent(*hook) };
        }
        let _ = ready.send(Err("Windows refused the window event hooks".into()));
        return;
    }
    let _ = ready.send(Ok(unsafe { GetCurrentThreadId() }));

    let mut last: Vec<Watched> = Vec::new();
    let refresh = |last: &mut Vec<Watched>| {
        let matchers = shared.lock().map(|list| list.clone()).unwrap_or_default();
        let (states, windows) = snapshot(&matchers, &mut Names::default());
        TRACKED.with(|set| *set.borrow_mut() = windows);
        if *last != states {
            let _ = app.emit("apps-state", &states);
            *last = states;
        }
    };
    refresh(&mut last);
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.0 > 0 {
        let timer = TIMER.with(Cell::get);
        if message.message == WM_APP {
            refresh(&mut last);
        } else if message.message == WM_TIMER && timer == Some(message.wParam.0) {
            let _ = unsafe { KillTimer(None, message.wParam.0) };
            TIMER.with(|cell| cell.set(None));
            refresh(&mut last);
        } else {
            let _ = unsafe { TranslateMessage(&message) };
            unsafe { DispatchMessageW(&message) };
        }
    }
    if let Some(id) = TIMER.with(Cell::take) {
        let _ = unsafe { KillTimer(None, id) };
    }
    for hook in hooks {
        let _ = unsafe { UnhookWinEvent(hook) };
    }
}

struct Running {
    thread: u32,
    matchers: Arc<Mutex<Vec<Matcher>>>,
}

/// Owns the watcher thread. It runs only while some app is watched.
#[derive(Default)]
pub struct AppsHub {
    running: Mutex<Option<Running>>,
}

impl AppsHub {
    pub fn watch(&self, app: &AppHandle, matchers: Vec<Matcher>) -> Result<(), String> {
        let mut running = self.running.lock().map_err(|_| "apps hub poisoned")?;
        if let Some(active) = running.as_ref() {
            *active.matchers.lock().map_err(|_| "apps hub poisoned")? = matchers;
            unsafe { PostThreadMessageW(active.thread, WM_APP, WPARAM(0), LPARAM(0)) }
                .map_err(|error| error.message())?;
            return Ok(());
        }
        let shared = Arc::new(Mutex::new(matchers));
        let (ready, started) = mpsc::channel();
        let (app, worker) = (app.clone(), shared.clone());
        thread::Builder::new()
            .name("SupaDashboard app watcher".into())
            .spawn(move || run(app, worker, ready))
            .map_err(|error| format!("could not start the app watcher: {error}"))?;
        let thread = started
            .recv()
            .map_err(|_| "the app watcher stopped while starting")??;
        *running = Some(Running {
            thread,
            matchers: shared,
        });
        Ok(())
    }

    pub fn unwatch(&self) {
        if let Some(active) = self
            .running
            .lock()
            .ok()
            .and_then(|mut running| running.take())
        {
            let _ = unsafe { PostThreadMessageW(active.thread, WM_QUIT, WPARAM(0), LPARAM(0)) };
        }
    }
}
