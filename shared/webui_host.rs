use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Status uruchomionego trybu Web UI bez okna. Zapisywany przez proces
/// `timeflow-dashboard --headless`, czytany przez demona (toggle + stop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebUiHost {
    pub pid: u32,
    pub port: u16,
    pub started_at: u64,
}

pub fn status_path(data_dir: &Path) -> PathBuf {
    data_dir.join("webui_host.json")
}

pub fn read(data_dir: &Path) -> Option<WebUiHost> {
    let raw = std::fs::read_to_string(status_path(data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write(data_dir: &Path, host: &WebUiHost) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(host)
        .unwrap_or_else(|_| "{}".to_string());
    std::fs::write(status_path(data_dir), json)
}

pub fn clear(data_dir: &Path) {
    let _ = std::fs::remove_file(status_path(data_dir));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("tf-webui-host-{}-{}", std::process::id(), unique));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = temp_dir();
        assert_eq!(read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_then_read_roundtrips_and_clear_removes() {
        let dir = temp_dir();
        let host = WebUiHost { pid: 4242, port: 47892, started_at: 100 };
        write(&dir, &host).unwrap();
        assert_eq!(read(&dir), Some(host));
        clear(&dir);
        assert_eq!(read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
