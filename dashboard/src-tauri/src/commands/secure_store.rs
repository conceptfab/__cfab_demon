use super::helpers::timeflow_data_dir;
use tauri::AppHandle;
use std::fs;

#[cfg(windows)]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
};
#[cfg(windows)]
use windows_sys::Win32::Foundation::LocalFree;

const SECURE_TOKEN_FILE: &str = "sync_token.dat";

fn secure_token_path() -> Result<std::path::PathBuf, String> {
    let dir = timeflow_data_dir()?;
    Ok(dir.join(SECURE_TOKEN_FILE))
}

#[tauri::command]
pub async fn get_secure_token(_app: AppHandle) -> Result<String, String> {
    let path = secure_token_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    let raw = fs::read(&path).map_err(|e| format!("Failed to read secure token: {}", e))?;

    #[cfg(windows)]
    {
        match decrypt_token_bytes_windows(&raw) {
            Ok(token) => Ok(token.trim().to_string()),
            Err(_) => String::from_utf8(raw)
                .map(|s| s.trim().to_string())
                .map_err(|e| format!("Failed to decode secure token: {}", e)),
        }
    }

    #[cfg(not(windows))]
    {
        String::from_utf8(raw)
            .map(|s| s.trim().to_string())
            .map_err(|e| format!("Failed to decode secure token: {}", e))
    }
}

#[tauri::command]
pub async fn set_secure_token(_app: AppHandle, token: String) -> Result<(), String> {
    let path = secure_token_path()?;
    if token.trim().is_empty() {
        // Remove token file if clearing
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove secure token: {}", e))?;
        }
        return Ok(());
    }
    let trimmed = token.trim();

    #[cfg(windows)]
    {
        let encrypted = encrypt_token_bytes_windows(trimmed)?;
        fs::write(&path, encrypted)
            .map_err(|e| format!("Failed to write secure token: {}", e))
    }

    #[cfg(not(windows))]
    {
        fs::write(&path, trimmed.as_bytes())
            .map_err(|e| format!("Failed to write secure token: {}", e))
    }
}

#[cfg(windows)]
fn encrypt_token_bytes_windows(token: &str) -> Result<Vec<u8>, String> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: token.len() as u32,
        pbData: token.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let description: Vec<u16> = "TIMEFLOW Sync Token"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            description.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "Failed to encrypt secure token: {}",
            std::io::Error::last_os_error()
        ));
    }

    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(bytes)
}

#[cfg(windows)]
fn decrypt_token_bytes_windows(raw: &[u8]) -> Result<String, String> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: raw.len() as u32,
        pbData: raw.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "Failed to decrypt secure token: {}",
            std::io::Error::last_os_error()
        ));
    }

    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as _);
    }
    String::from_utf8(bytes).map_err(|e| format!("Failed to decode decrypted token: {}", e))
}
