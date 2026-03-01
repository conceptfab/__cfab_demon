use super::helpers::timeflow_data_dir;
use tauri::AppHandle;

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
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read secure token: {}", e))
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
    std::fs::write(&path, token.trim())
        .map_err(|e| format!("Failed to write secure token: {}", e))
}
