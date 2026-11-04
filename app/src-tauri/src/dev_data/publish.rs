use std::io;
use std::path::Path;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{
    CommitTransaction, CreateTransaction, MOVE_FILE_FLAGS, MoveFileTransactedW,
};
use windows::core::{HSTRING, PCWSTR};

// Both directory renames commit together: even a crash cannot expose half a data set.
// Unsupported volumes fail closed rather than falling back to a non-atomic copy.
pub(super) fn publish(
    stage: &Path,
    release: &Path,
    old: &Path,
    had_release: bool,
) -> io::Result<()> {
    let transaction = unsafe {
        CreateTransaction(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            PCWSTR::null(),
        )
    }
    .map_err(io::Error::other)?;
    let result = (|| {
        if had_release {
            unsafe {
                MoveFileTransactedW(
                    &HSTRING::from(release),
                    &HSTRING::from(old),
                    None,
                    None,
                    MOVE_FILE_FLAGS(0),
                    transaction,
                )
            }
            .map_err(io::Error::other)?;
        }
        unsafe {
            MoveFileTransactedW(
                &HSTRING::from(stage),
                &HSTRING::from(release),
                None,
                None,
                MOVE_FILE_FLAGS(0),
                transaction,
            )
        }
        .map_err(io::Error::other)?;
        unsafe { CommitTransaction(transaction) }.map_err(io::Error::other)
    })();
    // Closing the last handle rolls back any uncommitted transaction.
    let _ = unsafe { CloseHandle(transaction) };
    result
}
