//! One worker thread reads every Windows media session once per second while a window is subscribed,
//! and runs exact-session transport commands so the session shown is the session controlled.
use super::MediaHub;
use super::artwork::MAX_BYTES;
use super::model::{PlaybackState, SessionInfo, Snapshot, Timeline, changed};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::core::{HRESULT, IUnknown, Interface as _, RuntimeType};
use windows_future::{AsyncStatus, IAsyncOperation};

const POLL: Duration = Duration::from_secs(1);
const BURST_POLL: Duration = Duration::from_millis(150);
const BURST: Duration = Duration::from_secs(2);
/// Each Windows call gets this long; a stuck player is skipped instead of freezing the others.
const CALL_DEADLINE: Duration = Duration::from_secs(3);
const MAX_SESSIONS: usize = 16;
const MAX_TEXT: usize = 512;
const MAX_ID: usize = 1024;
/// A thumbnail that was missing is retried this many polls; a kept one is refreshed for stations
/// whose art changes under an unchanged title.
const ART_RETRIES: u8 = 3;
const ART_REFRESH: Duration = Duration::from_secs(60);
const META_FAILURES: u8 = 5;
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

fn timeout() -> windows::core::Error {
    // ERROR_TIMEOUT
    windows::core::Error::new(HRESULT(0x8007_05B4_u32 as i32), "media call timed out")
}

