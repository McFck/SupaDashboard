//! The dashboard window's native behaviour: never take focus, a resize border, and hover, resize and visibility
//! events for the frontend. It is a window subclass, so every handler runs on the UI thread.
use super::events::Events;
use super::geometry::{Geometry, ResizeHit, resize_hit};
use std::cell::Cell;
use std::mem::size_of;
use tauri::{Manager, WebviewWindow};
use windows::Win32::Foundation::{
    GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, SetLastError, WIN32_ERROR, WPARAM,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows::Win32::UI::Shell::{
    DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GetAncestor, GetCursorPos, GetWindowLongPtrW,
    GetWindowRect, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT,
    HTTOPRIGHT, IsIconic, IsWindowVisible, MA_NOACTIVATE, PA_NOACTIVATE, SC_MAXIMIZE, SC_MOVE,
    SC_SIZE, STYLESTRUCT, SW_HIDE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, ShowWindow, WM_CANCELMODE, WM_ENTERSIZEMOVE,
    WM_EXITSIZEMOVE, WM_MOUSEACTIVATE, WM_NCDESTROY, WM_NCHITTEST, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE,
    WM_POINTERACTIVATE, WM_SHOWWINDOW, WM_SIZE, WM_STYLECHANGING, WM_SYSCOMMAND, WS_CAPTION,
    WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_MAXIMIZEBOX, WindowFromPoint,
};

/// Identifies our subclass on the window ("SUPA").
const SUBCLASS_ID: usize = 0x5355_5041;
/// The low four bits of a WM_SYSCOMMAND wParam are used by the system.
const SYSCOMMAND_MASK: u32 = 0xfff0;

/// Only ever borrowed shared: `DefSubclassProc` runs the modal size loop, which re-enters the subclass proc and
/// runs Tao's queued closures (`set_interaction_mode`), so a `&mut` held across it would alias.
struct PolicyState {
    events: Events,
    fullscreen: Cell<bool>,
    minimized: Cell<bool>,
    resize_hit_test: Cell<bool>,
}

pub fn hwnd_of(window: &WebviewWindow) -> Result<HWND, String> {
    let raw = window.hwnd().map_err(|error| error.to_string())?;
    Ok(HWND(raw.0))
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_focusable(false)
        .map_err(|error| format!("could not disable dashboard focusability: {error}"))?;
    let hwnd = hwnd_of(window)?;
    let state = Box::into_raw(Box::new(PolicyState {
        events: Events::new(window.app_handle().clone()),
        fullscreen: Cell::new(false),
        minimized: Cell::new(unsafe { IsIconic(hwnd).as_bool() }),
        resize_hit_test: Cell::new(false),
    }));
    let installed = unsafe {
        SetWindowSubclass(hwnd, Some(dashboard_subclass), SUBCLASS_ID, state as usize).as_bool()
    };
    if !installed {
        let code = unsafe { GetLastError().0 };
        unsafe { drop(Box::from_raw(state)) };
        return Err(format!("SetWindowSubclass failed with Win32 error {code}"));
    }

    if let Err(error) = apply_style_policy(hwnd) {
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(dashboard_subclass), SUBCLASS_ID) };
        unsafe { drop(Box::from_raw(state)) };
        return Err(error);
    }
    hide_tauri_resize_border(hwnd);
    Ok(())
}

/// Tauri covers an undecorated window's outer frame with a `TAURI_DRAG_RESIZE_BORDERS` child that resizes natively.
/// Over it the page never sees the pointer, so the edge cues stay off, and its thin band sits under the rounded
/// shell's clipped corners. The page's own grips own the whole edge instead (`ResizeGrips.svelte`). Tauri only
/// repositions the child afterwards and never shows it again, because the dashboard never toggles resizability.
fn hide_tauri_resize_border(hwnd: HWND) {
    let border = unsafe {
        FindWindowExW(
            Some(hwnd),
            None,
            windows::core::w!("TAURI_DRAG_RESIZE_BORDERS"),
            None,
        )
    };
    if let Ok(border) = border {
        let _ = unsafe { ShowWindow(border, SW_HIDE) };
    }
}

