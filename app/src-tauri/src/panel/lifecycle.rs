//! Single creation, readiness generations and pending reveals for the control panel.
#[derive(Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Absent,
    Creating,
    Loading,
    Ready,
    Closing,
}

#[derive(Default)]
pub(super) struct PanelLifecycle {
    phase: Phase,
    pub(super) generation: u64,
    pending_reveal: Option<bool>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReadyAction {
    Stale,
    Hidden,
    Reveal,
}

impl PanelLifecycle {
    pub(super) fn begin_creation(&mut self) -> bool {
        if self.phase != Phase::Absent {
            return false;
        }
        self.phase = Phase::Creating;
        true
    }

    pub(super) fn creation_succeeded(&mut self) {
        if self.phase == Phase::Creating {
            self.phase = Phase::Loading;
        }
    }

    pub(super) fn creation_failed(&mut self) {
        self.phase = Phase::Absent;
        self.pending_reveal = None;
    }

    pub(super) fn request_open(&mut self) -> (u64, bool) {
        self.pending_reveal = Some(true);
        (self.generation, self.phase == Phase::Ready)
    }

    pub(super) fn navigation_started(&mut self, was_visible: bool) -> u64 {
        if self.phase == Phase::Closing {
            return self.generation;
        }
        self.generation = self.generation.saturating_add(1);
        self.phase = Phase::Loading;
        if was_visible {
            self.pending_reveal.get_or_insert(false);
        }
        self.generation
    }

    pub(super) fn mark_ready(&mut self, generation: u64) -> ReadyAction {
        if generation != self.generation || matches!(self.phase, Phase::Absent | Phase::Closing) {
            return ReadyAction::Stale;
        }
        self.phase = Phase::Ready;
        if self.pending_reveal.is_some() {
            ReadyAction::Reveal
        } else {
            ReadyAction::Hidden
        }
    }

    pub(super) fn pending_focus(&self, generation: u64) -> Option<bool> {
        if generation == self.generation && self.phase == Phase::Ready {
            self.pending_reveal
        } else {
            None
        }
    }

    pub(super) fn finish_reveal(&mut self, generation: u64) -> bool {
        if self.pending_focus(generation).is_none() {
            return false;
        }
        self.pending_reveal = None;
        true
    }

    pub(super) fn close_requested(&mut self) {
        self.phase = Phase::Closing;
        self.generation = self.generation.saturating_add(1);
        self.pending_reveal = None;
    }

    pub(super) fn destroyed(&mut self) -> bool {
        self.phase = Phase::Absent;
        self.generation = self.generation.saturating_add(1);
        self.pending_reveal.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::{PanelLifecycle, ReadyAction};

    #[test]
    fn readiness_without_an_open_request_stays_hidden() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        let generation = state.navigation_started(false);
        state.creation_succeeded();
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        assert_eq!(state.pending_focus(generation), None);
    }

    #[test]
    fn repeated_opens_during_creation_build_once_and_reveal_once() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        assert_eq!(state.request_open(), (0, false));
        assert_eq!(state.request_open(), (0, false));
        assert!(!state.begin_creation());
        let generation = state.navigation_started(false);
        state.creation_succeeded();
        assert_eq!(state.mark_ready(generation), ReadyAction::Reveal);
        assert_eq!(state.pending_focus(generation), Some(true));
        assert!(state.finish_reveal(generation));
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
    }

    #[test]
    fn close_before_ready_cancels_the_pending_reveal() {
        let mut state = PanelLifecycle::default();
        state.begin_creation();
        state.request_open();
        let generation = state.navigation_started(false);
        state.close_requested();
        assert_eq!(state.mark_ready(generation), ReadyAction::Stale);
        assert!(!state.destroyed());
    }

    #[test]
    fn navigation_invalidates_an_old_ready_generation() {
        let mut state = PanelLifecycle::default();
        let old = state.navigation_started(false);
        state.request_open();
        let current = state.navigation_started(false);
        assert!(current > old);
        assert_eq!(state.mark_ready(old), ReadyAction::Stale);
        assert_eq!(state.mark_ready(current), ReadyAction::Reveal);
    }

    #[test]
    fn visible_reload_reveals_again_without_stealing_focus() {
        let mut state = PanelLifecycle::default();
        let first = state.navigation_started(false);
        state.request_open();
        assert_eq!(state.mark_ready(first), ReadyAction::Reveal);
        assert!(state.finish_reveal(first));
        let reload = state.navigation_started(true);
        assert_eq!(state.mark_ready(reload), ReadyAction::Reveal);
        assert_eq!(state.pending_focus(reload), Some(false));
    }

    #[test]
    fn creation_failure_releases_single_flight_for_retry() {
        let mut state = PanelLifecycle::default();
        assert!(state.begin_creation());
        state.request_open();
        state.creation_failed();
        assert!(state.begin_creation());
        assert_eq!(state.pending_focus(state.generation), None);
    }

    #[test]
    fn an_open_during_close_waits_for_destruction_and_a_fresh_handshake() {
        let mut state = PanelLifecycle::default();
        let generation = state.navigation_started(false);
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        state.close_requested();
        assert!(!state.request_open().1);
        assert!(!state.begin_creation());
        assert_eq!(state.mark_ready(generation), ReadyAction::Stale);
        assert!(state.destroyed());
        assert!(state.begin_creation());
        let reopened = state.navigation_started(false);
        state.creation_succeeded();
        assert_eq!(state.mark_ready(reopened), ReadyAction::Reveal);
        assert!(state.finish_reveal(reopened));
        assert!(!state.finish_reveal(reopened));
    }

    #[test]
    fn destroyed_panel_resets_readiness_and_advances_generation() {
        let mut state = PanelLifecycle::default();
        let generation = state.navigation_started(false);
        assert_eq!(state.mark_ready(generation), ReadyAction::Hidden);
        state.destroyed();
        assert!(state.generation > generation);
        assert_eq!(state.mark_ready(generation), ReadyAction::Stale);
        assert!(!state.request_open().1);
    }
}
