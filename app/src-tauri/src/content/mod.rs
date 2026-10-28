//! Trust policy for embedded web content. `allowed_web_url` is the authority for every iframe in the app windows
//! (not only `content:*` frames); the CSP `frame-src` in tauri.conf.json and the frontend's URL checks mirror it.
mod observer;

use tauri::{Manager, Url, WebviewWindow, Window, WindowEvent};

fn generated_frame_key(name: &str) -> Option<&str> {
    let key = name.strip_prefix("content:")?;
    (!key.is_empty() && !key.chars().any(char::is_whitespace)).then_some(key)
}

fn allowed_web_url(raw: &str, app_origin: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let scheme_allowed =
        url.scheme() == "https" || url.scheme() == "http" && url.host_str() == Some("localhost");
    scheme_allowed
        && url.username().is_empty()
        && url.password().is_none()
        && url.origin().ascii_serialization() != app_origin
        && !matches!(url.host_str(), Some("tauri.localhost" | "asset.localhost"))
}

fn local_application_origin(window: &WebviewWindow) -> Result<String, String> {
    if !matches!(window.label(), "main" | "panel") {
        return Err("content frame observer is limited to local application windows".into());
    }
    let url = window.url().map_err(|error| error.to_string())?;
    let local = matches!(
        (url.scheme(), url.host_str()),
        ("http", Some("localhost" | "tauri.localhost"))
            | ("https", Some("tauri.localhost"))
            | ("tauri", Some("localhost"))
    );
    if !local {
        return Err("content frame observer requires a local application origin".into());
    }
    Ok(url.origin().ascii_serialization())
}

/// Installs the frame observer on the calling window; installing twice is a no-op.
#[tauri::command]
pub async fn content_frames_ready(window: WebviewWindow) -> Result<bool, String> {
    let app_origin = local_application_origin(&window)?;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let label = window.label().to_owned();
    let app = window.app_handle().clone();
    window
        .with_webview(move |webview| {
            let result = observer::install(&app, &label, &app_origin, webview.controller());
            let _ = sender.try_send(result);
        })
        .map_err(|error| format!("could not schedule the frame observer: {error}"))?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "frame observer installation was canceled".to_owned())??;
    Ok(true)
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if matches!(event, WindowEvent::Destroyed) && matches!(window.label(), "main" | "panel") {
        let label = window.label().to_owned();
        let _ = window
            .app_handle()
            .run_on_main_thread(move || observer::forget(&label));
    }
}

#[cfg(test)]
mod tests {
    use super::allowed_web_url;

    #[test]
    fn restricts_embed_urls_and_frame_redirects() {
        let app_origin = "http://localhost:5173";
        for value in ["https://example.test/embed", "http://localhost:5186/embed"] {
            assert!(allowed_web_url(value, app_origin), "{value}");
        }
        for value in [
            "http://127.0.0.1/",
            "http://localhost.evil.test/",
            "file:///secret",
            "javascript:alert(1)",
            "https://user:pass@example.test/",
            "http://localhost:5173/",
            "https://tauri.localhost/",
            "https://asset.localhost/",
        ] {
            assert!(!allowed_web_url(value, app_origin), "{value}");
        }
    }
}
