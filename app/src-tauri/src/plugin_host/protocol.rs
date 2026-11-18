//! The `plugin` URI scheme (`http://plugin.localhost/<id>/ui/index.js`, `/<id>/assets/<path>`): serves the UI bundle
//! and assets of a discovered plugin from its archive or debug staging folder.
use std::borrow::Cow;

use tauri::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_TYPE};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use super::PluginHost;

fn content_type(file: &str) -> &'static str {
    match file.rsplit_once('.').map_or("", |(_, extension)| extension) {
        "js" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "opus" | "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "md" | "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let mut parts = request.uri().path().trim_start_matches('/').splitn(2, '/');
    let (id, file) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let found = app
        .try_state::<PluginHost>()
        .and_then(|host| host.ui_file(id, file));
    let response = Response::builder();
    match found {
        Some((bytes, from_dev_folder)) => {
            let mut response = response
                .header(CONTENT_TYPE, content_type(file))
                .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*");
            if from_dev_folder {
                response = response.header(CACHE_CONTROL, "no-store");
            }
            response.body(bytes.into())
        }
        None => response
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&[][..])),
    }
    .expect("static response parts are valid")
}
