//! `process`: programs the plugin declared by file name (`adb.exe`), found on PATH or at an absolute path after
//! `%VAR%` expansion. They run without a console window inside the app's job, so they die with the app, and a spawned
//! one dies with the page that started it. `onPowerOff` arms one command per plugin for `power.rs`.
use std::path::{Component, Path, PathBuf, Prefix};
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, Webview};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::task::AbortHandle;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

use super::Caps;
use crate::plugin_host::PluginHost;
use crate::plugin_host::job::Job;
use crate::plugin_host::permissions::Permissions;
use crate::plugin_host::power;

const MAX_STDOUT: usize = 1024 * 1024;

static JOB: LazyLock<Option<Job>> = LazyLock::new(|| {
    Job::new()
        .inspect_err(|error| log::warn!("Plugin processes have no job: {error}"))
        .ok()
});

pub struct Spawned {
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    /// Owns the child; aborting it drops the child, which kills it.
    task: AbortHandle,
}

impl Drop for Spawned {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// A checked program and its arguments.
#[derive(Clone)]
pub struct Armed {
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[derive(Serialize)]
pub struct Output {
    code: Option<i32>,
    stdout: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProcessEvent {
    /// One line of standard output, without its line break.
    Stdout {
        text: String,
    },
    Exited {
        code: Option<i32>,
    },
}

/// `%NAME%` replaced by the environment variable; an unknown one is an error.
fn expand(text: &str) -> Result<String, String> {
    let parts: Vec<&str> = text.split('%').collect();
    if parts.len().is_multiple_of(2) {
        return Err("Invalid program path".into());
    }
    parts
        .iter()
        .enumerate()
        .map(|(index, part)| match index % 2 {
            0 => Ok((*part).to_owned()),
            _ => std::env::var(part).map_err(|_| "Invalid program path".to_owned()),
        })
        .collect()
}

/// The program and arguments if the plugin may run them: a declared file name, bare (found on PATH) or a plain
/// absolute `X:\...` path without `..`.
fn check(permissions: &Permissions, program: &str, args: Vec<String>) -> Result<Armed, String> {
    let expanded = expand(program)?;
    let path = Path::new(&expanded);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or("Invalid program path")?;
    if !permissions.process.contains(&name) {
        return Err("This program is not allowed".into());
    }
    let mut components = path.components();
    let bare = path.components().count() == 1 && !expanded.contains(['/', '\\', ':']);
    let absolute = matches!(components.next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_)))
        && matches!(components.next(), Some(Component::RootDir))
        && components.all(|part| matches!(part, Component::Normal(_)));
    if !bare && !absolute {
        return Err("Invalid program path".into());
    }
    if args.len() > 64
        || args
            .iter()
            .any(|arg| arg.len() > 4096 || arg.contains('\0'))
    {
        return Err("Invalid program arguments".into());
    }
    Ok(Armed {
        program: path.to_path_buf(),
        args,
    })
}

fn checked(
    host: &PluginHost,
    plugin: &str,
    program: &str,
    args: Vec<String>,
) -> Result<Armed, String> {
    check(&host.installed(plugin)?.manifest.permissions, program, args)
}

/// Starts the program without a window in the app's job; dropping the child kills it.
fn start(armed: &Armed, stdin: Stdio) -> Result<Child, String> {
    let child = Command::new(&armed.program)
        .args(&armed.args)
        .stdin(stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW.0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Could not start the program")?;
    if let (Some(job), Some(process)) = (JOB.as_ref(), child.raw_handle())
        && let Err(error) = job.assign(HANDLE(process))
    {
        log::warn!("A plugin process is outside the job: {error}");
    }
    Ok(child)
}

/// Runs to the end, at most `timeout_ms` (<= 10 s) with at most 1 MiB of output; a longer run is killed.
#[tauri::command]
pub async fn plugin_process_run(
    host: State<'_, PluginHost>,
    plugin: String,
    program: String,
    args: Vec<String>,
    timeout_ms: u64,
) -> Result<Output, String> {
    let armed = checked(&host, &plugin, &program, args)?;
    if timeout_ms > 10_000 {
        return Err("Invalid timeout".into());
    }
    let mut child = start(&armed, Stdio::null())?;
    let mut stdout = child.stdout.take().ok_or("Could not start the program")?;
    let finished = async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(MAX_STDOUT as u64 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "Could not read the program's output")?;
        if bytes.len() > MAX_STDOUT {
            return Err("The program's output is too large".to_owned());
        }
        let status = child.wait().await.map_err(|_| "The program failed")?;
        Ok(Output {
            code: status.code(),
            stdout: String::from_utf8_lossy(&bytes).into_owned(),
        })
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), finished)
        .await
        .map_err(|_| "The program timed out".to_owned())?
}

