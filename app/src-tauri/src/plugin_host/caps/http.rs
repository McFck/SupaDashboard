//! `http`: HTTPS requests without a body to the plugin's declared hosts, through the native client (10 s, no
//! redirects, 1 MiB). A header may carry `{{secret:<client>}}`, replaced natively by that client's access token when
//! the host is one the client may send to; JS never sees the token.
use std::collections::BTreeMap;

use serde::Deserialize;
use tauri::State;
use windows::Foundation::Uri;
use windows::core::HSTRING;

use super::oauth::access_token;
use crate::plugin_host::PluginHost;
use crate::plugin_host::http::{Response, send};
use crate::plugin_host::permissions::Permissions;

const PLACEHOLDER: &str = "{{secret:";

#[derive(Deserialize)]
pub struct Request {
    method: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
}

/// The secret names in a header value, each `{{secret:<name>}}`.
fn placeholders(value: &str) -> Result<Vec<&str>, String> {
    let mut names = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find(PLACEHOLDER) {
        let after = &rest[start + PLACEHOLDER.len()..];
        let end = after.find("}}").ok_or("Invalid secret placeholder")?;
        names.push(&after[..end]);
        rest = &after[end + 2..];
    }
    Ok(names)
}

/// The URL's host if the request may go out: a known method, `https://<declared host>[/path][?query]` with no port
/// or user info, header names of letters and dashes, values without control characters, and every secret placeholder
/// naming a client allowed to send to that host.
fn check<'a>(permissions: &Permissions, request: &'a Request) -> Result<&'a str, String> {
    if !["GET", "PUT", "DELETE", "POST"].contains(&request.method.as_str()) {
        return Err("Invalid HTTP method".into());
    }
    let rest = request
        .url
        .strip_prefix("https://")
        .ok_or("HTTPS required")?;
    let (host, tail) = rest.split_at(rest.find(['/', '?']).unwrap_or(rest.len()));
    if !permissions.http.iter().any(|declared| declared == host) {
        return Err("This host is not allowed".into());
    }
    let parsed = Uri::CreateUri(&HSTRING::from(&request.url)).map_err(|_| "Invalid URL")?;
    let parsed_host = parsed.Host().map(|h| h.to_string()).unwrap_or_default();
    if request.url.len() > 8192
        || !tail.bytes().all(|b| b.is_ascii_graphic() && b != b'\\')
        || parsed_host != host
        || parsed.Port().ok() != Some(443)
        || !parsed.UserName().is_ok_and(|user| user.is_empty())
    {
        return Err("Invalid URL".into());
    }
    if request.headers.len() > 32 {
        return Err("Too many headers".into());
    }
    for (name, value) in &request.headers {
        if !(1..=64).contains(&name.len())
            || !name.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-')
            || value.len() > 8192
            || value.chars().any(char::is_control)
        {
            return Err("Invalid HTTP header".into());
        }
        for secret in placeholders(value)? {
            let allowed = permissions
                .oauth
                .get(secret)
                .is_some_and(|oauth| oauth.send.iter().any(|target| target == host));
            if !allowed {
                return Err("This secret is not sent to this host".into());
            }
        }
    }
    Ok(host)
}

#[tauri::command]
pub async fn plugin_http_request(
    host: State<'_, PluginHost>,
    plugin: String,
    request: Request,
) -> Result<Response, String> {
    let installed = host.installed(&plugin)?;
    check(&installed.manifest.permissions, &request)?;
    let mut headers = Vec::with_capacity(request.headers.len());
    for (name, original) in &request.headers {
        let mut value = original.clone();
        for secret in placeholders(original)? {
            let token = access_token(&host, &plugin, secret).await?;
            value = value.replace(&format!("{PLACEHOLDER}{secret}}}}}"), &token);
        }
        headers.push((name.as_str(), value));
    }
    let headers: Vec<(&str, &str)> = headers.iter().map(|(n, v)| (*n, v.as_str())).collect();
    send(&request.method, &request.url, &headers, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_reach_only_declared_hosts_and_tokens_only_their_send_targets() {
        let permissions: Permissions = serde_json::from_str(
            r#"{"http":["api.spotify.com","lrclib.net"],"oauth":{"spotify":{"token":"https://api.spotify.com/t",
            "redirect":"http://127.0.0.1","scopes":[],"send":["api.spotify.com"]}}}"#,
        )
        .unwrap();
        let request = |method: &str, url: &str, headers: &[(&str, &str)]| Request {
            method: method.into(),
            url: url.into(),
            headers: headers
                .iter()
                .map(|(n, v)| ((*n).to_owned(), (*v).to_owned()))
                .collect(),
        };
        let bearer = [("Authorization", "Bearer {{secret:spotify}}")];
        let good = [
            request("GET", "https://api.spotify.com/v1/me", &bearer),
            request(
                "PUT",
                "https://api.spotify.com/v1/me/player/shuffle?state=true",
                &bearer,
            ),
            request(
                "GET",
                "https://lrclib.net/api/get?track_name=a%20b",
                &[("User-Agent", "x (y)")],
            ),
            request("GET", "https://lrclib.net?q=1", &[]),
        ];
        for ok in &good {
            assert!(check(&permissions, ok).is_ok(), "{}", ok.url);
        }
        let bad = [
            request("PATCH", "https://api.spotify.com/v1/me", &[]),
            request("GET", "http://api.spotify.com/v1/me", &[]),
            request("GET", "https://evil.com/", &[]),
            request("GET", "https://api.spotify.com.evil.com/", &[]),
            request("GET", "https://api.spotify.com:8443/", &[]),
            request("GET", "https://user@api.spotify.com/", &[]),
            request("GET", "https://evil.com@api.spotify.com/", &[]),
            request("GET", "https://API.spotify.com/", &[]),
            request("GET", "https://api.spotify.com/a b", &[]),
            request("GET", "https://api.spotify.com/a\\b", &[]),
            request(
                "GET",
                "https://api.spotify.com/",
                &[("X-A", "a\r\nHost: evil.com")],
            ),
            request("GET", "https://api.spotify.com/", &[("X_A", "a")]),
            request("GET", "https://api.spotify.com/", &[("X:A", "a")]),
            // The token goes only to its client's send targets, and only to declared clients.
            request("GET", "https://lrclib.net/", &bearer),
            request(
                "GET",
                "https://api.spotify.com/",
                &[("A", "{{secret:discord}}")],
            ),
            request(
                "GET",
                "https://api.spotify.com/",
                &[("A", "{{secret:spotify")],
            ),
        ];
        for refused in &bad {
            assert!(
                check(&permissions, refused).is_err(),
                "{} {:?}",
                refused.url,
                refused.headers
            );
        }
        assert_eq!(
            placeholders("{{secret:a}} {{secret:b}}"),
            Ok(vec!["a", "b"])
        );
    }
}
