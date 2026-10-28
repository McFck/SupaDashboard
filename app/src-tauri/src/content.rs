use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Manager, State, Url, WebviewWindow};

#[derive(Default)]
pub struct ContentObserverState {
    installed: Arc<Mutex<std::collections::HashSet<String>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameNavigationEvent {
    frame_key: String,
    navigation_id: u64,
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn generated_frame_key(name: &str) -> Option<&str> {
    let key = name.strip_prefix("content:")?;
    (!key.is_empty() && !key.chars().any(char::is_whitespace)).then_some(key)
}

fn allowed_web_url(raw: &str, app_origin: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let scheme_allowed =
        url.scheme() == "https" || url.scheme() == "http" && url.host_str() == Some("localhost");
    scheme_allowed
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin().ascii_serialization() != app_origin
        && !matches!(url.host_str(), Some("tauri.localhost" | "asset.localhost"))
}

fn local_application_origin(window: &WebviewWindow) -> Result<String, String> {
    if !matches!(window.label(), "main" | "panel") {
        return Err("content frame observer is limited to local application windows".into());
    }
    let url = window.url().map_err(|error| error.to_string())?;
    let origin = url.origin().ascii_serialization();
    let local = (url.scheme() == "http" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
        || (url.scheme() == "tauri" && url.host_str() == Some("localhost"));
    if !local {
        return Err("content frame observer requires a local application origin".into());
    }
    Ok(origin)
}

#[tauri::command]
pub async fn content_frames_ready(
    window: WebviewWindow,
    state: State<'_, ContentObserverState>,
) -> Result<bool, String> {
    let app_origin = local_application_origin(&window)?;
    if state
        .installed
        .lock()
        .map_err(|_| "content observer state is unavailable")?
        .contains(window.label())
    {
        return Ok(true);
    }
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    let installed = state.installed.clone();
    window
        .with_webview(move |webview| {
            let result = windows_observer::install(
                &app,
                &label,
                &app_origin,
                webview.controller(),
                &installed,
            );
            let _ = sender.try_send(result);
        })
        .map_err(|error| format!("could not schedule the frame observer: {error}"))?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "frame observer installation was canceled".to_owned())??;
    Ok(true)
}

pub fn forget_window(label: String, app: tauri::AppHandle, state: &ContentObserverState) {
    if let Ok(mut installed) = state.installed.lock() {
        installed.remove(&label);
    }
    let _ = app.run_on_main_thread(move || windows_observer::forget(label));
}

mod windows_observer {
    use std::{
        cell::RefCell,
        collections::{HashMap, HashSet},
        sync::{Arc, Mutex},
    };

    use tauri::{AppHandle, Emitter};
    use webview2_com::{
        FrameCreatedEventHandler, FrameDestroyedEventHandler, FrameNameChangedEventHandler,
        FrameNavigationCompletedEventHandler, FrameNavigationStartingEventHandler,
        Microsoft::Web::WebView2::Win32::*, take_pwstr,
    };
    use windows::core::{Interface, PWSTR};

    use super::{FrameNavigationEvent, allowed_web_url, generated_frame_key};

    thread_local! {
        static OBSERVERS: RefCell<HashMap<String, Observer>> = RefCell::new(HashMap::new());
    }

    #[derive(Default)]
    struct NavigationTrack {
        key: Option<String>,
        latest: Option<u64>,
        blocked: HashSet<u64>,
    }

    struct NativeFrame {
        frame: ICoreWebView2Frame,
        frame2: ICoreWebView2Frame2,
        name_token: i64,
        destroyed_token: i64,
        starting_token: i64,
        completed_token: i64,
    }

    pub struct Observer {
        core: ICoreWebView2_4,
        frame_created_token: i64,
        frames: Arc<Mutex<HashMap<usize, NativeFrame>>>,
    }

    impl Observer {
        pub fn detach(self) {
            unsafe {
                let _ = self.core.remove_FrameCreated(self.frame_created_token);
            }
            if let Ok(mut frames) = self.frames.lock() {
                for (_, frame) in frames.drain() {
                    detach_frame(frame);
                }
            }
        }
    }

    pub fn forget(label: String) {
        OBSERVERS.with(|observers| {
            if let Some(observer) = observers.borrow_mut().remove(&label) {
                observer.detach();
            }
        });
    }

    fn detach_frame(frame: NativeFrame) {
        unsafe {
            let _ = frame.frame.remove_NameChanged(frame.name_token);
            let _ = frame.frame.remove_Destroyed(frame.destroyed_token);
            let _ = frame.frame2.remove_NavigationStarting(frame.starting_token);
            let _ = frame
                .frame2
                .remove_NavigationCompleted(frame.completed_token);
        }
    }

    fn emit(
        app: &AppHandle,
        label: &str,
        track: &NavigationTrack,
        navigation_id: u64,
        phase: &'static str,
        success: Option<bool>,
        error: Option<String>,
    ) {
        let Some(frame_key) = track.key.clone() else {
            return;
        };
        let _ = app.emit_to(
            label,
            "content-frame-navigation",
            FrameNavigationEvent {
                frame_key,
                navigation_id,
                phase,
                success,
                error,
            },
        );
    }

    unsafe fn frame_name(frame: &ICoreWebView2Frame) -> windows::core::Result<String> {
        let mut name = PWSTR::null();
        unsafe {
            frame.Name(&mut name)?;
        }
        Ok(take_pwstr(name))
    }

    fn refresh_name(
        frame: &ICoreWebView2Frame,
        track: &Arc<Mutex<NavigationTrack>>,
        app: &AppHandle,
        label: &str,
    ) {
        let name = unsafe { frame_name(frame) }.unwrap_or_default();
        let key = generated_frame_key(&name).map(str::to_owned);
        if let Ok(mut track) = track.lock() {
            if track.key == key {
                return;
            }
            if let Some(previous) = track.key.take() {
                let _ = app.emit_to(
                    label,
                    "content-frame-navigation",
                    FrameNavigationEvent {
                        frame_key: previous,
                        navigation_id: track.latest.unwrap_or_default(),
                        phase: "destroyed",
                        success: None,
                        error: None,
                    },
                );
            }
            track.key = key;
            if let (Some(_), Some(id)) = (&track.key, track.latest) {
                emit(app, label, &track, id, "starting", None, None);
            }
        }
    }

    fn attach_frame(
        frame: ICoreWebView2Frame,
        app: AppHandle,
        label: String,
        app_origin: String,
        frames: Arc<Mutex<HashMap<usize, NativeFrame>>>,
    ) -> windows::core::Result<()> {
        let identity = frame.as_raw() as usize;
        if frames
            .lock()
            .map_err(|_| windows::core::Error::from_thread())?
            .contains_key(&identity)
        {
            return Ok(());
        }
        let frame2: ICoreWebView2Frame2 = frame.cast()?;
        let track = Arc::new(Mutex::new(NavigationTrack {
            key: unsafe { frame_name(&frame).ok() }
                .and_then(|name| generated_frame_key(&name).map(str::to_owned)),
            ..NavigationTrack::default()
        }));

        let name_frame = frame.clone();
        let name_track = track.clone();
        let name_app = app.clone();
        let name_label = label.clone();
        let name_handler = FrameNameChangedEventHandler::create(Box::new(move |_, _| {
            refresh_name(&name_frame, &name_track, &name_app, &name_label);
            Ok(())
        }));
        let mut name_token = 0;
        unsafe {
            frame.add_NameChanged(&name_handler, &mut name_token)?;
        }

        let destroy_track = track.clone();
        let destroy_app = app.clone();
        let destroy_label = label.clone();
        let destroy_frames = frames.clone();
        let destroy_handler = FrameDestroyedEventHandler::create(Box::new(move |_, _| {
            if let Ok(track) = destroy_track.lock() {
                if let Some(id) = track.latest {
                    emit(
                        &destroy_app,
                        &destroy_label,
                        &track,
                        id,
                        "destroyed",
                        None,
                        None,
                    );
                }
            }
            if let Ok(mut frames) = destroy_frames.lock() {
                if let Some(record) = frames.remove(&identity) {
                    unsafe {
                        let _ = record.frame.remove_NameChanged(record.name_token);
                        let _ = record
                            .frame2
                            .remove_NavigationStarting(record.starting_token);
                        let _ = record
                            .frame2
                            .remove_NavigationCompleted(record.completed_token);
                    }
                }
            }
            Ok(())
        }));
        let mut destroyed_token = 0;
        unsafe {
            frame.add_Destroyed(&destroy_handler, &mut destroyed_token)?;
        }

        let start_track = track.clone();
        let start_frame = frame.clone();
        let start_app = app.clone();
        let start_label = label.clone();
        let start_handler =
            FrameNavigationStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut navigation_id = 0;
                let mut uri = PWSTR::null();
                unsafe {
                    args.NavigationId(&mut navigation_id)?;
                    args.Uri(&mut uri)?;
                }
                let uri = take_pwstr(uri);
                let allowed = allowed_web_url(&uri, &app_origin);
                if !allowed {
                    unsafe {
                        args.SetCancel(true)?;
                    }
                }
                refresh_name(&start_frame, &start_track, &start_app, &start_label);
                if let Ok(mut track) = start_track.lock() {
                    track.latest = Some(navigation_id);
                    if allowed {
                        track.blocked.remove(&navigation_id);
                    } else {
                        track.blocked.insert(navigation_id);
                    }
                    emit(
                        &start_app,
                        &start_label,
                        &track,
                        navigation_id,
                        "starting",
                        None,
                        None,
                    );
                    if !allowed {
                        emit(
                            &start_app,
                            &start_label,
                            &track,
                            navigation_id,
                            "completed",
                            Some(false),
                            Some("blocked-navigation".into()),
                        );
                    }
                }
                Ok(())
            }));
        let mut starting_token = 0;
        unsafe {
            frame2.add_NavigationStarting(&start_handler, &mut starting_token)?;
        }

