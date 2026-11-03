//! Captured Windows contacts become trusted WebView2 touch input, independent of the system mouse.
use super::touch_stream::{Contact, Phase, TouchStream};
use super::touch_window::{TouchWindow, TouchWindowAction};
use std::{cell::RefCell, rc::Rc};
use tauri::{AppHandle, Emitter};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    UI::{
        HiDpi::GetDpiForWindow,
        Input::Pointer::{
            GetPointerDeviceRects, GetPointerTouchInfo, GetPointerType, POINTER_FLAG_CANCELED,
            POINTER_TOUCH_INFO,
        },
        WindowsAndMessaging::*,
    },
};
use windows::core::{HSTRING, w};

pub struct TouchInput {
    controller: ICoreWebView2Controller,
    core: ICoreWebView2,
    stream: Rc<RefCell<TouchStream>>,
    window: RefCell<TouchWindow>,
    app: AppHandle,
}

impl TouchInput {
    pub fn new(controller: ICoreWebView2Controller, app: AppHandle) -> windows::core::Result<Self> {
        Ok(Self {
            core: unsafe { controller.CoreWebView2()? },
            controller,
            stream: Rc::default(),
            window: RefCell::default(),
            app,
        })
    }

    pub fn pointer(&self, hwnd: HWND, message: u32, wp: WPARAM) -> bool {
        let id = (wp.0 & 0xffff) as u32;
        let mut kind = POINTER_INPUT_TYPE::default();
        if unsafe { GetPointerType(id, &mut kind) }.is_err() || kind != PT_TOUCH {
            return false;
        }
        let result = self.read_contact(hwnd, message, id);
        match result {
            Ok(true) => self.dispatch(),
            Ok(false) => {}
            Err(error) => {
                report(&self.app, error);
                self.cancel();
            }
        }
        true
    }

    fn read_contact(&self, hwnd: HWND, message: u32, id: u32) -> windows::core::Result<bool> {
        let mut info = POINTER_TOUCH_INFO::default();
        unsafe {
            GetPointerTouchInfo(id, &mut info)?;
        }
        if info
            .pointerInfo
            .pointerFlags
            .contains(POINTER_FLAG_CANCELED)
        {
            *self.window.borrow_mut() = TouchWindow::Idle;
            return Ok(self.stream.borrow_mut().cancel());
        }
        let phase = match message {
            WM_POINTERDOWN | WM_NCPOINTERDOWN => Phase::Start,
            WM_POINTERUPDATE | WM_NCPOINTERUPDATE => Phase::Move,
            WM_POINTERUP | WM_NCPOINTERUP => Phase::End,
            _ => return Ok(false),
        };
        let point = info.pointerInfo.ptPixelLocation;
        let screen = (point.x, point.y);
        if self.window.borrow().active() {
            self.update_window(hwnd, id, screen, matches!(phase, Phase::End))?;
            return Ok(false);
        }
        let mut device = RECT::default();
        let mut display = RECT::default();
        unsafe { GetPointerDeviceRects(info.pointerInfo.sourceDevice, &mut device, &mut display)? };
        self.browser_contact(hwnd, id, point, phase, display.into())
    }

    fn browser_contact(
        &self,
        hwnd: HWND,
        id: u32,
        mut point: POINT,
        phase: Phase,
        surface: super::geometry::Geometry,
    ) -> windows::core::Result<bool> {
        let screen = (point.x, point.y);
        unsafe { ScreenToClient(hwnd, &mut point) }.ok()?;
        let mut zoom = 1.0;
        unsafe {
            self.controller.ZoomFactor(&mut zoom)?;
        }
        let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }.max(96)) / 96.0 * zoom;
        if !scale.is_finite() || scale <= 0.0 {
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_FAIL,
                "invalid dashboard touch scale",
            ));
        }
        Ok(self.stream.borrow_mut().update(
            phase,
            Contact {
                id,
                x: f64::from(point.x) / scale,
                y: f64::from(point.y) / scale,
                origin: screen,
                screen,
                surface,
            },
        ))
    }

    fn update_window(
        &self,
        hwnd: HWND,
        id: u32,
        screen: (i32, i32),
        end: bool,
    ) -> windows::core::Result<()> {
        let bounds = self.window.borrow_mut().update(id, screen, end);
        if let Some(bounds) = bounds {
            let parent = unsafe { GetAncestor(hwnd, GA_ROOT) };
            super::commands::place_bounds(parent, bounds).map_err(|error| {
                windows::core::Error::new(windows::Win32::Foundation::E_FAIL, error)
            })?;
        }
        Ok(())
    }

    pub fn capture_lost(&self, wp: WPARAM) {
        let id = (wp.0 & 0xffff) as u32;
        if self.stream.borrow().contains(id) || self.window.borrow().owns(id) {
            self.cancel();
        }
    }

    pub fn cancel(&self) {
        *self.window.borrow_mut() = TouchWindow::Idle;
        let idle = self.stream.borrow_mut().cancel();
        if idle {
            self.dispatch();
        }
    }

    pub fn begin_window_action(
        &self,
        hwnd: HWND,
        action: TouchWindowAction,
    ) -> windows::core::Result<()> {
        let primary = self.stream.borrow().primary();
        let Some((id, start)) = primary else {
            return Ok(());
        };
        let mut rect = windows::Win32::Foundation::RECT::default();
        let mut limits = MINMAXINFO::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect)?;
            SendMessageW(
                hwnd,
                WM_GETMINMAXINFO,
                None,
                Some(windows::Win32::Foundation::LPARAM(
                    &mut limits as *mut MINMAXINFO as isize,
                )),
            );
        }
        *self.window.borrow_mut() = TouchWindow::Active {
            id,
            start,
            bounds: rect.into(),
            minimum: (limits.ptMinTrackSize.x, limits.ptMinTrackSize.y),
            action,
        };
        let idle = self.stream.borrow_mut().cancel();
        if idle {
            self.dispatch();
        }
        Ok(())
    }

    fn dispatch(&self) {
        dispatch_next(self.core.clone(), self.stream.clone(), self.app.clone());
    }
}

fn dispatch_next(core: ICoreWebView2, stream: Rc<RefCell<TouchStream>>, app: AppHandle) {
    let payload = stream.borrow().front().cloned();
    let Some(payload) = payload else {
        return;
    };
    let cancel = payload["type"] == "touchCancel";
    let next_core = core.clone();
    let next_stream = stream.clone();
    let next_app = app.clone();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _| {
        finish(
            next_core.clone(),
            next_stream.clone(),
            next_app.clone(),
            result,
            cancel,
        );
        Ok(())
    }));
    let result = unsafe {
        core.CallDevToolsProtocolMethod(
            w!("Input.dispatchTouchEvent"),
            &HSTRING::from(payload.to_string()),
            &handler,
        )
    };
    if let Err(error) = result {
        finish(core, stream, app, Err(error), cancel);
    }
}

fn finish(
    core: ICoreWebView2,
    stream: Rc<RefCell<TouchStream>>,
    app: AppHandle,
    result: windows::core::Result<()>,
    cancel: bool,
) {
    match result {
        Ok(()) => stream.borrow_mut().complete(),
        Err(error) => {
            report(&app, error);
            stream.borrow_mut().abort(!cancel);
        }
    }
    dispatch_next(core, stream, app);
}

fn report(app: &AppHandle, error: windows::core::Error) {
    log::error!("dashboard touch input failed: {error}");
    let _ = app.emit_to("main", "dashboard-touch-error", ());
}
