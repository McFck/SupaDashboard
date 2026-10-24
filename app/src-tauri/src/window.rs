use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

const SUBCLASS_ID: usize = 0x5355_5041;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Geometry {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResizeHit {
    NorthWest,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
}

fn scaled_dip(value: i32, dpi: u32) -> i32 {
    ((i64::from(value) * i64::from(if dpi == 0 { 96 } else { dpi }) + 48) / 96).max(1) as i32
}

fn resize_hit(rect: Geometry, point: (i32, i32), dpi: u32, fullscreen: bool) -> Option<ResizeHit> {
    if fullscreen {
        return None;
    }
    let left = i32::try_from(rect.x).ok()?;
    let top = i32::try_from(rect.y).ok()?;
    let width = i32::try_from(rect.width).ok()?.max(1);
    let height = i32::try_from(rect.height).ok()?.max(1);
    let right = left.checked_add(width)?;
    let bottom = top.checked_add(height)?;
    let (x, y) = point;
    if x < left || x >= right || y < top || y >= bottom {
        return None;
    }

    let band_x = scaled_dip(12, dpi).min((width / 2).max(1));
    let band_y = scaled_dip(12, dpi).min((height / 2).max(1));
    let reach_x = scaled_dip(32, dpi).min((width / 2).max(1));
    let reach_y = scaled_dip(32, dpi).min((height / 2).max(1));
    let west = x < left + band_x;
    let east = x >= right - band_x;
    let north = y < top + band_y;
    let south = y >= bottom - band_y;
    if !(west || east || north || south) {
        return None;
    }

    let near_west = x - left < reach_x;
    let near_east = right - 1 - x < reach_x;
    let near_north = y - top < reach_y;
    let near_south = bottom - 1 - y < reach_y;
    if (west || north) && near_west && near_north {
        Some(ResizeHit::NorthWest)
    } else if (east || north) && near_east && near_north {
        Some(ResizeHit::NorthEast)
    } else if (east || south) && near_east && near_south {
        Some(ResizeHit::SouthEast)
    } else if (west || south) && near_west && near_south {
        Some(ResizeHit::SouthWest)
    } else if north {
        Some(ResizeHit::North)
    } else if east {
        Some(ResizeHit::East)
    } else if south {
        Some(ResizeHit::South)
    } else if west {
        Some(ResizeHit::West)
    } else {
        None
    }
}

fn dashboard_visible(is_visible: bool, minimized: bool) -> bool {
    is_visible && !minimized
}

#[cfg(windows)]
mod win32 {
    use super::{Geometry, ResizeHit, SUBCLASS_ID, dashboard_visible, resize_hit};
    use serde::Serialize;
    use std::mem::size_of;
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
    use windows::Win32::Foundation::{
        GetLastError, HWND, LPARAM, LRESULT, RECT, SetLastError, WIN32_ERROR, WPARAM,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
    };
    use windows::Win32::UI::Shell::{
        DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GWL_STYLE, GetWindowLongPtrW, GetWindowRect, HTBOTTOM, HTBOTTOMLEFT,
        HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT, IsIconic, IsWindowVisible,
        MA_NOACTIVATE, PA_NOACTIVATE, SC_MAXIMIZE, SC_MOVE, SC_SIZE, STYLESTRUCT, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SendMessageW, SetWindowLongPtrW,
        SetWindowPos, WM_CANCELMODE, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOUSEACTIVATE,
        WM_NCDESTROY, WM_NCHITTEST, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_POINTERACTIVATE,
        WM_SHOWWINDOW, WM_SIZE, WM_STYLECHANGING,
        WM_SYSCOMMAND, WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_MAXIMIZEBOX,
    };

    struct PolicyState {
        app: AppHandle,
        fullscreen: bool,
        hovered: bool,
        tracking_leave: bool,
        minimized: bool,
        revision: u64,
        resize_hit_test: bool,
        resizing: bool,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HoverEvent {
        hovered: bool,
        revision: u64,
        clear_client: bool,
    }

    #[derive(Clone, Serialize)]
    struct VisibilityEvent {
        visible: bool,
    }

    pub fn install(window: &WebviewWindow) -> Result<(), String> {
        window
            .set_focusable(false)
            .map_err(|error| format!("could not disable dashboard focusability: {error}"))?;
        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = HWND(raw_hwnd.0);
        let state = Box::into_raw(Box::new(PolicyState {
            app: window.app_handle().clone(),
            fullscreen: false,
            hovered: false,
            tracking_leave: false,
            minimized: unsafe { IsIconic(hwnd).as_bool() },
            revision: 0,
            resize_hit_test: false,
            resizing: false,
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
        Ok(())
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

    fn publish_hover(state: &mut PolicyState, hovered: bool, clear_client: bool) {
        if state.hovered == hovered && !clear_client {
            return;
        }
        state.hovered = hovered;
        state.revision = state.revision.wrapping_add(1);
        let app = state.app.clone();
        let payload = HoverEvent {
            hovered,
            revision: state.revision,
            clear_client,
        };
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to("main", "dashboard-hover", payload);
        });
    }

    fn publish_visibility(state: &PolicyState, visible: bool) {
        let app = state.app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to("main", "dashboard-visibility", VisibilityEvent { visible });
        });
    }

    fn publish_resize(state: &mut PolicyState, resizing: bool) {
        if state.resizing == resizing {
            return;
        }
        state.resizing = resizing;
        let app = state.app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to("main", "dashboard-resize", resizing);
        });
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
        let policy = unsafe { &mut *(reference_data as *mut PolicyState) };

        if message == WM_MOUSEACTIVATE {
            return LRESULT(MA_NOACTIVATE as isize);
        }
        if message == WM_POINTERACTIVATE {
            return LRESULT(PA_NOACTIVATE as isize);
        }
        if message == WM_SYSCOMMAND {
            let command = wparam.0 as u32 & 0xfff0;
            if command == SC_SIZE {
                policy.resize_hit_test = true;
            }
            if command == SC_MAXIMIZE
                || (policy.fullscreen && (command == SC_MOVE || command == SC_SIZE))
            {
                return LRESULT(0);
            }
        }
        if message == WM_NCHITTEST && !policy.resizing {
            policy.resize_hit_test = false;
        }
        if message == WM_NCHITTEST && !policy.fullscreen {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let bits = lparam.0 as u32;
                let point = (
                    i32::from((bits as u16) as i16),
                    i32::from(((bits >> 16) as u16) as i16),
                );
                let dpi = unsafe { GetDpiForWindow(hwnd) };
                let bounds = Geometry {
                    x: i64::from(rect.left),
                    y: i64::from(rect.top),
                    width: i64::from(rect.right - rect.left),
                    height: i64::from(rect.bottom - rect.top),
                };
                if let Some(hit) = resize_hit(bounds, point, dpi, false) {
                    policy.resize_hit_test = true;
                    return LRESULT(hit_code(hit) as isize);
                }
            }
        }
        if message == WM_NCMOUSEMOVE && !policy.fullscreen && !policy.tracking_leave {
            let mut track = TRACKMOUSEEVENT {
                cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_NONCLIENT | TME_LEAVE,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            policy.tracking_leave = unsafe { TrackMouseEvent(&mut track) }.is_ok();
            if policy.tracking_leave {
                publish_hover(policy, true, false);
            } else {
                publish_hover(policy, false, false);
            }
        }
        if message == WM_NCMOUSELEAVE {
            policy.tracking_leave = false;
            publish_hover(policy, false, false);
        }
        if message == WM_SHOWWINDOW && wparam.0 == 0 {
            policy.tracking_leave = false;
            publish_hover(policy, false, true);
        }
        if message == WM_ENTERSIZEMOVE {
            publish_resize(policy, policy.resize_hit_test);
        }
        if message == WM_EXITSIZEMOVE || message == WM_CANCELMODE {
            policy.resize_hit_test = false;
            publish_resize(policy, false);
        }
        if message == WM_STYLECHANGING && lparam.0 != 0 {
            let change = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
            match wparam.0 as i32 {
                value if value == GWL_STYLE.0 => change.styleNew = enforce_style(change.styleNew),
                value if value == GWL_EXSTYLE.0 => {
                    change.styleNew = enforce_ex_style(change.styleNew)
                }
                _ => {}
            }
        }
        if message == WM_NCDESTROY {
            policy.tracking_leave = false;
            publish_hover(policy, false, true);
            policy.resize_hit_test = false;
            publish_resize(policy, false);
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(dashboard_subclass), subclass_id) };
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            unsafe { drop(Box::from_raw(reference_data as *mut PolicyState)) };
            return result;
        }
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if message == WM_SHOWWINDOW {
            let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
            let minimized = unsafe { IsIconic(hwnd).as_bool() };
            publish_visibility(policy, dashboard_visible(visible, minimized));
        } else if message == WM_SIZE {
            let minimized = unsafe { IsIconic(hwnd).as_bool() };
            if policy.minimized != minimized {
                policy.minimized = minimized;
                let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
                publish_visibility(policy, dashboard_visible(visible, minimized));
            }
        }
        result
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

    const fn enforce_style(style: u32) -> u32 {
        style & !(WS_CAPTION.0 | WS_MAXIMIZEBOX.0)
    }

    const fn enforce_ex_style(style: u32) -> u32 {
        style | WS_EX_NOACTIVATE.0 | WS_EX_NOREDIRECTIONBITMAP.0
    }

    pub fn set_bounds(hwnd: HWND, bounds: Geometry) -> Result<Geometry, String> {
        let x = i32::try_from(bounds.x).map_err(|_| "x is outside Win32 range".to_owned())?;
        let y = i32::try_from(bounds.y).map_err(|_| "y is outside Win32 range".to_owned())?;
        let width = i32::try_from(bounds.width)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| "width must be a positive Win32 integer".to_owned())?;
        let height = i32::try_from(bounds.height)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| "height must be a positive Win32 integer".to_owned())?;

        unsafe {
            SendMessageW(hwnd, WM_CANCELMODE, Some(WPARAM(0)), Some(LPARAM(0)));
            SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .map_err(|error| format!("dashboard SetWindowPos failed: {error}"))?;
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect)
                .map_err(|error| format!("could not read dashboard bounds: {error}"))?;
            Ok(Geometry {
                x: i64::from(rect.left),
                y: i64::from(rect.top),
                width: i64::from(rect.right - rect.left),
                height: i64::from(rect.bottom - rect.top),
            })
        }
    }

    pub fn set_interaction_mode(window: &WebviewWindow, fullscreen: bool) -> Result<(), String> {
        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = HWND(raw_hwnd.0);
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
        let policy = unsafe { &mut *(reference_data as *mut PolicyState) };
        policy.fullscreen = fullscreen;
        policy.tracking_leave = false;
        policy.resize_hit_test = false;
        publish_resize(policy, false);
        publish_hover(policy, false, true);
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::{enforce_ex_style, enforce_style};
        use windows::Win32::UI::WindowsAndMessaging::{
            WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_MAXIMIZEBOX, WS_THICKFRAME,
            WS_VISIBLE,
        };

        #[test]
        fn style_policy_removes_caption_and_maximize_but_keeps_resize_and_visibility() {
            let input = WS_CAPTION.0 | WS_MAXIMIZEBOX.0 | WS_THICKFRAME.0 | WS_VISIBLE.0 | 0x4000;
            let output = enforce_style(input);
            assert_eq!(output & (WS_CAPTION.0 | WS_MAXIMIZEBOX.0), 0);
            assert_eq!(output & WS_THICKFRAME.0, WS_THICKFRAME.0);
            assert_eq!(output & WS_VISIBLE.0, WS_VISIBLE.0);
            assert_eq!(output & 0x4000, 0x4000);
        }

        #[test]
        fn extended_style_policy_preserves_topmost_and_forces_composition_flags() {
            let topmost = 0x0000_0008;
            let output = enforce_ex_style(topmost);
            assert_eq!(output & topmost, topmost);
            assert_eq!(output & WS_EX_NOACTIVATE.0, WS_EX_NOACTIVATE.0);
            assert_eq!(
                output & WS_EX_NOREDIRECTIONBITMAP.0,
                WS_EX_NOREDIRECTIONBITMAP.0
            );
        }
    }
}

