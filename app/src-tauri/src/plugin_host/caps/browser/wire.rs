use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    WebSocketStream,
    tungstenite::{Message, handshake::server::Request},
};

pub(super) const ADDRESS: &str = "127.0.0.1:43822";
pub(super) const PATH: &str = "/browser-remote";
pub(super) const LIMIT: usize = 512 * 1024;
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
    pub id: i32,
    title: String,
    active: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Command {
    #[serde(rename = "tabs.list")]
    List { id: u32 },
    #[serde(rename = "tabs.activate")]
    Activate { id: u32, tab: i32 },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Reply {
    #[serde(rename = "tabs.list")]
    List {
        id: u32,
        tabs: Vec<Tab>,
    },
    #[serde(rename = "tabs.activate")]
    Activate {
        id: u32,
    },
    Failed {
        id: u32,
    },
}

impl Reply {
    pub(super) fn list(self, request: u32) -> Result<Vec<Tab>, Failure> {
        let Self::List { id, tabs } = self else {
            return Err("Browser could not list tabs");
        };
        let mut ids = std::collections::HashSet::new();
        if id != request
            || tabs.len() > 256
            || !tabs
                .iter()
                .all(|tab| tab.id >= 0 && tab.title.len() <= 256 && ids.insert(tab.id))
        {
            return Err("Invalid browser tab list");
        }
        Ok(tabs)
    }

    pub(super) fn activation(self, request: u32) -> Result<Result<(), Failure>, Failure> {
        match self {
            Self::Activate { id } if id == request => Ok(Ok(())),
            Self::Failed { id } if id == request => Ok(Err("Browser could not activate the tab")),
            _ => Err("Invalid browser activation reply"),
        }
    }
}

fn decode<T: DeserializeOwned>(text: &str) -> Result<T, Failure> {
    if text.len() > LIMIT {
        return Err("Browser message too large");
    }
    serde_json::from_str(text).map_err(|_| "Invalid browser message")
}

pub(super) async fn read<T: DeserializeOwned>(socket: &mut Socket) -> Result<T, Failure> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => return decode(&text),
            Some(Ok(Message::Ping(_))) => {
                socket.flush().await.map_err(|_| "Browser disconnected")?;
            }
            Some(Ok(Message::Pong(_))) => {}
            _ => return Err("Browser disconnected"),
        }
    }
}

pub(super) async fn send(socket: &mut Socket, frame: &impl Serialize) -> Result<(), Failure> {
    let text = serde_json::to_string(frame).map_err(|_| "Could not encode browser message")?;
    socket
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| "Browser disconnected")
}

pub(super) async fn request(socket: &mut Socket, command: Command) -> Result<Reply, Failure> {
    timeout(DEADLINE, async {
        send(socket, &command).await?;
        read(socket).await
    })
    .await
    .map_err(|_| "Browser did not respond")?
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
        assert!(!origin(
            &request(ADDRESS, "/browser-remote?x", &[&expected]),
            ID
        ));
    }

    #[test]
    fn malformed_oversized_or_unmatched_replies_do_not_supply_tabs() {
        let list = |tabs| json!({"kind": "tabs.list", "id": 1, "tabs": tabs}).to_string();
        let good = json!({"id": 10, "title": "Example", "active": true});
        let valid = list(json!([good]));
        assert_eq!(decode::<Reply>(&valid).unwrap().list(1).unwrap()[0].id, 10);
        assert!(decode::<Reply>(&valid).unwrap().list(2).is_err());
        for payload in [
            list(json!([good, good])),
            list(json!([{"id": -1, "title": "X", "active": true}])),
            list(json!([{"id": 1, "title": "x".repeat(257), "active": true}])),
            list(json!([{"id": 1, "title": "X", "active": true, "url": "https://example.org"}])),
            format!("{valid}{}", " ".repeat(LIMIT)),
            r#"{"kind":"tabs.list","id":1,"tabs":[],"extra":true}"#.into(),
        ] {
            assert!(
                decode::<Reply>(&payload)
                    .and_then(|reply| reply.list(1))
                    .is_err()
            );
        }
        let activated = decode::<Reply>(r#"{"kind":"tabs.activate","id":1}"#).unwrap();
        assert!(matches!(activated.activation(1), Ok(Ok(()))));
        assert!(
            decode::<Reply>(r#"{"kind":"tabs.activate","id":1}"#)
                .unwrap()
                .activation(2)
                .is_err()
        );
    }
}
