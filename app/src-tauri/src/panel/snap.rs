//! Native hit target over the HTML maximize button so Windows 11 shows the Snap Layouts flyout.
//! Windows only asks for the flyout when the window under the cursor answers `HTMAXBUTTON`, which a WebView cannot
//! do. Like Tauri's own resize-border child, a transparent child window sits above the WebView and answers it.
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, FindWindowExW, GetParent, HTMAXBUTTON, HWND_TOP, IsZoomed,
    PostMessageW, RegisterClassExW, SC_MAXIMIZE, SC_RESTORE, SWP_NOACTIVATE, SetWindowPos,
    WINDOW_EX_STYLE, WM_ERASEBKGND, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP,
    WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SYSCOMMAND, WNDCLASSEXW, WS_CHILD, WS_VISIBLE,
};
use windows::core::{PCWSTR, w};

const CLASS: PCWSTR = w!("SUPADASHBOARD_SNAP_BUTTON");

// The window procedure has no handle of its own, and the panel is the only window that gets this child.
static APP: OnceLock<AppHandle> = OnceLock::new();
static HOVERED: AtomicBool = AtomicBool::new(false);

/// Places the hit target over the maximize button; `x`, `y`, `width` and `height` are physical client pixels.
#[tauri::command]
pub fn panel_snap_button(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    super::require_panel(&window)?;
    let _ = APP.set(window.app_handle().clone());
    let parent = HWND(window.hwnd().map_err(|error| error.to_string())?.0 as _);
    // SAFETY: the parent is the live panel window and this command runs on its UI thread, which must own the child.
    unsafe {
        let child = match FindWindowExW(Some(parent), None, CLASS, PCWSTR::null()) {
            Ok(child) => child,
            Err(_) => create_child(parent)?,
        };
        SetWindowPos(child, Some(HWND_TOP), x, y, width, height, SWP_NOACTIVATE)
            .map_err(|error| error.to_string())
    }
}

unsafe fn create_child(parent: HWND) -> Result<HWND, String> {
    unsafe {
        let instance = GetModuleHandleW(PCWSTR::null())
            .map_err(|error| error.to_string())?
            .into();
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: CLASS,
            ..Default::default()
        };
        // Zero means the class already exists from an earlier panel window, which is fine.
        RegisterClassExW(&class);
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            CLASS,
            PCWSTR::null(),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            0,
            0,
            Some(parent),
            None,
            Some(instance),
            None,
        )
        .map_err(|error| error.to_string())
    }
}

fn set_hovered(hovered: bool) {
    if HOVERED.swap(hovered, Ordering::Relaxed) != hovered
        && let Some(app) = APP.get()
    {
        let _ = app.emit_to("panel", "panel-snap-hover", hovered);
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        match msg {
            WM_NCHITTEST => LRESULT(HTMAXBUTTON as _),
            WM_ERASEBKGND => LRESULT(1),
            WM_NCMOUSEMOVE => {
                if !HOVERED.load(Ordering::Relaxed) {
                    let mut track = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE | TME_NONCLIENT,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    let _ = TrackMouseEvent(&mut track);
                }
                set_hovered(true);
                LRESULT(0)
            }
            WM_NCMOUSELEAVE => {
                set_hovered(false);
                LRESULT(0)
            }
            // Swallowed so the default caption-button tracking does not run; the click completes on release.
            WM_NCLBUTTONDOWN => LRESULT(0),
            WM_NCLBUTTONUP => {
                if let Ok(parent) = GetParent(hwnd) {
                    let command = if IsZoomed(parent).as_bool() {
                        SC_RESTORE
                    } else {
                        SC_MAXIMIZE
                    };
                    let _ = PostMessageW(
                        Some(parent),
                        WM_SYSCOMMAND,
                        WPARAM(command as usize),
                        LPARAM(0),
                    );
                }
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}