pub fn install_dashboard_policy(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        win32::install(window)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(())
    }
}

#[tauri::command]
pub async fn dashboard_set_bounds(app: AppHandle, bounds: Geometry) -> Result<Geometry, String> {
    validate_bounds(bounds)?;
    #[cfg(windows)]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = handle
                .get_webview_window("main")
                .ok_or_else(|| "dashboard main window is unavailable".to_owned())
                .and_then(|window| {
                    let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
                    win32::set_bounds(windows::Win32::Foundation::HWND(raw_hwnd.0), bounds)
                });
            let _ = sender.try_send(result);
        })
        .map_err(|error| format!("could not dispatch bounds to the UI thread: {error}"))?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "dashboard UI thread dropped the bounds result".to_owned())?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("atomic dashboard bounds are only available on Windows".to_owned())
    }
}

#[tauri::command]
pub async fn dashboard_interaction_mode(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = handle
                .get_webview_window("main")
                .ok_or_else(|| "dashboard main window is unavailable".to_owned())
                .and_then(|window| win32::set_interaction_mode(&window, fullscreen));
            let _ = sender.try_send(result);
        })
        .map_err(|error| {
            format!("could not dispatch interaction mode to the UI thread: {error}")
        })?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "dashboard UI thread dropped the interaction mode result".to_owned())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, fullscreen);
        Ok(())
    }
}

