//! Audio data the frontend sees, and the pure rules that normalize and diff it.
use serde::Serialize;
use std::collections::BTreeMap;

const VALUE_EPSILON: f32 = 0.0001;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Channel {
    pub target: String,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub revision: u64,
    pub device_id: Option<String>,
    pub channels: Vec<Channel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioUpdateResult {
    pub applied: bool,
    pub snapshot: AudioSnapshot,
}

#[derive(Clone, Debug)]
pub struct SessionSample {
    pub target: String,
    pub instance_id: String,
    pub volume: f32,
    pub muted: bool,
}

pub fn normalize_target(target: &str) -> String {
    let target = target.trim().to_lowercase();
    target.strip_suffix(".exe").unwrap_or(&target).to_owned()
}

pub fn validate_patch(
    target: &str,
    value: Option<f32>,
    muted: Option<bool>,
) -> Result<(String, Option<f32>), String> {
    let target = normalize_target(target);
    if target.is_empty() {
        return Err("volume target cannot be empty".into());
    }
    if value.is_none() && muted.is_none() {
        return Err("volume update has no fields".into());
    }
    if value.is_some_and(|value| !value.is_finite()) {
        return Err("volume must be finite".into());
    }
    Ok((target, value.map(|value| value.clamp(0.0, 1.0))))
}

pub fn canonical_channels(mut channels: Vec<Channel>) -> Vec<Channel> {
    channels.retain_mut(|channel| {
        channel.target = normalize_target(&channel.target);
        !channel.target.is_empty() && channel.volume.is_finite()
    });
    for channel in &mut channels {
        channel.volume = channel.volume.clamp(0.0, 1.0);
    }
    channels.sort_by(|a, b| match (a.target == "system", b.target == "system") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.target.cmp(&b.target),
    });
    channels.dedup_by(|a, b| a.target == b.target);
    channels
}

fn channels_changed(a: &[Channel], b: &[Channel]) -> bool {
    a.len() != b.len()
        || a.iter().zip(b).any(|(a, b)| {
            a.target != b.target
                || a.muted != b.muted
                || (a.volume - b.volume).abs() > VALUE_EPSILON
        })
}

pub fn snapshot_changed(
    previous: &AudioSnapshot,
    device_id: &Option<String>,
    channels: &[Channel],
) -> bool {
    previous.device_id != *device_id || channels_changed(&previous.channels, channels)
}

pub fn representative_channels(samples: Vec<SessionSample>) -> Vec<Channel> {
    let mut representatives: BTreeMap<String, SessionSample> = BTreeMap::new();
    for sample in samples {
        let replace = representatives
            .get(&sample.target)
            .is_none_or(|current| sample.instance_id < current.instance_id);
        if replace {
            representatives.insert(sample.target.clone(), sample);
        }
    }
    representatives
        .into_iter()
        .map(|(target, sample)| Channel {
            target,
            volume: sample.volume,
            muted: sample.muted,
        })
        .collect()
}

/// The one session name a write changes: the exact target, otherwise the first name containing it in snapshot
/// order, which is the channel the frontend's `findVolumeChannel` shows. Writing to every name containing the
/// target also moved steamwebhelper with the steam slider.
pub fn write_target<'a>(targets: &[&'a str], selector: &str) -> Option<&'a str> {
    targets
        .iter()
        .copied()
        .find(|target| *target == selector)
        .or_else(|| {
            targets
                .iter()
                .copied()
                .filter(|target| target.contains(selector))
                .min()
        })
}

#[cfg(test)]
mod tests {
    use super::{
        AudioSnapshot, Channel, SessionSample, canonical_channels, normalize_target,
        representative_channels, snapshot_changed, validate_patch, write_target,
    };

    fn channel(target: &str, volume: f32, muted: bool) -> Channel {
        Channel {
            target: target.into(),
            volume,
            muted,
        }
    }

    #[test]
    fn snapshots_sort_system_first_and_deduplicate_targets() {
        let channels = canonical_channels(vec![
            channel("Spotify.exe", 0.4, false),
            channel("system", 0.8, false),
            channel("discord", 0.3, true),
            channel("spotify", 0.5, true),
        ]);
        assert_eq!(
            channels
                .iter()
                .map(|channel| channel.target.as_str())
                .collect::<Vec<_>>(),
            ["system", "discord", "spotify"]
        );
    }

    #[test]
    fn representative_session_is_selected_by_stable_instance_id() {
        let sample = |instance_id: &str, volume: f32, muted: bool| SessionSample {
            target: "chrome".into(),
            instance_id: instance_id.into(),
            volume,
            muted,
        };
        let samples = vec![
            sample("z-session", 0.9, true),
            sample("a-session", 0.4, false),
        ];
        let forward = representative_channels(samples.clone());
        assert_eq!(
            forward,
            representative_channels(samples.into_iter().rev().collect())
        );
        assert_eq!(forward[0].volume, 0.4);
    }

    #[test]
    fn device_switches_are_snapshot_changes() {
        let before = AudioSnapshot {
            revision: 1,
            device_id: Some("device-a".into()),
            channels: vec![channel("system", 0.6, false)],
        };
        assert!(snapshot_changed(
            &before,
            &Some("device-b".into()),
            &before.channels
        ));
        assert!(snapshot_changed(&before, &None, &[]));
    }

    #[test]
    fn volume_writes_prefer_the_exact_app_over_apps_whose_name_contains_it() {
        let running = ["steamwebhelper", "steam", "discord"];
        assert_eq!(write_target(&running, "steam"), Some("steam"));
        assert_eq!(
            write_target(&["steamwebhelper", "steamservice"], "steam"),
            Some("steamservice")
        );
        assert_eq!(write_target(&running, "spotify"), None);
    }

    #[test]
    fn target_and_value_validation_preserve_process_substring_compatibility() {
        assert_eq!(normalize_target("  Discord.exe "), "discord");
        assert_eq!(
            validate_patch("SYSTEM", Some(1.4), None).unwrap(),
            ("system".into(), Some(1.0))
        );
        assert_eq!(
            validate_patch("discord", Some(-0.2), None).unwrap(),
            ("discord".into(), Some(0.0))
        );
        assert!(validate_patch(" ", Some(0.5), None).is_err());
        assert!(validate_patch("system", Some(f32::NAN), None).is_err());
        assert!(validate_patch("system", None, None).is_err());
    }
}
