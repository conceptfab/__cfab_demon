use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const SESSION_SETTINGS_FILE_NAME: &str = "session_settings.json";
pub const DEFAULT_MIN_SESSION_DURATION_SECONDS: i64 = 10;
const MIN_SESSION_DURATION_SECONDS_MIN: i64 = 0;
const MIN_SESSION_DURATION_SECONDS_MAX: i64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedSessionSettings {
    #[serde(
        default = "default_min_session_duration_seconds",
        alias = "min_session_duration_seconds"
    )]
    pub min_session_duration_seconds: i64,
}

impl Default for SharedSessionSettings {
    fn default() -> Self {
        Self {
            min_session_duration_seconds: default_min_session_duration_seconds(),
        }
    }
}

const fn default_min_session_duration_seconds() -> i64 {
    DEFAULT_MIN_SESSION_DURATION_SECONDS
}

pub fn normalize_min_session_duration_seconds(value: i64) -> i64 {
    value.clamp(
        MIN_SESSION_DURATION_SECONDS_MIN,
        MIN_SESSION_DURATION_SECONDS_MAX,
    )
}

pub fn normalize_session_settings(settings: SharedSessionSettings) -> SharedSessionSettings {
    SharedSessionSettings {
        min_session_duration_seconds: normalize_min_session_duration_seconds(
            settings.min_session_duration_seconds,
        ),
    }
}

pub fn session_settings_path(base_dir: &Path) -> PathBuf {
    base_dir.join(SESSION_SETTINGS_FILE_NAME)
}

pub fn read_session_settings(base_dir: &Path) -> SharedSessionSettings {
    let path = session_settings_path(base_dir);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return SharedSessionSettings::default(),
    };

    match serde_json::from_str::<SharedSessionSettings>(&content) {
        Ok(parsed) => normalize_session_settings(parsed),
        Err(error) => {
            log::warn!(
                "Failed to parse shared session settings '{}': {}",
                path.display(),
                error
            );
            SharedSessionSettings::default()
        }
    }
}

#[allow(dead_code)]
pub fn write_session_settings(
    base_dir: &Path,
    settings: &SharedSessionSettings,
) -> Result<(), String> {
    fs::create_dir_all(base_dir).map_err(|e| {
        format!(
            "Failed to create TIMEFLOW settings directory '{}': {}",
            base_dir.display(),
            e
        )
    })?;

    let normalized = normalize_session_settings(settings.clone());
    let path = session_settings_path(base_dir);
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Failed to serialize session settings: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write '{}': {}", path.display(), e))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_min_session_duration_seconds, normalize_session_settings, SharedSessionSettings,
    };

    #[test]
    fn min_session_duration_is_clamped_to_supported_range() {
        assert_eq!(normalize_min_session_duration_seconds(-10), 0);
        assert_eq!(normalize_min_session_duration_seconds(301), 300);
        assert_eq!(normalize_min_session_duration_seconds(42), 42);
    }

    #[test]
    fn session_settings_are_normalized() {
        let settings = normalize_session_settings(SharedSessionSettings {
            min_session_duration_seconds: 999,
        });

        assert_eq!(settings.min_session_duration_seconds, 300);
    }
}
