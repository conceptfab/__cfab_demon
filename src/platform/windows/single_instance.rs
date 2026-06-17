// Single instance lock via Windows Named Mutex.

use std::ptr;
use winapi::shared::winerror::ERROR_ALREADY_EXISTS;
use winapi::um::errhandlingapi::GetLastError;
use winapi::um::handleapi::CloseHandle;
use winapi::um::synchapi::CreateMutexW;
use winapi::um::winnt::HANDLE;

const MUTEX_NAME: &str = "Global\\TimeFlowDemon_SingleInstance";

/// RAII guard — mutex is released on drop.
pub struct SingleInstanceGuard {
    handle: HANDLE,
}

unsafe impl Send for SingleInstanceGuard {}

impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

pub fn try_acquire() -> Result<SingleInstanceGuard, String> {
    let wide_name: Vec<u16> = MUTEX_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let handle = CreateMutexW(ptr::null_mut(), 1, wide_name.as_ptr());

        if handle.is_null() {
            return Err(format!("Failed to create mutex (error {})", GetLastError()));
        }

        if GetLastError() == ERROR_ALREADY_EXISTS {
            CloseHandle(handle);
            return Err(crate::i18n::load_language()
                .t(crate::i18n::TrayText::AlreadyRunning)
                .to_string());
        }

        Ok(SingleInstanceGuard { handle })
    }
}
