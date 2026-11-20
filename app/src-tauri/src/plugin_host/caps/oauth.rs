//! `oauth`: PKCE sign-in for a declared client. The plugin passes its client id; the verifier, the code exchange and
//! the tokens stay native, in the client's secret record (`secrets.rs`). A loopback sign-in listens once on the
//! declared redirect port; a code that arrives another way (Discord's local pipe) is exchanged with `pkce` first.
use std::time::Duration;

use tauri::{AppHandle, Manager, State, Webview};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::AbortHandle;

use super::open::open;
use super::secrets::{Secret, Tokens, valid_token};
use crate::plugin_host::PluginHost;
use crate::plugin_host::http::{form, send};
use crate::plugin_host::permissions::OAuth;
use crate::plugin_host::secure::pkce;

/// The error of a rejected refresh token; the tokens are dropped with it.
const SIGN_IN_AGAIN: &str = "Sign in again";

pub(super) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// The declared client `name` of an installed plugin.
pub fn client(host: &PluginHost, plugin: &str, name: &str) -> Result<OAuth, String> {
    host.installed(plugin)?
        .manifest
        .permissions
        .oauth
        .get(name)
        .cloned()
        .ok_or_else(|| "Unknown plugin secret".into())
}

fn valid_client_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// A token endpoint's answer. A refresh may omit the refresh token (the old one stays) and may report fewer scopes
/// than were asked for, since it cannot widen an older grant; a new sign-in must grant every declared scope.
fn parse_tokens(
    body: &str,
    previous: Option<&Tokens>,
    scopes: &[String],
    now: u64,
) -> Result<Tokens, String> {
    #[derive(serde::Deserialize)]
    struct Response {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
        token_type: String,
        scope: Option<String>,
    }
    let invalid = || "Invalid token response".to_owned();
    if body.len() > 65_536 {
        return Err(invalid());
    }
    let response: Response = serde_json::from_str(body).map_err(|_| invalid())?;
    let refresh_token = response
        .refresh_token
        .or_else(|| previous.map(|tokens| tokens.refresh_token.clone()))
        .ok_or_else(invalid)?;
    let granted = |scope: &String| {
        response
            .scope
            .as_ref()
            .is_none_or(|granted| granted.split_whitespace().any(|s| s == scope))
    };
    if !valid_token(&response.access_token)
        || !valid_token(&refresh_token)
        || !response.token_type.eq_ignore_ascii_case("bearer")
        || !(1..=31_536_000).contains(&response.expires_in)
        || previous.is_none() && !scopes.iter().all(granted)
    {
        return Err(invalid());
    }
    Ok(Tokens {
        access_token: response.access_token,
        refresh_token,
        expires_at: now + response.expires_in,
    })
}

fn token_response(
    status: u16,
    body: &str,
    previous: Option<&Tokens>,
    scopes: &[String],
) -> Result<Tokens, String> {
    if !(200..300).contains(&status) {
        let rejected = serde_json::from_str::<serde_json::Value>(body)
            .is_ok_and(|value| value["error"] == "invalid_grant");
        return Err(if rejected {
            SIGN_IN_AGAIN
        } else {
            "Sign-in failed"
        }
        .into());
    }
    parse_tokens(body, previous, scopes, now())
}

async fn request_tokens(
    oauth: &OAuth,
    fields: &[(&str, &str)],
    previous: Option<&Tokens>,
) -> Result<Tokens, String> {
    let response = send("POST", &oauth.token, &[], Some(&form(fields))).await?;
    token_response(response.status, &response.body, previous, &oauth.scopes)
}

/// Exchanges an authorization code and stores the tokens and client id in the secret record.
async fn exchange(
    host: &PluginHost,
    plugin: &str,
    name: &str,
    oauth: &OAuth,
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<(), String> {
    if !valid_token(code) {
        return Err("Invalid authorization code".into());
    }
    let tokens = request_tokens(
        oauth,
        &[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &oauth.redirect),
            ("code_verifier", verifier),
        ],
        None,
    )
    .await?;
    let _secrets = host.caps.secrets.lock().await;
    let mut secret = Secret::open(&host.data(plugin), name)?;
    secret.record.tokens = Some(tokens);
    secret
        .record
        .fields
        .insert("clientId".into(), client_id.into());
    secret.save()
}

/// Refreshes the tokens of an open record; the caller holds the secrets lock. A rejected refresh token signs out.
async fn refresh(secret: &mut Secret, oauth: &OAuth) -> Result<(), String> {
    let tokens = secret.record.tokens.clone().ok_or("Not signed in")?;
    let client_id = secret
        .record
        .fields
        .get("clientId")
        .and_then(|id| id.as_str());
    let client_id = client_id
        .filter(|id| valid_client_id(id))
        .ok_or("Not signed in")?;
    let fields = [
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
        ("refresh_token", tokens.refresh_token.as_str()),
    ];
    let refreshed = request_tokens(oauth, &fields, Some(&tokens)).await;
    store_refreshed(secret, refreshed)
}