pub fn set_interaction_mode(window: &WebviewWindow, fullscreen: bool) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let mut reference_data = 0usize;
    let found = unsafe {
        GetWindowSubclass(
            hwnd,
            Some(dashboard_subclass),
            SUBCLASS_ID,
            Some(&mut reference_data),
        )
        .as_bool()
    };
    if !found || reference_data == 0 {
        return Err("dashboard window interaction policy is not installed".to_owned());
    }
    let policy = unsafe { &*(reference_data as *const PolicyState) };
    policy.fullscreen.set(fullscreen);
    super::touch_surface::cancel(hwnd);
    clear_pointer_state(policy);
    Ok(())
}

pub fn touch_window_action(
    window: &WebviewWindow,
    action: super::touch_window::TouchWindowAction,
) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let mut data = 0;
    if !unsafe { GetWindowSubclass(hwnd, Some(dashboard_subclass), SUBCLASS_ID, Some(&mut data)) }
        .as_bool()
        || data == 0
    {
        return Err("dashboard window interaction policy is not installed".into());
    }
    // SAFETY: the policy is installed on this live window; this command runs on its UI thread.
    let policy = unsafe { &*(data as *const PolicyState) };
    if policy.fullscreen.get() {
        return Err("window touch gestures are disabled in fullscreen".into());
    }
    super::touch_surface::begin_window_action(hwnd, action)
}

fn apply_style_policy(hwnd: HWND) -> Result<(), String> {
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;
    let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    let next_style = enforce_style(style);
    let next_ex_style = enforce_ex_style(ex_style);

    if next_style != style {
        set_window_long_checked(hwnd, GWL_STYLE, next_style as isize)?;
    }
    if next_ex_style != ex_style {
        set_window_long_checked(hwnd, GWL_EXSTYLE, next_ex_style as isize)?;
    }

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|error| format!("dashboard frame refresh failed: {error}"))
    }
}

fn set_window_long_checked(
    hwnd: HWND,
    index: windows::Win32::UI::WindowsAndMessaging::WINDOW_LONG_PTR_INDEX,
    value: isize,
) -> Result<(), String> {
    unsafe {
        SetLastError(WIN32_ERROR(0));
        let previous = SetWindowLongPtrW(hwnd, index, value);
        let error = GetLastError();
        if previous == 0 && error.0 != 0 {
            Err(format!(
                "SetWindowLongPtrW failed with Win32 error {}",
                error.0
            ))
        } else {
            Ok(())
        }
    }
}

const fn enforce_style(style: u32) -> u32 {
    style & !(WS_CAPTION.0 | WS_MAXIMIZEBOX.0)
}

const fn enforce_ex_style(style: u32) -> u32 {
    style | WS_EX_NOACTIVATE.0 | WS_EX_NOREDIRECTIONBITMAP.0
}

/// Ends any resize gesture and hover the frontend still believes in.
fn clear_pointer_state(policy: &PolicyState) {
    policy.resize_hit_test.set(false);
    policy.events.resize(false);
    policy.events.hover(false, true);
}

unsafe extern "system" fn dashboard_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    if reference_data == 0 {
        return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    }
    let policy = unsafe { &*(reference_data as *const PolicyState) };

    let answer = match message {
        WM_MOUSEACTIVATE => Some(LRESULT(MA_NOACTIVATE as isize)),
        WM_POINTERACTIVATE => Some(LRESULT(PA_NOACTIVATE as isize)),
        WM_SYSCOMMAND => on_syscommand(policy, wparam),
        WM_NCHITTEST => on_hit_test(policy, hwnd, lparam),
        WM_NCMOUSEMOVE | WM_NCMOUSELEAVE => {
            on_mouse_move(policy, hwnd);
            None
        }
        WM_SHOWWINDOW if wparam.0 == 0 => {
            super::touch_surface::cancel(hwnd);
            policy.events.hover(false, true);
            None
        }
        WM_ENTERSIZEMOVE => {
            policy.events.resize(policy.resize_hit_test.get());
            None
        }
        WM_EXITSIZEMOVE | WM_CANCELMODE => {
            super::touch_surface::cancel(hwnd);
            policy.resize_hit_test.set(false);
            policy.events.resize(false);
            None
        }
        WM_STYLECHANGING => {
            on_style_changing(wparam, lparam);
            None
        }
        WM_NCDESTROY => {
            return on_destroy(policy, hwnd, wparam, lparam, subclass_id, reference_data);
        }
        _ => None,
    };
    if let Some(answer) = answer {
        return answer;
    }

    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    match message {
        // WS_VISIBLE is set only after WM_SHOWWINDOW returns, so the message's wParam is the new state.
        WM_SHOWWINDOW => {
            let minimized = unsafe { IsIconic(hwnd).as_bool() };
            policy.events.visibility(wparam.0 != 0 && !minimized);
        }
        WM_SIZE => {
            if let Err(error) = super::touch_surface::resize(hwnd) {
                log::error!("could not resize dashboard input surface: {error}");
            }
            let minimized = unsafe { IsIconic(hwnd).as_bool() };
            if policy.minimized.get() != minimized {
                policy.minimized.set(minimized);
                let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
                policy.events.visibility(visible && !minimized);
            }
        }
        _ => {}
    }
    result
}

