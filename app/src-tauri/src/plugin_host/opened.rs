//! A `.sdplugin` opened from Explorer: its path arrives on the command line of this instance or, forwarded by the
//! single-instance plugin, of a second one. It waits here until the control panel asks for it and confirms the
//! install.
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::panel::{self, require_panel};

#[derive(Default)]
pub struct OpenedFile(Mutex<Option<PathBuf>>);

/// The first `.sdplugin` argument, relative to the launching process's folder.
fn plugin_argument(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .map(Path::new)
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "sdplugin")
        })
        .map(|path| cwd.join(path))
}

/// Keeps the file for the panel, opens the panel and tells it a file is waiting.
pub fn opened(app: &AppHandle, args: &[String], cwd: &Path) {
    let Some(path) = plugin_argument(args, cwd) else {
        return;
    };
    *app.state::<OpenedFile>()
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(path);
    panel::spawn_open(app.clone());
    // A panel still starting asks on mount instead.
    let _ = app.emit_to("panel", "plugin-file-opened", ());
}

/// The waiting file, once.
#[tauri::command]
pub fn plugin_opened_file(
    window: WebviewWindow,
    opened: State<'_, OpenedFile>,
) -> Result<Option<String>, String> {
    require_panel(&window)?;
    let path = opened
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    Ok(path.map(|path| path.to_string_lossy().into_owned()))
}
