use super::{
    actions::{Action, ScrollFrame},
    pairing::{Hello, Mode, Pairing, Proof},
    stream::{MAX_PENDING, Pending, ScrollQueue},
    view::Outline,
    wire::{self, ADDRESS, DEADLINE, Failure, LIMIT, LOGIN_LIMIT, Outgoing, Reply, Socket, State},
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Notify, OwnedSemaphorePermit, Semaphore, mpsc, oneshot, watch},
    task::{AbortHandle, JoinHandle, JoinSet},
    time::{sleep_until, timeout},
};
use tokio_tungstenite::{
    WebSocketStream, accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response},
        protocol::{Role, WebSocketConfig},
    },
};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Snapshot {
    Offline,
    Repair,
    Connected {
        #[serde(flatten)]
        state: State,
        outline: Option<Outline>,
    },
}

pub(super) struct RequestAction {
    pub action: Action,
    pub reply: oneshot::Sender<Result<(), Failure>>,
}

pub struct Bridge {
    pub(super) plugin: String,
    task: AbortHandle,
    state: Arc<Server>,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct Server {
    extension: String,
    pairing: Mutex<Pairing>,
    admission: tokio::sync::Mutex<()>,
    session: Mutex<Option<SessionInput>>,
    snapshots: watch::Sender<Snapshot>,
    outline_watchers: watch::Sender<HashSet<u32>>,
}

struct SessionInput {
    commands: mpsc::Sender<RequestAction>,
    scroll: Arc<ScrollLane>,
}

#[derive(Default)]
struct ScrollLane {
    queue: Mutex<ScrollQueue>,
    ready: Notify,
}

impl Bridge {
    pub(super) fn start(
        plugin: String,
        extension: String,
        path: PathBuf,
    ) -> Result<(Self, JoinHandle<()>), String> {
        let pairing = Pairing::open(path);
        let snapshot = if pairing.needs_repair() {
            Snapshot::Repair
        } else {
            Snapshot::Offline
        };
        let bind_error = |_| "WebCompanion port 43822 is unavailable";
        let listener = std::net::TcpListener::bind(ADDRESS).map_err(bind_error)?;
        listener.set_nonblocking(true).map_err(bind_error)?;
        let listener = TcpListener::from_std(listener).map_err(bind_error)?;
        let state = Arc::new(Server {
            extension,
            pairing: Mutex::new(pairing),
            admission: tokio::sync::Mutex::new(()),
            session: Mutex::new(None),
            snapshots: watch::Sender::new(snapshot),
            outline_watchers: watch::Sender::default(),
        });
        let task = tokio::spawn(serve(listener, state.clone()));
        let bridge = Self {
            plugin,
            task: task.abort_handle(),
            state,
        };
        Ok((bridge, task))
    }

    pub(super) fn extension(&self) -> &str {
        &self.state.extension
    }

    pub(super) fn snapshots(&self) -> watch::Receiver<Snapshot> {
        self.state.snapshots.subscribe()
    }

    pub(super) fn pair(&self, watch: u32) -> Result<String, Failure> {
        let _permit = self
            .state
            .admission
            .try_lock()
            .map_err(|_| "Browser is already connected")?;
        lock(&self.state.pairing).issue(watch, Instant::now())
    }

    pub(super) fn cancel(&self, watch: u32) {
        lock(&self.state.pairing).cancel(watch);
        self.outline(watch, false);
    }

    pub(super) fn outline(&self, watch: u32, enabled: bool) {
        self.state.outline_watchers.send_if_modified(|watchers| {
            let was_empty = watchers.is_empty();
            if enabled {
                watchers.insert(watch);
            } else {
                watchers.remove(&watch);
            }
            was_empty != watchers.is_empty()
        });
    }

