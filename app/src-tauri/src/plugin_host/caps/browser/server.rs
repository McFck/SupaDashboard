use super::{
    actions::{Action, ScrollFrame},
    pairing::{Hello, Mode, PairCode, Pairing, Proof, Ready, Rejected, VERSION},
    stream::{MAX_PENDING, Pending, ScrollQueue},
    wire::{self, ADDRESS, DEADLINE, Failure, LIMIT, LOGIN_LIMIT, Outgoing, Reply, Socket, State},
};
use serde::Serialize;
use std::{
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

    pub(super) fn pair(&self, watch: u32) -> Result<PairCode, Failure> {
        let _permit = self
            .state
            .admission
            .try_lock()
            .map_err(|_| "Browser is already connected")?;
        lock(&self.state.pairing).issue(watch, Instant::now())
    }

    pub(super) fn cancel(&self, watch: u32) {
        lock(&self.state.pairing).cancel(watch);
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
        let active = match &*self.state.snapshots.borrow() {
            Snapshot::Connected { state, .. } => state.active_tab,
            _ => None,
        };
        if active != Some(frame.tab()) {
            return Err("Browser tab changed");
        }
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
) -> Result<(Mode, Ready, tokio::sync::MutexGuard<'a, ()>), Failure> {
    if hello.v != VERSION {
        auth_error(socket, "update").await?;
        return Err("Update the browser extension");
    }
    let (attempt, challenge) =
        lock(&state.pairing).begin(hello, &state.extension, Instant::now())?;
    wire::send(socket, &challenge).await?;
    let proof: Proof = wire::read(socket).await?;
    let permit = state
        .admission
        .try_lock()
        .map_err(|_| "Browser is already connected")?;
    let result = lock(&state.pairing).finish(attempt, &state.extension, proof, Instant::now());
    match result {
        Ok((mode, ready)) => Ok((mode, ready, permit)),
        Err(rejection) => {
            let code = match rejection {
                Rejected::Code => "code",
                Rejected::Expired => "expired",
                Rejected::Authentication => "auth",
                Rejected::Storage(error) => {
                    log::warn!("Browser bridge authentication: {error}");
                    "storage"
                }
            };
            auth_error(socket, code).await?;
            Err("Browser authentication refused")
        }
    }
}

async fn auth_error(socket: &mut Socket, code: &str) -> Result<(), Failure> {
    wire::send(socket, &serde_json::json!({"kind": "error", "code": code})).await
}

async fn connect(stream: TcpStream, state: Arc<Server>, slot: OwnedSemaphorePermit) {
    let Ok(Ok((mut socket, hello))) =
        timeout(Duration::from_secs(1), upgrade(stream, &state.extension)).await
    else {
        return;
    };
    let Ok(Ok((mode, ready, permit))) =
        timeout(DEADLINE, authenticate(&mut socket, hello, &state)).await
    else {
        return;
    };
    drop(slot);
    if mode == Mode::Pair {
        drop(permit);
        state.snapshots.send_if_modified(|snapshot| {
            let repaired = matches!(snapshot, Snapshot::Repair);
            if repaired {
                *snapshot = Snapshot::Offline;
            }
            repaired
        });
        // Give the extension time to save the credential and close this socket before logging in.
        let _ = timeout(DEADLINE, async {
            wire::send(&mut socket, &ready).await?;
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
        timeout(DEADLINE, wire::send(&mut socket, &ready)).await,
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
            frame = wire::read::<Reply>(&mut socket) => {
                idle = tokio::time::Instant::now() + DEADLINE * 8;
                match frame? {
                    Reply::State { state: update } => publish(state, update)?,
                    Reply::Done { id, ok, gone } => {
                        pending.expire(tokio::time::Instant::now());
                        pending.complete(id, ok, gone.then_some("Tab closed"));
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
        if matches!(snapshot, Snapshot::Connected { state: old } if *old == state) {
            return false;
        }
        *snapshot = Snapshot::Connected { state };
        true
    });
    Ok(())
}

fn validate(snapshot: &Snapshot, request: &RequestAction) -> Result<(), Failure> {
    let Snapshot::Connected { state } = snapshot else {
        return Err("Browser is offline");
    };
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
