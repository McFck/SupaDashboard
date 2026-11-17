//! The `permissions` of a plugin manifest: which native capabilities the plugin may use and where they may reach.
//! Validated strictly here, at discovery, install and in the catalogue; each capability command checks its grant.
use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::manifest::valid_id;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Permissions {
    /// DNS hosts reached over HTTPS.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub http: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub oauth: BTreeMap<String, OAuth>,
    /// Named pipe prefixes; `discord-ipc` allows `discord-ipc-0` to `discord-ipc-9`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pipes: Vec<String>,
    /// Executable file names the plugin may run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub process: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub signin: BTreeMap<String, SignIn>,
    /// Executable file names whose windows the plugin may read and press buttons in.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub automation: Vec<String>,
    /// URL schemes the plugin may open with their registered app.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub open: Vec<String>,
}

/// One OAuth client; its tokens stay native and are sent only to the `send` targets.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OAuth {
    /// The consent page; absent when the code arrives another way (Discord's local pipe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorize: Option<String>,
    pub token: String,
    pub redirect: String,
    pub scopes: Vec<String>,
    /// HTTP hosts or `pipe:<prefix>` targets the token may be sent to.
    pub send: Vec<String>,
}

/// A web sign-in in its own window and profile; the token is read from the page's `localStorage[storage]`.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignIn {
    pub url: String,
    pub storage: String,
    /// The window's data folder in the plugin's data.
    pub profile: String,
    pub send: Vec<String>,
}

/// Lowercase DNS name of at least two labels; no scheme, port, user info, wildcard or IP address.
fn valid_host(host: &str) -> bool {
    let labels: Vec<&str> = host.split('.').collect();
    host.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        && !labels
            .last()
            .is_some_and(|tld| tld.bytes().all(|b| b.is_ascii_digit()))
}

/// URL path characters only: no query, fragment, spaces or escapes.
fn valid_path(path: &str) -> bool {
    path.is_empty()
        || path.starts_with('/')
            && path
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/._-~".contains(&b))
}

/// `https://<host>[/path]` with a valid host.
fn valid_https(url: &str) -> bool {
    url.strip_prefix("https://").is_some_and(|rest| {
        let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
        valid_host(host) && valid_path(path)
    })
}

/// `http://127.0.0.1[:port][/path]`, the loopback redirect of a desktop OAuth client.
fn valid_redirect(url: &str) -> bool {
    url.strip_prefix("http://127.0.0.1").is_some_and(|rest| {
        let Some(after) = rest.strip_prefix(':') else {
            return valid_path(rest);
        };
        let (port, path) = after.split_at(after.find('/').unwrap_or(after.len()));
        port.bytes().all(|b| b.is_ascii_digit())
            && port.parse::<u16>().is_ok_and(|port| port > 0)
            && valid_path(path)
    })
}

/// `^[a-z0-9_.-]+\.exe$`, a bare file name.
fn valid_exe(exe: &str) -> bool {
    exe.len() <= 64
        && exe.strip_suffix(".exe").is_some_and(|stem| {
            !stem.is_empty()
                && !stem.starts_with('.')
                && stem
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
        })
}

/// An app link scheme; never one that loads web content, files or script.
fn valid_scheme(scheme: &str) -> bool {
    let mut bytes = scheme.bytes();
    scheme.len() <= 32
        && bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+.-".contains(&b))
        && !["http", "https", "file", "javascript", "data", "vbscript"].contains(&scheme)
        && !scheme.starts_with("ms-")
}

fn valid_scope(scope: &str) -> bool {
    (1..=128).contains(&scope.len())
        && scope
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}

/// A `localStorage` key: printable ASCII without quotes or backslashes.
fn valid_storage_key(key: &str) -> bool {
    (1..=256).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_graphic() && !b"\"'`\\".contains(&b))
}

