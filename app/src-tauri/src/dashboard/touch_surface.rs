//! Captures touch before DefWindowProc can move the mouse; mouse messages stay native.
use super::touch_input::TouchInput;
use std::mem::size_of;
use std::rc::Rc;
use tauri::{Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{BeginPaint, EndPaint, MapWindowPoints, PAINTSTRUCT};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Controls::WM_MOUSELEAVE;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{PCWSTR, w};

const CLASS: PCWSTR = w!("SUPADASHBOARD_TOUCH_INPUT");
const SUBCLASS: usize = 0x5355_5054;

struct Surface {
    root: HWND,
    browser: HWND,
    input: TouchInput,
}

pub async fn install(window: WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            let result = create(webview.controller(), app).map_err(|error| error.to_string());
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("dashboard touch initialization was canceled")?
}

fn create(controller: ICoreWebView2Controller, app: tauri::AppHandle) -> windows::core::Result<()> {
    unsafe {
        let mut parent = HWND::default();
        controller.ParentWindow(&mut parent)?;
        let parent = GetAncestor(parent, GA_ROOT);
        if parent.is_invalid() {
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_HANDLE,
                "dashboard window is unavailable",
            ));
        }
        if surface_hwnd(parent).is_some() {
            return Ok(());
        }
        let mut browser = HWND::default();
        // Finding the browser stops enumeration with false, just as an enumeration failure would.
        let _ = EnumChildWindows(
            Some(parent),
            Some(find_browser),
            LPARAM(&mut browser as *mut HWND as isize),
        );
        if browser.is_invalid() {
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_FAIL,
                "WebView2 input window is unavailable",
            ));
        }
        let input = TouchInput::new(controller, app)?;
        // Chromium drops wheel events over unrelated host windows. Keeping this child inside its input tree
        // preserves native mouse-wheel routing while our procedure consumes touch pointer messages.
        let hwnd = create_window(browser)?;
        let state = Box::into_raw(Box::new(Rc::new(Surface {
            root: parent,
            browser,
            input,
        })));
        if !SetWindowSubclass(hwnd, Some(input_subclass), SUBCLASS, state as usize).as_bool() {
            let error = windows::core::Error::from_thread();
            drop(Box::from_raw(state));
            let _ = DestroyWindow(hwnd);
            return Err(error);
        }
        if let Err(error) =
            SetPropW(parent, CLASS, Some(HANDLE(hwnd.0))).and_then(|()| resize(parent))
        {
            let _ = DestroyWindow(hwnd);
            return Err(error);
        }
        Ok(())
    }
}

fn create_window(parent: HWND) -> windows::core::Result<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None)?.into();
        let class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(surface_proc),
            hInstance: instance,
            lpszClassName: CLASS,
            ..Default::default()
        };
        // The class survives dashboard recreation in the same process.
        if RegisterClassExW(&class) == 0
            && windows::Win32::Foundation::GetLastError()
                != windows::Win32::Foundation::ERROR_CLASS_ALREADY_EXISTS
        {
            return Err(windows::core::Error::from_thread());
        }
        let hwnd = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            CLASS,
            None,
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            0,
            0,
            Some(parent),
            None,
            Some(instance),
            None,
        )?;
        Ok(hwnd)
    }
}

unsafe extern "system" fn find_browser(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
    let mut name = [0u16; 128];
    let length = unsafe { GetClassNameW(hwnd, &mut name) } as usize;
    if String::from_utf16_lossy(&name[..length]) == "Chrome_RenderWidgetHostHWND" {
        // SAFETY: EnumChildWindows is synchronous; data points to its caller's HWND.
        unsafe {
            *(data.0 as *mut HWND) = hwnd;
        }
        return false.into();
    }
    true.into()
}

pub fn resize(parent: HWND) -> windows::core::Result<()> {
    unsafe {
        if let Some(child) = surface_hwnd(parent) {
            let mut rect = RECT::default();
            GetClientRect(parent, &mut rect)?;
            SetWindowPos(
                child,
                Some(HWND_TOP),
                0,
                0,
                rect.right,
                rect.bottom,
                SWP_NOACTIVATE,
            )?;
        }
        Ok(())
    }
}

pub fn cancel(parent: HWND) {
    if let Some(child) = surface_hwnd(parent) {
        unsafe {
            SendMessageW(child, WM_CANCELMODE, None, None);
        }
    }
}

pub fn begin_window_action(
    parent: HWND,
    action: super::touch_window::TouchWindowAction,
) -> Result<(), String> {
    let child = surface_hwnd(parent).ok_or("dashboard touch input is unavailable")?;
    let mut data = 0;
    if !unsafe {
        windows::Win32::UI::Shell::GetWindowSubclass(
            child,
            Some(input_subclass),
            SUBCLASS,
            Some(&mut data),
        )
    }
    .as_bool()
        || data == 0
    {
        return Err("dashboard touch input is unavailable".into());
    }
    // Keep the state alive if a COM call pumps messages and destroys the input window.
    let state = unsafe { &*(data as *const Rc<Surface>) }.clone();
    state
        .input
        .begin_window_action(parent, action)
        .map_err(|error| error.to_string())
}

