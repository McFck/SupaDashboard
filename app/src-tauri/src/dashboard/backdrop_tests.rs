use super::corner_bands;
use super::{Backdrop, create_window};
use std::cell::Cell;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyWindow, GW_HWNDNEXT, GWL_EXSTYLE, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
    HWND_TOPMOST, IsWindowVisible, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    SetWindowPos, WM_WINDOWPOSCHANGED, WM_WINDOWPOSCHANGING, WS_EX_TOPMOST,
};

struct TestWindow(HWND);

impl Drop for TestWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.0) }.unwrap();
    }
}

unsafe extern "system" fn count_placements(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    if message == WM_WINDOWPOSCHANGING || message == WM_WINDOWPOSCHANGED {
        let count = unsafe { &*(data as *const Cell<usize>) };
        count.set(count.get() + 1);
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[test]
fn repeated_dashboard_events_settle_without_repositioning_or_reshowing_the_backdrop() {
    let dashboard = TestWindow(create_window().unwrap());
    unsafe {
        SetWindowPos(
            dashboard.0,
            None,
            0,
            0,
            100,
            100,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    }
    .unwrap();
    let count = Cell::new(0usize);
    let backdrop = Box::new(Backdrop::new(dashboard.0));
    // An owned source avoids depending on Explorer or changing the real desktop in this native test.
    backdrop.source.set(Some(dashboard.0));
    backdrop.configure(true, 0.0).unwrap();
    let window = backdrop.window.get().expect("backdrop must be created");
    assert!(unsafe { IsWindowVisible(window).as_bool() });
    let foreground = unsafe { GetForegroundWindow() };
    assert!(
        unsafe {
            SetWindowSubclass(
                window,
                Some(count_placements),
                1,
                &count as *const Cell<usize> as usize,
            )
        }
        .as_bool()
    );

    for _ in 0..10 {
        backdrop.sync();
        backdrop.configure(true, 0.0).unwrap();
    }
    assert_eq!(
        count.get(),
        0,
        "unchanged notifications must not cause native placements"
    );

    let interloper = TestWindow(create_window().unwrap());
    unsafe {
        SetWindowPos(
            interloper.0,
            Some(dashboard.0),
            0,
            0,
            100,
            100,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    }
    .unwrap();
    backdrop.sync();
    assert_eq!(
        unsafe { GetWindow(dashboard.0, GW_HWNDNEXT) }.unwrap(),
        window
    );
    assert!(
        count.get() > 0,
        "real z-order changes must still be repaired"
    );
    unsafe {
        SetWindowPos(
            dashboard.0,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )
    }
    .unwrap();
    backdrop.sync();
    assert_ne!(
        unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOPMOST.0,
        0
    );
    let settled = count.get();
    backdrop.sync();
    assert_eq!(count.get(), settled);
    assert_eq!(unsafe { GetForegroundWindow() }, foreground);

    backdrop.configure(false, 0.0).unwrap();
    let hidden = count.get();
    backdrop.sync();
    assert_eq!(count.get(), hidden);
    assert!(!unsafe { IsWindowVisible(window).as_bool() });
    assert!(unsafe { RemoveWindowSubclass(window, Some(count_placements), 1) }.as_bool());
}

fn coverage(width: i32, height: i32, radius: i32) -> Vec<(i32, i32)> {
    let bands = corner_bands(width, height, radius);
    (0..height)
        .map(|row| {
            let covering: Vec<_> = bands
                .iter()
                .filter(|band| band.top <= row && row < band.bottom)
                .collect();
            assert_eq!(covering.len(), 1, "row {row} must be covered exactly once");
            (covering[0].left, covering[0].right)
        })
        .collect()
}

#[test]
fn rounded_bands_cover_every_row_once_and_leave_the_corners_out() {
    let rows = coverage(40, 20, 6);
    assert_eq!(
        rows[0],
        (4, 36),
        "the corner pixels stay uncovered, symmetrically"
    );
    assert_eq!(rows[19], rows[0], "top and bottom corners match");
    assert_eq!(rows[10], (0, 40), "the middle is full width");
    assert!(rows[..6].windows(2).all(|pair| pair[0].0 >= pair[1].0));
}

#[test]
fn a_square_or_oversized_radius_stays_inside_the_window() {
    assert_eq!(coverage(30, 10, 0), vec![(0, 30); 10]);
    assert_eq!(corner_bands(30, 10, 0).len(), 1);
    let pill = coverage(30, 10, 99);
    assert_eq!(pill.len(), 10);
    assert!(
        pill.iter()
            .all(|(left, right)| 0 <= *left && left < right && *right <= 30)
    );
}