    pub(super) fn send(&self, action: RequestAction) -> Result<(), Failure> {
        lock(&self.state.session)
            .as_ref()
            .ok_or("Browser is offline")?
            .commands
            .try_send(action)
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => "Browser is busy",
                mpsc::error::TrySendError::Closed(_) => "Browser is offline",
            })
    }

    pub(super) fn scroll(&self, frame: ScrollFrame) -> Result<(), Failure> {
        let session = lock(&self.state.session);
        let lane = &session.as_ref().ok_or("Browser is offline")?.scroll;
        lock(&lane.queue).push(frame);
        lane.ready.notify_one();
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn serve(listener: TcpListener, state: Arc<Server>) {
    let mut peers = JoinSet::new();
    let slots = Arc::new(Semaphore::new(4));
    loop {
        tokio::select! {
            incoming = async {
                let slot = slots.clone().acquire_owned().await.expect("pre-auth semaphore stays open");
                listener.accept().await.map(|(stream, _)| (stream, slot))
            } => {
                match incoming {
                    Ok((stream, slot)) => { peers.spawn(connect(stream, state.clone(), slot)); }
                    Err(error) => {
                        log::warn!("Browser bridge listener: {error}");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
            _ = peers.join_next(), if !peers.is_empty() => {}
        }
    }
}

async fn upgrade(stream: TcpStream, extension: &str) -> Result<(Socket, Hello), Failure> {
    let config = WebSocketConfig::default()
        .read_buffer_size(LOGIN_LIMIT)
        .max_message_size(Some(LOGIN_LIMIT))
        .max_frame_size(Some(LOGIN_LIMIT));
    let upgrade = |request: &Request, response: Response| {
        if wire::origin(request, extension) {
            Ok(response)
        } else {
            let mut refused = ErrorResponse::new(None);
            *refused.status_mut() = tauri::http::StatusCode::FORBIDDEN;
            Err(refused)
        }
    };
    let mut socket = accept_hdr_async_with_config(stream, upgrade, Some(config))
        .await
        .map_err(|_| "Browser upgrade refused")?;
    let hello = wire::read(&mut socket).await?;
    Ok((socket, hello))
}

async fn authenticate<'a>(
    socket: &mut Socket,
    hello: Hello,
    state: &'a Server,
) -> Result<(Mode, tokio::sync::MutexGuard<'a, ()>), Failure> {
    let (attempt, challenge) =
        lock(&state.pairing).begin(hello, &state.extension, Instant::now())?;
    wire::send(socket, &challenge).await?;
    let proof: Proof = wire::read(socket).await?;
    let permit = state
        .admission
        .try_lock()
        .map_err(|_| "Browser is already connected")?;
    let mode = lock(&state.pairing)
        .finish(attempt, &state.extension, proof, Instant::now())
        .map_err(|error| {
            log::debug!("Browser bridge authentication: {error}");
            "Browser authentication refused"
        })?;
    Ok((mode, permit))
}

async fn connect(stream: TcpStream, state: Arc<Server>, slot: OwnedSemaphorePermit) {
    let Ok(Ok((mut socket, hello))) =
        timeout(Duration::from_secs(1), upgrade(stream, &state.extension)).await
    else {
        return;
    };
    let Ok(Ok((mode, permit))) = timeout(DEADLINE, authenticate(&mut socket, hello, &state)).await
    else {
        return;
    };
    drop(slot);
    if mode == Mode::Pair {
        drop(permit);
        // Give the extension time to save the credential and close this socket before logging in.
        let _ = timeout(DEADLINE, async {
            wire::send(&mut socket, &serde_json::json!({"kind": "ready"})).await?;
            wire::read::<Proof>(&mut socket).await
        })
        .await;
        return;
    }
    // The extension waits for ready before sending any session frames.
    let config = WebSocketConfig::default()
        .max_message_size(Some(LIMIT))
        .max_frame_size(Some(LIMIT));
    let mut socket =
        WebSocketStream::from_raw_socket(socket.into_inner(), Role::Server, Some(config)).await;
    if !matches!(
        timeout(
            DEADLINE,
            wire::send(&mut socket, &serde_json::json!({"kind": "ready"}))
        )
        .await,
        Ok(Ok(()))
    ) {
        return;
    }
    let (commands, receive) = mpsc::channel(MAX_PENDING);
    let scroll = Arc::new(ScrollLane::default());
    *lock(&state.session) = Some(SessionInput {
        commands,
        scroll: scroll.clone(),
    });
    if let Err(error) = session(socket, &state, receive, &scroll).await {
        log::debug!("Browser bridge session: {error}");
    }
    *lock(&state.session) = None;
    state.snapshots.send_replace(Snapshot::Offline);
}

async fn session(
    mut socket: Socket,
    state: &Server,
    mut actions: mpsc::Receiver<RequestAction>,
    scroll: &ScrollLane,
) -> Result<(), Failure> {
    let mut pending = Pending::default();
    let mut idle = tokio::time::Instant::now() + DEADLINE * 8;
    let mut outline_watchers = state.outline_watchers.subscribe();
    let mut watching = !outline_watchers.borrow_and_update().is_empty();
    if watching {
        write(&mut socket, &Outgoing::Outline { enabled: true }).await?;
    }
    loop {
        let deadline = pending
            .expire(tokio::time::Instant::now())
            .unwrap_or(idle)
            .min(idle);
        tokio::select! {
            Some(action) = actions.recv() => {
                dispatch(&mut socket, state, &mut pending, action).await?;
            }
            _ = scroll.ready.notified() => {
                let frame = lock(&scroll.queue).take();
                if let Some(frame) = frame {
                    write(&mut socket, &Outgoing::Scroll(frame)).await?;
                }
            }
            _ = outline_watchers.changed() => {
                let enabled = !outline_watchers.borrow_and_update().is_empty();
                if enabled != watching {
                    watching = enabled;
                    if !watching {
                        publish_outline(state, None)?;
                    }
                    write(&mut socket, &Outgoing::Outline { enabled }).await?;
                }
            }
            frame = wire::read_reply(&mut socket) => {
                idle = tokio::time::Instant::now() + DEADLINE * 8;
                match frame? {
                    Reply::State { state: update } => publish(state, update)?,
                    Reply::Outline { view } if watching => publish_outline(state, view)?,
                    Reply::Outline { .. } => {},
                    Reply::Done { id, ok, gone, covered } => {
                        pending.expire(tokio::time::Instant::now());
                        let failure = if gone {
                            Some("Tab closed")
                        } else if covered {
                            Some("Element covered")
                        } else {
                            None
                        };
                        pending.complete(id, ok, failure);
                    }
                }
            }
            _ = sleep_until(deadline) => {
                if tokio::time::Instant::now() >= idle {
                    return Err("Browser is offline");
                }
            }
        }
    }
}

fn publish(server: &Server, state: State) -> Result<(), Failure> {
    state.validate()?;
    server.snapshots.send_if_modified(|snapshot| {
        let outline = match snapshot {
            Snapshot::Connected { state: old, .. } if *old == state => return false,
            Snapshot::Connected {
                state: old,
                outline,
            } if old.active_tab == state.active_tab => outline.take(),
            _ => None,
        };
        *snapshot = Snapshot::Connected { state, outline };
        true
    });
    Ok(())
}

fn publish_outline(server: &Server, view: Option<Outline>) -> Result<(), Failure> {
    if let Some(view) = &view {
        view.validate()?;
    }
    server.snapshots.send_if_modified(|snapshot| {
        let Snapshot::Connected { state, outline } = snapshot else {
            return false;
        };
        if let Some(view) = &view {
            if Some(view.tab) != state.active_tab
                || outline
                    .as_ref()
                    .is_some_and(|old| old.doc == view.doc && old.seq >= view.seq)
            {
                return false;
            }
        } else if outline.is_none() {
            return false;
        }
        *outline = view;
        true
    });
    Ok(())
}

fn validate(snapshot: &Snapshot, request: &RequestAction) -> Result<(), Failure> {
    let Snapshot::Connected { state, outline } = snapshot else {
        return Err("Browser is offline");
    };
    if let Some(selection) = request.action.selection() {
        if !outline
            .as_ref()
            .is_some_and(|view| view.contains(selection))
        {
            return Err("Page element changed");
        }
    }
    request.action.validate_target(state)
}

async fn dispatch(
    socket: &mut Socket,
    state: &Server,
    pending: &mut Pending,
    action: RequestAction,
) -> Result<(), Failure> {
    if action.reply.is_closed() {
        return Ok(());
    }
    if let Err(error) = validate(&state.snapshots.borrow(), &action) {
        let _ = action.reply.send(Err(error));
        return Ok(());
    }
    match pending.insert(
        action.reply,
        action.action.failure(),
        tokio::time::Instant::now(),
    ) {
        Ok(id) => {
            write(
                socket,
                &Outgoing::Command {
                    id,
                    action: &action.action,
                },
            )
            .await
        }
        Err(reply) => {
            let _ = reply.send(Err("Browser is busy"));
            Ok(())
        }
    }
}

async fn write(socket: &mut Socket, frame: &Outgoing<'_>) -> Result<(), Failure> {
    timeout(DEADLINE, wire::send(socket, frame))
        .await
        .map_err(|_| "Browser did not respond")?
}
