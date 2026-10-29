//! Which Windows media session a transport command without a session id goes to.

pub struct Candidate<'a> {
    pub app_id: &'a str,
    pub playing: bool,
    pub current: bool,
}

/// The playing session, preferring the one Windows calls current; with nothing playing, the current
/// one, else the most recent. Windows' "current" alone is often a different app than the one playing.
pub fn pick_system(sessions: &[Candidate]) -> Option<usize> {
    sessions
        .iter()
        .position(|c| c.playing && c.current)
        .or_else(|| sessions.iter().position(|c| c.playing))
        .or_else(|| sessions.iter().position(|c| c.current))
        .or_else(|| sessions.len().checked_sub(1))
}

/// An exact app id match wins; a case-insensitive substring ("spotify") is the fallback. Among
/// several matches the playing one is preferred.
pub fn pick_app(sessions: &[Candidate], target: &str) -> Option<usize> {
    let target = target.to_lowercase();
    let pick = |matches: &dyn Fn(&str) -> bool| {
        let hits: Vec<usize> = (0..sessions.len())
            .filter(|&i| matches(&sessions[i].app_id.to_lowercase()))
            .collect();
        hits.iter()
            .copied()
            .find(|&i| sessions[i].playing)
            .or(hits.first().copied())
    };
    pick(&|id| id == target).or_else(|| pick(&|id| id.contains(&target)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(app_id: &str, playing: bool, current: bool) -> Candidate<'_> {
        Candidate {
            app_id,
            playing,
            current,
        }
    }

    #[test]
    fn system_command_reaches_the_playing_app_not_the_current_one() {
        let sessions = [s("brave", false, true), s("spotify", true, false)];
        assert_eq!(pick_system(&sessions), Some(1));
    }

    #[test]
    fn system_command_prefers_current_when_it_plays_too() {
        let sessions = [s("a", true, false), s("b", true, true)];
        assert_eq!(pick_system(&sessions), Some(1));
    }

    #[test]
    fn system_command_with_nothing_playing_takes_current_then_most_recent() {
        assert_eq!(
            pick_system(&[
                s("a", false, false),
                s("b", false, true),
                s("c", false, false)
            ]),
            Some(1)
        );
        assert_eq!(
            pick_system(&[s("a", false, false), s("b", false, false)]),
            Some(1)
        );
        assert_eq!(pick_system(&[]), None);
    }

    #[test]
    fn app_target_prefers_exact_id_over_a_longer_id_containing_it() {
        let sessions = [s("Brave.Beta", true, false), s("Brave", false, false)];
        assert_eq!(pick_app(&sessions, "brave"), Some(1));
    }

    #[test]
    fn app_target_falls_back_to_substring_and_prefers_the_playing_match() {
        let sessions = [
            s("Spotify.exe", false, false),
            s("Spotify.exe", true, false),
        ];
        assert_eq!(pick_app(&sessions, "spotify"), Some(1));
        assert_eq!(pick_app(&sessions, "discord"), None);
    }
}
