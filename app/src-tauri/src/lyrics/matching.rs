use super::{LyricsView, Track, lrc};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Record {
    track_name: String,
    artist_name: String,
    duration: f64,
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

impl Record {
    fn view(&self, distance: f64) -> LyricsView {
        if distance <= 3.0 {
            if self.instrumental {
                return LyricsView::Instrumental;
            }
            if let Some(text) = &self.synced_lyrics {
                let lines = lrc::parse(text);
                if !lines.is_empty() {
                    return LyricsView::Synced { lines };
                }
            }
        }
        // Exact metadata can identify plain lyrics across slightly different releases. Unlike
        // synchronized lyrics, this text does not claim that its timestamps fit this recording.
        if !self.instrumental
            && let Some(text) = &self.plain_lyrics
        {
            if !text.trim().is_empty() {
                return LyricsView::Plain {
                    text: text.chars().take(100_000).collect(),
                };
            }
        }
        LyricsView::None
    }
}

fn unbracketed(value: &str) -> String {
    let mut depth = 0usize;
    let mut result = String::new();
    for character in value.chars() {
        match character {
            '(' | '[' => {
                depth += 1;
                result.push(' ');
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
            }
            _ if depth == 0 => result.push(character),
            _ => {}
        }
    }
    result
}

fn words(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn normalized(title: &str, artist: &str) -> (String, String) {
    let clean = |value: &str| {
        let mut value = unbracketed(&value.to_lowercase());
        for marker in [" feat.", " feat ", " ft.", " ft ", " featuring "] {
            if let Some(at) = value.find(marker) {
                value.truncate(at);
            }
        }
        value
    };
    let mut title = clean(title);
    for separator in [" - ", " – ", " — "] {
        if let Some((base, suffix)) = title.rsplit_once(separator) {
            if suffix.contains("remaster") || suffix.trim().ends_with("version") {
                title = base.into();
            }
        }
    }
    let artist = clean(artist);
    let artist = artist.split([',', ';', '&']).next().unwrap_or_default();
    (words(&title), words(artist))
}

pub(super) fn pick(records: Vec<Record>, track: &Track) -> LyricsView {
    let identity = normalized(&track.title, &track.artist);
    if identity.0.is_empty() || identity.1.is_empty() {
        return LyricsView::None;
    }
    records
        .into_iter()
        .filter(|record| normalized(&record.track_name, &record.artist_name) == identity)
        .filter_map(|record| {
            let distance = (record.duration - track.duration as f64).abs();
            if !record.duration.is_finite() || distance > 15.0 {
                return None;
            }
            let view = record.view(distance);
            let rank = match view {
                LyricsView::Synced { .. } => 0,
                LyricsView::Instrumental => 1,
                LyricsView::Plain { .. } => 2,
                LyricsView::None => return None,
            };
            Some((rank, distance, view))
        })
        .min_by(|(a_rank, a_distance, _), (b_rank, b_distance, _)| {
            a_rank
                .cmp(b_rank)
                .then_with(|| a_distance.total_cmp(b_distance))
        })
        .map(|(_, _, view)| view)
        .unwrap_or(LyricsView::None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(title: &str, artist: &str, duration: f64, synced: bool) -> Record {
        Record {
            track_name: title.into(),
            artist_name: artist.into(),
            duration,
            instrumental: false,
            plain_lyrics: Some("plain".into()),
            synced_lyrics: synced.then(|| "[00:01]line".into()),
        }
    }
    #[test]
    fn finds_sizor_plain_lyrics_despite_the_real_spotify_duration_mismatch() {
        let track = Track::new(
            "Sizor".into(),
            "Холодные стены".into(),
            "Холодные стены".into(),
            195_863,
        )
        .unwrap();
        assert_eq!(
            pick(
                vec![
                    record("Холодные стены", "Sizor", 201.0, false),
                    record("Холодные стены", "Sizor", 188.0, false)
                ],
                &track
            ),
            LyricsView::Plain {
                text: "plain".into()
            }
        );
    }
    #[test]
    fn matches_cyrillic_case_and_collaborators_without_accepting_other_songs() {
        let track = Track::new(
            "SIZOR feat. Гость".into(),
            "ХОЛОДНЫЕ СТЕНЫ (feat. Гость) [Deluxe] - Remastered 2024".into(),
            "Another album".into(),
            196_000,
        )
        .unwrap();
        assert_eq!(
            normalized(&track.title, &track.artist),
            ("холодные стены".into(), "sizor".into())
        );
        assert_eq!(
            normalized("ПЕСНЯ [2024]", "ГРУППА, Гость"),
            ("песня".into(), "группа".into())
        );
        assert!(matches!(
            pick(
                vec![
                    record("Другие стены", "Sizor", 196.0, true),
                    record("Холодные стены", "Другой", 196.0, true),
                    record("Холодные стены", "Sizor", 199.0, true),
                    record("Холодные стены", "Sizor", 196.0, false)
                ],
                &track
            ),
            LyricsView::Synced { .. }
        ));
        assert_eq!(
            pick(
                vec![
                    record("Другие стены", "Sizor", 196.0, true),
                    record("Холодные стены", "Другой", 196.0, true)
                ],
                &track
            ),
            LyricsView::None
        );
    }
    #[test]
    fn rejects_wrong_recording_timestamps_and_bounds_plain_fallback() {
        let track = Track::new("Artist".into(), "Song".into(), "".into(), 100_000).unwrap();
        let mut out_of_sync = record("Song", "Artist", 104.0, true);
        out_of_sync.plain_lyrics = None;
        assert_eq!(pick(vec![out_of_sync], &track), LyricsView::None);
        assert_eq!(
            pick(vec![record("Song", "Artist", 115.0, false)], &track),
            LyricsView::Plain {
                text: "plain".into()
            }
        );
        assert_eq!(
            pick(vec![record("Song", "Artist", 116.0, false)], &track),
            LyricsView::None
        );
        assert_eq!(
            pick(vec![record("Song", "Artist", f64::NAN, false)], &track),
            LyricsView::None
        );
        let mut instrumental = record("Song", "Artist", 100.0, false);
        instrumental.instrumental = true;
        assert_eq!(pick(vec![instrumental], &track), LyricsView::Instrumental);
    }
}
