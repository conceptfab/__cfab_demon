//! Windows autostart przez klucz rejestru `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
//!
//! Wcześniejszy mechanizm tworzył plik `.lnk` w Start Menu\Programs\Startup
//! przez PowerShell + WScript.Shell. Był wrażliwy na ciche błędy COM, brak
//! `WorkingDirectory`, OneDrive Known Folder Move (synchronizacja Start Menu)
//! oraz ewentualne uruchomienia dashboardu z elewacją UAC (skrót lądował
//! w innym profilu). Bezpośredni zapis do rejestru eliminuje te wektory.
//!
//! Wartość rejestru zawiera komendę uruchomieniową (ścieżka exe w cudzysłowach,
//! żeby spacje w `Program Files` nie psuły parsera).

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr;

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WOW64_64KEY, REG_OPTION_NON_VOLATILE,
    REG_SZ,
};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const VALUE_NAME: &str = "TIMEFLOW Demon";

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn open_run_key(rights: u32) -> Result<HKEY, String> {
    let path = to_wide(RUN_KEY);
    let mut hkey: HKEY = ptr::null_mut();
    let mut disposition: u32 = 0;
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            0,
            ptr::null(),
            REG_OPTION_NON_VOLATILE,
            rights | KEY_WOW64_64KEY,
            ptr::null(),
            &mut hkey,
            &mut disposition,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("RegCreateKeyExW({RUN_KEY}) failed: {status}"));
    }
    Ok(hkey)
}

/// Komenda uruchomieniowa zapisywana w rejestrze. Ścieżka jest opakowana
/// w cudzysłowy, więc spacje (np. `Program Files`) nie rozbijają argv.
pub fn build_command(exe: &Path) -> String {
    format!("\"{}\"", exe.to_string_lossy())
}

/// Zapisuje wartość pod `VALUE_NAME` z `command` jako REG_SZ.
pub fn write(command: &str) -> Result<(), String> {
    let hkey = open_run_key(KEY_SET_VALUE)?;
    let name = to_wide(VALUE_NAME);
    let data: Vec<u16> = OsStr::new(command)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let bytes = (data.len() * std::mem::size_of::<u16>()) as u32;
    let status = unsafe {
        let s = RegSetValueExW(
            hkey,
            name.as_ptr(),
            0,
            REG_SZ,
            data.as_ptr() as *const u8,
            bytes,
        );
        RegCloseKey(hkey);
        s
    };
    if status != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW({VALUE_NAME}) failed: {status}"));
    }
    Ok(())
}

/// Usuwa wartość. Brak wartości traktujemy jako sukces (idempotentne).
pub fn delete() -> Result<(), String> {
    let hkey = open_run_key(KEY_SET_VALUE)?;
    let name = to_wide(VALUE_NAME);
    let status = unsafe {
        let s = RegDeleteValueW(hkey, name.as_ptr());
        RegCloseKey(hkey);
        s
    };
    if status != ERROR_SUCCESS && status != ERROR_FILE_NOT_FOUND {
        return Err(format!("RegDeleteValueW({VALUE_NAME}) failed: {status}"));
    }
    Ok(())
}

/// Sprawdza czy `VALUE_NAME` jest ustawione w kluczu Run.
pub fn is_enabled() -> bool {
    let Ok(hkey) = open_run_key(KEY_QUERY_VALUE) else {
        return false;
    };
    let name = to_wide(VALUE_NAME);
    let mut data_type: u32 = 0;
    let mut size: u32 = 0;
    let status = unsafe {
        let s = RegQueryValueExW(
            hkey,
            name.as_ptr(),
            ptr::null_mut(),
            &mut data_type,
            ptr::null_mut(),
            &mut size,
        );
        RegCloseKey(hkey);
        s
    };
    status == ERROR_SUCCESS
}
