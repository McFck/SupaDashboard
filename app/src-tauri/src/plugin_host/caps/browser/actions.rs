use serde::{Deserialize, Serialize};

use super::wire::{Failure, State};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Destination {
    New,
    Current,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Scroll {
    Drag { pixels: i32 },
    Fling { pixels: i32 },
    PageUp {},
    PageDown {},
    Top {},
    Bottom {},
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Media {
    Toggle {},
    Back {},
    Forward {},
    Speed { rate: f64 },
    Fullscreen {},
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Activate {
        tab: i32,
    },
    Close {
        tab: i32,
    },
    Open {
        url: String,
        destination: Destination,
    },
    Scroll {
        tab: i32,
        input: Scroll,
    },
    Media {
        tab: i32,
        input: Media,
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
    pub(super) fn validate_input(&self, revision: Option<u32>) -> Result<(), Failure> {
        match self {
            Self::Open { url, .. } if !web_url(url, 2048) => Err("Enter a valid HTTP or HTTPS URL"),
            Self::Open { .. } => Ok(()),
            _ if revision.is_none() => Err("Browser snapshot is missing"),
            Self::Scroll { input, .. } if !input.valid() => Err("Invalid scroll request"),
            Self::Media { input, .. } if !input.valid() => Err("Invalid media request"),
            _ => Ok(()),
        }
    }

    pub(super) fn validate_target(&self, state: &State) -> Result<(), Failure> {
        match self {
            Self::Activate { tab } | Self::Close { tab } if !state.contains(*tab) => {
                Err("Browser tabs changed")
            }
            Self::Open {
                destination: Destination::Current,
                ..
            } if state.active_tab.is_none() => Err("No active browser tab"),
            Self::Scroll { tab, .. } if Some(*tab) != state.active_tab => {
                Err("Browser scroll unavailable")
            }
            Self::Media { tab, .. } if !state.has_media(*tab) => Err("Browser media unavailable"),
            _ => Ok(()),
        }
    }

    pub(super) fn failure(&self) -> Failure {
        match self {
            Self::Activate { .. } => "Could not select tab",
            Self::Close { .. } => "Could not close tab",
            Self::Open { .. } => "Could not open website",
            Self::Scroll { .. } => "Could not scroll this tab",
            Self::Media { .. } => "Could not control browser media",
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
            .validate_input(None)
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
        let validate = |value: Value, revision| {
            serde_json::from_value::<Action>(value)
                .map_err(|_| "Invalid action")?
                .validate_input(revision)
        };
        for value in [
            json!({"kind": "close", "tab": 1, "window": 0}),
            json!({"kind": "close", "tab": 1.5}),
            json!({"kind": "open", "url": "https://example.org", "destination": "popup"}),
            json!({"kind": "scroll", "tab": 1, "input": {"kind": "drag", "pixels": 2049}}),
            json!({"kind": "scroll", "tab": 1, "input": {"kind": "fling", "pixels": -6001}}),
            json!({"kind": "scroll", "tab": 1, "input": {"kind": "top", "extra": 0}}),
            json!({"kind": "media", "tab": 2, "input": {"kind": "speed", "rate": 0}}),
            json!({"kind": "media", "tab": 2, "input": {"kind": "fullscreen", "window": 2}}),
        ] {
            assert!(validate(value.clone(), Some(4)).is_err(), "{value}");
        }
        assert!(validate(json!({"kind": "close", "tab": 1}), None).is_err());
        for (value, allowed) in [
            (json!({"kind": "activate", "tab": 0}), false),
            (json!({"kind": "close", "tab": -1}), false),
            (json!({"kind": "close", "tab": 1}), true),
            (
                json!({"kind": "scroll", "tab": 2, "input": {"kind": "bottom"}}),
                false,
            ),
            (
                json!({"kind": "scroll", "tab": 1, "input": {"kind": "page_down"}}),
                true,
            ),
            (
                json!({"kind": "media", "tab": 1, "input": {"kind": "toggle"}}),
                false,
            ),
            (
                json!({"kind": "media", "tab": 2, "input": {"kind": "back"}}),
                true,
            ),
            (
                json!({"kind": "media", "tab": 2, "input": {"kind": "forward"}}),
                true,
            ),
            (
                json!({"kind": "media", "tab": 2, "input": {"kind": "fullscreen"}}),
                true,
            ),
        ] {
            let action = serde_json::from_value::<Action>(value.clone()).unwrap();
            assert_eq!(action.validate_target(&state).is_ok(), allowed, "{value}");
        }
    }
}

impl Scroll {
    fn valid(&self) -> bool {
        match self {
            Self::Drag { pixels } => (1..=2048).contains(&pixels.unsigned_abs()),
            Self::Fling { pixels } => (1..=6000).contains(&pixels.unsigned_abs()),
            _ => true,
        }
    }
}

pub(super) fn valid_rate(rate: f64) -> bool {
    (0.0625..=16.0).contains(&rate)
}

impl Media {
    fn valid(&self) -> bool {
        match self {
            Self::Speed { rate } => valid_rate(*rate),
            _ => true,
        }
    }
}
