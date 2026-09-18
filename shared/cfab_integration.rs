use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

pub const BEACON_SCHEMA: u32 = 1;
pub const CFAB_RENDER_SUPPORTED: &[u32] = &[1, 2, 3];

/// Numer kontraktu, ktory TIMEFLOW oglasza w swojej latarni.
///
/// Zawsze najwyzszy z obslugiwanych: wpisany recznie rozjezdza sie z ingestem
/// i druga strona widzi mniej, niz naprawde potrafimy przyjac.
pub fn announced_render_contract() -> u32 {
    CFAB_RENDER_SUPPORTED.iter().copied().max().unwrap_or(1)
}
pub const HEARTBEAT_INTERVAL_SECS: u64 = 30;
pub const HEARTBEAT_STALE_SECS: f64 = 90.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Beacon {
    pub schema: u32,
    pub app: String,
    pub version: String,
    pub db_path: String,
    pub instance_id: Option<String>,
    #[serde(default)]
    pub contracts: HashMap<String, u32>,
    pub pid: u32,
    pub started_at: f64,
    pub heartbeat_at: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BeaconRead {
    Absent,
    Unreadable,
    Found(Beacon),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerState {
    Absent,
    Stale,
    Alive,
    Incompatible,
    Unreadable,
}

impl PeerState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PeerState::Absent => "absent",
            PeerState::Stale => "stale",
            PeerState::Alive => "alive",
            PeerState::Incompatible => "incompatible",
            PeerState::Unreadable => "unreadable",
        }
    }
}

pub fn integration_dir() -> std::io::Result<PathBuf> {
    if let Some(val) = std::env::var_os("CFAB_INTEGRATION_DIR") {
        if !val.is_empty() {
            return Ok(PathBuf::from(val));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME not set"))?;
        Ok(home.join("Library").join("Application Support").join("CFAB").join("integration"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(|h| PathBuf::from(h).join("AppData").join("Roaming"))
            })
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "APPDATA not set"))?;
        Ok(base.join("CFAB").join("integration"))
    }
}

pub fn write_beacon_in_dir(dir: &Path, app: &str, beacon: &Beacon) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let target = dir.join(format!("{}.json", app));
    let tmp = dir.join(format!("{}.json.tmp.{}", app, std::process::id()));

    let content = serde_json::to_string_pretty(beacon)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    std::fs::write(&tmp, content)?;
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

pub fn write_beacon(app: &str, beacon: &Beacon) -> std::io::Result<()> {
    let dir = integration_dir()?;
    write_beacon_in_dir(&dir, app, beacon)
}

pub fn read_beacon_in_dir(dir: &Path, app: &str) -> BeaconRead {
    let path = dir.join(format!("{}.json", app));
    if !path.is_file() {
        return BeaconRead::Absent;
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        return BeaconRead::Unreadable;
    };
    let Ok(beacon) = serde_json::from_str::<Beacon>(&content) else {
        return BeaconRead::Unreadable;
    };
    if beacon.schema != BEACON_SCHEMA {
        return BeaconRead::Unreadable;
    }
    BeaconRead::Found(beacon)
}

pub fn read_beacon(app: &str) -> BeaconRead {
    let Ok(dir) = integration_dir() else {
        return BeaconRead::Absent;
    };
    read_beacon_in_dir(&dir, app)
}

