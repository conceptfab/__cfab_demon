use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DEFAULT_WEB_PORT: u16 = 47892;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct WebServerConfig {
    pub enabled: bool,
    pub port: u16,
    /// Gdy false (domyślnie) serwer binduje tylko 127.0.0.1 (loopback).
    /// Gdy true — 0.0.0.0 (dostęp z LAN, np. telefon). Wymaga świadomego
    /// włączenia: ruch jest plaintext HTTP bez TLS.
    pub lan_exposure: bool,
}

impl Default for WebServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_WEB_PORT,
            lan_exposure: false,
        }
    }
}

impl WebServerConfig {
    pub fn from_json_str(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_string())
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_path_in(
        &crate::commands::helpers::timeflow_data_dir()?,
    ))
}

fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("webserver_settings.json")
}

fn load_from_path(path: &Path) -> WebServerConfig {
    match std::fs::read_to_string(path) {
        Ok(raw) => WebServerConfig::from_json_str(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => WebServerConfig::default(),
        Err(e) => {
            log::warn!(
                "Failed to read web-server config from {}: {}",
                path.display(),
                e
            );
            WebServerConfig::default()
        }
    }
}

fn save_to_path(path: &Path, cfg: &WebServerConfig) -> Result<(), String> {
    std::fs::write(path, cfg.to_json_string()).map_err(|e| e.to_string())
}

pub fn load() -> WebServerConfig {
    match config_path() {
        Ok(path) => load_from_path(&path),
        Err(e) => {
            log::warn!("Failed to resolve web-server config path: {}", e);
            WebServerConfig::default()
        }
    }
}

pub fn save(cfg: &WebServerConfig) -> Result<(), String> {
    let path = config_path()?;
    save_to_path(&path, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-webui-config-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn defaults_are_off_and_standard_port() {
        let cfg = WebServerConfig::default();

        assert!(!cfg.enabled);
        assert_eq!(cfg.port, 47892);
    }

    #[test]
    fn from_json_roundtrips() {
        let cfg = WebServerConfig {
            enabled: true,
            port: 47900,
            lan_exposure: false,
        };

        let raw = cfg.to_json_string();
        assert_eq!(WebServerConfig::from_json_str(&raw), cfg);
    }

    #[test]
    fn from_json_garbage_falls_back_to_default() {
        assert_eq!(
            WebServerConfig::from_json_str("not-json"),
            WebServerConfig::default()
        );
    }

    #[test]
    fn persistence_uses_webserver_settings_file_and_roundtrips() {
        let dir = temp_test_dir();
        let path = config_path_in(&dir);
        let cfg = WebServerConfig {
            enabled: true,
            port: 47901,
            lan_exposure: false,
        };

        save_to_path(&path, &cfg).expect("config should be saved");

        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("webserver_settings.json")
        );
        assert!(path.exists());
        assert_eq!(load_from_path(&path), cfg);

        std::fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn from_json_partial_config_uses_defaults() {
        let cfg = WebServerConfig::from_json_str(r#"{"enabled":true}"#);

        assert!(cfg.enabled);
        assert_eq!(cfg.port, DEFAULT_WEB_PORT);
    }

    #[test]
    fn defaults_keep_lan_exposure_off() {
        let cfg = WebServerConfig::default();
        assert!(!cfg.lan_exposure);
    }

    #[test]
    fn lan_exposure_roundtrips() {
        let cfg = WebServerConfig {
            enabled: true,
            port: 47892,
            lan_exposure: true,
        };
        let raw = cfg.to_json_string();
        assert_eq!(WebServerConfig::from_json_str(&raw), cfg);
    }
}
