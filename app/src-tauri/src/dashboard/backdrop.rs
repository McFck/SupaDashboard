//! The Wallpaper background: a click-through window kept directly below the dashboard that shows the live desktop
//! wallpaper through DWM thumbnails. The compositor draws every wallpaper frame; this process only updates the
//! thumbnails when the dashboard moves, resizes, shows, hides or changes mode. Everything runs on the UI thread.
use super::geometry::Geometry;
use std::cell::Cell;
use std::mem::size_of;
use std::sync::OnceLock;
use windows::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_RECTSOURCE,
    DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DwmRegisterThumbnail, DwmUnregisterThumbnail,
    DwmUpdateThumbnailProperties,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, FindWindowExW, FindWindowW, GWLP_USERDATA,
    GetSystemMetrics, GetWindowLongPtrW, GetWindowRect, HTTRANSPARENT, IsIconic, IsWindow,
    IsWindowVisible, MA_NOACTIVATE, RegisterClassExW, RegisterWindowMessageW, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SMTO_ABORTIFHUNG, SMTO_BLOCK, SW_HIDE, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
    SWP_SHOWWINDOW, SendMessageTimeoutW, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    WM_DISPLAYCHANGE, WM_MOUSEACTIVATE, WM_NCHITTEST, WNDCLASSEXW, WS_EX_NOACTIVATE,
    WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_POPUP,
};
use windows::core::{PCWSTR, w};

const CLASS: PCWSTR = w!("SUPADASHBOARD_BACKDROP");
/// Asks Explorer to draw the wallpaper in a WorkerW of its own behind the icons, as Wallpaper Engine does.
const SPAWN_WORKER: u32 = 0x052C;

/// What the thumbnails currently show; a sync that would apply the same layout only restacks the window.
#[derive(Clone, Copy, PartialEq)]
struct Layout {
    source: HWND,
    bounds: Geometry,
    origin: (i32, i32),
    radius: i32,
}

pub struct Backdrop {
    dashboard: HWND,
    window: Cell<Option<HWND>>,
    source: Cell<Option<HWND>>,
    thumbnails: Cell<Vec<isize>>,
    applied: Cell<Option<Layout>>,
    wallpaper: Cell<bool>,
    /// The dashboard's corner radius in DIPs; square while fullscreen.
    radius: Cell<f64>,
    fullscreen: Cell<bool>,
}

impl Backdrop {
    pub fn new(dashboard: HWND) -> Self {
        Self {
            dashboard,
            window: Cell::new(None),
            source: Cell::new(None),
            thumbnails: Cell::new(Vec::new()),
            applied: Cell::new(None),
            wallpaper: Cell::new(false),
            radius: Cell::new(0.0),
            fullscreen: Cell::new(false),
        }
    }

    pub fn configure(&self, wallpaper: bool, radius: f64) -> Result<(), String> {
        if !radius.is_finite() {
            return Err("backdrop radius must be a finite number".into());
        }
        self.wallpaper.set(wallpaper);
        // A negative CSS radius is invalid and draws square corners.
        self.radius.set(radius.max(0.0));
        self.sync();
        Ok(())
    }

    pub fn set_fullscreen(&self, fullscreen: bool) {
        self.fullscreen.set(fullscreen);
        self.sync();
    }

    /// Follows the dashboard: called after every change of its position, size, z-order or visibility.
    pub fn sync(&self) {
        if let Err(error) = self.try_sync() {
            log::warn!("wallpaper backdrop: {error}");
            self.release();
        }
    }

