use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::manifest::valid_id;
use super::permissions::Permissions;
use super::secure::replace;

const VERSION: u32 = 1;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Approvals {
    version: u32,
    approved: BTreeMap<String, Permissions>,
}

fn path(root: &Path) -> PathBuf {
    root.join("plugin-permissions.json")
}

impl Approvals {
    pub(super) fn load(
        root: &Path,
        legacy: impl FnOnce() -> BTreeMap<String, Permissions>,
    ) -> Result<Self, String> {
        match fs::read(path(root)) {
            Ok(bytes) => {
                let store: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if store.version != VERSION || !store.approved.keys().all(|id| valid_id(id)) {
                    return Err("Invalid plugin permission store".into());
                }
                for permissions in store.approved.values() {
                    permissions.validate()?;
                }
                Ok(store)
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let store = Self {
                    version: VERSION,
                    approved: legacy(),
                };
                store.save(root)?;
                Ok(store)
            }
            Err(error) => Err(error.to_string()),
        }
    }

    pub(super) fn get(&self, id: &str) -> Option<&Permissions> {
        self.approved.get(id)
    }

    pub(super) fn approve(
        &mut self,
        root: &Path,
        id: &str,
        permissions: &Permissions,
    ) -> Result<(), String> {
        let mut next = Self {
            version: VERSION,
            approved: self.approved.clone(),
        };
        next.approved.insert(id.to_owned(), permissions.clone());
        next.save(root)?;
        *self = next;
        Ok(())
    }

    fn save(&self, root: &Path) -> Result<(), String> {
        let save = || -> Result<(), Box<dyn std::error::Error>> {
            let bytes = serde_json::to_vec(self)?;
            fs::create_dir_all(root)?;
            let temp = root.join(".plugin-permissions.tmp");
            let mut file = fs::File::create(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            replace(&temp, &path(root))?;
            Ok(())
        };
        save().map_err(|error| format!("Could not save plugin permissions: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::archive::tests::temp;

    #[test]
    fn legacy_permissions_are_captured_once_and_an_unreadable_store_is_preserved() {
        let root = temp("plugin-permissions");
        let legacy = || {
            BTreeMap::from([(
                "spike".into(),
                Permissions {
                    displays: true,
                    ..Default::default()
                },
            )])
        };
        Approvals::load(&root, legacy).unwrap();
        let store = Approvals::load(&root, || panic!("already migrated")).unwrap();
        assert_eq!(store.get("spike"), legacy().get("spike"));
        for bytes in [b"broken".as_slice(), br#"{"version":2,"approved":{}}"#] {
            fs::write(path(&root), bytes).unwrap();
            assert!(Approvals::load(&root, legacy).is_err());
            assert_eq!(fs::read(path(&root)).unwrap(), bytes);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
