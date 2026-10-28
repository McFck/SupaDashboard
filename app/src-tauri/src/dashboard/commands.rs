//! The two commands the frontend uses to place and configure the dashboard window.
use super::geometry::Geometry;
use super::policy::{hwnd_of, set_interaction_mode};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, SWP_NOACTIVATE, SWP_NOZORDER, SendMessageW, SetWindowPos, WM_CANCELMODE,
};

#[tauri::command]
pub async fn dashboard_set_bounds(app: AppHandle, bounds: Geometry) -> Result<Geometry, String> {
    on_main_window(&app, "bounds", move |window| {
        set_bounds(hwnd_of(&window)?, bounds)
    })
    .await
}

#[tauri::command]
pub async fn dashboard_interaction_mode(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    on_main_window(&app, "interaction mode", move |window| {
        set_interaction_mode(&window, fullscreen)
    })
    .await
}

/// Window calls must run on the UI thread; the result comes back over a channel.
async fn on_main_window<T: Send + 'static>(
    app: &AppHandle,
    operation: &'static str,
    work: impl FnOnce(WebviewWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = handle
            .get_webview_window("main")
            .ok_or_else(|| "dashboard main window is unavailable".to_owned())
            .and_then(work);
        let _ = sender.try_send(result);
    })
    .map_err(|error| format!("could not dispatch {operation} to the UI thread: {error}"))?;
    receiver
        .recv()
        .await
        .ok_or_else(|| format!("dashboard UI thread dropped the {operation} result"))?
}

fn set_bounds(hwnd: HWND, bounds: Geometry) -> Result<Geometry, String> {
    let (x, y, width, height) = bounds.to_win32()?;
    let place = || unsafe {
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
        let mut rect = Default::default();
        GetWindowRect(hwnd, &mut rect)
            .map_err(|error| format!("could not read dashboard bounds: {error}"))?;
        Ok::<_, String>(Geometry::from(rect))
    };

    unsafe { SendMessageW(hwnd, WM_CANCELMODE, Some(WPARAM(0)), Some(LPARAM(0))) };
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let placed = place()?;
    // Moving onto a monitor with another DPI sends WM_DPICHANGED inside that SetWindowPos, and Tao applies the
    // OS-suggested rectangle, scaled by the DPI ratio; the OS can also adjust a size. The window now has the
    // destination's DPI, so the requested physical rectangle is reapplied once. Returning the scaled one made
    // the saved window shrink on every cross-DPI restart.
    if placed != bounds || unsafe { GetDpiForWindow(hwnd) } != dpi {
        return place();
    }
    Ok(placed)
}
