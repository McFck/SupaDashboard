//! App-wide graceful exit through Restart Manager, including apps with no visible windows.
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{ERROR_SUCCESS, FILETIME, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::RestartManager::{
    CCH_RM_SESSION_KEY, RM_UNIQUE_PROCESS, RmEndSession, RmRegisterResources, RmShutdown,
    RmStartSession,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    WaitForSingleObject,
};
use windows::core::{Owned, PWSTR};

struct Session(u32);

impl Drop for Session {
    fn drop(&mut self) {
        // Ending a session only releases bookkeeping; it does not restart or terminate apps.
        let _ = unsafe { RmEndSession(self.0) };
    }
}

pub fn quit(pids: &[u32], label: &str) -> Result<(), String> {
    let failed = || format!("Couldn't quit {label}");
    if pids.is_empty() || pids.contains(&std::process::id()) {
        return Err(failed());
    }
    let mut processes = Vec::new();
    let mut applications = Vec::new();
    for &pid in pids {
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        }
        .map_err(|_| failed())?;
        let process = unsafe { Owned::new(process) };
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe { GetProcessTimes(*process, &mut created, &mut exited, &mut kernel, &mut user) }
            .map_err(|_| failed())?;
        // The start time prevents a recycled PID from targeting a different process.
        applications.push(RM_UNIQUE_PROCESS {
            dwProcessId: pid,
            ProcessStartTime: created,
        });
        processes.push(process);
    }
    let mut handle = 0;
    let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
    if unsafe { RmStartSession(&mut handle, None, PWSTR(key.as_mut_ptr())) } != ERROR_SUCCESS {
        return Err(failed());
    }
    let session = Session(handle);
    if unsafe { RmRegisterResources(session.0, None, Some(&applications), None) } != ERROR_SUCCESS {
        return Err(failed());
    }
    // Zero flags allows refusal and never enables RmForceShutdown or a terminate fallback.
    let shutdown = unsafe { RmShutdown(session.0, 0, None) };
    // A partial shutdown error can precede successful cleanup. Observe actual exits with one shared grace period.
    let deadline = Instant::now() + Duration::from_secs(30);
    for process in &processes {
        let remaining = u32::try_from(
            deadline
                .saturating_duration_since(Instant::now())
                .as_millis(),
        )
        .map_err(|_| failed())?;
        match unsafe { WaitForSingleObject(**process, remaining) } {
            WAIT_OBJECT_0 => {}
            WAIT_TIMEOUT => {
                log::warn!("Quit {label} timed out; Restart Manager returned {shutdown:?}");
                return Err(format!("{label} is still running"));
            }
            _ => return Err(failed()),
        }
    }
    Ok(())
}