    fn try_sync(&self) -> Result<(), String> {
        let shown = self.wallpaper.get()
            && unsafe {
                IsWindowVisible(self.dashboard).as_bool() && !IsIconic(self.dashboard).as_bool()
            };
        if !shown {
            self.release();
            return Ok(());
        }
        let window = self.window()?;
        let source = self.source()?;
        let mut rect = RECT::default();
        unsafe { GetWindowRect(self.dashboard, &mut rect) }
            .map_err(|error| format!("could not read dashboard bounds: {error}"))?;
        let bounds = Geometry::from(rect);
        let (x, y, width, height) = bounds.to_win32()?;
        unsafe {
            SetWindowPos(
                window,
                Some(self.dashboard),
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
            )
        }
        .map_err(|error| format!("could not place the backdrop: {error}"))?;

        let dpi = unsafe { GetDpiForWindow(self.dashboard) }.max(96);
        let radius = if self.fullscreen.get() {
            0
        } else {
            (self.radius.get() * f64::from(dpi) / 96.0).round() as i32
        };
        // Progman and the legacy wallpaper WorkerW span the virtual screen. Explorer resizes them only after a
        // display change reaches us, so their origin is taken from the system metrics, which are already current.
        let origin = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
            )
        };
        let layout = Layout {
            source,
            bounds,
            origin,
            radius,
        };
        let previous = self.applied.take();
        if previous == Some(layout) {
            self.applied.set(previous);
            return Ok(());
        }
        let bands = corner_bands(width, height, radius);
        let mut thumbnails = self.thumbnails.take();
        if previous.map(|applied| applied.source) != Some(source) {
            unregister(&mut thumbnails);
        }
        let result = place_thumbnails(
            &mut thumbnails,
            window,
            source,
            &bands,
            (x - origin.0, y - origin.1),
        );
        self.thumbnails.set(thumbnails);
        result?;
        self.applied.set(Some(layout));
        Ok(())
    }

    fn window(&self) -> Result<HWND, String> {
        if let Some(window) = self.window.get() {
            return Ok(window);
        }
        let window = create_window()?;
        unsafe { SetWindowLongPtrW(window, GWLP_USERDATA, self as *const Self as isize) };
        self.window.set(Some(window));
        Ok(window)
    }

    /// The cached wallpaper window, found again once Explorer restarted.
    fn source(&self) -> Result<HWND, String> {
        if let Some(source) = self.source.get()
            && unsafe { IsWindow(Some(source)).as_bool() }
        {
            return Ok(source);
        }
        let source = wallpaper_window()?;
        self.source.set(Some(source));
        Ok(source)
    }

    /// Drops the thumbnails and hides the window; nothing is composed for it until the next sync shows it again.
    fn release(&self) {
        let mut thumbnails = self.thumbnails.take();
        unregister(&mut thumbnails);
        self.applied.set(None);
        if let Some(window) = self.window.get() {
            let _ = unsafe { ShowWindow(window, SW_HIDE) };
        }
    }

    /// Explorer restarted or the display layout changed: everything is registered again.
    fn refresh(&self) {
        self.source.set(None);
        let mut thumbnails = self.thumbnails.take();
        unregister(&mut thumbnails);
        self.applied.set(None);
        self.sync();
    }
}

impl Drop for Backdrop {
    fn drop(&mut self) {
        let mut thumbnails = self.thumbnails.take();
        unregister(&mut thumbnails);
        if let Some(window) = self.window.take() {
            unsafe {
                SetWindowLongPtrW(window, GWLP_USERDATA, 0);
                let _ = DestroyWindow(window);
            }
        }
    }
}

/// One thumbnail per band: DWM thumbnails ignore window regions, so the rounded corners are built from bands.
fn place_thumbnails(
    thumbnails: &mut Vec<isize>,
    window: HWND,
    source: HWND,
    bands: &[RECT],
    offset: (i32, i32),
) -> Result<(), String> {
    while thumbnails.len() > bands.len() {
        if let Some(thumbnail) = thumbnails.pop() {
            let _ = unsafe { DwmUnregisterThumbnail(thumbnail) };
        }
    }
    while thumbnails.len() < bands.len() {
        let thumbnail = unsafe { DwmRegisterThumbnail(window, source) }
            .map_err(|error| format!("could not show the wallpaper: {error}"))?;
        thumbnails.push(thumbnail);
    }
    for (thumbnail, band) in thumbnails.iter().zip(bands) {
        let properties = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION
                | DWM_TNP_RECTSOURCE
                | DWM_TNP_VISIBLE
                | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: *band,
            rcSource: RECT {
                left: band.left + offset.0,
                top: band.top + offset.1,
                right: band.right + offset.0,
                bottom: band.bottom + offset.1,
            },
            opacity: 255,
            fVisible: true.into(),
            fSourceClientAreaOnly: false.into(),
        };
        unsafe { DwmUpdateThumbnailProperties(*thumbnail, &properties) }
            .map_err(|error| format!("could not place the wallpaper: {error}"))?;
    }
    Ok(())
}

fn unregister(thumbnails: &mut Vec<isize>) {
    for thumbnail in thumbnails.drain(..) {
        // An unregister fails only for a thumbnail DWM already dropped with its source.
        let _ = unsafe { DwmUnregisterThumbnail(thumbnail) };
    }
}

/// Horizontal bands covering a `width` x `height` window whose corners are rounded by `radius` pixels: like CSS, a
/// corner pixel is covered when its center lies inside the corner circle. Rows with the same inset share a band.
fn corner_bands(width: i32, height: i32, radius: i32) -> Vec<RECT> {
    let radius = radius.clamp(0, width.min(height) / 2);
    let r = f64::from(radius);
    let inset = |row: i32| {
        let dy = r - f64::from(row) - 0.5;
        (r - 0.5 - (r * r - dy * dy).sqrt()).ceil().max(0.0) as i32
    };
    let mut bands: Vec<RECT> = Vec::new();
    let mut push = |top: i32, bottom: i32, inset: i32| {
        if top >= bottom {
            return;
        }
        match bands.last_mut() {
            Some(last) if last.left == inset && last.bottom == top => last.bottom = bottom,
            _ => bands.push(RECT {
                left: inset,
                top,
                right: width - inset,
                bottom,
            }),
        }
    };
    for row in 0..radius {
        push(row, row + 1, inset(row));
    }
    push(radius, height - radius, 0);
    for row in (0..radius).rev() {
        push(height - row - 1, height - row, inset(row));
    }
    bands
}

