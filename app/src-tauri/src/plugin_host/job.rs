//! A Windows job object that kills every plugin process when the app exits, even when it crashes.
use std::ffi::c_void;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectExtendedLimitInformation, SetInformationJobObject,
};
use windows::core::PCWSTR;

/// Never closed: the handle closes when the app process ends, which is what kills the plugins.
pub struct Job(HANDLE);

// SAFETY: a job handle may be used from any thread.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub fn new() -> windows::core::Result<Self> {
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // Silent breakaway keeps what a plugin starts itself (the adb server daemon) out of the job, so quitting
        // the app does not kill a tool the user shares with other programs.
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        // SAFETY: `info` outlives the call and the size matches the information class.
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null())?;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&raw const info).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
            Ok(Self(job))
        }
    }

    pub fn assign(&self, process: HANDLE) -> windows::core::Result<()> {
        // SAFETY: both handles are open; the caller owns the process handle for the call.
        unsafe { AssignProcessToJobObject(self.0, process) }
    }
}
