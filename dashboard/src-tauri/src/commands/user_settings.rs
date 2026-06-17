//! Wspólny magazyn ustawień UI (jeden plik `user_settings.json` w katalogu
//! danych). Desktop i web UI współdzielą ten sam katalog danych, więc plik jest
//! jedynym źródłem prawdy dla ustawień użytkownika — eliminuje rozjazd między
//! localStorage przeglądarki a webview pulpitu.

use crate::commands::helpers::timeflow_data_dir;
use serde_json::{Map, Value};

const SETTINGS_FILE: &str = "user_settings.json";

fn read_object(base: &std::path::Path) -> Map<String, Value> {
    match std::fs::read_to_string(base.join(SETTINGS_FILE)) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

/// Cały magazyn ustawień jako obiekt JSON klucz→wartość (pusty obiekt, gdy plik
/// nie istnieje). Frontend hydratuje z tego swój lokalny cache przy starcie.
#[tauri::command]
pub async fn get_all_user_settings() -> Result<Value, String> {
    let base = timeflow_data_dir()?;
    Ok(Value::Object(read_object(&base)))
}

/// Czy bieżący proces backendu działa w trybie headless (`--headless`).
/// Front używa tego, by rozróżnić okno pulpitu (autorytatywne przy zasiewaniu
/// wspólnego store'u) od instancji headless i przeglądarki (tylko konsumują) —
/// inaczej headless zasiałby wartości domyślne i nadpisał konfigurację pulpitu.
#[tauri::command]
pub fn webui_is_headless_process() -> bool {
    std::env::args().any(|a| a == "--headless")
}

/// Zapis pojedynczego ustawienia (read-modify-write na jednym pliku). `value`
/// to dowolny JSON — klient trzyma własny kształt pod swoim kluczem.
#[tauri::command]
pub async fn set_user_setting(key: String, value: Value) -> Result<(), String> {
    let base = timeflow_data_dir()?;
    let mut obj = read_object(&base);
    obj.insert(key, value);
    let serialized = serde_json::to_string(&Value::Object(obj))
        .map_err(|e| format!("serialize user_settings: {e}"))?;
    std::fs::write(base.join(SETTINGS_FILE), serialized)
        .map_err(|e| format!("write user_settings.json: {e}"))
}