pub fn peer_state(read: &BeaconRead, supported_contracts: &[u32], now: f64) -> PeerState {
    match read {
        BeaconRead::Absent => PeerState::Absent,
        BeaconRead::Unreadable => PeerState::Unreadable,
        BeaconRead::Found(beacon) => {
            let render_contract = beacon.contracts.get("cfab_render").copied().unwrap_or(1);
            if !supported_contracts.contains(&render_contract) {
                return PeerState::Incompatible;
            }
            if now - beacon.heartbeat_at > HEARTBEAT_STALE_SECS {
                return PeerState::Stale;
            }
            PeerState::Alive
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("cfab_beacon_{}_{}", tag, nanos));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_and_read_beacon_roundtrip() {
        let dir = temp_test_dir("roundtrip");
        let mut contracts = HashMap::new();
        contracts.insert("cfab_render".to_string(), 2);

        let beacon = Beacon {
            schema: 1,
            app: "hub".to_string(),
            version: "BETA 0.15".to_string(),
            db_path: "/path/to/history.db".to_string(),
            instance_id: Some("3f2a-uuid".to_string()),
            contracts,
            pid: 1234,
            started_at: 1000.0,
            heartbeat_at: 1030.0,
        };

        write_beacon_in_dir(&dir, "hub", &beacon).unwrap();
        let read = read_beacon_in_dir(&dir, "hub");
        assert_eq!(read, BeaconRead::Found(beacon));

        // Atomic write: tmp file must not exist
        let tmp = dir.join(format!("hub.json.tmp.{}", std::process::id()));
        assert!(!tmp.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_beacon_absent_and_unreadable() {
        let dir = temp_test_dir("unreadable");
        assert_eq!(read_beacon_in_dir(&dir, "nonexistent"), BeaconRead::Absent);

        // Corrupted JSON
        std::fs::write(dir.join("corrupt.json"), "{ invalid json").unwrap();
        assert_eq!(read_beacon_in_dir(&dir, "corrupt"), BeaconRead::Unreadable);

        // Schema != 1
        std::fs::write(
            dir.join("bad_schema.json"),
            r#"{"schema": 2, "app": "hub", "version": "1", "db_path": "", "pid": 1, "started_at": 1, "heartbeat_at": 1}"#
        ).unwrap();
        assert_eq!(read_beacon_in_dir(&dir, "bad_schema"), BeaconRead::Unreadable);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn announced_contract_is_the_highest_we_can_ingest() {
        assert_eq!(announced_render_contract(), *CFAB_RENDER_SUPPORTED.iter().max().unwrap());
        assert!(CFAB_RENDER_SUPPORTED.contains(&announced_render_contract()));
    }

    #[test]
    fn beacon_written_by_the_hub_parses() {
        // Doslowna kopia pliku hub.json z CFAB 4D Hub
        // (shared/cfab_core/integration_beacon.py :: hub_beacon). Kazde pole, ktore Hub
        // przestanie pisac, zmienia tu stan na Unreadable — czyli powrot do recznego
        // wklejania sciezki bazy zamiast wykrycia z latarni.
        let dir = temp_test_dir("hub_format");
        let hub_json = r#"{
  "schema": 1,
  "app": "hub",
  "version": "BETA 0.181",
  "db_path": "/Users/x/.local/history.db",
  "instance_id": "3f2a9c1d",
  "contracts": {
    "cfab_render": 3,
    "dcc_activity": 1,
    "cfab_project_index": 1
  },
  "pid": 25485,
  "started_at": 1789720294.25,
  "heartbeat_at": 1789720324.25
}"#;
        std::fs::write(dir.join("hub.json"), hub_json).unwrap();

        match read_beacon_in_dir(&dir, "hub") {
            BeaconRead::Found(beacon) => {
                assert_eq!(beacon.app, "hub");
                assert_eq!(beacon.instance_id.as_deref(), Some("3f2a9c1d"));
                assert_eq!(beacon.contracts.get("cfab_render"), Some(&3));
            }
            other => panic!("latarnia Huba nie do odczytania: {:?}", other),
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn peer_state_evaluations() {
        assert_eq!(peer_state(&BeaconRead::Absent, &[1, 2], 100.0), PeerState::Absent);
        assert_eq!(peer_state(&BeaconRead::Unreadable, &[1, 2], 100.0), PeerState::Unreadable);

        let mut contracts = HashMap::new();
        contracts.insert("cfab_render".to_string(), 2);
        let beacon = Beacon {
            schema: 1,
            app: "hub".to_string(),
            version: "BETA 0.15".to_string(),
            db_path: "/path".to_string(),
            instance_id: None,
            contracts,
            pid: 1,
            started_at: 1000.0,
            heartbeat_at: 1000.0,
        };

        // Fresh heartbeat (10 s ago) -> Alive
        assert_eq!(
            peer_state(&BeaconRead::Found(beacon.clone()), &[1, 2], 1010.0),
            PeerState::Alive
        );

        // Stale heartbeat (91 s ago) -> Stale
        assert_eq!(
            peer_state(&BeaconRead::Found(beacon.clone()), &[1, 2], 1091.0),
            PeerState::Stale
        );

        // Unsupported contract -> Incompatible
        let mut future_contracts = HashMap::new();
        future_contracts.insert("cfab_render".to_string(), 3);
        let mut future_beacon = beacon.clone();
        future_beacon.contracts = future_contracts;
        assert_eq!(
            peer_state(&BeaconRead::Found(future_beacon), &[1, 2], 1010.0),
            PeerState::Incompatible
        );
    }
}
