//! What the session worker publishes, and the rule for when a new reading is worth publishing.
use serde::Serialize;

/// Position drift beyond this means a seek or a stall, not the clock the renderer extrapolates. Synced
/// lyrics show anything coarser as a visibly late line.
const DRIFT_MS: i64 = 300;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackState {
    Playing,
    Paused,
    Stopped,
    Unknown,
}

/// Milliseconds; `sampled_at_ms` is the UTC time `position_ms` was true at, as the app reported it.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub position_ms: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub rate: Option<f64>,
    pub sampled_at_ms: i64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// Opaque; stable while the Windows session lives. Never a filter key (the app id is).
    pub id: String,
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub state: PlaybackState,
    pub current: bool,
    pub timeline: Option<Timeline>,
    /// Handle from the artwork cache, resolved to a file by `media_artwork_resolve`.
    pub artwork: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// False while Windows' session manager cannot be reached.
    pub available: bool,
    pub sessions: Vec<SessionInfo>,
}

fn timeline_changed(
    state: PlaybackState,
    before: &Option<Timeline>,
    after: &Option<Timeline>,
) -> bool {
    match (before, after) {
        (None, None) => false,
        (Some(a), Some(b)) => {
            let rate = if state == PlaybackState::Playing {
                a.rate.unwrap_or(1.0)
            } else {
                0.0
            };
            let expected = a.position_ms as f64 + rate * (b.sampled_at_ms - a.sampled_at_ms) as f64;
            a.start_ms != b.start_ms
                || a.end_ms != b.end_ms
                || a.rate != b.rate
                || (b.position_ms as f64 - expected).abs() > DRIFT_MS as f64
        }
        _ => true,
    }
}

/// Whether `after` is worth publishing. Position ticks that follow the clock are not: the renderer
/// extrapolates them from the last sample.
pub fn changed(before: &Snapshot, after: &Snapshot) -> bool {
    before.available != after.available
        || before.sessions.len() != after.sessions.len()
        || before.sessions.iter().zip(&after.sessions).any(|(a, b)| {
            SessionInfo {
                timeline: None,
                ..a.clone()
            } != SessionInfo {
                timeline: None,
                ..b.clone()
            } || timeline_changed(a.state, &a.timeline, &b.timeline)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(position_ms: i64, sampled_at_ms: i64) -> SessionInfo {
        SessionInfo {
            id: "app#1".into(),
            app_id: "app".into(),
            title: "Song".into(),
            artist: "Band".into(),
            album: String::new(),
            state: PlaybackState::Playing,
            current: true,
            timeline: Some(Timeline {
                position_ms,
                start_ms: 0,
                end_ms: 200_000,
                rate: Some(1.0),
                sampled_at_ms,
            }),
            artwork: None,
        }
    }

    fn snapshot(sessions: Vec<SessionInfo>) -> Snapshot {
        Snapshot {
            available: true,
            sessions,
        }
    }

    #[test]
    fn publishes_seeks_and_track_changes_but_not_the_ticking_clock() {
        let before = snapshot(vec![session(10_000, 1_000_000)]);
        assert!(!changed(
            &before,
            &snapshot(vec![session(15_000, 1_005_000)])
        ));
        assert!(changed(
            &before,
            &snapshot(vec![session(90_000, 1_005_000)])
        ));
        let mut next = session(10_000, 1_000_000);
        next.title = "Other".into();
        assert!(changed(&before, &snapshot(vec![next])));
        let mut paused = session(10_000, 1_000_000);
        paused.state = PlaybackState::Paused;
        assert!(changed(&before, &snapshot(vec![paused])));
        assert!(changed(
            &before,
            &Snapshot {
                available: false,
                sessions: Vec::new()
            }
        ));
    }

    #[test]
    fn a_paused_clock_that_moves_counts_as_a_seek() {
        let mut paused = session(10_000, 1_000_000);
        paused.state = PlaybackState::Paused;
        let mut later = session(15_000, 1_005_000);
        later.state = PlaybackState::Paused;
        assert!(changed(&snapshot(vec![paused]), &snapshot(vec![later])));
    }
}
