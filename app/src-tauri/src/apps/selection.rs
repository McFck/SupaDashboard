//! Selection is independent of focus and Z-order; the same snapshot drives Toggle and its action.
use super::model::{ToggleFacts, Win, Windows, is_app_window};

pub fn select(wins: &[Win], mode: Windows, title: &str) -> Vec<Win> {
    let title = title.trim().to_lowercase();
    let mut selected: Vec<Win> = wins
        .iter()
        .filter(|win| is_app_window(win))
        .filter(|win| mode != Windows::Title || win.title.to_lowercase().contains(&title))
        .cloned()
        .collect();
    // HWNDs stay fixed for a window's lifetime, unlike enumeration order or its changing title.
    selected.sort_unstable_by_key(|win| win.hwnd as usize);
    if mode == Windows::Main {
        selected.truncate(1);
    }
    selected
}

pub fn toggle_facts(selected: &[Win], running: bool, foreground_root: isize) -> ToggleFacts {
    ToggleFacts {
        running,
        shown: !selected.is_empty(),
        foreground: selected.iter().any(|win| win.hwnd == foreground_root),
        minimized: !selected.is_empty() && selected.iter().all(|win| win.minimized),
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
        }
    }

    #[test]
    fn steam_group_hides_from_either_window_despite_mixed_minimization_and_z_order() {
        let main = win(10, 1, "Steam");
        let chat = win(20, 2, "Friends");
        let minimized = Win {
            minimized: true,
            ..win(30, 3, "Chat")
        };
        for wins in [
            vec![main.clone(), chat.clone(), minimized.clone()],
            vec![minimized, chat, main],
        ] {
            let selected = select(&wins, Windows::All, "");
            assert_eq!(
                selected.iter().map(|w| w.hwnd).collect::<Vec<_>>(),
                [10, 20, 30]
            );
            for foreground in [10, 20] {
                assert_eq!(
                    plan_toggle(toggle_facts(&selected, true, foreground)),
                    Plan::Hide
                );
            }
            assert_eq!(plan_toggle(toggle_facts(&selected, true, 99)), Plan::Raise);
            let minimized: Vec<_> = selected
                .into_iter()
                .map(|w| Win {
                    minimized: true,
                    ..w
                })
                .collect();
            assert_eq!(
                plan_toggle(toggle_facts(&minimized, true, 99)),
                Plan::Restore
            );
        }
    }

    #[test]
    fn main_target_survives_focus_changes_and_helpers_never_become_targets() {
        let wins = vec![
            Win {
                visible: false,
                ..win(1, 1, "Hidden")
            },
            Win {
                tool: true,
                ..win(2, 1, "Tool")
            },
            Win {
                owned: true,
                ..win(3, 1, "Dialog")
            },
            Win {
                cloaked: true,
                ..win(4, 1, "Cloaked")
            },
            win(20, 1, "Friends"),
            win(10, 1, "Steam"),
        ];
        let selected = select(&wins, Windows::Main, "");
        assert_eq!(selected, [wins[5].clone()]);
        let reversed: Vec<_> = wins.into_iter().rev().collect();
        assert_eq!(select(&reversed, Windows::Main, ""), selected);
        // Another window in the same process must not hide the selected main window.
        assert_eq!(plan_toggle(toggle_facts(&selected, true, 20)), Plan::Raise);
        assert_eq!(plan_toggle(toggle_facts(&selected, true, 10)), Plan::Hide);
    }

    #[test]
    fn title_selects_only_matching_main_windows_and_never_falls_back() {
        let wins = vec![
            win(20, 1, "Steam Chat"),
            win(10, 2, "STEAM"),
            win(30, 1, "Friends"),
            Win {
                visible: false,
                ..win(1, 1, "Steam helper")
            },
        ];
        assert_eq!(
            select(&wins, Windows::Title, " steam ")
                .iter()
                .map(|w| w.hwnd)
                .collect::<Vec<_>>(),
            [10, 20]
        );
        assert!(select(&wins, Windows::Title, "missing").is_empty());
        assert_eq!(plan_toggle(toggle_facts(&[], false, 0)), Plan::Launch);
    }
}
