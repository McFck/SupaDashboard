//! Move an app window without changing the foreground window.
use super::model::{Rect, relocate};
use super::windows::{Monitor, monitors, rect};
use std::mem::size_of;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{MONITOR_DEFAULTTONEAREST, MonitorFromWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, GetWindowPlacement, GetWindowRect, IsZoomed, SW_SHOWNOACTIVATE,
    SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPlacement, SetWindowPos, WINDOWPLACEMENT,
    WS_EX_TOOLWINDOW,
};

pub fn move_to(win: HWND, path: &str) -> Result<(), String> {
    let monitors = monitors();
    // Resolve the stored device path on every pass; enumeration order and handles can change.
    let Some(target) = monitors
        .iter()
        .find(|monitor| monitor.path.eq_ignore_ascii_case(path))
    else {
        return Ok(());
    };
    let source = unsafe { MonitorFromWindow(win, MONITOR_DEFAULTTONEAREST) };
    if source == target.handle {
        return Ok(());
    }
    let Some(source) = monitors.iter().find(|monitor| monitor.handle == source) else {
        return Ok(());
    };
    let mut bounds = RECT::default();
    unsafe { GetWindowRect(win, &mut bounds) }.map_err(|error| error.message())?;
    let maximized = unsafe { IsZoomed(win) }.as_bool();
    if rect(bounds) == source.rect && !maximized {
        // Preserve borderless fullscreen on the destination monitor.
        return position(win, target.rect);
    }
    let mut placement = WINDOWPLACEMENT {
        length: size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    unsafe { GetWindowPlacement(win, &mut placement) }.map_err(|error| error.message())?;
    // Tool windows use screen coordinates; other placements use workspace coordinates.
    let tool = unsafe { GetWindowLongPtrW(win, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW.0 != 0;
    let offset = |monitor: &Monitor| {
        if tool {
            (0, 0)
        } else {
            (
                monitor.work.left - monitor.rect.left,
                monitor.work.top - monitor.rect.top,
            )
        }
    };
    let (sx, sy) = offset(source);
    let normal = rect(placement.rcNormalPosition);
    let screen = Rect {
        left: normal.left + sx,
        top: normal.top + sy,
        right: normal.right + sx,
        bottom: normal.bottom + sy,
    };
    let moved = relocate(screen, source.work, target.work);
    if maximized {
        let mut restored = placement;
        restored.showCmd = SW_SHOWNOACTIVATE.0 as u32;
        restored.flags = Default::default();
        unsafe { SetWindowPlacement(win, &restored) }.map_err(|error| error.message())?;
    }
    position(win, moved)?;
    if maximized {
        let (tx, ty) = offset(target);
        placement.rcNormalPosition = RECT {
            left: moved.left - tx,
            top: moved.top - ty,
            right: moved.right - tx,
            bottom: moved.bottom - ty,
        };
        unsafe { SetWindowPlacement(win, &placement) }.map_err(|error| error.message())?;
    }
    Ok(())
}

fn position(win: HWND, to: Rect) -> Result<(), String> {
    unsafe {
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
    .map_err(|error| error.message())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetForegroundWindow, IsWindowVisible, WS_OVERLAPPEDWINDOW,
    };
    use windows::core::w;

    #[test]
    fn relocation_clamps_large_windows_on_negative_and_offset_work_areas() {
        let from = Rect {
            left: 40,
            top: 30,
            right: 1960,
            bottom: 1070,
        };
        let to = Rect {
            left: -1280,
            top: -900,
            right: 0,
            bottom: -40,
        };
        for window in [
            Rect {
                left: -200,
                top: -100,
                right: 400,
                bottom: 300,
            },
            Rect {
                left: 1800,
                top: 900,
                right: 4000,
                bottom: 2400,
            },
        ] {
            let moved = relocate(window, from, to);
            assert!(moved.left >= to.left && moved.right <= to.right);
            assert!(moved.top >= to.top && moved.bottom <= to.bottom);
            assert_eq!(moved.width(), window.width().min(to.width()));
            assert_eq!(moved.height(), window.height().min(to.height()));
        }
    }

    #[test]
    fn moving_a_hidden_test_window_never_shows_it_or_changes_foreground() {
        struct Hidden(HWND);
        impl Drop for Hidden {
            fn drop(&mut self) {
                unsafe { DestroyWindow(self.0) }.expect("destroy test window");
            }
        }
        let win = Hidden(
            unsafe {
                CreateWindowExW(
                    Default::default(),
                    w!("STATIC"),
                    w!("Display placement test"),
                    WS_OVERLAPPEDWINDOW,
                    -32000,
                    -32000,
                    400,
                    300,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("create hidden test window"),
        );
        let foreground = unsafe { GetForegroundWindow() };
        let mut before = RECT::default();
        unsafe { GetWindowRect(win.0, &mut before) }.unwrap();
        move_to(win.0, "missing-test-display").unwrap();
        let mut after = RECT::default();
        unsafe { GetWindowRect(win.0, &mut after) }.unwrap();
        assert_eq!(rect(before), rect(after));
        let screens = monitors();
        let source = unsafe { MonitorFromWindow(win.0, MONITOR_DEFAULTTONEAREST) };
        if let Some(target) = screens
            .iter()
            .find(|screen| screen.handle != source && !screen.path.is_empty())
        {
            move_to(win.0, &target.path.to_uppercase()).unwrap();
            unsafe { GetWindowRect(win.0, &mut after) }.unwrap();
            let moved = rect(after);
            assert!(moved.left >= target.work.left && moved.right <= target.work.right);
            assert!(moved.top >= target.work.top && moved.bottom <= target.work.bottom);
            assert_eq!(
                unsafe { MonitorFromWindow(win.0, MONITOR_DEFAULTTONEAREST) },
                target.handle
            );
            println!("Hidden test window moved between monitors");
        } else {
            println!("Cross-monitor native probe unavailable: fewer than two identified monitors");
        }
        assert!(!unsafe { IsWindowVisible(win.0) }.as_bool());
        assert_eq!(unsafe { GetForegroundWindow() }, foreground);
    }
}
