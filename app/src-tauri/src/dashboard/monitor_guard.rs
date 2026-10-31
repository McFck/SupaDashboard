//! Prevents Windows' automatic relocation from painting on an unselected monitor.
use std::cell::{Cell, RefCell};
use std::mem::size_of;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICEW, EnumDisplayDevicesW, GetMonitorInfoW,
    MONITOR_DEFAULTTONULL, MONITORINFOEXW, MonitorFromRect,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EDD_GET_DEVICE_INTERFACE_NAME, GetWindowRect, SW_HIDE, SWP_HIDEWINDOW, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, ShowWindow, WINDOWPOS,
};
use windows::core::PCWSTR;

#[derive(Default)]
pub struct MonitorGuard {
    selected: RefCell<Option<String>>,
    blocked: Cell<bool>,
    hiding: Cell<bool>,
}

fn decode(value: &[u16]) -> String {
    String::from_utf16_lossy(&value[..value.iter().position(|v| *v == 0).unwrap_or(value.len())])
}

fn matches_monitor(selected: &str, source: &[u16]) -> bool {
    if selected.eq_ignore_ascii_case(&decode(source)) {
        return true;
    }
    for index in 0..32 {
        let mut device = DISPLAY_DEVICEW {
            cb: size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        if !unsafe {
            EnumDisplayDevicesW(
                PCWSTR(source.as_ptr()),
                index,
                &mut device,
                EDD_GET_DEVICE_INTERFACE_NAME,
            )
        }
        .as_bool()
        {
            break;
        }
        if device.StateFlags.contains(DISPLAY_DEVICE_ACTIVE)
            && selected.eq_ignore_ascii_case(&decode(&device.DeviceID))
        {
            return true;
        }
    }
    false
}

impl MonitorGuard {
    pub fn select(&self, monitor: Option<String>) -> Result<(), String> {
        if monitor
            .as_ref()
            .is_some_and(|v| v.is_empty() || v.len() > 4096 || v.contains('\0'))
        {
            return Err("invalid dashboard monitor identity".into());
        }
        if *self.selected.borrow() != monitor {
            *self.selected.borrow_mut() = monitor;
            self.blocked.set(false);
        }
        Ok(())
    }

    pub fn blocked(&self) -> bool {
        self.blocked.get()
    }

    pub fn restore(&self, bounds: super::geometry::Geometry) -> Result<(), String> {
        let (x, y, width, height) = bounds.to_win32()?;
        let rect = RECT {
            left: x,
            top: y,
            right: x.saturating_add(width),
            bottom: y.saturating_add(height),
        };
        if !self.allows(&rect) {
            return Err("dashboard monitor is unavailable for placement".into());
        }
        self.blocked.set(false);
        Ok(())
    }

    fn allows(&self, rect: &RECT) -> bool {
        let selected = self.selected.borrow();
        let Some(selected) = selected.as_ref() else {
            return true;
        };
        let monitor = unsafe { MonitorFromRect(rect, MONITOR_DEFAULTTONULL) };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        unsafe { GetMonitorInfoW(monitor, &mut info.monitorInfo) }.as_bool()
            && matches_monitor(selected, &info.szDevice)
    }

    /// Called before DefSubclassProc applies a proposed position or WS_VISIBLE.
    pub fn changing(&self, hwnd: HWND, position: &mut WINDOWPOS) {
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if !position.flags.contains(SWP_NOMOVE) {
            rect.left = position.x;
            rect.top = position.y;
        }
        rect.right = rect
            .left
            .saturating_add(if position.flags.contains(SWP_NOSIZE) {
                width
            } else {
                position.cx
            });
        rect.bottom = rect
            .top
            .saturating_add(if position.flags.contains(SWP_NOSIZE) {
                height
            } else {
                position.cy
            });
        if !self.allows(&rect) {
            position.flags &= !SWP_SHOWWINDOW;
            position.flags |= SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW;
            self.hide(hwnd);
        } else if self.blocked.get() {
            position.flags &= !SWP_SHOWWINDOW;
            position.flags |= SWP_HIDEWINDOW;
        }
    }

    pub fn check(&self, hwnd: HWND) {
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() && !self.allows(&rect) {
            self.hide(hwnd);
        }
    }

    fn hide(&self, hwnd: HWND) {
        // Set first: ShowWindow re-enters the subclass with another WINDOWPOSCHANGING.
        self.blocked.set(true);
        if !self.hiding.replace(true) {
            let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
            self.hiding.set(false);
        }
    }
}

#[cfg(test)]
#[path = "monitor_guard_tests.rs"]
mod tests;