/// The top-level window that draws the wallpaper; Wallpaper Engine renders into the same one.
fn wallpaper_window() -> Result<HWND, String> {
    let progman = unsafe { FindWindowW(w!("Progman"), None) }
        .map_err(|error| format!("the desktop window is unavailable: {error}"))?;
    unsafe {
        SendMessageTimeoutW(
            progman,
            SPAWN_WORKER,
            WPARAM(0xD),
            LPARAM(1),
            SMTO_BLOCK | SMTO_ABORTIFHUNG,
            500,
            None,
        )
    };
    // Before Windows 11 24H2 that WorkerW is the top-level window right after the one hosting the icons
    // (SHELLDLL_DefView), and its thumbnail is the wallpaper alone. From 24H2 the icons and the wallpaper WorkerW
    // are children of Progman; a child cannot be a thumbnail source, so there the desktop icons show too.
    let mut after = None;
    while let Ok(worker) = unsafe { FindWindowExW(None, after, w!("WorkerW"), None) } {
        if unsafe { FindWindowExW(Some(worker), None, w!("SHELLDLL_DefView"), None) }.is_ok() {
            return Ok(
                unsafe { FindWindowExW(None, Some(worker), w!("WorkerW"), None) }
                    .ok()
                    .filter(|wallpaper| unsafe { IsWindowVisible(*wallpaper).as_bool() })
                    .unwrap_or(progman),
            );
        }
        after = Some(worker);
    }
    Ok(progman)
}

fn taskbar_created() -> u32 {
    static MESSAGE: OnceLock<u32> = OnceLock::new();
    *MESSAGE.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) })
}

/// Click-through, never activated, kept out of the taskbar and Alt+Tab. It is not owned by the dashboard: an owned
/// window always stays above its owner, so every sync inserts it right after the dashboard instead.
fn create_window() -> Result<HWND, String> {
    taskbar_created();
    unsafe {
        let instance = GetModuleHandleW(None)
            .map_err(|error| error.to_string())?
            .into();
        let class = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(backdrop_proc),
            hInstance: instance,
            lpszClassName: CLASS,
            ..Default::default()
        };
        // The class survives dashboard recreation in the same process.
        if RegisterClassExW(&class) == 0
            && GetLastError() != windows::Win32::Foundation::ERROR_CLASS_ALREADY_EXISTS
        {
            return Err(format!(
                "could not register the backdrop class: {:?}",
                GetLastError()
            ));
        }
        CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOREDIRECTIONBITMAP,
            CLASS,
            None,
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance),
            None,
        )
        .map_err(|error| format!("could not create the backdrop window: {error}"))
    }
}

unsafe extern "system" fn backdrop_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        _ if message == WM_DISPLAYCHANGE || message == taskbar_created() => {
            let backdrop = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const Backdrop;
            // SAFETY: set while the owning dashboard policy is alive and cleared before the window is destroyed.
            if let Some(backdrop) = unsafe { backdrop.as_ref() } {
                backdrop.refresh();
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

#[cfg(test)]
mod tests {
    use super::corner_bands;

    fn coverage(width: i32, height: i32, radius: i32) -> Vec<(i32, i32)> {
        let bands = corner_bands(width, height, radius);
        (0..height)
            .map(|row| {
                let covering: Vec<_> = bands
                    .iter()
                    .filter(|band| band.top <= row && row < band.bottom)
                    .collect();
                assert_eq!(covering.len(), 1, "row {row} must be covered exactly once");
                (covering[0].left, covering[0].right)
            })
            .collect()
    }

    #[test]
    fn rounded_bands_cover_every_row_once_and_leave_the_corners_out() {
        let rows = coverage(40, 20, 6);
        assert_eq!(
            rows[0],
            (4, 36),
            "the corner pixels stay uncovered, symmetrically"
        );
        assert_eq!(rows[19], rows[0], "top and bottom corners match");
        assert_eq!(rows[10], (0, 40), "the middle is full width");
        assert!(rows[..6].windows(2).all(|pair| pair[0].0 >= pair[1].0));
    }

    #[test]
    fn a_square_or_oversized_radius_stays_inside_the_window() {
        assert_eq!(coverage(30, 10, 0), vec![(0, 30); 10]);
        assert_eq!(corner_bands(30, 10, 0).len(), 1);
        let pill = coverage(30, 10, 99);
        assert_eq!(pill.len(), 10);
        assert!(
            pill.iter()
                .all(|(left, right)| 0 <= *left && left < right && *right <= 30)
        );
    }
}
