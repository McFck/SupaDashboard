//! Selection is independent of focus; the same snapshot drives Toggle and its action.
use super::model::{AppState, ToggleFacts, Win, Windows, is_app_window};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WindowSelection {
    pub slug: String,
    pub windows: Windows,
    pub title: String,
}

impl WindowSelection {
    pub fn validate(&self) -> Result<(), String> {
        if self.slug.is_empty()
            || self.slug.len() > 1024
            || !self
                .slug
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        {
            return Err("The app is not valid".into());
        }
        if self.title.len() > 1024
            || self.title.chars().any(char::is_control)
            || (matches!(self.windows, Windows::Title | Windows::Window)
                && self.title.trim().is_empty())
        {
            return Err("The window title is not valid".into());
        }
        Ok(())
    }
}

/// The windows a command acts on, in Z order (front first): restoring them back to front keeps that order and
/// leaves the most recently active one focused. `Main` is the one oldest window, which does not change with focus.
pub fn select(wins: &[Win], mode: Windows, title: &str) -> Vec<Win> {
    let title = title.trim().to_lowercase();
    let mut selected: Vec<Win> = wins
        .iter()
        .filter(|win| is_app_window(win))
        .filter(|win| match mode {
            Windows::Title => win.title.to_lowercase().contains(&title),
            Windows::Window => win.title.trim().to_lowercase() == title,
            Windows::Main | Windows::All => true,
        })
        .cloned()
        .collect();
    if mode == Windows::Main {
        // HWNDs stay fixed for a window's lifetime, unlike Z order or its changing title.
        selected.sort_unstable_by_key(|win| win.hwnd as usize);
        selected.truncate(1);
    }
    selected
}

/// The distinct titles of the windows a user could pick, front first.
pub fn titles(wins: &[Win]) -> Vec<String> {
    let mut titles: Vec<String> = Vec::new();
    for win in wins.iter().filter(|win| is_app_window(win)) {
        let title = win.title.trim();
        if !title.is_empty() && !titles.iter().any(|known| known == title) {
            titles.push(title.to_owned());
        }
    }
    titles
}

pub fn toggle_facts(selected: &[Win], running: bool, foreground_root: isize) -> ToggleFacts {
    ToggleFacts {
        running,
        shown: !selected.is_empty(),
        foreground: selected.iter().any(|win| win.hwnd == foreground_root),
        minimized: !selected.is_empty() && selected.iter().all(|win| win.minimized),
    }
}

