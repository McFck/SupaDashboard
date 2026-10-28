use std::sync::{Mutex, MutexGuard};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
pub struct PanelState(Mutex<PanelLifecycle>);

#[derive(Default)]
struct PanelLifecycle {
    creating: bool,
    ready: bool,
    generation: u64,
    reveal_requested: bool,
    focus_requested: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum ReadyAction {
    Stale,
    Hidden,
    Reveal,
}

impl PanelLifecycle {
    fn begin_creation(&mut self) -> bool {
        if self.creating {
            return false;
        }
        self.creating = true;
        self.ready = false;
        true
    }

    fn creation_succeeded(&mut self) {
        self.creating = false;
    }

    fn creation_failed(&mut self) {
        self.creating = false;
        self.ready = false;
        self.reveal_requested = false;
        self.focus_requested = false;
    }

    fn request_open(&mut self) -> (u64, bool) {
        self.reveal_requested = true;
        self.focus_requested = true;
        (self.generation, self.ready)
    }

    fn navigation_started(&mut self, was_visible: bool) -> u64 {
        self.generation = self.generation.saturating_add(1);
        self.ready = false;
        if was_visible {
            self.reveal_requested = true;
        }
        self.generation
    }

    fn mark_ready(&mut self, generation: u64) -> ReadyAction {
        if generation != self.generation {
            return ReadyAction::Stale;
        }
        self.ready = true;
        if self.reveal_requested {
            ReadyAction::Reveal
        } else {
            ReadyAction::Hidden
        }
    }

    fn pending_focus(&self, generation: u64) -> Option<bool> {
        (generation == self.generation && self.ready && self.reveal_requested)
            .then_some(self.focus_requested)
    }

    fn finish_reveal(&mut self, generation: u64) -> bool {
        if generation != self.generation || !self.ready || !self.reveal_requested {
            return false;
        }
        self.reveal_requested = false;
        self.focus_requested = false;
        true
    }

    fn close_requested(&mut self) {
        self.reveal_requested = false;
        self.focus_requested = false;
    }

    fn destroyed(&mut self) {
        self.creating = false;
        self.ready = false;
        self.generation = self.generation.saturating_add(1);
        self.reveal_requested = false;
        self.focus_requested = false;
    }
}

impl PanelState {
    fn lock(&self) -> MutexGuard<'_, PanelLifecycle> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn begin_creation(&self) -> bool {
        self.lock().begin_creation()
    }

    fn creation_succeeded(&self) {
        self.lock().creation_succeeded();
    }

    fn creation_failed(&self) {
        self.lock().creation_failed();
    }

    fn request_open(&self) -> (u64, bool) {
        self.lock().request_open()
    }

    fn navigation_started(&self, was_visible: bool) -> u64 {
        self.lock().navigation_started(was_visible)
    }

    fn mark_ready(&self, generation: u64) -> ReadyAction {
        self.lock().mark_ready(generation)
    }

    fn pending_focus(&self, generation: u64) -> Option<bool> {
        self.lock().pending_focus(generation)
    }

    fn finish_reveal(&self, generation: u64) -> bool {
        self.lock().finish_reveal(generation)
    }

    pub fn close_requested(&self) {
        self.lock().close_requested();
    }

