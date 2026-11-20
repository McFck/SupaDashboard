use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{Message, handshake::server::Request},
};

use super::{
    actions::{Action, web_url},
    stream::ScrollOut,
};

pub(super) const ADDRESS: &str = "127.0.0.1:43822";
pub(super) const PATH: &str = "/browser";
pub(super) const LOGIN_LIMIT: usize = 1024;
pub(super) const LIMIT: usize = 256 * 1024;
pub(super) const DEADLINE: Duration = Duration::from_secs(4);
pub(super) type Socket = WebSocketStream<TcpStream>;
pub(super) type Failure = &'static str;

pub(super) fn origin(request: &Request, extension: &str) -> bool {
    let headers = request.headers();
    headers.get_all("origin").iter().count() == 1
        && headers
            .get("origin")
            .is_some_and(|value| value == format!("chrome-extension://{extension}").as_str())
        && headers.get_all("host").iter().count() == 1
        && headers.get("host").is_some_and(|value| value == ADDRESS)
        && request
            .uri()
            .path_and_query()
            .is_some_and(|path| path.as_str() == PATH)
}

pub(super) fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tab {
    id: i32,
    title: String,
    active: bool,
    favicon: Option<String>,
    #[serde(default)]
    window: i32,
    group: Option<i32>,
    #[serde(default)]
    pinned: bool,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum GroupColor {
    Grey,
    Blue,
    Red,
    Yellow,
    Green,
    Pink,
    Purple,
    Cyan,
    Orange,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Group {
    id: i32,
    window: i32,
    title: String,
    color: GroupColor,
    collapsed: bool,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaState {
    tab: i32,
    paused: bool,
    rate: f64,
    fullscreen: bool,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Display {
    id: String,
    name: String,
    /// Browser windows whose centre lies on this display.
    windows: Vec<i32>,
}

pub(super) fn display_id(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    tabs: Vec<Tab>,
    #[serde(default)]
    groups: Vec<Group>,
    pub(super) active_tab: Option<i32>,
    media: Option<MediaState>,
    #[serde(default)]
    suspended: bool,
    #[serde(default)]
    displays: Vec<Display>,
}

impl State {
    pub(super) fn validate(&self) -> Result<(), Failure> {
        let mut ids = std::collections::HashSet::new();
        let mut groups = std::collections::HashMap::new();
        if self.tabs.len() > 256
            || self.groups.len() > self.tabs.len()
            || !self.groups.iter().all(|group| {
                group.id >= 0
                    && group.window >= 0
                    && group.title.len() <= 256
                    && groups.insert(group.id, group.window).is_none()
            })
            || !self.tabs.iter().all(|tab| {
                tab.id >= 0
                    && tab.window >= 0
                    && tab
                        .group
                        .is_none_or(|id| !tab.pinned && groups.get(&id) == Some(&tab.window))
                    && tab.title.len() <= 256
                    && tab.favicon.as_deref().is_none_or(|url| web_url(url, 512))
                    && ids.insert(tab.id)
            })
            || self
                .active_tab
                .is_some_and(|id| !self.tabs.iter().any(|tab| tab.id == id && tab.active))
            || !self.valid_displays()
            || self.media.as_ref().is_some_and(|media| {
                !ids.contains(&media.tab)
                    || (media.rate != 0.0 && !(0.0625..=16.0).contains(&media.rate))
            })
        {
            return Err("Invalid browser state");
        }
        Ok(())
    }

    fn valid_displays(&self) -> bool {
        let mut ids = std::collections::HashSet::new();
        self.displays.len() <= 16
            && self.displays.iter().all(|display| {
                display_id(&display.id)
                    && display.name.len() <= 256
                    && display.windows.len() <= 256
                    && display.windows.iter().all(|window| *window >= 0)
                    && ids.insert(display.id.as_str())
            })
    }

    pub(super) fn has_display(&self, id: &str) -> bool {
        self.displays.iter().any(|display| display.id == id)
    }

    pub(super) fn has_media(&self) -> bool {
        self.media.is_some()
    }

    pub(super) fn has_tab(&self, id: i32) -> bool {
        self.tabs.iter().any(|tab| tab.id == id)
    }

    pub(super) fn has_group(&self, id: i32) -> bool {
        self.groups.iter().any(|group| group.id == id)
    }

    pub(super) fn can_move_tab(&self, id: i32, anchor: i32) -> bool {
        let source = self.tabs.iter().find(|tab| tab.id == id);
        let target = self.tabs.iter().find(|tab| tab.id == anchor);
        source.zip(target).is_some_and(|(a, b)| {
            a.window == b.window && a.group == b.group && a.pinned == b.pinned
        })
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Outgoing<'a> {
    Command { id: u32, action: &'a Action },
    Scroll(ScrollOut),
    Unpaired,
    UnpairFailed,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Reply {
    Unpair {},
    State {
        state: State,
    },
    Done {
        id: u32,
        ok: bool,
        #[serde(default)]
        gone: bool,
    },
}

fn decode<T: DeserializeOwned>(text: &str) -> Result<T, Failure> {
    if text.len() > LIMIT {
        return Err("Browser message too large");
    }
    serde_json::from_str(text).map_err(|_| "Invalid browser message")
}

async fn read_text(
    socket: &mut Socket,
) -> Result<tokio_tungstenite::tungstenite::Utf8Bytes, Failure> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => return Ok(text),
            Some(Ok(Message::Ping(_))) => {
                socket.flush().await.map_err(|_| "Browser disconnected")?;
            }
            Some(Ok(Message::Pong(_))) => {}
            _ => return Err("Browser disconnected"),
        }
    }
}

pub(super) async fn read<T: DeserializeOwned>(socket: &mut Socket) -> Result<T, Failure> {
    decode(&read_text(socket).await?)
}

pub(super) async fn send(socket: &mut Socket, frame: &impl Serialize) -> Result<(), Failure> {
    let text = serde_json::to_string(frame).map_err(|_| "Could not encode browser message")?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| "Browser disconnected")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn upgrade_accepts_only_the_exact_extension_origin_and_loopback_endpoint() {
        let expected = format!("chrome-extension://{ID}");
        let request = |host: &str, path: &str, origins: &[&str]| {
            let mut builder = Request::builder().uri(path).header("host", host);
            for value in origins {
                builder = builder.header("origin", *value);
            }
            builder.body(()).unwrap()
        };
        assert!(origin(&request(ADDRESS, PATH, &[&expected]), ID));
        for origins in [
            vec![],
            vec!["null"],
            vec!["https://127.0.0.1"],
            vec!["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            vec![&expected, &expected],
        ] {
            assert!(!origin(&request(ADDRESS, PATH, &origins), ID));
        }
        assert!(!origin(
            &request(ADDRESS, PATH, &[&format!("{expected}/")]),
            ID
        ));
        assert!(!origin(&request("localhost:43822", PATH, &[&expected]), ID));
        assert!(!origin(&request(ADDRESS, "/browser?x", &[&expected]), ID));
    }

    #[test]
    fn malformed_oversized_or_unmatched_state_cannot_supply_targets() {
        let state = |tabs, active_tab, media| {
            json!({"kind": "state", "state": {"tabs": tabs, "activeTab": active_tab, "media": media}})
                .to_string()
        };
        let good = json!({"id": 10, "title": "Example", "active": true});
        let media = json!({"tab": 10, "paused": true, "rate": 1, "fullscreen": false});
        let valid = state(json!([good]), json!(10), media.clone());
        let parse = |payload: &str| match decode::<Reply>(payload)? {
            Reply::State { state } => state.validate(),
            _ => Err("Expected state"),
        };
        assert_eq!(parse(&valid), Ok(()));
        for payload in [
            state(json!([good, good]), json!(10), media.clone()),
            state(
                json!([{"id": -1, "title": "X", "active": true}]),
                json!(null),
                json!(null),
            ),
            state(
                json!([{"id": 1, "title": "x".repeat(257), "active": true}]),
                json!(null),
                json!(null),
            ),
            state(
                json!([{"id": 10, "title": "X", "active": true, "favicon": "file:///secret"}]),
                json!(10),
                json!(null),
            ),
            state(
                json!([good]),
                json!(null),
                json!({"tab": 9, "paused": true, "rate": 1, "fullscreen": false}),
            ),
            state(
                json!([good]),
                json!(null),
                json!({"tab": 10, "paused": true, "rate": 17, "fullscreen": false}),
            ),
            state(json!([good]), json!(9), json!(null)),
            format!("{valid}{}", " ".repeat(LIMIT)),
            r#"{"kind":"state","state":{"tabs":[],"extra":true}}"#.into(),
        ] {
            assert!(parse(&payload).is_err(), "{:.240}", payload);
        }
    }

    #[test]
    fn grouped_tabs_cannot_reference_missing_or_other_window_groups() {
        let good = json!({
            "tabs": [{"id": 1, "title": "One", "active": true, "window": 2, "group": 3}],
            "groups": [{"id": 3, "window": 2, "title": "Work", "color": "blue", "collapsed": true}],
            "activeTab": 1
        });
        let check = |input| {
            serde_json::from_value::<State>(input)
                .map_err(|_| "Invalid browser message")?
                .validate()
        };
        assert_eq!(check(good.clone()), Ok(()));
        for (field, value) in [
            ("window", json!(42)),
            ("id", json!(4)),
            ("color", json!("plaid")),
        ] {
            let mut bad = good.clone();
            bad["groups"][0][field] = value;
            assert!(check(bad).is_err(), "{field}");
        }
    }

    #[test]
    fn displays_need_unique_short_ids_and_bounded_fields() {
        let check = |displays: serde_json::Value| {
            serde_json::from_value::<State>(
                json!({"tabs": [], "activeTab": null, "displays": displays}),
            )
            .map_err(|_| "Invalid browser message")?
            .validate()
        };
        let good = json!({"id": "2528732444", "name": "DELL U2720Q", "windows": [1, 2]});
        assert_eq!(check(json!([good])), Ok(()));
        for bad in [
            json!([good, good]),
            json!([{"id": "", "name": "A", "windows": []}]),
            json!([{"id": "../1", "name": "A", "windows": []}]),
            json!([{"id": "1", "name": "x".repeat(257), "windows": []}]),
            json!([{"id": "1", "name": "A", "windows": [-1]}]),
            json!([{"id": "1", "name": "A", "windows": [], "bounds": 0}]),
            json!(
                (0..17)
                    .map(|i| json!({"id": i.to_string(), "name": "A", "windows": []}))
                    .collect::<Vec<_>>()
            ),
        ] {
            assert!(check(bad.clone()).is_err(), "{bad}");
        }
    }

    #[test]
    fn completion_frames_require_a_valid_id_and_result() {
        assert!(matches!(
            decode::<Reply>(r#"{"kind":"done","id":4,"ok":false,"gone":true}"#),
            Ok(Reply::Done {
                id: 4,
                ok: false,
                gone: true,
                ..
            })
        ));
        for payload in [
            r#"{"kind":"done","id":4,"ok":"true"}"#,
            r#"{"kind":"done","id":4,"ok":true,"tab":9}"#,
            r#"{"kind":"done","id":-1,"ok":true}"#,
        ] {
            assert!(decode::<Reply>(payload).is_err(), "{payload}");
        }
    }

    #[test]
    fn unpair_frames_cannot_carry_extra_fields() {
        assert!(matches!(
            decode::<Reply>(r#"{"kind":"unpair"}"#),
            Ok(Reply::Unpair {})
        ));
        assert!(decode::<Reply>(r#"{"kind":"unpair","id":4}"#).is_err());
        assert!(decode::<Reply>(r#"{"kind":"unpaired"}"#).is_err());
    }
}
