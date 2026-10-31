//! Process-exit wake-ups. The thread pool waits on each watched process and posts a message to the watcher
//! thread when one ends, so an app that exits without closing a window still updates, and nothing polls.
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, LPARAM, WPARAM};
use windows::Win32::System::Threading::{
    GetCurrentThreadId, INFINITE, OpenProcess, PROCESS_SYNCHRONIZE, RegisterWaitForSingleObject,
    UnregisterWaitEx, WT_EXECUTEONLYONCE,
};
use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};

struct Wait {
    process: HANDLE,
    wait: HANDLE,
}

pub struct ExitWaits {
    thread: u32,
    waits: HashMap<u32, Wait>,
}

/// Runs on a pool thread; `context` is the watcher thread's id.
unsafe extern "system" fn on_exit(context: *mut c_void, _: bool) {
    let _ = unsafe { PostThreadMessageW(context as usize as u32, WM_APP, WPARAM(0), LPARAM(0)) };
}

impl ExitWaits {
    pub fn new() -> Self {
        Self {
            thread: unsafe { GetCurrentThreadId() },
            waits: HashMap::new(),
        }
    }

    /// Waits on exactly these processes. A process that cannot be opened (elevated) is left to window events.
    pub fn sync(&mut self, pids: &HashSet<u32>) {
        let gone: Vec<u32> = self
            .waits
            .keys()
            .filter(|pid| !pids.contains(pid))
            .copied()
            .collect();
        for pid in gone {
            if let Some(wait) = self.waits.remove(&pid) {
                release(wait);
            }
        }
        for &pid in pids {
            if !self.waits.contains_key(&pid)
                && let Some(wait) = self.register(pid)
            {
                self.waits.insert(pid, wait);
            }
        }
    }

    fn register(&self, pid: u32) -> Option<Wait> {
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid).ok()? };
        let mut wait = HANDLE::default();
        let registered = unsafe {
            RegisterWaitForSingleObject(
                &mut wait,
                process,
                Some(on_exit),
                Some(self.thread as usize as *const c_void),
                INFINITE,
                WT_EXECUTEONLYONCE,
            )
        };
        if registered.is_err() {
            let _ = unsafe { CloseHandle(process) };
            return None;
        }
        Some(Wait { process, wait })
    }
}

fn release(wait: Wait) {
    // Blocks until a running callback returns; the callback only posts a message.
    let _ = unsafe { UnregisterWaitEx(wait.wait, Some(INVALID_HANDLE_VALUE)) };
    let _ = unsafe { CloseHandle(wait.process) };
}

impl Drop for ExitWaits {
    fn drop(&mut self) {
        for (_, wait) in self.waits.drain() {
            release(wait);
        }
    }
}
