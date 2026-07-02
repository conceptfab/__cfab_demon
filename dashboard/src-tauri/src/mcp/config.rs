use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Konfiguracja serwera MCP. Token jest przechowywany JAWNIE w pliku
/// mcp_settings.json (katalog danych użytkownika) — świadomie, jak sekret LAN:
/// użytkownik musi móc go odczytać, by skonfigurować klienta (Claude Code/Codex).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct McpConfig {
    pub enabled: bool,
    /// false (domyślnie) = agenci widzą tylko narzędzia odczytu.
    /// true = również narzędzia zapisujące (create/update/assign).
    pub read_write: bool,
    /// Token Bearer wymagany na KAŻDYM żądaniu /mcp (również loopback).
    pub token: String,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            read_write: false,
            token: String::new(),
        }
    }
}

impl McpConfig {
    pub fn from_json_str(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// Generuje token, jeśli pusty. Zwraca true, gdy config się zmienił.
    pub fn ensure_token(&mut self, mint: impl FnOnce() -> String) -> bool {
        if self.token.is_empty() {
            self.token = mint();
            true
        } else {
            false
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_path_in(
        &crate::commands::helpers::timeflow_data_dir()?,
    ))
}

fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("mcp_settings.json")
}

fn load_from_path(path: &Path) -> McpConfig {
    match std::fs::read_to_string(path) {
        Ok(raw) => McpConfig::from_json_str(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => McpConfig::default(),
        Err(e) => {
            log::warn!("Failed to read MCP config from {}: {}", path.display(), e);
            McpConfig::default()
        }
    }
}

fn save_to_path(path: &Path, cfg: &McpConfig) -> Result<(), String> {
    std::fs::write(path, cfg.to_json_string()).map_err(|e| e.to_string())
}

pub fn load() -> McpConfig {
    match config_path() {
        Ok(path) => load_from_path(&path),
        Err(e) => {
            log::warn!("Failed to resolve MCP config path: {}", e);
            McpConfig::default()
        }
    }
}

pub fn save(cfg: &McpConfig) -> Result<(), String> {
    let path = config_path()?;
    save_to_path(&path, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-mcp-config-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn defaults_are_disabled_and_read_only() {
        let cfg = McpConfig::default();
        assert!(!cfg.enabled);
        assert!(!cfg.read_write);
        assert!(cfg.token.is_empty());
    }

    #[test]
    fn json_roundtrips() {
        let cfg = McpConfig {
            enabled: true,
            read_write: true,
            token: "abc123".to_string(),
        };
        let raw = cfg.to_json_string();
        assert_eq!(McpConfig::from_json_str(&raw), cfg);
    }

    #[test]
    fn garbage_json_falls_back_to_default() {
        assert_eq!(McpConfig::from_json_str("not-json"), McpConfig::default());
    }

    #[test]
    fn partial_json_uses_defaults() {
        let cfg = McpConfig::from_json_str(r#"{"enabled":true}"#);
        assert!(cfg.enabled);
        assert!(!cfg.read_write);
    }

    #[test]
    fn persistence_uses_mcp_settings_file_and_roundtrips() {
        let dir = temp_test_dir();
        let path = config_path_in(&dir);
        let cfg = McpConfig {
            enabled: true,
            read_write: false,
            token: "tok".to_string(),
        };
        save_to_path(&path, &cfg).expect("config should be saved");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("mcp_settings.json")
        );
        assert_eq!(load_from_path(&path), cfg);
        std::fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn ensure_token_generates_once_and_is_stable() {
        let mut cfg = McpConfig::default();
        let changed = cfg.ensure_token(|| "generated-token".to_string());
        assert!(changed);
        assert_eq!(cfg.token, "generated-token");
        let changed_again = cfg.ensure_token(|| "other".to_string());
        assert!(!changed_again);
        assert_eq!(cfg.token, "generated-token");
    }
}
