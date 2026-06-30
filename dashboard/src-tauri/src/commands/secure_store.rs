use super::helpers::timeflow_data_dir;
use crate::commands::error::CommandError;
use std::fs;
use tauri::AppHandle;

#[cfg(windows)]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(windows)]
use windows_sys::Win32::Security::Cryptography::{
    CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const SECURE_TOKEN_FILE: &str = "sync_token.dat";

fn secure_token_path() -> Result<std::path::PathBuf, String> {
    let dir = timeflow_data_dir()?;
    Ok(dir.join(SECURE_TOKEN_FILE))
}

#[tauri::command]
pub async fn get_secure_token(_app: AppHandle) -> Result<String, CommandError> {
    // Token w pliku w katalogu danych (bez keychaina). Windows: starsze pliki
    // zapisane DPAPI są nadal odczytywane przez decode_legacy_token.
    let path = secure_token_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    let raw = fs::read(&path).map_err(|e| format!("Failed to read secure token: {}", e))?;
    decode_legacy_token(&raw).map_err(CommandError::Other)
}

fn decode_legacy_token(raw: &[u8]) -> Result<String, String> {
    #[cfg(windows)]
    {
        if let Ok(token) = decrypt_token_bytes_windows(raw) {
            return Ok(token.trim().to_string());
        }
    }
    String::from_utf8(raw.to_vec())
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to decode secure token: {}", e))
}

#[tauri::command]
pub async fn set_secure_token(_app: AppHandle, token: String) -> Result<(), CommandError> {
    let trimmed = token.trim();
    let path = secure_token_path()?;
    // Pusty string = usunięcie pliku tokenu.
    if trimmed.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    fs::write(&path, trimmed.as_bytes())
        .map_err(|e| CommandError::Other(format!("Failed to write secure token: {}", e)))
}

#[cfg(windows)]
fn decrypt_token_bytes_windows(raw: &[u8]) -> Result<String, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: raw.len() as u32,
        pbData: raw.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &input,
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

    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        LocalFree(output.pbData as _);
    }
    String::from_utf8(bytes).map_err(|e| format!("Failed to decode decrypted token: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plaintext_legacy_token() {
        // On non-Windows this is a plain utf8+trim; on Windows the DPAPI decrypt
        // fails for non-blob input and falls back to the same utf8 path.
        assert_eq!(decode_legacy_token(b"  legacy-xyz\n").unwrap(), "legacy-xyz");
    }
}
