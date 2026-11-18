//! `signin`: a web sign-in in its own window and WebView2 profile (`plugin-data/<id>/<profile>`), for a site whose
//! session only a browser can hold. The token is read from the page's `localStorage[storage]` (an oidc-client user)
//! and kept in memory as the secret `name`, for http `{{secret:name}}`; it is never written or shown to JS. The
//! window's label `signin-<id>` matches no capability, and its remote page cannot call app commands.
use std::sync::{Arc, PoisonError, Weak};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::task::AbortHandle;

use super::oauth::now;
use crate::plugin_host::PluginHost;
use crate::plugin_host::permissions::SignIn;

/// Seconds a captured token must still be valid for; an older one is renewed first.
const MIN_LIFETIME_S: u64 = 120;
const SIGNED_OUT: &str = "Not signed in";

#[derive(Clone)]
pub struct Token {
    access: String,
    /// Unix seconds.
    expires_at: u64,
}

pub enum Session {
    Accepted(Token),
    Rejected(Token),
}

impl Session {
    fn valid_for(&self, now: u64, seconds: u64) -> Option<&Token> {
        match self {
            Self::Accepted(token) if token.expires_at > now + seconds => Some(token),
            _ => None,
        }
    }

    fn last_token(&self) -> &Token {
        match self {
            Self::Accepted(token) | Self::Rejected(token) => token,
        }
    }

    fn reject(&mut self, access: &str) {
        if let Self::Accepted(token) = self
            && token.access == access
        {
            *self = Self::Rejected(token.clone());
        }
    }
}

fn declared(host: &PluginHost, plugin: &str, name: &str) -> Result<SignIn, String> {
    host.installed(plugin)?
        .manifest
        .permissions
        .signin
        .get(name)
        .cloned()
        .ok_or_else(|| "Unknown plugin sign-in".into())
}

/// The token of sign-in `name` while it is valid for another minute.
pub fn token(host: &PluginHost, plugin: &str, name: &str) -> Result<String, String> {
    let signed_in = host
        .caps
        .signed_in
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    signed_in
        .get(&(plugin.to_owned(), name.to_owned()))
        .and_then(|session| session.valid_for(now(), 60))
        .map(|token| token.access.clone())
        .ok_or_else(|| SIGNED_OUT.into())
}

/// A late HTTP response must not invalidate a newer token captured while the request was in flight.
pub(super) fn reject(host: &PluginHost, plugin: &str, name: &str, access: &str) {
    let mut signed_in = host
        .caps
        .signed_in
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if let Some(session) = signed_in.get_mut(&(plugin.to_owned(), name.to_owned())) {
        session.reject(access);
    }
}

/// `json` is ExecuteScript's JSON-encoded result: null, or the stored user as a JSON string.
fn parse_user(json: &str) -> Option<Token> {
    let stored: String = serde_json::from_str::<Option<String>>(json).ok()??;
    let user: Value = serde_json::from_str(&stored).ok()?;
    let access = user.get("access_token")?.as_str()?;
    // It goes into an HTTP header: printable ASCII only.
    if access.is_empty() || access.len() > 16_384 || !access.bytes().all(|b| b.is_ascii_graphic()) {
        return None;
    }
    Some(Token {
        access: access.to_owned(),
        expires_at: user.get("expires_at")?.as_u64()?,
    })
}

/// A token worth keeping: valid for a while and not the one being renewed.
fn fresh(json: &str, previous: Option<&str>, now: u64) -> Option<Token> {
    parse_user(json).filter(|token| {
        token.expires_at > now + MIN_LIFETIME_S && Some(token.access.as_str()) != previous
    })
}

/// The scheme, host and port of an `https://` URL.
fn origin(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    Some(&url[..8 + rest.find(['/', '?', '#']).unwrap_or(rest.len())])
}

/// The sign-in window; it closes when the last sign-in using it ends, however it ends.
pub struct Window(WebviewWindow);

impl Drop for Window {
    fn drop(&mut self) {
        let _ = self.0.destroy();
    }
}

fn label(plugin: &str) -> String {
    format!("signin-{plugin}")
}

