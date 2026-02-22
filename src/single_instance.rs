// Blokada pojedynczej instancji za pomocą Windows Named Mutex

use std::ptr;
use winapi::um::synchapi::CreateMutexW;
use winapi::um::errhandlingapi::GetLastError;
use winapi::um::handleapi::CloseHandle;
use winapi::um::winnt::HANDLE;
use winapi::shared::winerror::ERROR_ALREADY_EXISTS;

const MUTEX_NAME: &str = "Global\\TimeFlowDemon_SingleInstance";

/// RAII guard — mutex jest zwolniony przy dropie
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

/// Próbuje zająć mutex. Zwraca `Ok(guard)` jeśli to jedyna instancja,
/// `Err(msg)` jeśli inna instancja już działa.
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

        // SAFETY: GetLastError() jest bezpieczne tutaj — żadna funkcja WinAPI
        // nie jest wywoływana między CreateMutexW a tym sprawdzeniem,
        // więc last error code nie został nadpisany.
        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return Err("Inna instancja TimeFlow Demon już działa.".into());
        }

        Ok(SingleInstanceGuard { handle })
    }
}