/// Starts the program in the background; it is killed by `kill`, or when its page goes or the plugin is removed.
fn spawn(
    caps: &Caps,
    plugin: &str,
    label: &str,
    armed: &Armed,
    events: Channel<ProcessEvent>,
) -> Result<u32, String> {
    let mut child = start(armed, Stdio::piped())?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err("Could not start the program".into());
    };
    let handle = caps.handle();
    let task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout);
        let mut line = Vec::new();
        while lines
            .read_until(b'\n', &mut line)
            .await
            .is_ok_and(|read| read > 0)
        {
            let text = String::from_utf8_lossy(&line)
                .trim_end_matches(['\r', '\n'])
                .to_owned();
            let _ = events.send(ProcessEvent::Stdout { text });
            line.clear();
        }
        let code = child.wait().await.ok().and_then(|status| status.code());
        let _ = events.send(ProcessEvent::Exited { code });
    });
    let spawned = Spawned {
        stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
        task: task.inner().abort_handle(),
    };
    caps.with(plugin, label, |owned| {
        // Programs that ended on their own go here, so a plugin that restarts one does not pile them up.
        owned
            .processes
            .retain(|_, spawned| !spawned.task.is_finished());
        owned.processes.insert(handle, spawned);
    });
    Ok(handle)
}

#[tauri::command]
pub async fn plugin_process_spawn(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    program: String,
    args: Vec<String>,
    events: Channel<ProcessEvent>,
) -> Result<u32, String> {
    let _changing = host.changing.lock().await;
    let armed = checked(&host, &plugin, &program, args)?;
    spawn(&host.caps, &plugin, webview.label(), &armed, events)
}

#[tauri::command]
pub async fn plugin_process_write(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    handle: u32,
    text: String,
) -> Result<(), String> {
    let stdin = host
        .caps
        .with(&plugin, webview.label(), |owned| {
            owned
                .processes
                .get(&handle)
                .map(|spawned| spawned.stdin.clone())
        })
        .ok_or("The program has ended")?;
    let mut stdin = stdin.lock().await;
    stdin
        .write_all(text.as_bytes())
        .await
        .and(stdin.flush().await)
        .map_err(|_| "The program has ended".into())
}

/// Kills the program; no `exited` event follows.
#[tauri::command]
pub fn plugin_process_kill(
    webview: Webview,
    host: State<'_, PluginHost>,
    plugin: String,
    handle: u32,
) {
    let spawned = host.caps.with(&plugin, webview.label(), |owned| {
        owned.processes.remove(&handle)
    });
    drop(spawned);
}

/// Arms (or with `args: null` disarms) the plugin's command for when the PC sleeps or shuts down, replacing one armed
/// from another of its pages.
#[tauri::command]
pub async fn plugin_process_on_power_off(
    app: AppHandle,
    webview: Webview,
    plugin: String,
    program: String,
    args: Option<Vec<String>>,
) -> Result<(), String> {
    let host = app.state::<PluginHost>();
    let _changing = host.changing.lock().await;
    let armed = args
        .map(|args| checked(&host, &plugin, &program, args))
        .transpose()?;
    if armed.is_some() {
        power::watch(&app)?;
    }
    host.caps.set_power_off(&plugin, webview.label(), armed);
    Ok(())
}