/// The plugin's open sign-in window, or a new hidden one; a visible sign-in shows a window a silent renewal opened.
fn window(
    app: &AppHandle,
    plugin: &str,
    signin: &SignIn,
    visible: bool,
) -> Result<Arc<Window>, String> {
    let failed = |_| "Could not open the sign-in window".to_owned();
    let host = app.state::<PluginHost>();
    let mut windows = host
        .caps
        .signin_windows
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let window = match windows.get(plugin).and_then(Weak::upgrade) {
        Some(window) => window,
        None => {
            let url = signin.url.parse().map_err(|_| "Invalid sign-in URL")?;
            let built = WebviewWindowBuilder::new(app, label(plugin), WebviewUrl::External(url))
                .data_directory(host.data(plugin).join(&signin.profile))
                .title("Sign in")
                .inner_size(960.0, 760.0)
                .visible(false)
                .focused(false)
                .skip_taskbar(true)
                .build()
                .map_err(failed)?;
            let window = Arc::new(Window(built));
            windows.insert(plugin.to_owned(), Arc::downgrade(&window));
            window
        }
    };
    if visible {
        window.0.set_skip_taskbar(false).map_err(failed)?;
        window.0.show().map_err(failed)?;
        window.0.set_focus().map_err(failed)?;
    }
    Ok(window)
}

/// The page's stored user once a second until a fresh token appears, for up to `attempts` seconds.
async fn capture(
    window: &WebviewWindow,
    signin: &SignIn,
    previous: Option<&str>,
    attempts: u32,
) -> Result<Token, String> {
    let expected = origin(&signin.url).ok_or("Invalid sign-in URL")?;
    let script = format!(
        "localStorage.getItem({})",
        serde_json::to_string(&signin.storage).map_err(|_| "Invalid sign-in storage")?
    );
    for _ in 0..attempts {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let Ok(url) = window.url() else {
            return Err("Sign-in canceled".into());
        };
        // A redirect through the identity provider shows its own origin; only the declared site's storage counts.
        if origin(url.as_str()) != Some(expected) {
            continue;
        }
        let (reply, answer) = tokio::sync::oneshot::channel();
        let reply = std::sync::Mutex::new(Some(reply));
        window
            .eval_with_callback(script.as_str(), move |json| {
                if let Some(reply) = reply.lock().ok().and_then(|mut reply| reply.take()) {
                    let _ = reply.send(json);
                }
            })
            .map_err(|_| "Sign-in canceled")?;
        let Ok(Ok(json)) = tokio::time::timeout(Duration::from_secs(5), answer).await else {
            continue;
        };
        if let Some(token) = fresh(&json, previous, now()) {
            return Ok(token);
        }
    }
    Err(SIGNED_OUT.into())
}

/// Signs in: visible, the user gets ten minutes; hidden (a renewal), the site gets 45 seconds to sign in again from
/// the profile's session. Resolves with the token's expiry in Unix milliseconds. A new sign-in of the same name from
/// the same webview cancels the previous one.
#[tauri::command]
pub async fn plugin_signin_open(
    app: AppHandle,
    webview: tauri::Webview,
    plugin: String,
    name: String,
    visible: bool,
) -> Result<u64, String> {
    let host = app.state::<PluginHost>();
    let signin = declared(&host, &plugin, &name)?;
    if !visible && !host.data(&plugin).join(&signin.profile).exists() {
        return Err(SIGNED_OUT.into());
    }
    let key = (plugin.clone(), name.clone());
    let previous = {
        let signed_in = host
            .caps
            .signed_in
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let session = signed_in.get(&key);
        // The dashboard service can restart while the native session is still valid.
        if !visible
            && let Some(token) =
                session.and_then(|session| session.valid_for(now(), MIN_LIFETIME_S))
        {
            return Ok(token.expires_at.saturating_mul(1000));
        }
        session.map(|session| session.last_token().access.clone())
    };
    // Taken before the previous sign-in from this webview is cancelled, so the window stays open for this one.
    let window = window(&app, &plugin, &signin, visible)?;
    let label = webview.label().to_owned();
    host.caps
        .with(&plugin, &label, |owned| owned.signins.remove(&name))
        .inspect(AbortHandle::abort);
    let task = tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let attempts = if visible { 600 } else { 45 };
            let token = capture(&window.0, &signin, previous.as_deref(), attempts).await?;
            let expires_at = token.expires_at.saturating_mul(1000);
            app.state::<PluginHost>()
                .caps
                .signed_in
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(key, Session::Accepted(token));
            Ok::<_, String>(expires_at)
        }
    });
    let abort = task.inner().abort_handle();
    host.caps
        .with(&plugin, &label, |owned| owned.signins.insert(name, abort));
    task.await.map_err(|_| "Sign-in canceled".to_owned())?
}