/// Waits for a Windows async call, cancelling it at the deadline.
fn wait<T: RuntimeType + 'static>(
    op: &IAsyncOperation<T>,
    deadline: Instant,
) -> windows::core::Result<T> {
    while op.Status()? == AsyncStatus::Started {
        if Instant::now() >= deadline {
            let _ = op.Cancel();
            return Err(timeout());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    op.GetResults()
}

pub fn transport_op(
    session: &Session,
    command: &str,
) -> windows::core::Result<IAsyncOperation<bool>> {
    match command {
        "prev" => session.TrySkipPreviousAsync(),
        "next" => session.TrySkipNextAsync(),
        // Chromium browsers (Brave, Chrome, Edge) answer true to TryTogglePlayPause but ignore it, so toggle
        // reads the session's own state and sends an explicit pause or play, which every player honours.
        "toggle" => match session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
        {
            Ok(Status::Playing) => session.TryPauseAsync(),
            _ => session.TryPlayAsync(),
        },
        "play" => session.TryPlayAsync(),
        "pause" => session.TryPauseAsync(),
        other => Err(windows::core::Error::new(
            HRESULT(-1),
            format!("unknown media command {other}"),
        )),
    }
}

pub enum Message {
    Wake,
    Transport {
        id: String,
        command: String,
        reply: tauri::async_runtime::Sender<Result<bool, String>>,
    },
    Stop,
}

fn clip(text: impl ToString, limit: usize) -> String {
    text.to_string().chars().take(limit).collect()
}

pub(super) fn same(a: &Session, b: &Session) -> bool {
    matches!((a.cast::<IUnknown>(), b.cast::<IUnknown>()), (Ok(a), Ok(b)) if a == b)
}

#[derive(Default, Clone, PartialEq)]
struct Meta {
    title: String,
    artist: String,
    album: String,
}

struct Tracked {
    id: String,
    session: Session,
    meta: Meta,
    artwork: Option<String>,
    art_misses: u8,
    art_at: Option<Instant>,
    failures: u8,
}

struct Worker {
    app: AppHandle,
    generation: u64,
    manager: Option<Manager>,
    tracked: Vec<Tracked>,
    next_id: u64,
    published: Option<Snapshot>,
    failing: bool,
}

pub fn run(app: AppHandle, generation: u64, messages: Receiver<Message>) {
    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if initialized.is_err() {
        log::error!("media session worker COM initialization failed: {initialized:?}");
        return;
    }
    let mut worker = Worker {
        app,
        generation,
        manager: None,
        tracked: Vec::new(),
        next_id: 0,
        published: None,
        failing: false,
    };
    let mut burst_until = Instant::now();
    loop {
        worker.poll();
        let interval = if Instant::now() < burst_until {
            BURST_POLL
        } else {
            POLL
        };
        match messages.recv_timeout(interval) {
            Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(Message::Wake) => burst_until = Instant::now() + BURST,
            Ok(Message::Transport { id, command, reply }) => {
                let _ = reply.blocking_send(worker.transport(&id, &command));
                burst_until = Instant::now() + BURST;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    drop(worker);
    unsafe { CoUninitialize() };
}

impl Worker {
    fn transport(&self, id: &str, command: &str) -> Result<bool, String> {
        let tracked = self
            .tracked
            .iter()
            .find(|tracked| tracked.id == id)
            .ok_or("media session is gone")?;
        let result = transport_op(&tracked.session, command)
            .and_then(|op| wait(&op, Instant::now() + CALL_DEADLINE));
        result.map_err(|error| error.to_string())
    }

    fn poll(&mut self) {
        let snapshot = match self.read() {
            Ok(snapshot) => {
                self.failing = false;
                snapshot
            }
            Err(error) => {
                if !self.failing {
                    log::warn!("media sessions unavailable: {error}");
                }
                self.failing = true;
                self.manager = None;
                self.tracked.clear();
                Snapshot {
                    available: false,
                    sessions: Vec::new(),
                }
            }
        };
        let hub = tauri::Manager::state::<MediaHub>(&self.app);
        hub.pin_artwork(
            snapshot
                .sessions
                .iter()
                .filter_map(|s| s.artwork.as_deref()),
        );
        if self
            .published
            .as_ref()
            .is_none_or(|before| changed(before, &snapshot))
        {
            hub.publish(&self.app, self.generation, &snapshot);
            self.published = Some(snapshot);
        }
    }

    fn read(&mut self) -> windows::core::Result<Snapshot> {
        let manager = match &self.manager {
            Some(manager) => manager.clone(),
            None => {
                let manager = wait(&Manager::RequestAsync()?, Instant::now() + CALL_DEADLINE)?;
                self.manager = Some(manager.clone());
                manager
            }
        };
        let current = manager.GetCurrentSession().ok();
        let sessions: Vec<Session> = manager
            .GetSessions()?
            .into_iter()
            .take(MAX_SESSIONS)
            .collect();
        self.reconcile(&sessions);
        // Start every metadata request before waiting on any, so one slow player costs one deadline.
        let deadline = Instant::now() + CALL_DEADLINE;
        let requests: Vec<_> = self
            .tracked
            .iter()
            .map(|tracked| tracked.session.TryGetMediaPropertiesAsync())
            .collect();
        let mut infos = Vec::new();
        for (tracked, request) in self.tracked.iter_mut().zip(requests) {
            let props = request.and_then(|op| wait(&op, deadline));
            infos.push(tracked.refresh(props, current.as_ref(), &self.app));
        }
        Ok(Snapshot {
            available: true,
            sessions: infos,
        })
    }

    /// Keeps ids for sessions that are still there and gives new ones a fresh id, in Windows' order.
    fn reconcile(&mut self, sessions: &[Session]) {
        let mut previous = std::mem::take(&mut self.tracked);
        for session in sessions {
            let kept = previous
                .iter()
                .position(|tracked| same(&tracked.session, session));
            let tracked = match kept {
                Some(index) => previous.swap_remove(index),
                None => {
                    self.next_id += 1;
                    let app_id = session
                        .SourceAppUserModelId()
                        .map(clip_id)
                        .unwrap_or_default();
                    Tracked {
                        id: format!("{app_id}#{}", self.next_id),
                        session: session.clone(),
                        meta: Meta::default(),
                        artwork: None,
                        art_misses: 0,
                        art_at: None,
                        failures: 0,
                    }
                }
            };
            self.tracked.push(tracked);
        }
    }
}

fn clip_id(id: windows::core::HSTRING) -> String {
    clip(id, MAX_ID)
}

impl Tracked {
    fn refresh(
        &mut self,
        props: windows::core::Result<Properties>,
        current: Option<&Session>,
        app: &AppHandle,
    ) -> SessionInfo {
        match &props {
            Ok(props) => {
                self.failures = 0;
                let meta = Meta {
                    title: props.Title().map(|t| clip(t, MAX_TEXT)).unwrap_or_default(),
                    artist: props
                        .Artist()
                        .map(|t| clip(t, MAX_TEXT))
                        .unwrap_or_default(),
                    album: props
                        .AlbumTitle()
                        .map(|t| clip(t, MAX_TEXT))
                        .unwrap_or_default(),
                };
                if meta != self.meta {
                    self.meta = meta;
                    self.artwork = None;
                    self.art_misses = 0;
                    self.art_at = None;
                }
                self.refresh_artwork(props, app);
            }
            // A transient failure keeps the last metadata a few polls; a lasting one clears it.
            Err(_) => {
                self.failures = self.failures.saturating_add(1);
                if self.failures >= META_FAILURES {
                    self.meta = Meta::default();
                    self.artwork = None;
                }
            }
        }
        SessionInfo {
            id: self.id.clone(),
            app_id: self
                .session
                .SourceAppUserModelId()
                .map(clip_id)
                .unwrap_or_default(),
            title: self.meta.title.clone(),
            artist: self.meta.artist.clone(),
            album: self.meta.album.clone(),
            state: self.state(),
            current: current.is_some_and(|current| same(current, &self.session)),
            timeline: self.timeline(),
            artwork: self.artwork.clone(),
        }
    }

    fn refresh_artwork(&mut self, props: &Properties, app: &AppHandle) {
        let due = match (&self.artwork, self.art_at) {
            (None, _) => self.art_misses < ART_RETRIES,
            (Some(_), Some(at)) => at.elapsed() >= ART_REFRESH,
            (Some(_), None) => true,
        };
        if !due {
            return;
        }
        self.art_at = Some(Instant::now());
        match read_thumbnail(props).and_then(|(bytes, kind)| {
            tauri::Manager::state::<MediaHub>(app).insert_artwork(&bytes, &kind)
        }) {
            Ok(handle) => self.artwork = Some(handle),
            Err(error) => {
                // Missing art is routine (many players publish none); a refresh failure keeps the old cover.
                log::debug!("media artwork unavailable: {error}");
                self.art_misses = self.art_misses.saturating_add(1);
            }
        }
    }

    fn state(&self) -> PlaybackState {
        let status = self
            .session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus());
        match status {
            Ok(Status::Playing) => PlaybackState::Playing,
            Ok(Status::Paused) => PlaybackState::Paused,
            Ok(Status::Stopped | Status::Closed) => PlaybackState::Stopped,
            _ => PlaybackState::Unknown,
        }
    }

    /// Absent unless the app reports a sane range; Windows time units are normalised to milliseconds here.
    fn timeline(&self) -> Option<Timeline> {
        let timeline = self.session.GetTimelineProperties().ok()?;
        let ms = |ticks: i64| ticks / 10_000;
        let start_ms = ms(timeline.StartTime().ok()?.Duration);
        let end_ms = ms(timeline.EndTime().ok()?.Duration);
        let position_ms = ms(timeline.Position().ok()?.Duration);
        let updated = timeline.LastUpdatedTime().ok()?.UniversalTime;
        if end_ms <= start_ms
            || position_ms < start_ms
            || position_ms > end_ms
            || updated <= UNIX_EPOCH_TICKS
        {
            return None;
        }
        let rate = self
            .session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackRate())
            .and_then(|rate| rate.Value())
            .ok()
            .filter(|rate| rate.is_finite() && *rate >= 0.0);
        Some(Timeline {
            position_ms,
            start_ms,
            end_ms,
            rate,
            sampled_at_ms: ms(updated - UNIX_EPOCH_TICKS),
        })
    }
}

/// Reads the thumbnail stream, refusing anything larger than the cache accepts before loading it.
fn read_thumbnail(props: &Properties) -> Result<(Vec<u8>, String), String> {
    let deadline = Instant::now() + CALL_DEADLINE;
    let read = || -> windows::core::Result<Option<(Vec<u8>, String)>> {
        let stream = wait(&props.Thumbnail()?.OpenReadAsync()?, deadline)?;
        let size = stream.Size()?;
        if size == 0 || size > MAX_BYTES {
            return Ok(None);
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        if wait(
            &reader
                .LoadAsync(size as u32)?
                .cast::<IAsyncOperation<u32>>()?,
            deadline,
        )? as u64
            != size
        {
            return Ok(None);
        }
        let mut bytes = vec![0; size as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(Some((bytes, stream.ContentType()?.to_string())))
    };
    read()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "thumbnail empty or too large".to_owned())
}
