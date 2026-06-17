use super::helpers::timeflow_data_dir;
use std::fs;
use tauri::AppHandle;

#[cfg(windows)]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(windows)]
use windows_sys::Win32::Security::Cryptography::{
    CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const SECURE_TOKEN_FILE: &str = "sync_token.dat";
const KEYCHAIN_ACCOUNT: &str = "sync_token";

fn secure_token_path() -> Result<std::path::PathBuf, String> {
    let dir = timeflow_data_dir()?;
    Ok(dir.join(SECURE_TOKEN_FILE))
}

#[tauri::command]
pub async fn get_secure_token(_app: AppHandle) -> Result<String, String> {
    // 1. Keychain (źródło docelowe).
    if let Some(tok) = timeflow_shared::secret_store::get_secret(KEYCHAIN_ACCOUNT) {
        return Ok(tok.trim().to_string());
    }
    // 2. Migracja z legacy pliku plaintext (macOS/Linux) lub DPAPI (Windows).
    let path = secure_token_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    let raw = fs::read(&path).map_err(|e| format!("Failed to read secure token: {}", e))?;
    let legacy = decode_legacy_token(&raw)?;
    if !legacy.is_empty() {
        let _ = timeflow_shared::secret_store::set_secret(KEYCHAIN_ACCOUNT, &legacy);
        let _ = fs::remove_file(&path); // sprzątnij plaintext po migracji
    }
    Ok(legacy)
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
pub async fn set_secure_token(_app: AppHandle, token: String) -> Result<(), String> {
    let trimmed = token.trim();
    // Usuń ewentualny legacy plik niezależnie od wartości (sekret żyje w keychainie).
    if let Ok(path) = secure_token_path() {
        let _ = fs::remove_file(&path);
    }
    // Pusty string = usunięcie wpisu (obsłużone w secret_store::set_secret).
    timeflow_shared::secret_store::set_secret(KEYCHAIN_ACCOUNT, trimmed)
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
