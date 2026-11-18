use serde::{Deserialize, Serialize};

use super::wire::{Failure, State};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Destination {
    New,
    Current,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScrollFrame {
    Hold { tab: Option<i32> },
    Move { dx: i32, dy: i32, tab: Option<i32> },
    Release { vx: f32, vy: f32, tab: Option<i32> },
}

impl ScrollFrame {
    pub(super) fn tab(&self) -> Option<i32> {
        match self {
            Self::Hold { tab, .. } | Self::Move { tab, .. } | Self::Release { tab, .. } => *tab,
        }
    }

    pub(super) fn validate(&self) -> Result<(), Failure> {
        let valid = match self {
            Self::Hold { .. } => true,
            Self::Move { dx, dy, .. } => [dx, dy].into_iter().all(|d| d.unsigned_abs() <= 4096),
            Self::Release { vx, vy, .. } => [vx, vy].into_iter().all(|v| v.abs() <= 10000.0),
        };
        (valid && self.tab().is_none_or(|tab| tab >= 0))
            .then_some(())
            .ok_or("Invalid scroll request")
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PageInput {
    PageUp {},
    PageDown {},
    Top {},
    Bottom {},
    Back {},
    Forward {},
    Reload {},
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MediaInput {
    Play {},
    Pause {},
    Toggle {},
    Seek { seconds: i32 },
    Speed { rate: f64 },
    Fullscreen {},
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TabInput {
    Next,
    Previous,
    New,
    Close,
    Reopen,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SuspendMode {
    Toggle,
    On,
    Off,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PointerInput {
    Begin {},
    Move { dx: i32, dy: i32 },
    Click {},
    Down {},
    Up {},
    Cancel {},
}

impl PointerInput {
    fn validate(&self) -> Result<(), Failure> {
        match self {
            Self::Move { dx, dy }
                if [dx, dy]
                    .into_iter()
                    .any(|delta| delta.unsigned_abs() > 2048) =>
            {
                Err("Invalid browser pointer movement")
            }
            _ => Ok(()),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Tab {
        input: TabInput,
    },
    SelectTab {
        tab: i32,
    },
    CloseTab {
        tab: i32,
    },
    Group {
        group: i32,
        collapsed: bool,
    },
    Open {
        url: String,
        destination: Destination,
    },
    Page {
        input: PageInput,
    },
    Media {
        input: MediaInput,
    },
    Suspend {
        mode: SuspendMode,
    },
    WindowFullscreen {},
    Pointer {
        tab: i32,
        input: PointerInput,
    },
}

pub(super) fn web_url(value: &str, max: usize) -> bool {
    value.len() <= max
        && value.split_once("://").is_some_and(|(scheme, rest)| {
            (scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https"))
                && !rest.is_empty()
                && !rest.starts_with(['/', '?', '#'])
        })
        && !value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\')
        && tauri::Url::parse(value).is_ok_and(|url| {
            url.host().is_some() && url.username().is_empty() && url.password().is_none()
        })
}

impl Action {
    pub(super) fn validate_input(&self) -> Result<(), Failure> {
        match self {
            Self::Pointer { tab, .. } | Self::SelectTab { tab } | Self::CloseTab { tab }
                if *tab < 0 =>
            {
                Err("Invalid browser tab")
            }
            Self::Group { group, .. } if *group < 0 => Err("Invalid browser tab group"),
            Self::Pointer { input, .. } => input.validate(),
            Self::Open { url, .. } if !web_url(url, 2048) => Err("Enter a valid HTTP or HTTPS URL"),
            Self::Media {
                input: MediaInput::Seek { seconds },
            } if !(-600..=600).contains(seconds) => Err("Invalid media request"),
            Self::Media {
                input: MediaInput::Speed { rate },
            } if !(0.25..=4.0).contains(rate) => Err("Invalid media request"),
            _ => Ok(()),
        }
    }

    pub(super) fn validate_target(&self, state: &State) -> Result<(), Failure> {
        match self {
            Self::SelectTab { tab } | Self::CloseTab { tab } if !state.has_tab(*tab) => {
                Err("Tab closed")
            }
            Self::Group { group, .. } if !state.has_group(*group) => Err("Tab group closed"),
            Self::Tab {
                input: TabInput::Next | TabInput::Previous | TabInput::Close,
            } if state.active_tab.is_none() => Err("No active browser tab"),
            Self::Open {
                destination: Destination::Current,
                ..
            } if state.active_tab.is_none() => Err("No active browser tab"),
            Self::Page { .. } if state.active_tab.is_none() => Err("No active browser tab"),
            Self::Media { .. } if !state.has_media() => Err("Browser media unavailable"),
            Self::Pointer { tab, input }
                if !matches!(input, PointerInput::Cancel {}) && state.active_tab != Some(*tab) =>
            {
                Err("Browser tab changed")
            }
            _ => Ok(()),
        }
    }

    pub(super) fn failure(&self) -> Failure {
        match self {
            Self::Tab { .. } => "Could not control browser tab",
            Self::SelectTab { .. } => "Could not select tab",
            Self::CloseTab { .. } => "Could not close tab",
            Self::Group { .. } => "Could not change tab group",
            Self::Open { .. } => "Could not open website",
            Self::Page { .. } => "Could not control this page",
            Self::Media { .. } => "Could not control browser media",
            Self::Suspend { .. } => "Could not change browser media suspension",
            Self::WindowFullscreen { .. } => "Could not change browser fullscreen",
            Self::Pointer { .. } => "Browser touchpad unavailable",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn scenario_only_opens_well_formed_http_and_https_urls() {
        let parse = |url: &str| {
            serde_json::from_value::<Action>(json!({
                "kind": "open", "url": url, "destination": "new"
            }))
            .unwrap()
            .validate_input()
        };
        assert_eq!(parse("http://127.0.0.1:5481/page?a=b#c"), Ok(()));
        assert_eq!(parse("https://example.org/путь"), Ok(()));
        assert_eq!(parse("HTTPS://example.org/"), Ok(()));
        for url in [
            "javascript:alert(1)",
            "data:text/html,test",
            "file:///C:/Windows",
            "brave://settings",
            "https:example.org",
            "https:///example.org",
            "https://name:password@example.org",
            "https://example.org\n/test",
            "https://example.org\\test",
            &format!("https://example.org/{}", "a".repeat(2048)),
        ] {
            assert!(parse(url).is_err(), "{:.100}", url);
        }
    }

    #[test]
    fn only_known_actions_with_bounded_input_and_eligible_tab_ids_can_dispatch() {
        let state = serde_json::from_value::<State>(json!({
            "tabs": [
                {"id": 1, "title": "Active", "active": true},
                {"id": 2, "title": "Playing", "active": false},
            ],
            "activeTab": 1,
            "media": {"tab": 2, "paused": false, "rate": 1, "fullscreen": false}
        }))
        .unwrap();
        let validate = |value: Value| {
            serde_json::from_value::<Action>(value)
                .map_err(|_| "Invalid action")?
                .validate_input()
        };
        for value in [
            json!({"kind": "tab", "input": "close", "window": 0}),
            json!({"kind": "tab", "input": "activate"}),
            json!({"kind": "suspend", "mode": "invalid"}),
            json!({"kind": "open", "url": "https://example.org", "destination": "popup"}),
            json!({"kind": "page", "input": {"kind": "top", "extra": 0}}),
            json!({"kind": "media", "input": {"kind": "speed", "rate": 0}}),
            json!({"kind": "media", "input": {"kind": "seek", "seconds": -601}}),
            json!({"kind": "media", "input": {"kind": "fullscreen", "window": 2}}),
            json!({"kind": "pointer", "tab": 1, "input": {"kind": "move", "dx": 2049, "dy": 0}}),
            json!({"kind": "pointer", "tab": 1, "input": {"kind": "click", "x": 4}}),
        ] {
            assert!(validate(value.clone()).is_err(), "{value}");
        }
        for (value, allowed) in [
            (json!({"kind": "tab", "input": "close"}), true),
            (json!({"kind": "suspend", "mode": "off"}), true),
            (json!({"kind": "select_tab", "tab": 2}), true),
            (json!({"kind": "close_tab", "tab": 9}), false),
            (
                json!({"kind": "group", "group": 9, "collapsed": true}),
                false,
            ),
            (
                json!({"kind": "pointer", "tab": 2, "input": {"kind": "click"}}),
                false,
            ),
            (
                json!({"kind": "pointer", "tab": 1, "input": {"kind": "click"}}),
                true,
            ),
            (
                json!({"kind": "page", "input": {"kind": "page_down"}}),
                true,
            ),
            (
                json!({"kind": "media", "input": {"kind": "fullscreen"}}),
                true,
            ),
        ] {
            let action = serde_json::from_value::<Action>(value.clone()).unwrap();
            assert_eq!(action.validate_target(&state).is_ok(), allowed, "{value}");
        }
    }

    #[test]
    fn kit_fixture_is_accepted_by_the_native_action_boundary() {
        let fixture =
            include_str!("../../../../../src/features/plugins/browser-actions.fixture.json");
        for action in serde_json::from_str::<Vec<Action>>(fixture).unwrap() {
            assert_eq!(action.validate_input(), Ok(()));
        }
    }

    #[test]
    fn scroll_frames_reject_extra_fields_and_out_of_range_axes() {
        for input in [
            json!({"phase": "hold", "dx": 1}),
            json!({"phase": "move", "dx": 0.5, "dy": 0}),
            json!({"phase": "move", "dx": -2147483648i32, "dy": 0}),
            json!({"phase": "release", "vx": 0, "vy": 10001}),
            json!({"phase": "hold", "tab": -1}),
            json!({"phase": "hold", "outline": true, "tab": 1}),
        ] {
            assert!(
                serde_json::from_value::<ScrollFrame>(input)
                    .map_err(|_| "Invalid scroll request")
                    .and_then(|frame| frame.validate())
                    .is_err()
            );
        }
        assert!(
            ScrollFrame::Move {
                dx: -4096,
                dy: 4096,
                tab: Some(1),
            }
            .validate()
            .is_ok()
        );
        assert!(
            ScrollFrame::Release {
                vx: 10000.0,
                vy: -10000.0,
                tab: Some(1),
            }
            .validate()
            .is_ok()
        );
    }
}

pub(super) fn valid_rate(rate: f64) -> bool {
    (0.0625..=16.0).contains(&rate)
}
