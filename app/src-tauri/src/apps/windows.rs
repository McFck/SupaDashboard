//! Reading the desktop: monitors, an app's windows and its live state.
use super::identity::{Matcher, Names};
use super::model::{AppState, Rect, Win, fold, is_app_window};
use std::mem::size_of;
use windows::Win32::Foundation::{HWND, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITORINFOEXW,
    MonitorFromWindow,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, GA_ROOTOWNER, GW_OWNER, GWL_EXSTYLE, GetAncestor,
    GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};
use windows::core::{BOOL, w};

pub fn rect(value: RECT) -> Rect {
    Rect {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
    }
}

pub struct Monitor {
    pub handle: HMONITOR,
    pub rect: Rect,
    pub work: Rect,
    /// GDI device name, the key `monitors.rs` describes monitors by.
    pub name: String,
    pub friendly: String,
    /// Lowercase device path, the value display settings store.
    pub path: String,
}

pub fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn collect(
        handle: HMONITOR,
        _: HDC,
        _: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let list = unsafe { &mut *(data.0 as *mut Vec<Monitor>) };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if unsafe { GetMonitorInfoW(handle, &mut info as *mut _ as *mut _) }.as_bool() {
            let end = info
                .szDevice
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(0);
            list.push(Monitor {
                handle,
                rect: rect(info.monitorInfo.rcMonitor),
                work: rect(info.monitorInfo.rcWork),
                name: String::from_utf16_lossy(&info.szDevice[..end]),
                friendly: String::new(),
                path: String::new(),
            });
        }
        TRUE
    }
    let mut list: Vec<Monitor> = Vec::new();
    let _ = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM(&mut list as *mut _ as isize),
        )
    };
    let names: Vec<String> = list.iter().map(|monitor| monitor.name.clone()).collect();
    for (monitor, row) in list.iter_mut().zip(crate::monitors::describe(&names)) {
        monitor.friendly = row.friendly;
        monitor.path = row.path;
    }
    list
}

fn top_level_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
        unsafe { &mut *(data.0 as *mut Vec<HWND>) }.push(hwnd);
        TRUE
    }
    let mut list = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize)) };
    list
}

fn thread_process(hwnd: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// The process a window belongs to. A Store app's frame is hosted by ApplicationFrameHost; the app's own
/// process owns the CoreWindow inside it.
pub fn window_pid(hwnd: HWND, names: &mut Names) -> u32 {
    let pid = thread_process(hwnd);
    if names.name(pid) == Some("applicationframehost")
        && let Ok(core) =
            unsafe { FindWindowExW(Some(hwnd), None, w!("Windows.UI.Core.CoreWindow"), None) }
    {
        return thread_process(core);
    }
    pid
}

fn describe(hwnd: HWND, pid: u32) -> Win {
    let mut title = [0u16; 32768];
    let length = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    let mut cloaked = 0u32;
    let _ = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut _,
            size_of::<u32>() as u32,
        )
    };
    let minimized = unsafe { IsIconic(hwnd) }.as_bool();
    let mut bounds = RECT::default();
    let _ = unsafe { GetWindowRect(hwnd, &mut bounds) };
    Win {
        hwnd: hwnd.0 as isize,
        pid,
        visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
        owned: unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|owner| !owner.is_invalid()),
        tool: style & WS_EX_TOOLWINDOW.0 != 0,
        app_window: style & WS_EX_APPWINDOW.0 != 0,
        cloaked: cloaked != 0,
        minimized,
        sized: minimized || (bounds.right - bounds.left > 1 && bounds.bottom - bounds.top > 1),
        title: String::from_utf16_lossy(&title[..length]),
    }
}

pub fn hwnd(win: &Win) -> HWND {
    HWND(win.hwnd as *mut _)
}

/// One pass over the desktop. Process lookups are shared by everything asked during the pass.
pub struct Scan<'a> {
    pub names: &'a mut Names,
    windows: Vec<HWND>,
    processes: Option<Vec<(u32, String)>>,
    monitors: Option<Vec<Monitor>>,
    foreground: Option<u32>,
    foreground_root: isize,
    own: u32,
}

