//! The dashboard lives in the tray: its menu opens the control panel, toggles the dashboard and quits.
use crate::panel;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager};

fn toggle_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
}

pub fn install(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "panel", "Open control panel", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit SupaDashboard", true, None::<&str>)?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("SupaDashboard")
        .menu(&Menu::with_items(app, &[&open, &toggle, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "panel" => panel::spawn_open(app.clone()),
            "toggle" => toggle_dashboard(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                panel::toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