impl Caps {
    fn set_power_off(&self, plugin: &str, label: &str, armed: Option<Armed>) {
        let mut owners = self.lock();
        for ((owner, _), owned) in owners.iter_mut() {
            if owner == plugin {
                owned.power_off = None;
            }
        }
        if let Some(armed) = armed {
            owners
                .entry((plugin.to_owned(), label.to_owned()))
                .or_default()
                .power_off = Some(armed);
        }
    }

    /// Every armed power-off command.
    pub fn power_off(&self) -> Vec<Armed> {
        self.lock()
            .values()
            .filter_map(|owned| owned.power_off.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
    };

    fn permissions() -> Permissions {
        serde_json::from_str(r#"{"process":["adb.exe","ping.exe"]}"#).unwrap()
    }

    #[test]
    fn only_declared_programs_run_bare_or_from_a_plain_absolute_path() {
        let permissions = permissions();
        let allowed =
            |program: &str| check(&permissions, program, vec![]).map(|armed| armed.program);
        assert_eq!(allowed("adb.exe"), Ok(PathBuf::from("adb.exe")));
        assert_eq!(allowed("ADB.EXE"), Ok(PathBuf::from("ADB.EXE")));
        let windows = std::env::var("SystemRoot").unwrap();
        assert_eq!(
            allowed(r"%SystemRoot%\System32\adb.exe"),
            Ok(PathBuf::from(format!(r"{windows}\System32\adb.exe")))
        );
        assert!(allowed(r"C:\Android\platform-tools\adb.exe").is_ok());
        for refused in [
            "cmd.exe",
            "adb",
            "adb.exe.bat",
            r"tools\adb.exe",
            r"C:adb.exe",
            r"C:\x\..\adb.exe",
            r"\\server\share\adb.exe",
            r"\\?\C:\adb.exe",
            r"%NO_SUCH_VARIABLE_X%\adb.exe",
            r"%SystemRoot\adb.exe",
            r"C:\x\adb.exe\..\cmd.exe",
        ] {
            assert!(allowed(refused).is_err(), "{refused}");
        }
        assert!(check(&permissions, "adb.exe", vec!["a\0b".into()]).is_err());
        assert!(check(&permissions, "adb.exe", vec![String::new(); 65]).is_err());
    }

    /// Ids of running `ping.exe` processes.
    fn pings() -> Vec<u32> {
        let output = std::process::Command::new("tasklist")
            .args(["/fi", "imagename eq ping.exe", "/fo", "csv", "/nh"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.split(',').nth(1)?.trim_matches('"').parse().ok())
            .collect()
    }

    #[test]
    fn a_spawned_program_is_killed_when_its_page_goes() {
        let caps = Caps::default();
        let args = ["-n", "30", "127.0.0.1"].map(String::from).to_vec();
        let armed = check(&permissions(), "ping.exe", args).unwrap();
        let before = pings();
        tauri::async_runtime::block_on(async {
            spawn(&caps, "a", "main", &armed, Channel::new(|_| Ok(()))).unwrap();
        });
        let started: Vec<u32> = pings()
            .into_iter()
            .filter(|pid| !before.contains(pid))
            .collect();
        assert_eq!(started.len(), 1);
        caps.release(|_, label| label == "main");
        // SAFETY: the handle is closed after the wait.
        let ended = unsafe {
            let process = OpenProcess(PROCESS_SYNCHRONIZE, false, started[0]).unwrap();
            let ended = WaitForSingleObject(process, 5000) == WAIT_OBJECT_0;
            let _ = CloseHandle(process);
            ended
        };
        assert!(ended, "the released process still runs");
    }
}
