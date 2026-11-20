use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::secure::replace;

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct PluginState {
    #[serde(default)]
    installed: BTreeMap<String, String>,
    #[serde(default)]
    uninstalled: BTreeSet<String>,
}

#[derive(Deserialize, Serialize)]
struct Store {
    #[serde(rename = "plugin-store", default)]
    state: PluginState,
}

impl PluginState {
    pub fn load(root: &Path) -> Result<Self, String> {
        match fs::read(root.join("plugins.json")) {
            Ok(bytes) => serde_json::from_slice::<Store>(&bytes)
                .map(|store| store.state)
                .map_err(|error| format!("Could not read plugin state: {error}")),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(format!("Could not read plugin state: {error}")),
        }
    }

    pub fn enabled(&self, id: &str) -> bool {
        !self.uninstalled.contains(id)
    }

    pub fn record_install(&mut self, id: &str, fresh: bool) -> Result<(), String> {
        let date = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .map_err(|error| error.to_string())?;
        self.installed.insert(id.to_owned(), date);
        if fresh {
            self.set_enabled(id, true);
        }
        Ok(())
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        if enabled {
            self.uninstalled.remove(id);
        } else {
            self.uninstalled.insert(id.to_owned());
        }
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let save = || -> Result<(), Box<dyn std::error::Error>> {
            fs::create_dir_all(root)?;
            let temp = root.join(".plugins.tmp");
            let bytes = serde_json::to_vec(&Store {
                state: self.clone(),
            })?;
            let mut file = fs::File::create(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            replace(&temp, &root.join("plugins.json"))?;
            Ok(())
        };
        save().map_err(|error| format!("Could not save plugin state: {error}"))
    }
}