fn surface_hwnd(root: HWND) -> Option<HWND> {
    let child = HWND(unsafe { GetPropW(root, CLASS) }.0);
    (!child.is_invalid() && unsafe { GetAncestor(child, GA_ROOT) } == root).then_some(child)
}

unsafe extern "system" fn surface_proc(
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
) -> LRESULT {
    match message {
        WM_ERASEBKGND => LRESULT(1),
        WM_PAINT => {
            let mut paint = PAINTSTRUCT::default();
            unsafe {
                let _ = BeginPaint(hwnd, &mut paint);
                let _ = EndPaint(hwnd, &paint);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wp, lp) },
    }
}

unsafe extern "system" fn input_subclass(
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    // SAFETY: the subclass owns this allocation on the UI thread. The local Rc also covers reentrant destruction.
    let state = unsafe { &*(data as *const Rc<Surface>) }.clone();
    match message {
        WM_POINTERDOWN | WM_POINTERUPDATE | WM_POINTERUP | WM_NCPOINTERDOWN
        | WM_NCPOINTERUPDATE | WM_NCPOINTERUP | WM_POINTERENTER | WM_POINTERLEAVE
        | WM_POINTERWHEEL | WM_POINTERHWHEEL => {
            if state.input.pointer(hwnd, message, wp) {
                return LRESULT(0);
            }
        }
        WM_POINTERCAPTURECHANGED => state.input.capture_lost(wp),
        WM_CANCELMODE => state.input.cancel(),
        WM_POINTERACTIVATE => return LRESULT(PA_NOACTIVATE as isize),
        WM_NCDESTROY => {
            state.input.cancel();
            // An old browser child can finish teardown after its replacement was installed.
            if unsafe { GetPropW(state.root, CLASS) }.0 == hwnd.0 {
                let _ = unsafe { RemovePropW(state.root, CLASS) };
            }
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(input_subclass), id) };
            let result = unsafe { DefSubclassProc(hwnd, message, wp, lp) };
            unsafe {
                drop(Box::from_raw(data as *mut Rc<Surface>));
            }
            return result;
        }
        _ => {}
    }
    if let Some(result) = mouse_message(&state, hwnd, message, wp, lp) {
        return result;
    }
    unsafe { DefSubclassProc(hwnd, message, wp, lp) }
}

fn mouse_message(
    state: &Surface,
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
) -> Option<LRESULT> {
    match message {
        WM_MOUSEACTIVATE => return Some(LRESULT(MA_NOACTIVATE as isize)),
        WM_NCHITTEST => {
            return Some(unsafe { SendMessageW(state.root, message, Some(wp), Some(lp)) });
        }
        WM_SETCURSOR => {
            let target = if lp.0 as u16 as u32 == HTCLIENT {
                state.browser
            } else {
                state.root
            };
            return Some(unsafe {
                SendMessageW(target, message, Some(WPARAM(target.0 as usize)), Some(lp))
            });
        }
        WM_MOUSEMOVE | WM_NCMOUSEMOVE => {
            let mut track = TRACKMOUSEEVENT {
                cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: if message == WM_NCMOUSEMOVE {
                    TME_LEAVE | TME_NONCLIENT
                } else {
                    TME_LEAVE
                },
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            if let Err(error) = unsafe { TrackMouseEvent(&mut track) } {
                log::warn!("dashboard mouse leave tracking failed: {error}");
            }
        }
        WM_NCMOUSELEAVE => {
            // Chromium ignores the client leave while the pointer is still over our native resize band.
            unsafe {
                SendMessageW(state.browser, WM_MOUSELEAVE, None, None);
            }
        }
        _ => {}
    }
    // WebView2 receives the original Win32 mouse messages, never synthetic DOM mouse events.
    if matches!(message, WM_MOUSEFIRST..=WM_MOUSELAST | WM_MOUSELEAVE) {
        let position = mouse_position(hwnd, state.browser, message, lp);
        return Some(unsafe { SendMessageW(state.browser, message, Some(wp), Some(position)) });
    }
    if matches!(
        message,
        WM_NCMOUSEMOVE | WM_NCMOUSELEAVE | WM_NCLBUTTONDOWN | WM_NCLBUTTONUP | WM_NCLBUTTONDBLCLK
    ) {
        return Some(unsafe { SendMessageW(state.root, message, Some(wp), Some(lp)) });
    }
    None
}

fn mouse_position(hwnd: HWND, browser: HWND, message: u32, lp: LPARAM) -> LPARAM {
    let mut position = lp;
    if message != WM_MOUSEWHEEL && message != WM_MOUSEHWHEEL && message != WM_MOUSELEAVE {
        let mut point = [POINT {
            x: (lp.0 as u16 as i16) as i32,
            y: ((lp.0 >> 16) as u16 as i16) as i32,
        }];
        unsafe {
            MapWindowPoints(Some(hwnd), Some(browser), &mut point);
        }
        position =
            LPARAM(((point[0].x as u16 as u32) | ((point[0].y as u16 as u32) << 16)) as isize);
    }
    position
}