impl<'a> Scan<'a> {
    pub fn new(names: &'a mut Names) -> Self {
        let foreground = unsafe { GetForegroundWindow() };
        let foreground_root = unsafe { GetAncestor(foreground, GA_ROOTOWNER) }.0 as isize;
        let foreground = (!foreground.is_invalid()).then(|| window_pid(foreground, names));
        Self {
            names,
            windows: top_level_windows(),
            processes: None,
            monitors: None,
            foreground,
            foreground_root,
            own: unsafe { GetCurrentProcessId() },
        }
    }

    /// The app's top-level windows in Z order, hidden ones included, never this app's own.
    pub fn windows(&mut self, matcher: &Matcher) -> Vec<Win> {
        let mut found = Vec::new();
        for &handle in &self.windows {
            let pid = window_pid(handle, self.names);
            if pid != self.own && matcher.matches(self.names, pid) {
                found.push(describe(handle, pid));
            }
        }
        found
    }

    /// Every window a user would see, whichever app owns it.
    pub fn visible_windows(&mut self) -> Vec<Win> {
        let mut found = Vec::new();
        for &handle in &self.windows {
            let pid = window_pid(handle, self.names);
            let win = describe(handle, pid);
            if pid != self.own && is_app_window(&win) {
                found.push(win);
            }
        }
        found
    }

    /// Pids of every process with the matcher's image name, windows or not.
    pub fn pids(&mut self, matcher: &Matcher) -> Vec<u32> {
        let Some(exe) = &matcher.exe else {
            return Vec::new();
        };
        let list = self.processes.get_or_insert_with(process_list);
        list.iter()
            .filter(|(_, name)| name == exe)
            .map(|(pid, _)| *pid)
            .collect()
    }

    pub fn monitors(&mut self) -> &[Monitor] {
        self.monitors.get_or_insert_with(monitors)
    }

    pub fn foreground_root(&self) -> isize {
        self.foreground_root
    }

    pub fn state(&mut self, matcher: &Matcher) -> AppState {
        let wins = self.windows(matcher);
        let alive = !self.pids(matcher).is_empty();
        let display = wins
            .iter()
            .find(|win| is_app_window(win))
            .map(|win| self.display_of(win))
            .unwrap_or_default();
        fold(&wins, alive, self.foreground, display)
    }

    fn display_of(&mut self, win: &Win) -> String {
        let handle = unsafe { MonitorFromWindow(hwnd(win), MONITOR_DEFAULTTONEAREST) };
        self.monitors()
            .iter()
            .find(|monitor| monitor.handle == handle)
            .map(|monitor| monitor.friendly.clone())
            .unwrap_or_default()
    }
}

fn process_list() -> Vec<(u32, String)> {
    let mut out = Vec::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return out;
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while more {
        let end = entry
            .szExeFile
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(0);
        out.push((
            entry.th32ProcessID,
            crate::audio::model::normalize_target(&String::from_utf16_lossy(
                &entry.szExeFile[..end],
            )),
        ));
        more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(snapshot) };
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_POPUP,
    };

    struct HiddenWindow(HWND);

    impl Drop for HiddenWindow {
        fn drop(&mut self) {
            unsafe { DestroyWindow(self.0) }.unwrap();
        }
    }

    fn hidden(owner: Option<HWND>, tool: bool) -> HiddenWindow {
        HiddenWindow(
            unsafe {
                CreateWindowExW(
                    if tool {
                        WS_EX_TOOLWINDOW
                    } else {
                        WINDOW_EX_STYLE::default()
                    },
                    w!("STATIC"),
                    w!("Steam test Friends"),
                    WS_POPUP,
                    -32000,
                    -32000,
                    100,
                    100,
                    owner,
                    None,
                    None,
                    None,
                )
            }
            .unwrap(),
        )
    }

    #[test]
    fn native_snapshot_reads_titles_and_ownership_without_showing_test_windows() {
        let main = hidden(None, false);
        let dialog = hidden(Some(main.0), false);
        let tool = hidden(None, true);
        let pid = unsafe { GetCurrentProcessId() };
        let main_win = describe(main.0, pid);
        assert_eq!(main_win.title, "Steam test Friends");
        assert!(!main_win.owned && !main_win.visible);
        assert!(describe(dialog.0, pid).owned);
        assert!(describe(tool.0, pid).tool);
        assert_eq!(unsafe { GetAncestor(dialog.0, GA_ROOTOWNER) }, main.0);
        for window in [main.0, dialog.0, tool.0] {
            assert!(!unsafe { IsWindowVisible(window) }.as_bool());
        }
    }
}
