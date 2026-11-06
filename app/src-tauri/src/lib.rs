#[cfg(not(windows))]
compile_error!("SupaDashboard builds for Windows only");

mod apps;
mod audio;
mod content;
mod dashboard;
#[cfg(debug_assertions)]
mod dev_data;
mod discord;
mod http;
mod work;
mod lyrics;
mod media;
mod monitors;
mod panel;
mod plugin_host;
mod secure;
mod spotify;
mod tray;

use tauri::{Manager, WindowEvent};

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    let context = dev_data::context(context);
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            app.manage(apps::watch::AppsHub::default());
            app.manage(discord::DiscordHub::default());
            app.manage(work::Work::default());
            app.manage(spotify::SpotifyHub::default());
            app.manage(lyrics::LyricsHub::default());
            app.manage(lyrics::offsets::LyricsOffsets::default());
            app.manage(media::MediaHub::new(app.handle()).map_err(std::io::Error::other)?);
            media::grant_saved_files(app.handle());
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
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
            if matches!(event, WindowEvent::Destroyed) {
                window
                    .state::<spotify::SpotifyHub>()
                    .unsubscribe(window.label());
            }
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
            dashboard::commands::dashboard_set_bounds,
            dashboard::commands::dashboard_interaction_mode,
            dashboard::commands::dashboard_touch_window_action,
            dashboard::commands::dashboard_backdrop,
            dashboard::commands::dashboard_set_shown,
            audio::service::audio_snapshot,
            audio::service::audio_update,
            plugin_host::plugin_call,
            plugin_host::plugin_set_enabled,
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
            discord::discord_subscribe,
            discord::discord_unsubscribe,
            discord::discord_authorize,
            discord::discord_logout,
            discord::discord_voice,
            work::work_meetings,
            work::work_photos,
            work::work_session,
            work::work_sign_in,
            work::work_sign_out,
            work::work_call_state,
            work::work_call,
            work::work_join,
            spotify::spotify_subscribe,
            spotify::spotify_unsubscribe,
            spotify::spotify_authorize,
            spotify::spotify_logout,
            spotify::spotify_command,
            spotify::shuffle::spotify_shuffle,
            lyrics::lyrics_get,
            lyrics::offsets::lyrics_offset_get,
            lyrics::offsets::lyrics_offset_set,
        ])
        .run(context)
        .expect("error while building tauri application");
}