    pub fn destroyed(&self) {
        self.lock().destroyed();
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
    let action = state.mark_ready(generation);
    match action {
        ReadyAction::Stale => Ok(false),
        ReadyAction::Hidden => Ok(true),
        ReadyAction::Reveal => reveal_panel(window, &state, generation).await,
    }
}

async fn reveal_panel(
    window: WebviewWindow,
    state: &PanelState,
    generation: u64,
) -> Result<bool, String> {
    if state.pending_focus(generation).is_none() {
        return Ok(false);
    }
    if window.is_minimized().map_err(|error| error.to_string())? {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    if state.pending_focus(generation).is_none() {
        return Ok(false);
    }
    window.show().map_err(|error| error.to_string())?;
    let Some(focus) = state.pending_focus(generation) else {
        let _ = window.hide();
        return Ok(false);
    };
    if focus {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    if state.finish_reveal(generation) {
        Ok(true)
    } else {
        let _ = window.hide();
        Ok(false)
    }
}

async fn create_panel(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("panel").is_some() {
        return Ok(());
    }
    let state = app.state::<PanelState>();
    if !state.begin_creation() {
        return Ok(());
    }

    let page_app = app.clone();
    let built = WebviewWindowBuilder::new(&app, "panel", WebviewUrl::App("index.html".into()))
        .title("SupaDashboard · Control panel")
        .inner_size(1360.0, 860.0)
        .min_inner_size(960.0, 620.0)
        .decorations(true)
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
                .navigation_started(was_visible);
            if was_visible {
                if let Err(error) = window.hide() {
                    log::warn!("could not hide panel for navigation: {error}");
                }
            }
        })
        .build();

    match built {
        Ok(window) => {
            disable_window_transitions(&window);
            state.creation_succeeded();
            Ok(())
        }
        Err(error) => {
            state.creation_failed();
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

pub async fn preload_panel(app: AppHandle) -> Result<(), String> {
    create_panel(app).await
}

pub async fn open_panel(app: AppHandle) -> Result<(), String> {
    let state = app.state::<PanelState>();
    let (generation, ready) = state.request_open();
    if let Some(window) = app.get_webview_window("panel") {
        if ready {
            reveal_panel(window, &state, generation).await?;
        } else {
            // A page that never sent panel_ready (for example after a dev reload) would leave the open request
            // pending forever; reloading makes it handshake again and reveal.
            let _ = window.eval("location.reload()");
        }
        return Ok(());
    }
    create_panel(app).await
}

#[cfg(test)]
mod tests {
    use super::{PanelLifecycle, ReadyAction, require_panel_label};

    #[test]
    fn preload_ready_stays_hidden() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        let generation = state.navigation_started(false);
        state.creation_succeeded();
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        assert_eq!(state.pending_focus(generation), None);
    }

    #[test]
    fn repeated_opens_during_creation_build_once_and_reveal_once() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        assert_eq!(state.request_open(), (0, false));
        assert_eq!(state.request_open(), (0, false));
        assert!(!state.begin_creation());
        let generation = state.navigation_started(false);
        state.creation_succeeded();
        assert_eq!(state.mark_ready(generation), ReadyAction::Reveal);
        assert_eq!(state.pending_focus(generation), Some(true));
        assert!(state.finish_reveal(generation));
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
    }

    #[test]
    fn close_before_ready_cancels_the_pending_reveal() {
        let mut state = PanelLifecycle::default();
        state.begin_creation();
        state.request_open();
        let generation = state.navigation_started(false);
        state.close_requested();
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
    }

    #[test]
    fn navigation_invalidates_an_old_ready_generation() {
        let mut state = PanelLifecycle::default();
        let old = state.navigation_started(false);
        state.request_open();
        let current = state.navigation_started(false);
        assert!(current > old);
        assert_eq!(state.mark_ready(old), ReadyAction::Stale);
        assert_eq!(state.mark_ready(current), ReadyAction::Reveal);
    }

    #[test]
    fn visible_reload_reveals_again_without_stealing_focus() {
        let mut state = PanelLifecycle::default();
        let first = state.navigation_started(false);
        state.request_open();
        assert_eq!(state.mark_ready(first), ReadyAction::Reveal);
        assert!(state.finish_reveal(first));
        let reload = state.navigation_started(true);
        assert_eq!(state.mark_ready(reload), ReadyAction::Reveal);
        assert_eq!(state.pending_focus(reload), Some(false));
    }

    #[test]
    fn creation_failure_releases_single_flight_for_retry() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        state.request_open();
        state.creation_failed();
        assert!(state.begin_creation());
        assert_eq!(state.pending_focus(state.generation), None);
    }

    #[test]
    fn close_to_hide_keeps_readiness_for_warm_reopen() {
        let mut state = PanelLifecycle::default();
        let generation = state.navigation_started(false);
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        state.close_requested();
        assert!(state.request_open().1);
        assert_eq!(state.mark_ready(generation), ReadyAction::Reveal);
    }

    #[test]
    fn destroyed_panel_resets_readiness_and_advances_generation() {
        let mut state = PanelLifecycle::default();
        let generation = state.navigation_started(false);
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        state.destroyed();
        assert!(state.generation > generation);
        assert_eq!(state.mark_ready(generation), ReadyAction::Stale);
        assert!(!state.ready);
    }

    #[test]
    fn panel_commands_reject_other_windows() {
        assert!(require_panel_label("panel").is_ok());
        assert!(require_panel_label("main").is_err());
    }
}
