use super::{
    pairing::{Pairing, Proof},
    wire::{self, ADDRESS, Command, DEADLINE, Failure, LIMIT, Reply, Socket, Tab},
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError, Weak,
        atomic::{AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, watch},
    task::{AbortHandle, JoinSet},
    time::{MissedTickBehavior, interval, timeout},
};
use tokio_tungstenite::{
    accept_hdr_async_with_config,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response},
        protocol::WebSocketConfig,
    },
};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Snapshot {
    Offline,
    Connected { revision: u32, tabs: Vec<Tab> },
}

pub(super) struct Activation {
    pub owner: Weak<()>,
    pub revision: u32,
    pub tab: i32,
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
    commands: Mutex<Option<mpsc::Sender<Activation>>>,
    snapshots: watch::Sender<Snapshot>,
    revision: AtomicU32,
}

impl Bridge {
    pub(super) fn start(plugin: String, extension: String, path: PathBuf) -> Result<Self, String> {
        let pairing = Pairing::open(path)?;
        let bind_error = |_| "Browser Remote port 43822 is unavailable";
        let listener = std::net::TcpListener::bind(ADDRESS).map_err(bind_error)?;
        listener.set_nonblocking(true).map_err(bind_error)?;
        let listener = TcpListener::from_std(listener).map_err(bind_error)?;
        let state = Arc::new(Server {
            extension,
            pairing: Mutex::new(pairing),
            admission: tokio::sync::Mutex::new(()),
            commands: Mutex::new(None),
            snapshots: watch::Sender::new(Snapshot::Offline),
            revision: AtomicU32::default(),
        });
        let task = tauri::async_runtime::spawn(serve(listener, state.clone()))
            .inner()
            .abort_handle();
        Ok(Self {
            plugin,
            task,
            state,
        })
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
    }

    pub(super) fn activate(&self, action: Activation) -> Result<(), Failure> {
        lock(&self.state.commands)
            .as_ref()
            .ok_or("Browser is offline")?
            .try_send(action)
            .map_err(|_| "Browser is busy")
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn serve(listener: TcpListener, state: Arc<Server>) {
    let mut peers = JoinSet::new();
    loop {
        tokio::select! {
            result = listener.accept(), if peers.len() < 4 => {
                match result {
                    Ok((stream, _)) => { peers.spawn(connect(stream, state.clone())); }
                    Err(error) => {
                        log::warn!("Browser Remote listener: {error}");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
            _ = peers.join_next(), if !peers.is_empty() => {}
        }
    }
}

async fn authenticate(
    stream: TcpStream,
    state: &Server,
) -> Result<(Socket, tokio::sync::MutexGuard<'_, ()>), Failure> {
    let config = WebSocketConfig::default()
        .max_message_size(Some(LIMIT))
        .max_frame_size(Some(LIMIT));
    let upgrade = |request: &Request, response: Response| {
        if wire::origin(request, &state.extension) {
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
    let (attempt, challenge) =
        lock(&state.pairing).begin(hello, &state.extension, Instant::now())?;
    wire::send(&mut socket, &challenge).await?;
    let proof: Proof = wire::read(&mut socket).await?;
    let permit = state
        .admission
        .try_lock()
        .map_err(|_| "Browser is already connected")?;
    lock(&state.pairing)
        .finish(attempt, &state.extension, proof, Instant::now())
        .map_err(|error| {
            log::debug!("Browser Remote authentication: {error}");
            "Browser authentication refused"
        })?;
    wire::send(&mut socket, &serde_json::json!({"kind": "ready"})).await?;
    Ok((socket, permit))
}

async fn connect(stream: TcpStream, state: Arc<Server>) {
    let Ok(Ok((socket, _permit))) = timeout(DEADLINE, authenticate(stream, &state)).await else {
        return;
    };
    let (send, receive) = mpsc::channel(4);
    *lock(&state.commands) = Some(send);
    if let Err(error) = session(socket, &state, receive).await {
        log::debug!("Browser Remote session: {error}");
    }
    *lock(&state.commands) = None;
    state.snapshots.send_replace(Snapshot::Offline);
}

async fn session(
    mut socket: Socket,
    state: &Server,
    mut actions: mpsc::Receiver<Activation>,
) -> Result<(), Failure> {
    let mut poll = interval(Duration::from_secs(3));
    poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut request = 0u32;
    loop {
        request = request.wrapping_add(1);
        tokio::select! {
            _ = poll.tick() => {
                let tabs = wire::request(&mut socket, Command::List { id: request }).await?.list(request)?;
                state.snapshots.send_if_modified(|snapshot| {
                    if matches!(snapshot, Snapshot::Connected { tabs: old, .. } if *old == tabs) {
                        return false;
                    }
                    let revision = state.revision.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
                    *snapshot = Snapshot::Connected { revision, tabs };
                    true
                });
            }
            Some(action) = actions.recv() => {
                activate(&mut socket, state, request, action).await?;
            }
            frame = wire::read::<Reply>(&mut socket) => {
                frame?;
                return Err("Unexpected browser reply");
            }
        }
    }
}

async fn activate(
    socket: &mut Socket,
    state: &Server,
    request: u32,
    action: Activation,
) -> Result<(), Failure> {
    let current = matches!(&*state.snapshots.borrow(), Snapshot::Connected { revision, tabs }
        if *revision == action.revision && tabs.iter().any(|tab| tab.id == action.tab));
    if !current || action.owner.strong_count() == 0 || action.reply.is_closed() {
        let _ = action.reply.send(Err("Browser tabs changed"));
        return Ok(());
    }
    let result = wire::request(
        socket,
        Command::Activate {
            id: request,
            tab: action.tab,
        },
    )
    .await
    .and_then(|reply| reply.activation(request));
    let _ = action.reply.send(result.and_then(|reply| reply));
    result.map(|_| ())
}