fn unique<'a>(values: impl IntoIterator<Item = &'a String>) -> bool {
    let mut seen = HashSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

impl Permissions {
    /// Whether the token of OAuth client or sign-in `secret` may go to `target`, a host or `pipe:<prefix>`.
    pub fn sends(&self, secret: &str, target: &str) -> bool {
        let send = match (self.oauth.get(secret), self.signin.get(secret)) {
            (Some(oauth), _) => &oauth.send,
            (None, Some(signin)) => &signin.send,
            (None, None) => return false,
        };
        send.iter().any(|declared| declared == target)
    }

    pub fn validate(&self) -> Result<(), String> {
        let fail = |what: &str| Err(format!("Invalid plugin permission: {what}"));
        if !self.http.iter().all(|host| valid_host(host)) || !unique(&self.http) {
            return fail("http");
        }
        if !self.pipes.iter().all(|pipe| valid_id(pipe)) || !unique(&self.pipes) {
            return fail("pipes");
        }
        for (key, list) in [("process", &self.process), ("automation", &self.automation)] {
            if !list.iter().all(|exe| valid_exe(exe)) || !unique(list) {
                return fail(key);
            }
        }
        if !self.open.iter().all(|scheme| valid_scheme(scheme)) || !unique(&self.open) {
            return fail("open");
        }
        // Each OAuth client and sign-in is a secret named after its key; they share one namespace.
        let secrets: Vec<&String> = self.oauth.keys().chain(self.signin.keys()).collect();
        if !secrets.iter().all(|name| valid_id(name)) || !unique(secrets.iter().copied()) {
            return fail("secret name");
        }
        let target = |send: &String| match send.strip_prefix("pipe:") {
            Some(pipe) => self.pipes.contains(&pipe.to_owned()),
            None => self.http.contains(send),
        };
        for oauth in self.oauth.values() {
            if !oauth
                .authorize
                .iter()
                .chain([&oauth.token])
                .all(|url| valid_https(url))
                || !valid_redirect(&oauth.redirect)
                || !oauth.scopes.iter().all(|scope| valid_scope(scope))
                || !oauth.send.iter().all(target)
            {
                return fail("oauth");
            }
        }
        for signin in self.signin.values() {
            if !valid_https(&signin.url)
                || !valid_storage_key(&signin.storage)
                || !valid_id(&signin.profile)
                || !signin.send.iter().all(target)
            {
                return fail("signin");
            }
        }
        if !unique(self.signin.values().map(|signin| &signin.profile)) {
            return fail("signin profile");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<(), String> {
        serde_json::from_str::<Permissions>(json)
            .map_err(|error| error.to_string())?
            .validate()
    }

    const SPOTIFY: &str = r#"{"http":["api.spotify.com","lrclib.net"],"oauth":{"spotify":{
        "authorize":"https://accounts.spotify.com/authorize","token":"https://accounts.spotify.com/api/token",
        "redirect":"http://127.0.0.1:43821/callback","scopes":["user-library-read"],"send":["api.spotify.com"]}}}"#;
    const DISCORD: &str = r#"{"http":["discord.com"],"pipes":["discord-ipc"],"oauth":{"discord":{
        "token":"https://discord.com/api/oauth2/token","redirect":"http://127.0.0.1",
        "scopes":["rpc","rpc.voice.read"],"send":["pipe:discord-ipc"]}}}"#;
    const WORK: &str = r#"{"http":["staff.example.com"],"signin":{"staff":{"url":"https://staff.example.com",
        "storage":"oidc.user:https://passport.example.com:staff_site_new","profile":"work-web",
        "send":["staff.example.com"]}},"automation":["meet.exe"],"open":["meet"]}"#;

    #[test]
    fn a_manifest_cannot_grant_reach_beyond_what_its_permissions_name() {
        for good in [SPOTIFY, DISCORD, WORK, r#"{"process":["adb.exe"]}"#, "{}"] {
            assert_eq!(parse(good), Ok(()), "{good}");
        }
        let bad: &[&str] = &[
            // Hosts: lowercase DNS names only.
            r#"{"http":["https://api.spotify.com"]}"#,
            r#"{"http":["api.spotify.com:443"]}"#,
            r#"{"http":["user@api.spotify.com"]}"#,
            r#"{"http":["*.spotify.com"]}"#,
            r#"{"http":["API.spotify.com"]}"#,
            r#"{"http":["localhost"]}"#,
            r#"{"http":["127.0.0.1"]}"#,
            r#"{"http":["a.com","a.com"]}"#,
            // OAuth and sign-in URLs are https, redirects loopback, tokens go only to declared targets.
            &SPOTIFY.replace(
                "https://accounts.spotify.com/authorize",
                "http://accounts.spotify.com",
            ),
            &SPOTIFY.replace(
                "https://accounts.spotify.com/api/token",
                "https://x.com:8443/token",
            ),
            &SPOTIFY.replace(
                "https://accounts.spotify.com/api/token",
                "https://x.com/t?a=1",
            ),
            &SPOTIFY.replace("http://127.0.0.1:43821/callback", "http://localhost:43821"),
            &SPOTIFY.replace(
                "http://127.0.0.1:43821/callback",
                "http://127.0.0.1.evil.com",
            ),
            &SPOTIFY.replace("http://127.0.0.1:43821/callback", "http://127.0.0.1:99999"),
            &SPOTIFY.replace(r#""send":["api.spotify.com"]"#, r#""send":["evil.com"]"#),
            &SPOTIFY.replace(r#""user-library-read""#, r#""a b""#),
            &SPOTIFY.replace(r#""spotify":{"#, r#""../x":{"#),
            &DISCORD.replace("pipe:discord-ipc", "pipe:other-ipc"),
            &WORK.replace("https://staff.example.com\",", "javascript:alert(1)\","),
            &WORK.replace("work-web", "../profile"),
            &WORK.replace("oidc.user", "a\\\"b"),
            &WORK.replace(r#""send":["staff.example.com"]"#, r#""send":["x.com"]"#),
            r#"{"oauth":{"staff":{"token":"https://a.com/t","redirect":"http://127.0.0.1","scopes":[],"send":[]}},
                "signin":{"staff":{"url":"https://a.com","storage":"k","profile":"p","send":[]}}}"#,
            // Programs and schemes.
            r#"{"process":["adb"]}"#,
            r#"{"process":["..\\adb.exe"]}"#,
            r#"{"process":["C:\\adb.exe"]}"#,
            r#"{"process":["ADB.EXE"]}"#,
            r#"{"automation":["meet.bat"]}"#,
            r#"{"open":["https"]}"#,
            r#"{"open":["javascript"]}"#,
            r#"{"open":["ms-settings"]}"#,
            r#"{"open":["meet:"]}"#,
            r#"{"pipes":["Discord"]}"#,
            r#"{"camera":[]}"#,
        ];
        for text in bad {
            assert!(parse(text).is_err(), "{text}");
        }
    }
}