/// New tokens replace the old ones; a rejected refresh token drops them. The record's other fields stay either way.
fn store_refreshed(secret: &mut Secret, refreshed: Result<Tokens, String>) -> Result<(), String> {
    match refreshed {
        Ok(tokens) => {
            secret.record.tokens = Some(tokens);
            secret.save()
        }
        Err(error) if error == SIGN_IN_AGAIN => {
            secret.record.tokens = None;
            secret.save()?;
            Err(error)
        }
        Err(error) => Err(error),
    }
}

/// The access token of client `name` for an HTTP request, refreshed first when it expires within a minute.
pub async fn access_token(host: &PluginHost, plugin: &str, name: &str) -> Result<String, String> {
    let oauth = client(host, plugin, name)?;
    let _secrets = host.caps.secrets.lock().await;
    let mut secret = Secret::open(&host.data(plugin), name)?;
    let expires_at = secret
        .record
        .tokens
        .as_ref()
        .ok_or("Not signed in")?
        .expires_at;
    if expires_at <= now() + 60 {
        refresh(&mut secret, &oauth).await?;
    }
    secret
        .record
        .tokens
        .map(|tokens| tokens.access_token)
        .ok_or_else(|| "Not signed in".into())
}

/// The port and path of a `http://127.0.0.1:<port>[/path]` redirect.
fn loopback(redirect: &str) -> Option<(u16, String)> {
    let rest = redirect.strip_prefix("http://127.0.0.1:")?;
    let (port, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    let path = if path.is_empty() { "/" } else { path };
    Some((port.parse().ok()?, path.to_owned()))
}

fn decode(value: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut input = value.bytes();
    while let Some(byte) = input.next() {
        bytes.push(match byte {
            b'+' => b' ',
            b'%' => {
                let high = (input.next()? as char).to_digit(16)?;
                let low = (input.next()? as char).to_digit(16)?;
                (high * 16 + low) as u8
            }
            byte => byte,
        });
    }
    String::from_utf8(bytes).ok()
}

/// The authorization code of the redirect request `GET <path>?...&state=<state>&code=... HTTP/1.1`.
fn callback(request: &str, path: &str, state: &str) -> Result<String, String> {
    let invalid = || "Invalid sign-in callback".to_owned();
    let line = request.lines().next().ok_or_else(invalid)?;
    let mut parts = line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err(invalid());
    }
    let query = parts
        .next()
        .and_then(|target| target.strip_prefix(path)?.strip_prefix('?'))
        .ok_or_else(invalid)?;
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err(invalid());
    }
    let mut params = std::collections::HashMap::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').ok_or_else(invalid)?;
        let (key, value) = (
            decode(key).ok_or_else(invalid)?,
            decode(value).ok_or_else(invalid)?,
        );
        if params.insert(key, value).is_some() {
            return Err(invalid());
        }
    }
    if params.get("state").map(String::as_str) != Some(state) {
        return Err("Invalid sign-in state".into());
    }
    if params.contains_key("error") {
        return Err("Sign-in cancelled".into());
    }
    params
        .remove("code")
        .filter(|code| valid_token(code))
        .ok_or_else(|| "Invalid authorization code".into())
}

