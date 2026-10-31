//! The app picker's rows: what is running, then what the Start menu offers.
use super::identity::{Names, image_path, installed, package_aumid};
use super::model::slug;
use super::windows::Scan;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize)]
pub struct AppRow {
    pub key: String,
    pub label: String,
    pub slug: String,
    pub detail: String,
    pub running: bool,
}

pub fn list() -> Result<Vec<AppRow>, String> {
    let mut names = Names::default();
    let pids: HashSet<u32> = Scan::new(&mut names)
        .visible_windows()
        .iter()
        .map(|win| win.pid)
        .collect();
    let mut running_names = HashSet::new();
    let mut running_aumids = HashSet::new();
    let mut loose = Vec::new();
    for pid in pids {
        if let Some(aumid) = package_aumid(pid) {
            running_aumids.insert(aumid.to_lowercase());
        } else if let (Some(name), Some(path)) =
            (names.name(pid).map(str::to_owned), image_path(pid))
        {
            running_names.insert(name.clone());
            loose.push((name, path));
        }
    }
    let start_menu = installed()?;
    let known: HashSet<String> = start_menu
        .iter()
        .filter_map(|app| app.exe.clone())
        .collect();
    let mut rows: Vec<AppRow> = start_menu
        .into_iter()
        .map(|app| AppRow {
            running: running_aumids.contains(&app.aumid.to_lowercase())
                || app
                    .exe
                    .as_ref()
                    .is_some_and(|exe| running_names.contains(exe)),
            detail: String::new(),
            key: app.key,
            label: app.label,
            slug: app.slug,
        })
        .collect();
    // A running desktop app the Start menu does not know is offered by its file.
    for (name, path) in loose {
        if !known.contains(&name) {
            rows.push(AppRow {
                key: format!("exe:{path}"),
                slug: slug(&name),
                label: name,
                detail: path,
                running: true,
            });
        }
    }
    rows.sort_by(|a, b| {
        b.running
            .cmp(&a.running)
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    Ok(rows)
}
