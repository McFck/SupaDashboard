#[cfg(not(windows))]
compile_error!("SupaDashboard builds for Windows only");

mod apps;
mod audio;
mod autostart;
mod content;
mod dashboard;
#[cfg(debug_assertions)]
mod dev_data;
mod media;
mod monitors;
mod panel;
mod plugin_host;
mod tray;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WindowEvent};

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    let context = dev_data::context(context);
    tauri::Builder::default()
        // First: a second launch (a double-clicked `.sdplugin`) hands its arguments over and exits, so two instances
        // never both own the dashboard.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            plugin_host::opened::opened(app, &args, std::path::Path::new(&cwd));
        }))
        .manage(plugin_host::opened::OpenedFile::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("plugin", |context, request| {
            plugin_host::protocol::serve(context.app_handle(), &request)
        })
        .setup(|app| {
            #[cfg(debug_assertions)]
            dev_data::seed(app.handle()).map_err(std::io::Error::other)?;
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Info
                    } else {
                        log::LevelFilter::Warn
                    })
                    .build(),
            )?;
            if let Some(main) = app.get_webview_window("main") {
                dashboard::policy::install(&main).map_err(std::io::Error::other)?;
            }
            app.manage(panel::PanelState::default());
            app.manage(
                audio::service::AudioService::start(app.handle().clone())
                    .map_err(std::io::Error::other)?,
            );
            app.manage(
                plugin_host::PluginHost::discover(app.handle()).map_err(std::io::Error::other)?,
            );
            if let Err(error) = plugin_host::power::watch(app.handle()) {
                log::warn!("Could not watch PC power events: {error}");
            }
            #[cfg(debug_assertions)]
            plugin_host::PluginHost::watch_dev(app.handle())?;
            app.manage(apps::watch::AppsHub::default());
            app.manage(media::MediaHub::new(app.handle()).map_err(std::io::Error::other)?);
            media::grant_saved_files(app.handle());
            tray::install(app)?;
            let args: Vec<String> = std::env::args().collect();
            plugin_host::opened::opened(app.handle(), &args, &std::env::current_dir()?);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                plugin_host::caps::release_webview(webview.app_handle(), webview.label());
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                plugin_host::caps::release_webview(window.app_handle(), window.label());
            }
            match window.label() {
                // The dashboard lives in the tray: closing hides it.
                "main" => {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                "panel" => panel::on_window_event(window, event),
                _ => return,
            }
            content::on_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            // Debug builds only: the release app has no dev data to copy.
            #[cfg(debug_assertions)]
            dev_data::copy_settings_to_release,
            content::content_frames_ready,
            panel::panel_bootstrap,
            panel::panel_ready,
            panel::snap::panel_snap_button,
            monitors::monitor_names,
            autostart::autostart_get,
            autostart::autostart_set,
            dashboard::commands::dashboard_set_bounds,
            dashboard::commands::dashboard_interaction_mode,
            dashboard::commands::dashboard_touch_window_action,
            dashboard::commands::dashboard_backdrop,
            dashboard::commands::dashboard_set_shown,
            audio::service::audio_snapshot,
            audio::service::audio_update,
            plugin_host::install::plugin_catalogue,
            plugin_host::install::plugin_install,
            plugin_host::install::plugin_inspect_file,
            plugin_host::install::plugin_install_file,
            plugin_host::install::plugin_uninstall,
            plugin_host::opened::plugin_opened_file,
            plugin_host::plugin_list,
            plugin_host::caps::storage::plugin_storage_read,
            plugin_host::caps::storage::plugin_storage_write,
            plugin_host::caps::storage::plugin_storage_remove,
            plugin_host::caps::storage::plugin_storage_list,
            plugin_host::caps::http::plugin_http_request,
            plugin_host::caps::secrets::plugin_secrets_read,
            plugin_host::caps::secrets::plugin_secrets_write,
            plugin_host::caps::oauth::plugin_oauth_sign_in,
            plugin_host::caps::oauth::plugin_oauth_pkce,
            plugin_host::caps::oauth::plugin_oauth_exchange,
            plugin_host::caps::oauth::plugin_oauth_refresh,
            plugin_host::caps::oauth::plugin_oauth_sign_out,
            plugin_host::caps::open::plugin_open,
            plugin_host::caps::pipe::plugin_pipe_open,
            plugin_host::caps::pipe::plugin_pipe_send,
            plugin_host::caps::pipe::plugin_pipe_close,
            plugin_host::caps::process::plugin_process_run,
            plugin_host::caps::process::plugin_process_spawn,
            plugin_host::caps::process::plugin_process_write,
            plugin_host::caps::process::plugin_process_kill,
            plugin_host::caps::process::plugin_process_on_power_off,
            plugin_host::caps::signin::plugin_signin_open,
            plugin_host::caps::signin::plugin_signin_sign_out,
            plugin_host::caps::automation::plugin_automation_watch,
            plugin_host::caps::automation::plugin_automation_invoke,
            plugin_host::caps::browser::plugin_browser_watch,
            plugin_host::caps::browser::plugin_browser_unwatch,
            plugin_host::caps::browser::plugin_browser_pair,
            plugin_host::caps::browser::plugin_browser_unpair,
            plugin_host::caps::browser::plugin_browser_action,
            plugin_host::caps::browser::plugin_browser_scroll,
            plugin_host::caps::displays::plugin_displays_list,
            apps::apps_list,
            apps::apps_icon,
            apps::app_command,
            apps::app_windows,
            apps::apps_watch,
            apps::apps_unwatch,
            media::media_command,
            media::media_sessions_subscribe,
            media::media_sessions_unsubscribe,
            media::media_artwork_resolve,
        ])
        .run(context)
        .expect("error while building tauri application");
}
