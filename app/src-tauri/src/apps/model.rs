//! Pure rules of app control: request validation, which windows count, the toggle plan, the state fold
//! and window relocation. Nothing here touches Windows.
use serde::{Deserialize, Serialize};

const MAX_KEY: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    /// An AppUserModelID from the Start menu (`shell:AppsFolder`).
    Aumid(String),
    /// An absolute path to an `.exe`.
    Exe(String),
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Op {
    Open,
    Focus,
    Toggle,
    Minimize,
    Close,
    Quit,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Hide {
    #[default]
    Minimize,
    Close,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Windows {
    Main,
    #[default]
    All,
    Title,
    /// One window, found again by its exact title after it is recreated.
    Window,
}

/// The raw `app_command` payload.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub op: Op,
    pub app: String,
    #[serde(default)]
    pub display: Option<String>,
    #[serde(default)]
    pub hide: Hide,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub windows: Windows,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Command {
    pub op: Op,
    pub key: Key,
    /// A monitor device path; the caller checks it against the current monitors.
    pub display: Option<String>,
    pub hide: Hide,
    pub force: bool,
    pub windows: Windows,
    pub title: String,
}

pub fn parse_key(raw: &str) -> Result<Key, String> {
    if raw.is_empty() || raw.len() > MAX_KEY || raw.chars().any(char::is_control) {
        return Err("The app is not valid".into());
    }
    if let Some(id) = raw.strip_prefix("aumid:") {
        return if id.is_empty() {
            Err("The app is not valid".into())
        } else {
            Ok(Key::Aumid(id.to_owned()))
        };
    }
    if let Some(path) = raw.strip_prefix("exe:") {
        let valid = std::path::Path::new(path).is_absolute()
            && path.to_lowercase().ends_with(".exe")
            && !path.contains('"');
        return if valid {
            Ok(Key::Exe(path.to_owned()))
        } else {
            Err("The app path must be an absolute .exe path".into())
        };
    }
    Err("The app is not valid".into())
}

pub fn parse_request(request: Request) -> Result<Command, String> {
    if request.op == Op::Quit && request.force {
        return Err("Quit app cannot force close".into());
    }
    if request.op == Op::Quit && request.windows != Windows::All {
        return Err("Quit app requires All windows".into());
    }
    if request.title.len() > MAX_KEY || request.title.chars().any(char::is_control) {
        return Err("The window title is not valid".into());
    }
    if matches!(request.windows, Windows::Title | Windows::Window)
        && request.title.trim().is_empty()
    {
        return Err("Enter a window title".into());
    }
    if request.op == Op::Toggle
        && request.hide == Hide::Close
        && request.force
        && request.windows != Windows::All
    {
        return Err("Force close requires All windows".into());
    }
    Ok(Command {
        op: request.op,
        key: parse_key(&request.app)?,
        display: request.display.filter(|path| !path.is_empty()),
        hide: request.hide,
        force: request.force,
        windows: request.windows,
        title: request.title.trim().to_lowercase(),
    })
}

/// Keep existing variable ids; names with no ASCII slug use their lowercase UTF-8 bytes.
pub fn slug(name: &str) -> String {
    let lower = name.to_lowercase();
    let name = lower.strip_suffix(".exe").unwrap_or(&lower);
    let ascii: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if !ascii.is_empty() {
        return ascii;
    }
    let encoded: String = name
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("u_{encoded}")
}

/// What the window enumeration knows about one top-level window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Win {
    pub hwnd: isize,
    pub pid: u32,
    pub visible: bool,
    pub owned: bool,
    pub tool: bool,
    pub app_window: bool,
    /// Cloaked windows include those on another virtual desktop.
    pub cloaked: bool,
    pub minimized: bool,
    /// False for the zero-size windows browser engines keep around; they are never a window the user sees.
    pub sized: bool,
    pub title: String,
}

/// A window the user would call "the app's window". Hidden ones still prove the app is running.
pub fn is_app_window(win: &Win) -> bool {
    win.visible && win.sized && !win.owned && (!win.tool || win.app_window) && !win.cloaked
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct AppState {
    pub running: bool,
    pub focused: bool,
    pub minimized: bool,
    pub visible: bool,
    /// Friendly monitor name of the top window, or empty.
    pub display: String,
}

/// `wins` are the app's top-level windows in Z order (hidden included); `alive` is whether a matching process exists.
pub fn fold(wins: &[Win], alive: bool, foreground_pid: Option<u32>, display: String) -> AppState {
    let running = alive || !wins.is_empty();
    let shown: Vec<&Win> = wins.iter().filter(|win| is_app_window(win)).collect();
    AppState {
        running,
        // Any window of the app in front counts, so an owned dialog keeps the app focused.
        focused: running && foreground_pid.is_some_and(|pid| wins.iter().any(|win| win.pid == pid)),
        minimized: !shown.is_empty() && shown.iter().all(|win| win.minimized),
        visible: shown.iter().any(|win| !win.minimized),
        display: if running { display } else { String::new() },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ToggleFacts {
    pub running: bool,
    pub shown: bool,
    pub foreground: bool,
    pub minimized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plan {
    Launch,
    Hide,
    Restore,
    Raise,
}

pub fn plan_toggle(facts: ToggleFacts) -> Plan {
    if !facts.running || !facts.shown {
        // A tray app has no window to show; launching again makes a single-instance app show itself.
        Plan::Launch
    } else if facts.foreground {
        Plan::Hide
    } else if facts.minimized {
        Plan::Restore
    } else {
        Plan::Raise
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// Moves `rect` from one work area to another, keeping its offset and shrinking it to fit.
pub fn relocate(rect: Rect, from: Rect, to: Rect) -> Rect {
    let width = rect.width().min(to.width());
    let height = rect.height().min(to.height());
    let left = to.left + (rect.left - from.left).clamp(0, to.width() - width);
    let top = to.top + (rect.top - from.top).clamp(0, to.height() - height);
    Rect {
        left,
        top,
        right: left + width,
        bottom: top + height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(app: &str) -> Request {
        Request {
            op: Op::Focus,
            app: app.into(),
            display: None,
            hide: Hide::Minimize,
            force: false,
            windows: Windows::All,
            title: String::new(),
        }
    }

    #[test]
    fn rejects_keys_that_could_run_something_else() {
        for bad in [
            "",
            "discord",
            "exe:relative\\app.exe",
            "exe:C:\\tools\\script.bat",
            "exe:C:\\tools\\a\".exe",
            "exe:C:\\tools\\a\n.exe",
            "aumid:",
            "aumid:bad\u{0}id",
            "path:C:\\a.exe",
        ] {
            assert!(parse_request(request(bad)).is_err(), "{bad:?}");
        }
        assert!(parse_request(request(&format!("exe:C:\\{}.exe", "a".repeat(1100)))).is_err());
        assert_eq!(
            parse_request(request("exe:C:\\Apps\\Chat.EXE"))
                .unwrap()
                .key,
            Key::Exe("C:\\Apps\\Chat.EXE".into())
        );
        assert_eq!(
            parse_request(request("aumid:com.squirrel.Discord.Discord"))
                .unwrap()
                .key,
            Key::Aumid("com.squirrel.Discord.Discord".into())
        );
    }

    #[test]
    fn rejects_unknown_operations_and_fields() {
        assert!(serde_json::from_str::<Request>(r#"{"op":"kill","app":"x"}"#).is_err());
        assert!(
            serde_json::from_str::<Request>(r#"{"op":"open","app":"x","args":"--evil"}"#).is_err()
        );
    }

    #[test]
    fn toggle_plans_cover_every_state() {
        let facts = |running, shown, foreground, minimized| ToggleFacts {
            running,
            shown,
            foreground,
            minimized,
        };
        for (given, plan) in [
            (facts(false, false, false, false), Plan::Launch),
            (facts(true, false, false, false), Plan::Launch),
            (facts(true, true, true, false), Plan::Hide),
            (facts(true, true, false, true), Plan::Restore),
            (facts(true, true, false, false), Plan::Raise),
        ] {
            assert_eq!(plan_toggle(given), plan, "{given:?}");
        }
    }

    fn win(pid: u32) -> Win {
        Win {
            hwnd: 1,
            pid,
            visible: true,
            owned: false,
            tool: false,
            app_window: false,
            cloaked: false,
            minimized: false,
            sized: true,
            title: String::new(),
        }
    }

    #[test]
    fn window_filter_skips_tool_owned_cloaked_and_hidden_windows() {
        let table = [
            (win(1), true),
            (
                Win {
                    tool: true,
                    ..win(1)
                },
                false,
            ),
            (
                Win {
                    tool: true,
                    app_window: true,
                    ..win(1)
                },
                true,
            ),
            (
                Win {
                    owned: true,
                    ..win(1)
                },
                false,
            ),
            (
                Win {
                    cloaked: true,
                    ..win(1)
                },
                false,
            ),
            (
                Win {
                    visible: false,
                    ..win(1)
                },
                false,
            ),
            (
                Win {
                    sized: false,
                    ..win(1)
                },
                false,
            ),
        ];
        for (window, counts) in table {
            assert_eq!(is_app_window(&window), counts, "{window:?}");
        }
    }

    #[test]
    fn tray_app_stays_running_without_a_visible_window() {
        let hidden = Win {
            visible: false,
            ..win(7)
        };
        let state = fold(&[hidden], true, None, "Monitor".into());
        assert!(state.running && !state.visible && !state.minimized);
        let windowless = fold(&[], true, None, String::new());
        assert!(windowless.running && !windowless.visible);
    }

    #[test]
    fn owned_dialog_in_front_keeps_the_app_focused() {
        let dialog = Win {
            owned: true,
            ..win(7)
        };
        let state = fold(&[win(7), dialog], true, Some(7), String::new());
        assert!(state.focused && state.visible);
        assert!(!fold(&[win(7)], true, Some(8), String::new()).focused);
    }

    #[test]
    fn process_exit_clears_every_flag() {
        let state = fold(&[], false, Some(7), "Monitor".into());
        assert_eq!(state, AppState::default());
    }

    #[test]
    fn minimized_means_every_shown_window_is_minimized() {
        let minimized = Win {
            minimized: true,
            ..win(7)
        };
        assert!(fold(&[minimized.clone()], true, None, String::new()).minimized);
        let mixed = fold(&[minimized, win(7)], true, None, String::new());
        assert!(!mixed.minimized && mixed.visible);
    }

    #[test]
    fn relocation_keeps_the_offset_and_fits_the_target() {
        let from = Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        let to = Rect {
            left: 1920,
            top: 0,
            right: 2720,
            bottom: 600,
        };
        let small = Rect {
            left: 100,
            top: 50,
            right: 500,
            bottom: 350,
        };
        assert_eq!(
            relocate(small, from, to),
            Rect {
                left: 2020,
                top: 50,
                right: 2420,
                bottom: 350
            }
        );
        let big = Rect {
            left: 1000,
            top: 500,
            right: 1900,
            bottom: 1000,
        };
        let moved = relocate(big, from, to);
        assert!(moved.left >= to.left && moved.right <= to.right);
        assert!(moved.top >= to.top && moved.bottom <= to.bottom);
    }

    #[test]
    fn slug_matches_the_mixer_convention() {
        assert_eq!(slug("Discord.exe"), "discord");
        assert_eq!(slug("Notepad++"), "notepad");
        assert_eq!(slug("my app_2"), "myapp_2");
    }

    #[test]
    fn non_ascii_apps_have_distinct_usable_state_ids() {
        assert_eq!(
            slug("Контур.Коннект.exe"),
            "u_d0bad0bed0bdd182d183d1802ed0bad0bed0bdd0bdd0b5d0bad182"
        );
        assert_eq!(slug("КОНТУР.КОННЕКТ.EXE"), slug("Контур.Коннект.exe"));
        assert_ne!(slug("Контур.Коннект.exe"), slug("Толк.exe"));
        assert_eq!(slug("Контур2.exe"), "2");
    }
}
