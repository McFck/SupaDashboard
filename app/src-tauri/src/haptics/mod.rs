//! Tablet haptics over adb: one persistent `adb shell` fed vibrate commands.
mod adb;
mod limiter;
mod service;

use serde::Deserialize;
use tauri::State;

pub use service::Haptics;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Tick,
    Tap,
    Confirm,
}

impl Kind {
    /// Pulse length: the Galaxy Tab's coin motor has no amplitude control and is barely felt below ~20 ms.
    fn millis(self, strength: Strength) -> u64 {
        let base = match self {
            Kind::Tick => 25,
            Kind::Tap => 40,
            Kind::Confirm => 70,
        };
        match strength {
            Strength::Light => base * 3 / 5,
            Strength::Medium => base,
            Strength::Strong => base * 8 / 5,
        }
    }
}

/// Scales every pulse's length, the only strength the motor has.
#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Strength {
    Light,
    #[default]
    Medium,
    Strong,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub adb_path: Option<String>,
    pub serial: Option<String>,
    #[serde(default)]
    pub strength: Strength,
}

impl Config {
    fn valid(&self) -> bool {
        self.adb_path
            .as_deref()
            .is_none_or(|path| path.len() <= 1024)
            && self.serial.as_deref().is_none_or(adb::valid_serial)
    }

    /// False when `other` needs a new shell; a strength change alone keeps the connection.
    fn same_device(&self, other: &Config) -> bool {
        self.enabled == other.enabled
            && self.adb_path == other.adb_path
            && self.serial == other.serial
    }
}

/// Applies the settings and reports whether a device is connected (false is silent when disabled).
#[tauri::command]
pub async fn haptics_configure(
    haptics: State<'_, Haptics>,
    config: Config,
) -> Result<bool, String> {
    if !config.valid() {
        return Err("Invalid haptics settings".into());
    }
    Ok(haptics.configure(config).await)
}

#[tauri::command]
pub fn haptics_pulse(haptics: State<'_, Haptics>, kind: Kind) {
    haptics.pulse(kind);
}
