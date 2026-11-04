use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};

fn is_release(path: &str, current: &str) -> bool {
    let path = path.replace('/', "\\").to_lowercase();
    let current = current.replace('/', "\\").to_lowercase();
    path != current && !path.contains("\\target\\debug\\")
}

pub(super) fn require_release_stopped() -> Result<(), String> {
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = current
        .file_name()
        .ok_or("Unknown dev executable")?
        .to_string_lossy();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|_| "Could not check release app")?;
    let result = (|| {
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe { Process32FirstW(snapshot, &mut entry) }
            .map_err(|_| "Could not check release app")?;
        loop {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case(&name)
                && entry.th32ProcessID != std::process::id()
            {
                let path = crate::apps::identity::image_path(entry.th32ProcessID)
                    .ok_or("Could not check release executable")?;
                if is_release(&path, &current.to_string_lossy()) {
                    return Err("Close the release app first".into());
                }
            }
            if let Err(error) = unsafe { Process32NextW(snapshot, &mut entry) } {
                if error.code() == ERROR_NO_MORE_FILES.to_hresult() {
                    break;
                }
                return Err("Could not check release app".into());
            }
        }
        Ok(())
    })();
    // The snapshot is owned here; closing it cannot affect the copy result.
    let _ = unsafe { CloseHandle(snapshot) };
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_named_dev_process_does_not_block_release_copy() {
        let current = r"C:\work\target\debug\supadashboard.exe";
        assert!(!is_release(current, current));
        assert!(!is_release(
            r"D:\other\target\debug\supadashboard.exe",
            current
        ));
        assert!(is_release(
            r"C:\Apps\SupaDashboard\supadashboard.exe",
            current
        ));
        assert!(is_release(
            r"C:\work\target\release\supadashboard.exe",
            current
        ));
    }
}
