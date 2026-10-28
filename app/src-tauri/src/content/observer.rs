//! WebView2 frame observer: cancels navigations the trust policy rejects and tells the window's frontend how each
//! content frame's navigation went. Every WebView2 callback runs on the UI thread, hence `Rc<RefCell>`.
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use webview2_com::{
    FrameCreatedEventHandler, FrameDestroyedEventHandler, FrameNameChangedEventHandler,
    FrameNavigationCompletedEventHandler, FrameNavigationStartingEventHandler,
    Microsoft::Web::WebView2::Win32::*, take_pwstr,
};
use windows::core::{Interface, PWSTR};

use super::{allowed_web_url, generated_frame_key};

thread_local! {
    static OBSERVERS: RefCell<HashMap<String, Observer>> = RefCell::new(HashMap::new());
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

#[derive(Default)]
struct NavigationTrack {
    key: Option<String>,
    latest: Option<u64>,
    blocked: HashSet<u64>,
}

type Frames = Rc<RefCell<HashMap<usize, NativeFrame>>>;

struct NativeFrame {
    frame: ICoreWebView2Frame,
    frame2: ICoreWebView2Frame2,
    name_token: i64,
    destroyed_token: i64,
    starting_token: i64,
    completed_token: i64,
}

impl NativeFrame {
    /// Everything but the Destroyed handler, which cannot be removed from inside its own callback.
    fn detach_navigation(&self) {
        unsafe {
            let _ = self.frame.remove_NameChanged(self.name_token);
            let _ = self.frame2.remove_NavigationStarting(self.starting_token);
            let _ = self.frame2.remove_NavigationCompleted(self.completed_token);
        }
    }

    fn detach(self) {
        self.detach_navigation();
        unsafe {
            let _ = self.frame.remove_Destroyed(self.destroyed_token);
        }
    }
}

struct Observer {
    core: ICoreWebView2_4,
    frame_created_token: i64,
    frames: Frames,
}

impl Observer {
    fn detach(self) {
        unsafe {
            let _ = self.core.remove_FrameCreated(self.frame_created_token);
        }
        let frames: Vec<_> = self
            .frames
            .borrow_mut()
            .drain()
            .map(|(_, frame)| frame)
            .collect();
        for frame in frames {
            frame.detach();
        }
    }
}

/// What every handler of one frame needs.
#[derive(Clone)]
struct FrameCtx {
    app: AppHandle,
    label: String,
    app_origin: String,
    frame: ICoreWebView2Frame,
    track: Rc<RefCell<NavigationTrack>>,
}

impl FrameCtx {
    fn send(
        &self,
        frame_key: String,
        navigation_id: u64,
        phase: &'static str,
        success: Option<bool>,
        error: Option<String>,
    ) {
        let _ = self.app.emit_to(
            &self.label,
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

    /// Sends the event for the frame's current key; a frame without a content key reports nothing.
    fn emit(
        &self,
        navigation_id: u64,
        phase: &'static str,
        success: Option<bool>,
        error: Option<String>,
    ) {
        let key = self.track.borrow().key.clone();
        if let Some(key) = key {
            self.send(key, navigation_id, phase, success, error);
        }
    }

    /// A rename ends the old key's navigation and, when the new name is a content key, restarts the latest one.
    fn refresh_name(&self) {
        let name = unsafe { frame_name(&self.frame) }.unwrap_or_default();
        let key = generated_frame_key(&name).map(str::to_owned);
        let (previous, latest) = {
            let mut track = self.track.borrow_mut();
            if track.key == key {
                return;
            }
            let previous = track.key.take();
            track.key = key.clone();
            (previous, track.latest)
        };
        if let Some(previous) = previous {
            self.send(
                previous,
                latest.unwrap_or_default(),
                "destroyed",
                None,
                None,
            );
        }
        if let (Some(_), Some(id)) = (key, latest) {
            self.emit(id, "starting", None, None);
        }
    }

    fn on_destroyed(&self, frames: &Frames, identity: usize) {
        let latest = self.track.borrow().latest;
        if let Some(id) = latest {
            self.emit(id, "destroyed", None, None);
        }
        let record = frames.borrow_mut().remove(&identity);
        if let Some(record) = record {
            record.detach_navigation();
        }
    }

    fn on_navigation_starting(
        &self,
        args: &ICoreWebView2NavigationStartingEventArgs,
    ) -> windows::core::Result<()> {
        let mut navigation_id = 0;
        let mut uri = PWSTR::null();
        unsafe {
            args.NavigationId(&mut navigation_id)?;
            args.Uri(&mut uri)?;
        }
        let allowed = allowed_web_url(&take_pwstr(uri), &self.app_origin);
        if !allowed {
            unsafe {
                args.SetCancel(true)?;
            }
        }
        self.refresh_name();
        {
            let mut track = self.track.borrow_mut();
            track.latest = Some(navigation_id);
            if allowed {
                track.blocked.remove(&navigation_id);
            } else {
                track.blocked.insert(navigation_id);
            }
        }
        self.emit(navigation_id, "starting", None, None);
        if !allowed {
            self.emit(
                navigation_id,
                "completed",
                Some(false),
                Some("blocked-navigation".into()),
            );
        }
        Ok(())
    }

    fn on_navigation_completed(
        &self,
        args: &ICoreWebView2NavigationCompletedEventArgs,
    ) -> windows::core::Result<()> {
        let mut navigation_id = 0;
        let mut is_success = windows::core::BOOL(0);
        let mut error_status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
        unsafe {
            args.NavigationId(&mut navigation_id)?;
            args.IsSuccess(&mut is_success)?;
            args.WebErrorStatus(&mut error_status)?;
        }
        self.refresh_name();
        let (latest, blocked) = {
            let track = self.track.borrow();
            (track.latest, track.blocked.contains(&navigation_id))
        };
        if latest == Some(navigation_id) {
            let succeeded = is_success.as_bool();
            self.emit(
                navigation_id,
                "completed",
                Some(!blocked && succeeded),
                (!succeeded || blocked).then(|| format!("web-error-{}", error_status.0)),
            );
        }
        Ok(())
    }
}

unsafe fn frame_name(frame: &ICoreWebView2Frame) -> windows::core::Result<String> {
    let mut name = PWSTR::null();
    unsafe {
        frame.Name(&mut name)?;
    }
    Ok(take_pwstr(name))
}

fn attach_frame(
    frame: ICoreWebView2Frame,
    app: &AppHandle,
    label: &str,
    app_origin: &str,
    frames: &Frames,
) -> windows::core::Result<()> {
    let identity = frame.as_raw() as usize;
    if frames.borrow().contains_key(&identity) {
        return Ok(());
    }
    let frame2: ICoreWebView2Frame2 = frame.cast()?;
    let key = unsafe { frame_name(&frame).ok() }
        .and_then(|name| generated_frame_key(&name).map(str::to_owned));
    let ctx = FrameCtx {
        app: app.clone(),
        label: label.to_owned(),
        app_origin: app_origin.to_owned(),
        frame: frame.clone(),
        track: Rc::new(RefCell::new(NavigationTrack {
            key,
            ..NavigationTrack::default()
        })),
    };

    let mut name_token = 0;
    let handler = FrameNameChangedEventHandler::create(Box::new({
        let ctx = ctx.clone();
        move |_, _| {
            ctx.refresh_name();
            Ok(())
        }
    }));
    unsafe { frame.add_NameChanged(&handler, &mut name_token)? };

    let mut destroyed_token = 0;
    let handler = FrameDestroyedEventHandler::create(Box::new({
        let ctx = ctx.clone();
        let frames = frames.clone();
        move |_, _| {
            ctx.on_destroyed(&frames, identity);
            Ok(())
        }
    }));
    unsafe { frame.add_Destroyed(&handler, &mut destroyed_token)? };

    let mut starting_token = 0;
    let handler = FrameNavigationStartingEventHandler::create(Box::new({
        let ctx = ctx.clone();
        move |_, args| match args {
            Some(args) => ctx.on_navigation_starting(&args),
            None => Ok(()),
        }
    }));
    unsafe { frame2.add_NavigationStarting(&handler, &mut starting_token)? };

    let mut completed_token = 0;
    let handler =
        FrameNavigationCompletedEventHandler::create(Box::new(move |_, args| match args {
            Some(args) => ctx.on_navigation_completed(&args),
            None => Ok(()),
        }));
    unsafe { frame2.add_NavigationCompleted(&handler, &mut completed_token)? };

    frames.borrow_mut().insert(
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
) -> Result<(), String> {
    if OBSERVERS.with(|observers| observers.borrow().contains_key(label)) {
        return Ok(());
    }
    let core: ICoreWebView2 =
        unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let core: ICoreWebView2_4 = core
        .cast()
        .map_err(|error| format!("WebView2 frame events are unavailable: {error}"))?;
    let frames = Frames::default();
    let handler = FrameCreatedEventHandler::create(Box::new({
        let app = app.clone();
        let label = label.to_owned();
        let origin = app_origin.to_owned();
        let frames = frames.clone();
        move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let frame = unsafe { args.Frame()? };
            attach_frame(frame, &app, &label, &origin, &frames)
        }
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
    OBSERVERS.with(|observers| observers.borrow_mut().insert(label.to_owned(), observer));
    Ok(())
}

pub fn forget(label: &str) {
    let observer = OBSERVERS.with(|observers| observers.borrow_mut().remove(label));
    if let Some(observer) = observer {
        observer.detach();
    }
}
