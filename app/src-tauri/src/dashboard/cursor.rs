//! Native cursor projection and input provenance for the dashboard's input surface only.
use std::{cell::RefCell, time::Instant};
use tauri::Emitter;
use windows::Win32::{
    Foundation::{HWND, LPARAM, POINT, WPARAM},
    UI::{
        Input::{
            GetCurrentInputMessageSource, IMDT_MOUSE, IMDT_PEN, IMDT_TOUCH, IMDT_TOUCHPAD,
            IMO_HARDWARE, IMO_INJECTED, IMO_SYSTEM, INPUT_MESSAGE_SOURCE,
            Pointer::{GetPointerInfo, POINTER_INFO},
        },
        WindowsAndMessaging::{
            GA_ROOT, GetAncestor, GetCursorPos, GetMessageExtraInfo, PT_PEN, PT_TOUCH,
            SendMessageW, SetCursor, WM_MOUSEMOVE, WM_NCHITTEST, WM_SETCURSOR, WindowFromPoint,
        },
    },
};

#[derive(Default)]
struct Mode {
    visible: bool,
    contact: Option<(POINT, Instant)>,
}

impl Mode {
    fn mouse(
        &mut self,
        source: INPUT_MESSAGE_SOURCE,
        extra: isize,
        point: POINT,
        now: Instant,
        moved: bool,
    ) -> Option<bool> {
        if super::policy::is_pointer_synthesized(extra)
            || matches!(source.deviceType, IMDT_TOUCH | IMDT_PEN)
            || matches!(source.originId, IMO_INJECTED | IMO_SYSTEM)
        {
            self.contact = Some((point, now));
            return Some(false);
        }
        let compatibility = self.contact.is_some_and(|(last, time)| {
            now.duration_since(time).as_millis() < 1000
                && (i64::from(last.x) - i64::from(point.x)).abs() <= 4
                && (i64::from(last.y) - i64::from(point.y)).abs() <= 4
        });
        (moved
            && !compatibility
            && matches!(source.deviceType, IMDT_MOUSE | IMDT_TOUCHPAD)
            && source.originId == IMO_HARDWARE)
            .then_some(true)
    }
}

#[derive(Default)]
pub(super) struct Cursor(RefCell<Mode>);

impl Cursor {
    pub fn visible(&self) -> bool {
        self.0.borrow().visible
    }

    pub fn pointer(&self, hwnd: HWND, wp: WPARAM, app: &tauri::AppHandle) {
        let mut info = POINTER_INFO::default();
        if unsafe { GetPointerInfo((wp.0 & 0xffff) as u32, &mut info) }.is_ok()
            && matches!(info.pointerType, PT_TOUCH | PT_PEN)
        {
            self.0.borrow_mut().contact = Some((info.ptPixelLocation, Instant::now()));
            self.set(false, app);
            hide_over_dashboard(hwnd);
        }
    }

    pub fn mouse(&self, hwnd: HWND, moved: bool, app: &tauri::AppHandle) {
        // Read before SendMessage forwards to Chromium: forwarded messages lose their provenance.
        let mut source = INPUT_MESSAGE_SOURCE::default();
        let mut point = POINT::default();
        if unsafe { GetCurrentInputMessageSource(&mut source) }.is_err()
            || unsafe { GetCursorPos(&mut point) }.is_err()
        {
            return;
        }
        let extra = unsafe { GetMessageExtraInfo() }.0;
        let visible = self
            .0
            .borrow_mut()
            .mouse(source, extra, point, Instant::now(), moved);
        if let Some(visible) = visible {
            let was_visible = self.visible();
            self.set(visible, app);
            if visible && !was_visible {
                // WM_SETCURSOR precedes WM_MOUSEMOVE; refresh after switching out of touch mode.
                unsafe {
                    let position = (point.x as u16 as u32) | ((point.y as u16 as u32) << 16);
                    let hit =
                        SendMessageW(hwnd, WM_NCHITTEST, None, Some(LPARAM(position as isize)));
                    SendMessageW(
                        hwnd,
                        WM_SETCURSOR,
                        Some(WPARAM(hwnd.0 as usize)),
                        Some(LPARAM(
                            ((WM_MOUSEMOVE << 16) | hit.0 as u16 as u32) as isize,
                        )),
                    );
                }
            } else if !visible {
                hide_over_dashboard(hwnd);
            }
        }
    }

    pub fn leave(&self, app: &tauri::AppHandle) {
        self.set(false, app);
    }

    fn set(&self, visible: bool, app: &tauri::AppHandle) {
        if self.0.borrow().visible == visible {
            return;
        }
        self.0.borrow_mut().visible = visible;
        if let Err(error) = app.emit_to("main", "dashboard-cursor", visible) {
            log::error!("dashboard cursor update failed: {error}");
        }
    }
}

fn hide_over_dashboard(hwnd: HWND) {
    let mut point = POINT::default();
    unsafe {
        if GetCursorPos(&mut point).is_ok()
            && GetAncestor(WindowFromPoint(point), GA_ROOT) == GetAncestor(hwnd, GA_ROOT)
        {
            SetCursor(None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use windows::Win32::UI::Input::{IMDT_UNAVAILABLE, IMO_UNAVAILABLE};

    #[test]
    fn injected_and_promoted_contacts_cannot_reveal_the_cursor() {
        let now = Instant::now();
        let point = POINT { x: 20, y: 30 };
        for (device_type, origin, extra) in [
            (IMDT_TOUCH, IMO_HARDWARE, 0),
            (IMDT_PEN, IMO_HARDWARE, 0),
            (IMDT_MOUSE, IMO_INJECTED, 0),
            (IMDT_MOUSE, IMO_SYSTEM, 0),
            (IMDT_MOUSE, IMO_HARDWARE, 0xff51_5780),
        ] {
            let mut mode = Mode::default();
            let source = INPUT_MESSAGE_SOURCE {
                deviceType: device_type,
                originId: origin,
            };
            assert_eq!(mode.mouse(source, extra, point, now, true), Some(false));
            let mouse = INPUT_MESSAGE_SOURCE {
                deviceType: IMDT_MOUSE,
                originId: IMO_HARDWARE,
            };
            assert_eq!(mode.mouse(mouse, 0, point, now, true), None);
            assert_eq!(
                mode.mouse(mouse, 0, POINT { x: 40, y: 30 }, now, true),
                Some(true)
            );
            assert_eq!(
                mode.mouse(mouse, 0, point, now + Duration::from_secs(1), true),
                Some(true)
            );
            assert_eq!(
                mode.mouse(mouse, 0, POINT { x: 40, y: 30 }, now, false),
                None
            );
        }
        let unknown = INPUT_MESSAGE_SOURCE {
            deviceType: IMDT_UNAVAILABLE,
            originId: IMO_UNAVAILABLE,
        };
        assert_eq!(Mode::default().mouse(unknown, 0, point, now, true), None);
    }
}
