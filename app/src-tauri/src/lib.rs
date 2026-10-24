#[cfg(windows)]
mod media;
mod monitors;
mod panel;
#[cfg(windows)]
mod volume;
mod window;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/// The dashboard lives in the tray: closing hides it, the tray brings it back.
fn toggle_dashboard(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Some(main) = app.get_webview_window("main") {
                window::install_dashboard_policy(&main).map_err(std::io::Error::other)?;
            }
            app.manage(panel::PanelState::default());
            #[cfg(windows)]
            app.manage(
                volume::AudioService::start(app.handle().clone()).map_err(std::io::Error::other)?,
            );
            let panel = MenuItem::with_id(app, "panel", "Open control panel", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Show / hide dashboard", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit SupaDashboard", true, None::<&str>)?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("bundle icon"))
                .tooltip("SupaDashboard")
                .menu(&Menu::with_items(app, &[&panel, &toggle, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "panel" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = panel::open_panel(app).await {
                                log::error!("tray panel open failed: {error}");
                            }
                        });
                    }
                    "toggle" => toggle_dashboard(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = e
                    {
                        let app = tray.app_handle().clone();
                        // Left click toggles the control panel: a visible panel hides like its close button.
                        if let Some(window) = app.get_webview_window("panel") {
                            if window.is_visible().unwrap_or(false)
                                && !window.is_minimized().unwrap_or(false)
                            {
                                app.state::<panel::PanelState>().close_requested();
                                let _ = window.hide();
                                return;
                            }
                        }
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = panel::open_panel(app).await {
                                log::error!("tray panel open failed: {error}");
                            }
                        });
                    }
                })
                .build(app)?;
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = panel::preload_panel(app).await {
                    log::error!("control panel preload failed: {error}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "panel" {
                    api.prevent_close();
                    window
                        .app_handle()
                        .state::<panel::PanelState>()
                        .close_requested();
                    let _ = window.hide();
                }
            }
            if window.label() == "panel" && matches!(event, WindowEvent::Destroyed) {
                window.app_handle().state::<panel::PanelState>().destroyed();
            }
        })
        .invoke_handler(tauri::generate_handler![
            panel::open_panel,
            panel::panel_bootstrap,
            panel::panel_ready,
            monitors::monitor_names,
            window::dashboard_set_bounds,
            window::dashboard_interaction_mode,
            volume::audio_snapshot,
            volume::audio_update,
            media::media_state,
            media::media_command,
            volume::volume_get,
            volume::volume_set,
            volume::volume_mute,
            volume::audio_mixer
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
