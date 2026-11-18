use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{Message, handshake::server::Request},
};

use super::{
    actions::{Action, valid_rate, web_url},
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
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaState {
    tab: i32,
    paused: bool,
    rate: f64,
    fullscreen: bool,
}

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    tabs: Vec<Tab>,
    pub(super) active_tab: Option<i32>,
    media: Option<MediaState>,
    #[serde(default)]
    suspended: bool,
}

impl State {
    pub(super) fn validate(&self) -> Result<(), Failure> {
        let mut ids = std::collections::HashSet::new();
        if self.tabs.len() > 256
            || !self.tabs.iter().all(|tab| {
                tab.id >= 0
                    && tab.title.len() <= 256
                    && tab.favicon.as_deref().is_none_or(|url| web_url(url, 512))
                    && ids.insert(tab.id)
            })
            || self
                .active_tab
                .is_some_and(|id| !self.tabs.iter().any(|tab| tab.id == id && tab.active))
            || self.media.as_ref().is_some_and(|media| {
                !ids.contains(&media.tab) || (media.rate != 0.0 && !valid_rate(media.rate))
            })
        {
            return Err("Invalid browser state");
        }
        Ok(())
    }

    pub(super) fn has_media(&self) -> bool {
        self.media.is_some()
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Outgoing<'a> {
    Command { id: u32, action: &'a Action },
    Scroll(ScrollOut),
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Reply {
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
}