        let complete_track = track.clone();
        let complete_frame = frame.clone();
        let complete_app = app.clone();
        let complete_label = label.clone();
        let complete_handler =
            FrameNavigationCompletedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut navigation_id = 0;
                let mut is_success = windows::core::BOOL(0);
                let mut error_status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                unsafe {
                    args.NavigationId(&mut navigation_id)?;
                    args.IsSuccess(&mut is_success)?;
                    args.WebErrorStatus(&mut error_status)?;
                }
                refresh_name(
                    &complete_frame,
                    &complete_track,
                    &complete_app,
                    &complete_label,
                );
                if let Ok(track) = complete_track.lock() {
                    if track.latest == Some(navigation_id) {
                        let blocked = track.blocked.contains(&navigation_id);
                        emit(
                            &complete_app,
                            &complete_label,
                            &track,
                            navigation_id,
                            "completed",
                            Some(!blocked && is_success.as_bool()),
                            (!is_success.as_bool() || blocked)
                                .then(|| format!("web-error-{}", error_status.0)),
                        );
                    }
                }
                Ok(())
            }));
        let mut completed_token = 0;
        unsafe {
            frame2.add_NavigationCompleted(&complete_handler, &mut completed_token)?;
        }

        frames
            .lock()
            .map_err(|_| windows::core::Error::from_thread())?
            .insert(
                identity,
                NativeFrame {
                    frame,
                    frame2,
                    name_token,
                    destroyed_token,
                    starting_token,
                    completed_token,
                },
            );
        Ok(())
    }

    pub fn install(
        app: &AppHandle,
        label: &str,
        app_origin: &str,
        controller: ICoreWebView2Controller,
        installed: &Arc<Mutex<HashSet<String>>>,
    ) -> Result<(), String> {
        if OBSERVERS.with(|observers| observers.borrow().contains_key(label)) {
            return Ok(());
        }
        let core: ICoreWebView2 =
            unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
        let core: ICoreWebView2_4 = core
            .cast()
            .map_err(|error| format!("WebView2 frame events are unavailable: {error}"))?;
        let frames = Arc::new(Mutex::new(HashMap::<usize, NativeFrame>::new()));
        let app = app.clone();
        let label = label.to_owned();
        let observer_label = label.clone();
        let origin = app_origin.to_owned();
        let callback_frames = frames.clone();
        let handler = FrameCreatedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let frame = unsafe { args.Frame()? };
            attach_frame(
                frame,
                app.clone(),
                label.clone(),
                origin.clone(),
                callback_frames.clone(),
            )?;
            Ok(())
        }));
        let mut token = 0;
        unsafe {
            core.add_FrameCreated(&handler, &mut token)
                .map_err(|error| error.to_string())?;
        }
        let observer = Observer {
            core,
            frame_created_token: token,
            frames,
        };
        OBSERVERS.with(|observers| {
            observers
                .borrow_mut()
                .insert(observer_label.clone(), observer)
        });
        installed
            .lock()
            .map_err(|_| "content observer state is unavailable")?
            .insert(observer_label);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed_web_url, generated_frame_key};

    #[test]
    fn recognizes_only_nonempty_generated_frame_names() {
        assert_eq!(generated_frame_key("content:abc-123"), Some("abc-123"));
        for value in ["content:", "content:has space", "web:abc", " content:abc"] {
            assert_eq!(generated_frame_key(value), None);
        }
    }

    #[test]
    fn restricts_embed_urls_and_frame_redirects() {
        let app_origin = "http://localhost:5173";
        for value in ["https://example.test/embed", "http://localhost:5186/embed"] {
            assert!(allowed_web_url(value, app_origin), "{value}");
        }
        for value in [
            "http://127.0.0.1/",
            "http://localhost.evil.test/",
            "file:///secret",
            "javascript:alert(1)",
            "https://user:pass@example.test/",
            "http://localhost:5173/",
            "https://tauri.localhost/",
            "https://asset.localhost/",
        ] {
            assert!(!allowed_web_url(value, app_origin), "{value}");
        }
    }
}