fn on_syscommand(policy: &PolicyState, wparam: WPARAM) -> Option<LRESULT> {
    let command = wparam.0 as u32 & SYSCOMMAND_MASK;
    if command == SC_SIZE {
        policy.resize_hit_test.set(true);
    }
    let blocked = command == SC_MAXIMIZE
        || (policy.fullscreen.get() && (command == SC_MOVE || command == SC_SIZE));
    blocked.then_some(LRESULT(0))
}

fn on_hit_test(policy: &PolicyState, hwnd: HWND, lparam: LPARAM) -> Option<LRESULT> {
    if !policy.events.is_resizing() {
        policy.resize_hit_test.set(false);
    }
    if policy.fullscreen.get() {
        return None;
    }
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
    let bits = lparam.0 as u32;
    let point = (
        i32::from((bits as u16) as i16),
        i32::from(((bits >> 16) as u16) as i16),
    );
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let hit = resize_hit(Geometry::from(rect), point, dpi)?;
    policy.resize_hit_test.set(true);
    Some(LRESULT(hit_code(hit) as isize))
}

fn hit_code(hit: ResizeHit) -> u32 {
    match hit {
        ResizeHit::NorthWest => HTTOPLEFT,
        ResizeHit::North => HTTOP,
        ResizeHit::NorthEast => HTTOPRIGHT,
        ResizeHit::East => HTRIGHT,
        ResizeHit::SouthEast => HTBOTTOMRIGHT,
        ResizeHit::South => HTBOTTOM,
        ResizeHit::SouthWest => HTBOTTOMLEFT,
        ResizeHit::West => HTLEFT,
    }
}

fn on_mouse_move(policy: &PolicyState, hwnd: HWND) {
    let mut point = POINT::default();
    let mut rect = RECT::default();
    let position = unsafe { GetCursorPos(&mut point) };
    let bounds = unsafe { GetWindowRect(hwnd, &mut rect) };
    let target = unsafe { WindowFromPoint(point) };
    let hovered = !policy.fullscreen.get()
        && position.is_ok()
        && bounds.is_ok()
        && unsafe { GetAncestor(target, GA_ROOT) } == hwnd
        && resize_hit(rect.into(), (point.x, point.y), unsafe {
            GetDpiForWindow(hwnd)
        })
        .is_some();
    policy.events.hover(hovered, false);
    if !hovered {
        return;
    }
    // The transparent input child can own the resize band; tracking its parent posts an immediate leave.
    let mut track = TRACKMOUSEEVENT {
        cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
        dwFlags: TME_NONCLIENT | TME_LEAVE,
        hwndTrack: target,
        dwHoverTime: 0,
    };
    if let Err(error) = unsafe { TrackMouseEvent(&mut track) } {
        log::warn!("dashboard edge leave tracking failed: {error}");
    }
}

fn on_style_changing(wparam: WPARAM, lparam: LPARAM) {
    if lparam.0 == 0 {
        return;
    }
    let change = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
    match wparam.0 as i32 {
        value if value == GWL_STYLE.0 => change.styleNew = enforce_style(change.styleNew),
        value if value == GWL_EXSTYLE.0 => change.styleNew = enforce_ex_style(change.styleNew),
        _ => {}
    }
}

fn on_destroy(
    policy: &PolicyState,
    hwnd: HWND,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    // Keep the original hover-before-resize revision order when the window is destroyed.
    policy.events.hover(false, true);
    policy.resize_hit_test.set(false);
    policy.events.resize(false);
    let _ = unsafe { RemoveWindowSubclass(hwnd, Some(dashboard_subclass), subclass_id) };
    let result = unsafe { DefSubclassProc(hwnd, WM_NCDESTROY, wparam, lparam) };
    unsafe { drop(Box::from_raw(reference_data as *mut PolicyState)) };
    result
}
