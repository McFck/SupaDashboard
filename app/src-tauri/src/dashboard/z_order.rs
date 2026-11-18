//! Keeps a nonactivating, topmost dashboard above an overlapping Explorer taskbar.
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GA_ROOTOWNER, GW_HWNDPREV, GWL_EXSTYLE, GetAncestor, GetClassNameW, GetForegroundWindow,
    GetWindow, GetWindowLongPtrW, GetWindowRect, HWND_TOPMOST, IsIconic, IsWindowVisible,
    KillTimer, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetTimer, SetWindowPos, WS_EX_TOPMOST,
};

pub const TIMER: usize = 0x5355_505A;

pub fn watch(hwnd: HWND) {
    // Explorer can reorder the taskbar without delivering a position message to the dashboard.
    if unsafe { SetTimer(Some(hwnd), TIMER, 500, None) } == 0 {
        log::warn!("could not start the dashboard taskbar check");
    }
}

pub fn unwatch(hwnd: HWND) {
    let _ = unsafe { KillTimer(Some(hwnd), TIMER) };
}

fn topmost(hwnd: HWND) -> bool {
    (unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32 & WS_EX_TOPMOST.0) != 0
}

pub fn visible_topmost(hwnd: HWND) -> bool {
    topmost(hwnd) && unsafe { IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() }
}

pub fn raise(hwnd: HWND) -> Result<(), String> {
    unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| format!("could not raise the dashboard: {error}"))
}

pub fn check(hwnd: HWND) {
    if visible_topmost(hwnd)
        && taskbar_above(hwnd)
        && let Err(error) = raise(hwnd)
    {
        log::warn!("{error}");
    }
}

fn taskbar_above(hwnd: HWND) -> bool {
    let mut bounds = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut bounds) }.is_err() {
        return false;
    }
    let foreground = unsafe { GetAncestor(GetForegroundWindow(), GA_ROOTOWNER) };
    let mut window = hwnd;
    // A window can disappear while walking the live stack, so stop on failure and limit the walk.
    for _ in 0..256 {
        let Ok(previous) = (unsafe { GetWindow(window, GW_HWNDPREV) }) else {
            break;
        };
        window = previous;
        if window != foreground
            && unsafe { IsWindowVisible(window).as_bool() }
            && is_taskbar(window)
            && overlaps(window, bounds)
        {
            return true;
        }
    }
    false
}

fn is_taskbar(hwnd: HWND) -> bool {
    let mut class = [0; 32];
    let length = unsafe { GetClassNameW(hwnd, &mut class) } as usize;
    matches!(
        String::from_utf16_lossy(&class[..length]).as_str(),
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    )
}

fn overlaps(hwnd: HWND, bounds: RECT) -> bool {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && rect.left < bounds.right
        && rect.right > bounds.left
        && rect.top < bounds.bottom
        && rect.bottom > bounds.top
}