/// Answers the first connection only; dropping the listener first prevents a replayed callback.
async fn receive_callback(
    listener: TcpListener,
    path: &str,
    state: &str,
) -> Result<String, String> {
    let failed = |_| "Sign-in callback failed".to_owned();
    let (mut stream, _) = listener.accept().await.map_err(failed)?;
    drop(listener);
    let mut bytes = Vec::new();
    let mut chunk = [0; 1024];
    while !bytes.windows(4).any(|b| b == b"\r\n\r\n") {
        let count = stream.read(&mut chunk).await.map_err(failed)?;
        if count == 0 || bytes.len() + count > 16_384 {
            return Err("Invalid sign-in callback".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let code = std::str::from_utf8(&bytes)
        .map_err(|_| "Invalid sign-in callback".to_owned())
        .and_then(|request| callback(request, path, state));
    let status = if code.is_ok() {
        "200 OK"
    } else {
        "400 Bad Request"
    };
    let body = "You can close this tab.";
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\n\
         Content-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(failed)?;
    code
}

/// Opens the consent page in the default browser and waits up to 5 minutes for the redirect. A new sign-in of the
/// same client from the same webview cancels the previous one.
#[tauri::command]
pub async fn plugin_oauth_sign_in(
    app: AppHandle,
    webview: Webview,
    plugin: String,
    name: String,
    client_id: String,
) -> Result<(), String> {
    let host = app.state::<PluginHost>();
    let changing = host.changing.lock().await;
    let oauth = client(&host, &plugin, &name)?;
    let authorize = oauth
        .authorize
        .clone()
        .ok_or("This client has no consent page")?;
    let (port, path) = loopback(&oauth.redirect).ok_or("This client has no callback port")?;
    if !valid_client_id(&client_id) {
        return Err("Invalid client id".into());
    }
    let (verifier, challenge) = pkce()?;
    let (state, _) = pkce()?;
    let scopes = oauth.scopes.join(" ");
    let url = format!(
        "{authorize}?{}",
        form(&[
            ("response_type", "code"),
            ("client_id", &client_id),
            ("redirect_uri", &oauth.redirect),
            ("state", &state),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
            ("scope", &scopes),
        ])
    );
    let label = webview.label().to_owned();
    host.caps
        .with(&plugin, &label, |owned| owned.signins.remove(&name))
        .inspect(AbortHandle::abort);
    let task = tauri::async_runtime::spawn({
        let (app, plugin, name) = (app.clone(), plugin.clone(), name.clone());
        async move {
            let listener = TcpListener::bind(("127.0.0.1", port))
                .await
                .map_err(|_| "The sign-in port is busy")?;
            open(&url)?;
            let code = tokio::time::timeout(
                Duration::from_secs(300),
                receive_callback(listener, &path, &state),
            )
            .await
            .map_err(|_| "Sign-in timed out")??;
            let host = app.state::<PluginHost>();
            exchange(&host, &plugin, &name, &oauth, &client_id, &code, &verifier).await
        }
    });
    let abort = task.inner().abort_handle();
    host.caps
        .with(&plugin, &label, |owned| owned.signins.insert(name, abort));
    drop(changing);
    task.await.map_err(|_| "Sign-in cancelled".to_owned())?
}

/// Starts a sign-in whose code arrives another way: returns the S256 challenge and keeps the verifier for
/// `exchange` from the same webview.
#[tauri::command]
pub async fn plugin_oauth_pkce(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
) -> Result<String, String> {
    let _changing = host.changing.lock().await;
    client(&host, &plugin, &name)?;
    let (verifier, challenge) = pkce()?;
    host.caps.with(&plugin, webview.label(), |owned| {
        owned.verifiers.insert(name, verifier)
    });
    Ok(challenge)
}

#[tauri::command]
pub async fn plugin_oauth_exchange(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
    client_id: String,
    code: String,
) -> Result<(), String> {
    let oauth = client(&host, &plugin, &name)?;
    if !valid_client_id(&client_id) {
        return Err("Invalid client id".into());
    }
    let verifier = host
        .caps
        .with(&plugin, webview.label(), |owned| {
            owned.verifiers.remove(&name)
        })
        .ok_or("Start the sign-in again")?;
    exchange(&host, &plugin, &name, &oauth, &client_id, &code, &verifier).await
}

#[tauri::command]
pub async fn plugin_oauth_refresh(
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
) -> Result<(), String> {
    let oauth = client(&host, &plugin, &name)?;
    let _secrets = host.caps.secrets.lock().await;
    refresh(&mut Secret::open(&host.data(&plugin), &name)?, &oauth).await
}

/// Drops the tokens; the record's other fields (the client id) stay.
#[tauri::command]
pub async fn plugin_oauth_sign_out(
    host: State<'_, PluginHost>,
    plugin: String,
    name: String,
) -> Result<(), String> {
    client(&host, &plugin, &name)?;
    let _secrets = host.caps.secrets.lock().await;
    let mut secret = Secret::open(&host.data(&plugin), &name)?;
    if secret.record.tokens.take().is_none() {
        return Ok(());
    }
    secret.save()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_callback_listener_answers_once_and_closes() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let receive = tokio::spawn(receive_callback(listener, "/callback", "expected"));
            let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
            client
                .write_all(b"GET /callback?state=expected&code=once HTTP/1.1\r\nHost: x\r\n\r\n")
                .await
                .unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK"));
            assert_eq!(receive.await.unwrap().unwrap(), "once");
            assert!(tokio::net::TcpStream::connect(address).await.is_err());
        });
    }

    #[test]
    fn a_refresh_keeps_the_other_fields_and_a_rejected_one_signs_out() {
        let data = crate::plugin_host::archive::tests::temp("oauth-refresh");
        let tokens = |access: &str| Tokens {
            access_token: access.into(),
            refresh_token: "r".into(),
            expires_at: 9,
        };
        let mut secret = Secret::open(&data, "spotify").unwrap();
        secret.record.tokens = Some(tokens("old"));
        secret.record.fields.insert("userName".into(), "Me".into());
        secret.save().unwrap();

        let mut secret = Secret::open(&data, "spotify").unwrap();
        store_refreshed(&mut secret, Ok(tokens("new"))).unwrap();
        assert!(store_refreshed(&mut secret, Err("Sign-in failed".into())).is_err());
        let reopened = Secret::open(&data, "spotify").unwrap().record;
        assert_eq!(reopened.tokens, Some(tokens("new")));
        assert_eq!(reopened.fields["userName"], "Me");

        let mut secret = Secret::open(&data, "spotify").unwrap();
        assert!(store_refreshed(&mut secret, Err(SIGN_IN_AGAIN.into())).is_err());
        let reopened = Secret::open(&data, "spotify").unwrap().record;
        assert_eq!(reopened.tokens, None);
        assert_eq!(reopened.fields["userName"], "Me");
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn a_forged_or_denied_callback_yields_no_code() {
        let code = |request: &str| callback(request, "/callback", "ok");
        assert_eq!(
            code("GET /callback?code=a%2Bb&state=ok HTTP/1.1\r\n").unwrap(),
            "a+b"
        );
        assert_eq!(
            callback("GET /?code=c&state=ok HTTP/1.1", "/", "ok").unwrap(),
            "c"
        );
        for request in [
            "GET /callback?code=x&state=bad HTTP/1.1",
            "GET /callback?code=x HTTP/1.1",
            "GET /callback?code=x&state=ok&state=ok HTTP/1.1",
            "GET /other?code=x&state=ok HTTP/1.1",
            "GET /callbackx?code=x&state=ok HTTP/1.1",
            "GET /callback?code=%XX&state=ok HTTP/1.1",
            "GET /callback?code=a%20b&state=ok HTTP/1.1",
            "POST /callback?code=x&state=ok HTTP/1.1",
        ] {
            assert!(code(request).is_err(), "{request}");
        }
        assert_eq!(
            code("GET /callback?error=access_denied&state=ok HTTP/1.1").unwrap_err(),
            "Sign-in cancelled"
        );
        assert_eq!(
            loopback("http://127.0.0.1:43821/callback"),
            Some((43821, "/callback".into()))
        );
        assert_eq!(loopback("http://127.0.0.1"), None);
    }

    #[test]
    fn refresh_keeps_or_rotates_the_refresh_token_and_a_sign_in_needs_every_scope() {
        let old = Tokens {
            access_token: "old".into(),
            refresh_token: "keep".into(),
            expires_at: 1,
        };
        let scopes = ["read".to_owned(), "modify".to_owned()];
        let body = |extra: &str| {
            format!(r#"{{"access_token":"new","expires_in":3600,"token_type":"Bearer"{extra}}}"#)
        };
        let kept = parse_tokens(&body(""), Some(&old), &scopes, 100).unwrap();
        assert_eq!(
            (kept.refresh_token.as_str(), kept.expires_at),
            ("keep", 3700)
        );
        let rotated = parse_tokens(&body(r#","refresh_token":"new-r""#), Some(&old), &scopes, 0);
        assert_eq!(rotated.unwrap().refresh_token, "new-r");
        // A refresh of an older, narrower grant stays usable; a new sign-in that lost a scope does not.
        let narrow = body(r#","refresh_token":"r","scope":"read""#);
        assert!(parse_tokens(&narrow, Some(&old), &scopes, 0).is_ok());
        assert!(parse_tokens(&narrow, None, &scopes, 0).is_err());
        assert!(
            parse_tokens(
                &body(r#","refresh_token":"r","scope":"read modify""#),
                None,
                &scopes,
                0
            )
            .is_ok()
        );
        for bad in [
            body(""),
            body(r#","refresh_token":"r","token_type":"mac""#)
                .replace(r#""token_type":"Bearer","#, ""),
            body(r#","refresh_token":"r""#).replace("3600", "0"),
            body(r#","refresh_token":"a b""#),
            r#"{"error":"invalid_grant"}"#.into(),
        ] {
            assert!(parse_tokens(&bad, None, &scopes, 0).is_err(), "{bad}");
        }
        assert_eq!(
            token_response(400, r#"{"error":"invalid_grant"}"#, Some(&old), &scopes).unwrap_err(),
            SIGN_IN_AGAIN
        );
        assert_eq!(
            token_response(500, "", Some(&old), &scopes).unwrap_err(),
            "Sign-in failed"
        );
    }
}