/// Forgets the token, closes the window and deletes the profile, so the site's session is gone too.
#[tauri::command]
pub async fn plugin_signin_sign_out(
    app: AppHandle,
    plugin: String,
    name: String,
) -> Result<(), String> {
    let host = app.state::<PluginHost>();
    let signin = declared(&host, &plugin, &name)?;
    host.caps
        .signed_in
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&(plugin.clone(), name.clone()));
    host.caps.release_signin(&plugin, &name);
    if let Some(window) = app.get_webview_window(&label(&plugin)) {
        let _ = window.destroy();
    }
    let profile = host.data(&plugin).join(&signin.profile);
    if profile.exists() {
        // WebView2 releases the profile shortly after its window closes.
        tokio::time::sleep(Duration::from_secs(1)).await;
        std::fs::remove_dir_all(&profile).map_err(|_| "Could not remove the sign-in data")?;
    }
    Ok(())
}

impl super::Caps {
    /// Cancels the plugin's sign-ins of `name` in every webview.
    fn release_signin(&self, plugin: &str, name: &str) {
        let cancelled: Vec<_> = self
            .lock()
            .iter_mut()
            .filter(|((owner, _), _)| owner == plugin)
            .filter_map(|(_, owned)| owned.signins.remove(name))
            .collect();
        for task in cancelled {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(user: Value) -> String {
        serde_json::to_string(&user.to_string()).unwrap()
    }

    #[test]
    fn a_cached_portal_session_survives_reload_but_cannot_reuse_a_rejected_token() {
        let now = 1_900_000_000;
        let legacy = stored(serde_json::json!({
            "access_token": "eyJ.abc.def",
            "expires_at": now + 3600,
            "profile": {"sub": "work\\user"}
        }));
        let mut session = Session::Accepted(fresh(&legacy, None, now).unwrap());
        session.reject("older-token");
        assert!(session.valid_for(now, MIN_LIFETIME_S).is_some());
        session.reject("eyJ.abc.def");
        assert!(session.valid_for(now, MIN_LIFETIME_S).is_none());
        assert!(fresh(&legacy, Some(&session.last_token().access), now).is_none());
    }

    #[test]
    fn only_a_fresh_well_formed_token_from_the_declared_site_is_kept() {
        let user = |token: &str, expires_at: u64| {
            stored(
                serde_json::json!({"access_token": token, "expires_at": expires_at, "profile": {"sub": "x"}}),
            )
        };
        let now = 1_900_000_000;
        let token = fresh(&user("eyJ.abc.def", now + 3600), None, now).unwrap();
        assert_eq!(
            (token.access.as_str(), token.expires_at),
            ("eyJ.abc.def", now + 3600)
        );
        for (json, previous) in [
            (user("eyJ.abc.def", now + 100), None),
            (user("eyJ.abc.def", now + 3600), Some("eyJ.abc.def")),
            (user("a b", now + 3600), None),
            (user("a\r\nX-Evil: 1", now + 3600), None),
            (user("", now + 3600), None),
            ("null".into(), None),
            ("\"not json\"".into(), None),
        ] {
            assert!(fresh(&json, previous, now).is_none(), "{json}");
        }
        assert_eq!(
            origin("https://staff.example.com/a?b"),
            Some("https://staff.example.com")
        );
        assert_eq!(
            origin("https://staff.example.com"),
            Some("https://staff.example.com")
        );
        assert_ne!(
            origin("https://staff.example.com.evil.test/"),
            Some("https://staff.example.com")
        );
        assert_eq!(origin("http://staff.example.com/"), None);
    }
}
