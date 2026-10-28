mod lifecycle;

use lifecycle::{PanelLifecycle, ReadyAction};
use std::sync::{Mutex, MutexGuard};

use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};

#[derive(Default)]
pub struct PanelState(Mutex<PanelLifecycle>);

impl PanelState {
    fn lock(&self) -> MutexGuard<'_, PanelLifecycle> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[derive(serde::Serialize)]
pub struct PanelBootstrap {
    pub generation: u64,
}

fn require_panel(window: &WebviewWindow) -> Result<(), String> {
    require_panel_label(window.label())
}

fn require_panel_label(label: &str) -> Result<(), String> {
    if label == "panel" {
        Ok(())
    } else {
        Err("panel command can only be called by the panel window".to_owned())
    }
}

#[tauri::command]
pub fn panel_bootstrap(
    window: WebviewWindow,
    state: tauri::State<'_, PanelState>,
) -> Result<PanelBootstrap, String> {
    require_panel(&window)?;
    Ok(PanelBootstrap {
        generation: state.lock().generation,
    })
}

#[tauri::command]
pub async fn panel_ready(
    window: WebviewWindow,
    state: tauri::State<'_, PanelState>,
    generation: u64,
) -> Result<bool, String> {
    require_panel(&window)?;
    let action = state.lock().mark_ready(generation);
    match action {
        ReadyAction::Stale => Ok(false),
        ReadyAction::Hidden => Ok(true),
        ReadyAction::Reveal => reveal_panel(window, &state, generation),
    }
}

fn reveal_panel(
    window: WebviewWindow,
    state: &PanelState,
    generation: u64,
) -> Result<bool, String> {
    // Window calls can race a close request; recheck before showing, focusing and completing the reveal.
    if state.lock().pending_focus(generation).is_none() {
        return Ok(false);
    }
    if window.is_minimized().map_err(|error| error.to_string())? {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    if state.lock().pending_focus(generation).is_none() {
        return Ok(false);
    }
    window.show().map_err(|error| error.to_string())?;
    let Some(focus) = state.lock().pending_focus(generation) else {
        let _ = window.hide();
        return Ok(false);
    };
    if focus {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    if state.lock().finish_reveal(generation) {
        Ok(true)
    } else {
        let _ = window.hide();
        Ok(false)
    }
}

fn create_panel(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("panel").is_some() {
        return Ok(());
    }
    let state = app.state::<PanelState>();
    if !state.lock().begin_creation() {
        return Ok(());
    }

    let page_app = app.clone();
    let built = WebviewWindowBuilder::new(&app, "panel", WebviewUrl::App("index.html".into()))
        .title("SupaDashboard")
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 620.0)
        .decorations(false)
        .visible(false)
        .focused(false)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(24, 24, 24, 255))
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Started || window.label() != "panel" {
                return;
            }
            let was_visible = window.is_visible().unwrap_or(false);
            page_app
                .state::<PanelState>()
                .lock()
                .navigation_started(was_visible);
            if was_visible && let Err(error) = window.hide() {
                log::warn!("could not hide panel for navigation: {error}");
            }
        })
        .build();

    match built {
        Ok(window) => {
            disable_window_transitions(&window);
            state.lock().creation_succeeded();
            Ok(())
        }
        Err(error) => {
            state.lock().creation_failed();
            Err(format!("could not create control panel: {error}"))
        }
    }
}

/// Windows fades decorated windows on show/hide; the tray toggle should be instant.
fn disable_window_transitions(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute,
        };
        use windows::core::BOOL;
        let disabled = BOOL(1);
        // SAFETY: the HWND belongs to the live panel window and the attribute value outlives the call.
        let result = unsafe {
            DwmSetWindowAttribute(
                HWND(hwnd.0 as _),
                DWMWA_TRANSITIONS_FORCEDISABLED,
                (&disabled as *const BOOL).cast(),
                std::mem::size_of::<BOOL>() as u32,
            )
        };
        if let Err(error) = result {
            log::warn!("could not disable panel transitions: {error}");
        }
    }
}

fn open_panel(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PanelState>();
    let (generation, ready) = state.lock().request_open();
    if let Some(window) = app.get_webview_window("panel") {
        if ready {
            reveal_panel(window, &state, generation)?;
        } else {
            // A page that never sent panel_ready (for example after a dev reload) would leave the open request
            // pending forever; reloading makes it handshake again and reveal.
            let _ = window.eval("location.reload()");
        }
        return Ok(());
    }
    create_panel(app)
}

/// Opens in the background; the tray cannot await.
pub fn spawn_open(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = open_panel(app) {
            log::error!("control panel open failed: {error}");
        }
    });
}

/// Builds the hidden panel at startup so the first tray click reveals a warm page.
pub fn spawn_preload(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = create_panel(app) {
            log::error!("control panel preload failed: {error}");
        }
    });
}

/// Hides like the close button: a pending reveal is cancelled.
fn hide(window: &WebviewWindow) {
    window
        .app_handle()
        .state::<PanelState>()
        .lock()
        .close_requested();
    let _ = window.hide();
}

/// The tray's left click: hides a visible panel, otherwise opens it.
pub fn toggle(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("panel")
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
    {
        hide(&window);
        return;
    }
    spawn_open(app.clone());
}

/// Closing hides the panel; destroying it resets its lifecycle.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            window
                .app_handle()
                .state::<PanelState>()
                .lock()
                .close_requested();
            let _ = window.hide();
        }
        WindowEvent::Destroyed => window.app_handle().state::<PanelState>().lock().destroyed(),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::require_panel_label;

    #[test]
    fn panel_commands_reject_other_windows() {
        assert!(require_panel_label("panel").is_ok());
        assert!(require_panel_label("main").is_err());
    }
}