fn validate_bounds(bounds: Geometry) -> Result<(), String> {
    i32::try_from(bounds.x).map_err(|_| "x is outside Win32 range".to_owned())?;
    i32::try_from(bounds.y).map_err(|_| "y is outside Win32 range".to_owned())?;
    if !(1..=i32::MAX as i64).contains(&bounds.width) {
        return Err("width must be a positive Win32 integer".to_owned());
    }
    if !(1..=i32::MAX as i64).contains(&bounds.height) {
        return Err("height must be a positive Win32 integer".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Geometry, ResizeHit, dashboard_visible, resize_hit, validate_bounds};

    #[test]
    fn dashboard_visibility_requires_a_shown_non_minimized_window() {
        assert!(dashboard_visible(true, false));
        assert!(!dashboard_visible(false, false));
        assert!(!dashboard_visible(true, true));
        assert!(!dashboard_visible(false, true));
    }

    #[test]
    fn validates_signed_positions_and_positive_win32_dimensions() {
        assert!(
            validate_bounds(Geometry {
                x: -1920,
                y: 0,
                width: 770,
                height: 392
            })
            .is_ok()
        );
        assert!(
            validate_bounds(Geometry {
                x: i32::MAX as i64 + 1,
                y: 0,
                width: 1,
                height: 1
            })
            .is_err()
        );
        assert!(
            validate_bounds(Geometry {
                x: 0,
                y: 0,
                width: 0,
                height: 1
            })
            .is_err()
        );
        assert!(
            validate_bounds(Geometry {
                x: 0,
                y: 0,
                width: i32::MAX as i64 + 1,
                height: 1
            })
            .is_err()
        );
    }

    #[test]
    fn resize_hit_covers_all_directions_and_keeps_the_interior_client_area() {
        let rect = Geometry {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
        };
        let cases = [
            ((2, 2), ResizeHit::NorthWest),
            ((100, 2), ResizeHit::North),
            ((198, 2), ResizeHit::NorthEast),
            ((198, 50), ResizeHit::East),
            ((198, 98), ResizeHit::SouthEast),
            ((100, 98), ResizeHit::South),
            ((2, 98), ResizeHit::SouthWest),
            ((2, 50), ResizeHit::West),
        ];
        for (point, expected) in cases {
            assert_eq!(
                resize_hit(rect, point, 96, false),
                Some(expected),
                "{point:?}"
            );
        }
        assert_eq!(resize_hit(rect, (100, 50), 96, false), None);
        assert_eq!(resize_hit(rect, (-1, 50), 96, false), None);
        assert_eq!(resize_hit(rect, (200, 50), 96, false), None);
    }

    #[test]
    fn resize_hit_scales_edges_handles_negative_origins_and_suppresses_fullscreen() {
        let rect = Geometry {
            x: -1920,
            y: -200,
            width: 800,
            height: 600,
        };
        assert_eq!(
            resize_hit(rect, (-1912, -100), 144, false),
            Some(ResizeHit::West)
        );
        assert_eq!(
            resize_hit(rect, (-1909, -100), 192, false),
            Some(ResizeHit::West)
        );
        assert_eq!(resize_hit(rect, (-1902, -100), 144, false), None);
        assert_eq!(resize_hit(rect, (-1896, -100), 192, false), None);
        assert_eq!(
            resize_hit(rect, (-1918, -198), 96, false),
            Some(ResizeHit::NorthWest)
        );
        assert_eq!(resize_hit(rect, (-1918, -198), 96, true), None);
    }

    #[test]
    fn resize_hit_bounds_handles_for_tiny_windows_and_respects_edge_boundaries() {
        let tiny = Geometry {
            x: 10,
            y: 20,
            width: 8,
            height: 8,
        };
        assert_eq!(
            resize_hit(tiny, (10, 20), 96, false),
            Some(ResizeHit::NorthWest)
        );
        assert_eq!(
            resize_hit(tiny, (17, 27), 96, false),
            Some(ResizeHit::SouthEast)
        );
        let normal = Geometry {
            x: 0,
            y: 0,
            width: 200,
            height: 100,
        };
        assert_eq!(resize_hit(normal, (12, 50), 96, false), None);
        assert_eq!(
            resize_hit(normal, (11, 50), 96, false),
            Some(ResizeHit::West)
        );
        assert_eq!(resize_hit(normal, (11, 31), 96, false), Some(ResizeHit::NorthWest));
        assert_eq!(resize_hit(normal, (11, 32), 96, false), Some(ResizeHit::West));
        assert_eq!(resize_hit(normal, (31, 11), 96, false), Some(ResizeHit::NorthWest));
        assert_eq!(resize_hit(normal, (32, 11), 96, false), Some(ResizeHit::North));
    }
}
