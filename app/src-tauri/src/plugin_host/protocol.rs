//! The `plugin` URI scheme (`http://plugin.localhost/<id>/ui/index.js`): serves the UI bundle of a discovered
//! plugin and nothing else. The files are read once at discovery, so a later change on disk is never served.
use std::borrow::Cow;
use std::path::Path;

use tauri::http::{Request, Response, StatusCode, header::CONTENT_TYPE};
use tauri::{AppHandle, Manager};

use super::PluginHost;

pub struct Ui {
    script: Vec<u8>,
    style: Vec<u8>,
}

impl Ui {
    pub fn read(folder: &Path) -> Result<Self, String> {
        let read = |name: &str| {
            std::fs::read(folder.join("ui").join(name)).map_err(|e| format!("ui/{name}: {e}"))
        };
        Ok(Self {
            script: read("index.js")?,
            style: read("index.css")?,
        })
    }
}

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let mut parts = request.uri().path().trim_start_matches('/').splitn(2, '/');
    let (id, file) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let host = app.try_state::<PluginHost>();
    let found = host
        .as_ref()
        .and_then(|host| host.ui(id))
        .and_then(|ui| match file {
            "ui/index.js" => Some((&ui.script, "text/javascript")),
            "ui/index.css" => Some((&ui.style, "text/css")),
            _ => None,
        });
    let response = Response::builder();
    match found {
        Some((bytes, kind)) => response
            .header(CONTENT_TYPE, kind)
            .body(bytes.clone().into()),
        None => response
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&[][..])),
    }
    .expect("static response parts are valid")
}
