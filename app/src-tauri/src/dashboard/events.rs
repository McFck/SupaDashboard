//! Hover, resize and visibility events for the dashboard's frontend.
use serde::Serialize;
use std::cell::Cell;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HoverEvent {
    hovered: bool,
    revision: u64,
    clear_client: bool,
}

#[derive(Clone, Serialize)]
struct VisibilityEvent {
    visible: bool,
    revision: u64,
}

#[derive(Clone, Serialize)]
struct ResizeEvent {
    resizing: bool,
    revision: u64,
}

/// Publishes only changes. Each emit runs as its own task, so events can arrive out of order: every payload carries
/// the next value of one counter, and the frontend drops a revision older than the last one it applied for that event.
pub struct Events {
    app: AppHandle,
    revision: Cell<u64>,
    hovered: Cell<bool>,
    resizing: Cell<bool>,
}

impl Events {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            revision: Cell::new(0),
            hovered: Cell::new(false),
            resizing: Cell::new(false),
        }
    }

    pub fn hover(&self, hovered: bool, clear_client: bool) {
        if self.hovered.get() == hovered && !clear_client {
            return;
        }
        self.hovered.set(hovered);
        self.emit(
            "dashboard-hover",
            HoverEvent {
                hovered,
                revision: self.next_revision(),
                clear_client,
            },
        );
    }

    pub fn visibility(&self, visible: bool) {
        self.emit(
            "dashboard-visibility",
            VisibilityEvent {
                visible,
                revision: self.next_revision(),
            },
        );
    }

    pub fn resize(&self, resizing: bool) {
        if self.resizing.get() == resizing {
            return;
        }
        self.resizing.set(resizing);
        self.emit(
            "dashboard-resize",
            ResizeEvent {
                resizing,
                revision: self.next_revision(),
            },
        );
    }

    pub fn is_resizing(&self) -> bool {
        self.resizing.get()
    }

    fn next_revision(&self) -> u64 {
        let revision = self.revision.get().wrapping_add(1);
        self.revision.set(revision);
        revision
    }

    fn emit<T: Serialize + Clone + Send + 'static>(&self, event: &'static str, payload: T) {
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = app.emit_to("main", event, payload);
        });
    }
}
