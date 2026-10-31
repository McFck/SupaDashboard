use super::MonitorGuard;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetWindowRect, IsWindowVisible, SWP_NOACTIVATE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SetWindowPos, WINDOW_EX_STYLE, WINDOWPOS, WM_WINDOWPOSCHANGING, WS_POPUP,
};
use windows::core::w;

unsafe extern "system" fn guard_position(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    if message == WM_WINDOWPOSCHANGING {
        let guard = unsafe { &*(data as *const MonitorGuard) };
        guard.changing(hwnd, unsafe { &mut *(lparam.0 as *mut WINDOWPOS) });
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[test]
fn missing_monitor_blocks_native_relocation_and_reveal_before_the_position_changes() {
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            None,
            WS_POPUP,
            -32000,
            -32000,
            100,
            100,
            None,
            None,
            None,
            None,
        )
    }
    .unwrap();
    let guard = MonitorGuard::default();
    guard.select(Some("missing-device-path".into())).unwrap();
    assert!(
        unsafe {
            SetWindowSubclass(
                hwnd,
                Some(guard_position),
                1,
                &guard as *const MonitorGuard as usize,
            )
        }
        .as_bool()
    );
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            -31000,
            -31000,
            200,
            200,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW,
        )
    }
    .unwrap();
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.unwrap();
    assert_eq!(
        (rect.left, rect.top, rect.right - rect.left),
        (-32000, -32000, 100)
    );
    assert!(!unsafe { IsWindowVisible(hwnd) }.as_bool());
    assert!(guard.blocked());

    // An explicit selection change releases the old monitor; the probe still stays hidden and off-screen.
    guard.select(None).unwrap();
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            -31900,
            -31900,
            100,
            100,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
    }
    .unwrap();
    unsafe { GetWindowRect(hwnd, &mut rect) }.unwrap();
    assert_eq!((rect.left, rect.top), (-31900, -31900));
    assert!(!unsafe { IsWindowVisible(hwnd) }.as_bool());
    unsafe {
        assert!(RemoveWindowSubclass(hwnd, Some(guard_position), 1).as_bool());
        DestroyWindow(hwnd).unwrap();
    }
}

#[test]
fn malformed_native_monitor_requests_are_rejected() {
    let guard = MonitorGuard::default();
    guard.select(Some("chosen-path".into())).unwrap();
    for invalid in [String::new(), "path\0suffix".into(), "x".repeat(4097)] {
        assert!(guard.select(Some(invalid)).is_err());
    }
}
