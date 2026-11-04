use super::{LyricsView, Track, lrc};
use crate::http;
use serde::Deserialize;
use std::time::Duration;

#[derive(Default)]
pub(super) struct Client {
    retry_at: Option<tokio::time::Instant>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    duration: f64,
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

impl Record {
    fn view(&self) -> LyricsView {
        if self.instrumental {
            return LyricsView::Instrumental;
        }
        if let Some(text) = &self.synced_lyrics {
            let lines = lrc::parse(text);
            if !lines.is_empty() {
                return LyricsView::Synced { lines };
            }
        }
        if let Some(text) = &self.plain_lyrics {
            if !text.trim().is_empty() {
                return LyricsView::Plain {
                    text: text.chars().take(100_000).collect(),
                };
            }
        }
        LyricsView::None
    }
}

fn pick(records: Vec<Record>, duration: u64) -> LyricsView {
    records
        .into_iter()
        .filter(|record| {
            record.duration.is_finite() && (record.duration - duration as f64).abs() <= 2.0
        })
        .map(|record| ((record.duration - duration as f64).abs(), record.view()))
        .filter(|(_, view)| *view != LyricsView::None)
        .min_by(|(a_distance, a), (b_distance, b)| {
            let rank = |view: &LyricsView| match view {
                LyricsView::Synced { .. } | LyricsView::Instrumental => 0,
                _ => 1,
            };
            rank(a)
                .cmp(&rank(b))
                .then_with(|| a_distance.total_cmp(b_distance))
        })
        .map(|(_, view)| view)
        .unwrap_or(LyricsView::None)
}

fn normalized(track: &Track) -> (String, String) {
    let mut title = track.title.clone();
    for marker in ["[", "(feat.", "(Feat."] {
        if let Some(at) = title.find(marker) {
            let end = if marker == "[" { ']' } else { ')' };
            if let Some(length) = title[at..].find(end) {
                title.replace_range(at..at + length + 1, "");
            }
        }
    }
    if let Some((base, suffix)) = title.rsplit_once(" - ") {
        let suffix = suffix.to_ascii_lowercase();
        if suffix.contains("remaster") || suffix.ends_with("version") {
            title = base.into();
        }
    }
    let artist = track
        .artist
        .split([',', ';'])
        .next()
        .unwrap_or(&track.artist)
        .split(" feat.")
        .next()
        .unwrap_or(&track.artist)
        .trim()
        .into();
    (title.trim().into(), artist)
}

impl Client {
    async fn request(
        &mut self,
        path: &str,
        fields: &[(&str, &str)],
    ) -> Result<http::Response, String> {
        let url = format!("https://lrclib.net/api/{path}?{}", http::form(fields));
        for attempt in 0..2 {
            if let Some(at) = self.retry_at {
                if at.saturating_duration_since(tokio::time::Instant::now())
                    > Duration::from_secs(60)
                {
                    return Err("Lyrics rate limited".into());
                }
                tokio::time::sleep_until(at).await;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
            let response = http::send(
                "GET",
                &url,
                &[(
                    "User-Agent",
                    concat!("SupaDashboard/", env!("CARGO_PKG_VERSION")),
                )],
                None,
            )
            .await?;
            if response.status != 429 {
                return Ok(response);
            }
            let delay = response
                .retry_after
                .as_deref()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(60);
            // Keep the server cooldown across tracks without holding a tile request indefinitely.
            self.retry_at =
                tokio::time::Instant::now().checked_add(Duration::from_secs(delay.max(1)));
            if self.retry_at.is_none() {
                self.retry_at = tokio::time::Instant::now().checked_add(Duration::from_secs(86400));
            }
            if attempt == 1 {
                break;
            }
        }
        Err("Lyrics rate limited".into())
    }

    pub(super) async fn fetch(&mut self, track: &Track) -> Result<LyricsView, String> {
        let duration = track.duration.to_string();
        let (title, artist) = normalized(track);
        for (title, artist) in [(&track.title, &track.artist), (&title, &artist)] {
            let response = self
                .request(
                    "get",
                    &[
                        ("track_name", title),
                        ("artist_name", artist),
                        ("album_name", &track.album),
                        ("duration", &duration),
                    ],
                )
                .await?;
            if response.status == 404 {
                continue;
            }
            if response.status != 200 {
                return Err("Lyrics unavailable".into());
            }
            let record: Record =
                serde_json::from_str(&response.body).map_err(|_| "Invalid lyrics response")?;
            if !record.duration.is_finite() || (record.duration - track.duration as f64).abs() > 2.0
            {
                return Err("Invalid lyrics duration".into());
            }
            return Ok(record.view());
        }
        let response = self
            .request(
                "search",
                &[("track_name", &title), ("artist_name", &artist)],
            )
            .await?;
        if response.status != 200 {
            return Err("Lyrics unavailable".into());
        }
        let records: Vec<Record> =
            serde_json::from_str(&response.body).map_err(|_| "Invalid lyrics response")?;
        Ok(pick(records, track.duration))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(duration: f64, synced: bool) -> Record {
        Record {
            duration,
            instrumental: false,
            plain_lyrics: Some("plain".into()),
            synced_lyrics: synced.then(|| "[00:01]line".into()),
        }
    }
    #[test]
    fn search_prefers_synced_within_tolerance_then_closest_and_preserves_instrumentals() {
        assert_eq!(
            pick(
                vec![
                    record(100.0, false),
                    record(101.0, true),
                    record(103.0, true)
                ],
                100
            ),
            record(101.0, true).view()
        );
        assert_eq!(
            pick(vec![record(99.0, false), record(100.0, false)], 100),
            record(100.0, false).view()
        );
        assert_eq!(pick(vec![record(103.0, true)], 100), LyricsView::None);
        let mut instrumental = record(100.0, false);
        instrumental.instrumental = true;
        assert_eq!(pick(vec![instrumental], 100), LyricsView::Instrumental);
    }
    #[test]
    fn normalizes_common_spotify_suffixes() {
        let track = Track::new(
            "Artist, Guest".into(),
            "Song (feat. Guest) [Deluxe] - Remastered 2024".into(),
            "".into(),
            1000,
        )
        .unwrap();
        assert_eq!(normalized(&track), ("Song".into(), "Artist".into()));
    }
}
