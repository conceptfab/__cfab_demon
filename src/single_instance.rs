// Single instance lock via Windows Named Mutex

use std::ptr;
use winapi::um::synchapi::CreateMutexW;
use winapi::um::errhandlingapi::GetLastError;
use winapi::um::handleapi::CloseHandle;
use winapi::um::winnt::HANDLE;
use winapi::shared::winerror::ERROR_ALREADY_EXISTS;

const MUTEX_NAME: &str = "Global\\TimeFlowDemon_SingleInstance";

/// RAII guard — mutex is released on drop
pub struct SingleInstanceGuard {
    handle: HANDLE,
}

// SAFETY: Windows mutex handle (HANDLE) is a plain pointer that is safe to move
// between threads. We intentionally do NOT implement Sync because the handle
// should not be shared across threads concurrently.
unsafe impl Send for SingleInstanceGuard {}

impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

/// Attempts to acquire the mutex. Returns `Ok(guard)` if this is the only instance,
/// `Err(msg)` if another instance is already running.
pub fn try_acquire() -> Result<SingleInstanceGuard, String> {
    let wide_name: Vec<u16> = MUTEX_NAME.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let handle = CreateMutexW(ptr::null_mut(), 1, wide_name.as_ptr());

        if handle.is_null() {
            return Err(format!(
                "Failed to create mutex (error {})",
                GetLastError()
            ));
        }

        // SAFETY: GetLastError() is safe here — no WinAPI function
        // is called between CreateMutexW and this check,
        // so the last error code has not been overwritten.
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return Err("Another instance of TimeFlow Demon is already running.".into());
        }

        Ok(SingleInstanceGuard { handle })
    }
}

