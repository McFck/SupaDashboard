use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "supadashboard-copy-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }

    fn dir(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir(&path).unwrap();
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn backup_stays_inside_release() {
    let release = Path::new(r"C:\temp\release");
    assert_eq!(
        backup_dir(release, "20261104120300").unwrap(),
        release.join("backups/20261104120300")
    );
    for stamp in ["", "../escape", "C:\\escape", "12/34"] {
        assert!(backup_dir(release, stamp).is_err());
    }
}

#[test]
fn seed_copies_release_without_writing_it_or_overwriting_existing_dev_data() {
    let fixture = Fixture::new();
    let release = fixture.dir("release");
    let dev = fixture.0.join("dev");
    fs::write(
        release.join("settings.json"),
        r#"{"settings":{"version":8}}"#,
    )
    .unwrap();
    fs::write(release.join("window-state.json"), "private release state").unwrap();
    seed(&release, &dev).unwrap();
    assert_eq!(
        fs::read(dev.join("settings.json")).unwrap(),
        fs::read(release.join("settings.json")).unwrap()
    );
    assert!(!dev.join("window-state.json").exists());
    fs::write(dev.join("settings.json"), "dev edits").unwrap();
    seed(&release, &dev).unwrap();
    assert_eq!(
        fs::read_to_string(dev.join("settings.json")).unwrap(),
        "dev edits"
    );
    assert_eq!(fs::read_dir(release).unwrap().count(), 2);
}

#[test]
fn export_backs_up_release_and_replaces_only_the_dev_data_set() {
    let fixture = Fixture::new();
    let dev = fixture.dir("dev");
    let release = fixture.dir("release");
    for name in ["settings.json", "variables.json", "plugins.json"] {
        fs::write(dev.join(name), r#"{"dev":true}"#).unwrap();
        fs::write(release.join(name), r#"{"release":true}"#).unwrap();
    }
    fs::create_dir(dev.join("icons")).unwrap();
    fs::write(dev.join("icons/new.png"), "new icon").unwrap();
    fs::create_dir(release.join("icons")).unwrap();
    fs::write(release.join("icons/old.png"), "old icon").unwrap();
    fs::write(release.join("window-state.json"), "release placement").unwrap();
    fs::write(dev.join("window-state.json"), "dev placement").unwrap();
    export(&dev, &release, "123", || Ok(())).unwrap();
    assert_eq!(
        fs::read_to_string(release.join("settings.json")).unwrap(),
        r#"{"dev":true}"#
    );
    assert_eq!(
        fs::read_to_string(release.join("backups/123/settings.json")).unwrap(),
        r#"{"release":true}"#
    );
    assert!(release.join("backups/123/icons/old.png").is_file());
    assert!(!release.join("icons/old.png").exists());
    assert!(release.join("icons/new.png").is_file());
    assert_eq!(
        fs::read_to_string(release.join("window-state.json")).unwrap(),
        "release placement"
    );
    export(&dev, &release, "124", || Ok(())).unwrap();
    assert!(release.join("backups/123/settings.json").is_file());
    assert!(!release.join("backups/124/window-state.json").exists());
}

#[test]
fn invalid_dev_data_or_a_running_release_never_changes_release() {
    let fixture = Fixture::new();
    let dev = fixture.dir("dev");
    let release = fixture.dir("release");
    fs::write(release.join("settings.json"), "original").unwrap();
    fs::write(dev.join("settings.json"), "broken").unwrap();
    assert!(export(&dev, &release, "123", || Ok(())).is_err());
    fs::write(dev.join("settings.json"), "{}").unwrap();
    assert!(export(&dev, &release, "124", || Err("running".into())).is_err());
    assert_eq!(
        fs::read_to_string(release.join("settings.json")).unwrap(),
        "original"
    );
    assert_eq!(fs::read_dir(release).unwrap().count(), 1);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn export_ignores_locked_webview_files_and_keeps_other_release_data() {
    use std::os::windows::fs::OpenOptionsExt;
    let fixture = Fixture::new();
    let dev = fixture.dir("dev");
    let release = fixture.dir("release");
    fs::write(dev.join("settings.json"), "{}").unwrap();
    fs::write(dev.join("discord.json"), r#"{"token":"dev"}"#).unwrap();
    fs::create_dir(dev.join("EBWebView")).unwrap();
    let locked = dev.join("EBWebView/Cookies");
    let _lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0)
        .open(&locked)
        .unwrap();
    fs::create_dir(release.join("lyrics")).unwrap();
    fs::write(release.join("lyrics/a.json"), "old").unwrap();
    export(&dev, &release, "125", || Ok(())).unwrap();
    assert!(release.join("discord.json").is_file());
    assert!(!release.join("EBWebView").exists());
    assert!(!release.join("lyrics").exists());
    assert!(release.join("backups/125/lyrics/a.json").is_file());
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
}

#[test]
fn first_start_seeds_an_empty_dev_directory_but_preserves_release() {
    let fixture = Fixture::new();
    let release = fixture.dir("release");
    let dev = fixture.dir("dev");
    fs::write(release.join("settings.json"), "{}").unwrap();
    seed(&release, &dev).unwrap();
    assert_eq!(fs::read(dev.join("settings.json")).unwrap(), b"{}");
    assert_eq!(fs::read(release.join("settings.json")).unwrap(), b"{}");
}