pub fn state(wins: &[Win], selection: &WindowSelection, foreground_root: isize) -> AppState {
    let selected = select(wins, selection.windows, &selection.title);
    AppState {
        running: !selected.is_empty(),
        focused: selected.iter().any(|win| win.hwnd == foreground_root),
        minimized: !selected.is_empty() && selected.iter().all(|win| win.minimized),
        visible: selected.iter().any(|win| !win.minimized),
        display: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apps::model::{Plan, plan_toggle};

    fn win(hwnd: isize, pid: u32, title: &str) -> Win {
        Win {
            hwnd,
            pid,
            title: title.into(),
            visible: true,
            owned: false,
            tool: false,
            app_window: false,
            cloaked: false,
            minimized: false,
            sized: true,
        }
    }

    /// Steam's web helper in Z order: the Library and Friends in two processes, a hidden helper, a zero-size helper.
    fn steam() -> Vec<Win> {
        vec![
            Win {
                visible: false,
                ..win(5, 1, "")
            },
            win(30, 2, "Friends List"),
            Win {
                sized: false,
                ..win(40, 1, "Steam")
            },
            win(10, 1, "Steam"),
        ]
    }

    fn handles(wins: &[Win]) -> Vec<isize> {
        wins.iter().map(|win| win.hwnd).collect()
    }

    fn plan(selected: &[Win], foreground: isize) -> Plan {
        plan_toggle(toggle_facts(selected, true, foreground))
    }

    #[test]
    fn group_ignores_hidden_and_zero_size_helpers_and_keeps_z_order() {
        assert_eq!(handles(&select(&steam(), Windows::All, "")), [30, 10]);
    }

    #[test]
    fn group_hides_when_any_window_is_in_front_wherever_focus_moves() {
        let selected = select(&steam(), Windows::All, "");
        for foreground in [10, 30] {
            assert_eq!(plan(&selected, foreground), Plan::Hide);
        }
        // Another app, or a hidden helper, in front: bring the group up instead.
        for foreground in [99, 5] {
            assert_eq!(plan(&selected, foreground), Plan::Raise);
        }
    }

    #[test]
    fn group_with_one_window_minimized_is_restored_as_a_whole_not_hidden() {
        let mut selected = select(&steam(), Windows::All, "");
        selected[1].minimized = true;
        assert_eq!(plan(&selected, 99), Plan::Raise);
        assert_eq!(plan(&selected, 30), Plan::Hide);
        for win in &mut selected {
            win.minimized = true;
        }
        assert_eq!(plan(&selected, 99), Plan::Restore);
    }

    #[test]
    fn restore_order_follows_the_windows_z_order_not_their_handles() {
        let mut wins = steam();
        wins.swap(1, 3);
        // Friends is now behind the Library: the Library is the one left focused.
        assert_eq!(handles(&select(&wins, Windows::All, "")), [10, 30]);
    }

    #[test]
    fn main_window_does_not_change_when_focus_moves() {
        let wins = steam();
        let reversed: Vec<_> = wins.iter().rev().cloned().collect();
        assert_eq!(handles(&select(&wins, Windows::Main, "")), [10]);
        assert_eq!(handles(&select(&reversed, Windows::Main, "")), [10]);
        let main = select(&wins, Windows::Main, "");
        assert_eq!(plan(&main, 30), Plan::Raise);
        assert_eq!(plan(&main, 10), Plan::Hide);
    }

    #[test]
    fn specific_window_matches_the_exact_title_again_after_it_is_recreated() {
        let mut wins = steam();
        assert_eq!(
            handles(&select(&wins, Windows::Window, " friends list ")),
            [30]
        );
        // Friends is closed and reopened: new handle, same title.
        wins[1] = win(77, 3, "Friends List");
        assert_eq!(
            handles(&select(&wins, Windows::Window, "friends list")),
            [77]
        );
        assert!(select(&wins, Windows::Window, "friends").is_empty());
        assert_eq!(handles(&select(&wins, Windows::Title, "friends")), [77]);
    }

    #[test]
    fn picker_lists_each_visible_title_once() {
        let mut wins = steam();
        wins.push(win(50, 2, "Steam"));
        assert_eq!(titles(&wins), ["Friends List", "Steam"]);
    }

    #[test]
    fn missing_title_selects_nothing_and_never_falls_back() {
        assert!(select(&steam(), Windows::Title, "missing").is_empty());
        assert!(select(&steam(), Windows::Window, "missing").is_empty());
        assert_eq!(plan_toggle(toggle_facts(&[], false, 0)), Plan::Launch);
    }

    #[test]
    fn scoped_states_ignore_the_apps_other_windows_and_reset_when_the_target_disappears() {
        let mut wins = steam();
        wins[1].minimized = true;
        let selection = WindowSelection {
            slug: "steam".into(),
            windows: Windows::Window,
            title: "Friends List".into(),
        };
        let result = state(&wins, &selection, 10);
        assert!(result.minimized);
        assert!(!result.visible && !result.focused);
        assert!(state(&wins, &selection, 30).focused);
        wins.remove(1);
        assert_eq!(state(&wins, &selection, 10), AppState::default());
    }

    #[test]
    fn watch_selections_reject_invalid_slugs_and_titles() {
        let mut selection = WindowSelection {
            slug: "steam".into(),
            windows: Windows::Window,
            title: "Friends List".into(),
        };
        assert!(selection.validate().is_ok());
        for title in ["", " ", "bad\nname"] {
            selection.title = title.into();
            assert!(selection.validate().is_err());
        }
        selection.title = "x".repeat(1025);
        assert!(selection.validate().is_err());
        selection.title = "Friends List".into();
        selection.slug = "../steam".into();
        assert!(selection.validate().is_err());
    }
}
