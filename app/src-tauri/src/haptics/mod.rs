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
    fn millis(self) -> u64 {
        match self {
            Kind::Tick => 8,
            Kind::Tap => 15,
            Kind::Confirm => 30,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub adb_path: Option<String>,
    pub serial: Option<String>,
}

impl Config {
    fn valid(&self) -> bool {
        self.adb_path
            .as_deref()
            .is_none_or(|path| path.len() <= 1024)
            && self.serial.as_deref().is_none_or(adb::valid_serial)
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
    haptics.pulse(kind.millis());
}
