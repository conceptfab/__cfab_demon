//! CFAB Hub render ingest (on demand, no daemon tick) and project-page commands.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::TimeZone;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use timeflow_shared::cfab_integration::{
    read_beacon, write_beacon, peer_state, Beacon, BeaconRead,
    announced_render_contract,
    CFAB_RENDER_SUPPORTED,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::estimates::get_global_hourly_rate;
use super::helpers::run_db_blocking;

const DEFAULT_COEFFICIENT: f64 = 0.2;
pub const CFAB_HUB_INTEGRATION_KEY: &str = "timeflow.settings.cfab-hub-integration";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabMachineRow {
    pub machine_name: String,
    pub hub_instance_id: String,
    pub last_ended_at: f64,
    pub total_renders: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabHubPeerInfo {
    pub state: String,
    pub version: Option<String>,
    pub db_path: Option<String>,
    pub contract: Option<u32>,
    pub heartbeat_at: Option<f64>,
    pub source: String,
    pub resolved_path: String,
    pub probe_status: String,
    pub machines: Vec<CfabMachineRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderDay {
    pub date: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub value: f64,
    pub rows: Vec<CfabRenderRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabUnassignedRenderRow {
    pub hub_instance_id: String,
    pub ledger_id: i64,
    pub working_path: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub ended_at: f64,
    pub machine_name: Option<String>,
    pub thumbnail_path: Option<String>,
    pub matched_project_id: Option<i64>,
    pub matched_project_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabRenderCostDetail {
    pub id: i64,
    pub hub_instance_id: String,
    pub ledger_id: i64,
    pub project_id: i64,
    pub project_name: String,
    pub working_path: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub coefficient: f64,
    pub value: f64,
    pub ended_at: f64,
    pub ingested_at: String,
    pub machine_name: Option<String>,
    pub thumbnail_path: Option<String>,
    pub assigned_by: String,
    pub assigned_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabAllRendersResponse {
    pub total: i64,
    pub total_seconds: f64,
    pub total_rbh: f64,
    pub total_value: f64,
    pub items: Vec<CfabRenderCostDetail>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderRow {
    pub hub_instance_id: String,
    pub ledger_id: i64,
    pub working_path: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub value: f64,
    pub ended_at: f64,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderIngestResult {
    pub ingested: usize,
    pub updated: usize,
    pub days: Vec<CfabRenderDay>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderProjectState {
    pub coefficient: f64,
    pub include_in_billing: bool,
    pub include_render_in_hours_limit: bool,
    pub effective_hourly_rate: f64,
    pub days: Vec<CfabRenderDay>,
}

#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: i64,
    pub name: String,
    pub assigned_folder_path: Option<String>,
    #[allow(dead_code)]
    pub frozen_at: Option<String>,
    pub excluded_at: Option<String>,
    pub merged_into: Option<String>,
}

fn app_support_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join("Library").join("Application Support")
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let home = std::env::var_os("HOME")
                    .or_else(|| std::env::var_os("USERPROFILE"))
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."));
                home.join("AppData").join("Roaming")
            })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabHubIntegration {
    #[serde(default = "default_integration_enabled")]
    pub enabled: bool,
    #[serde(default, rename = "hubDbPath")]
    pub hub_db_path: String,
}

fn default_integration_enabled() -> bool {
    true
}

impl Default for CfabHubIntegration {
    fn default() -> Self {
        Self {
            enabled: true,
            hub_db_path: String::new(),
        }
    }
}

pub fn parse_cfab_hub_integration(value: Option<&Value>) -> CfabHubIntegration {
    let Some(value) = value else {
        return CfabHubIntegration::default();
    };
    let owned = if let Some(raw) = value.as_str() {
        serde_json::from_str(raw).unwrap_or(Value::Null)
    } else {
        value.clone()
    };
    let mut parsed: CfabHubIntegration =
        serde_json::from_value(owned).unwrap_or_default();
    parsed.hub_db_path = parsed.hub_db_path.trim().to_string();
    parsed
}

pub fn load_cfab_hub_integration_from(dir: &Path) -> CfabHubIntegration {
    let parsed: Value = std::fs::read_to_string(dir.join("user_settings.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Null);
    parse_cfab_hub_integration(parsed.get(CFAB_HUB_INTEGRATION_KEY))
}

pub fn load_cfab_hub_integration() -> CfabHubIntegration {
    super::helpers::timeflow_data_dir()
        .ok()
        .map(|dir| load_cfab_hub_integration_from(&dir))
        .unwrap_or_default()
}

pub fn resolve_hub_db_path_with_source(settings: &CfabHubIntegration) -> (PathBuf, &'static str) {
    let override_path = settings.hub_db_path.trim();
    if !override_path.is_empty() {
        return (PathBuf::from(override_path), "override");
    }

    if let BeaconRead::Found(beacon) = read_beacon("hub") {
        let p = PathBuf::from(&beacon.db_path);
        if p.is_file() {
            return (p, "beacon");
        }
    }

    (app_support_root().join("c4dwatch").join("c4dwatch.db"), "canonical")
}

pub fn hub_db_path_from(settings: &CfabHubIntegration) -> PathBuf {
    resolve_hub_db_path_with_source(settings).0
}

pub fn hub_db_path() -> PathBuf {
    hub_db_path_from(&load_cfab_hub_integration())
}

pub fn probe_hub_db(path: &Path) -> &'static str {
    if !path.is_file() {
        return "missing";
    }
    match open_foreign(path) {
        Ok(None) => "missing",
        Err(_) => "unreadable",
        Ok(Some(conn)) => {
            let has_ledger = conn
                .prepare("SELECT 1 FROM render_ledger LIMIT 1")
                .is_ok();
            if has_ledger {
                "ok"
            } else {
                "missing_table"
            }
        }
    }
}

pub fn open_foreign(path: &Path) -> Result<Option<Connection>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    // Try opening with SQLITE_OPEN_READ_ONLY first (fails gracefully if WAL shm lock fails)
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(path, flags) {
        Ok(c) => c,
        Err(_) => Connection::open(path).map_err(|e| e.to_string())?,
    };
    conn.execute_batch("PRAGMA query_only=ON;")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| e.to_string())?;
    Ok(Some(conn))
}

pub fn write_timeflow_beacon() {
    if let Ok(data_dir) = super::helpers::timeflow_data_dir() {
        let db_path = data_dir.join("timeflow_dashboard.db");
        let now = chrono::Utc::now().timestamp() as f64;
        let mut contracts = std::collections::HashMap::new();
        contracts.insert("cfab_render".to_string(), announced_render_contract());

        let beacon = Beacon {
            schema: 1,
            app: "timeflow".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            db_path: db_path.to_string_lossy().into_owned(),
            instance_id: None,
            contracts,
            pid: std::process::id(),
            started_at: now,
            heartbeat_at: now,
        };
        let _ = write_beacon("timeflow", &beacon);
    }
}

pub fn get_cfab_hub_peer_info(tf: &Connection) -> Result<CfabHubPeerInfo, String> {
    let settings = load_cfab_hub_integration();
    let (resolved, source) = resolve_hub_db_path_with_source(&settings);
    let probe = probe_hub_db(&resolved).to_string();

    let beacon_read = read_beacon("hub");
    let now = chrono::Utc::now().timestamp() as f64;
    let state = peer_state(&beacon_read, CFAB_RENDER_SUPPORTED, now).as_str().to_string();

    let (version, db_path, contract, heartbeat_at) = match beacon_read {
        BeaconRead::Found(b) => {
            let c = b.contracts.get("cfab_render").copied();
            (Some(b.version), Some(b.db_path), c, Some(b.heartbeat_at))
        }
        _ => (None, None, None, None),
    };

    let mut stmt = tf
        .prepare(
            "SELECT COALESCE(machine_name, '(unknown)'), hub_instance_id, MAX(ended_at), COUNT(*)
             FROM cfab_render_cost
             GROUP BY hub_instance_id, COALESCE(machine_name, '(unknown)')
             ORDER BY MAX(ended_at) DESC",
        )
        .map_err(|e| e.to_string())?;

    let machines = stmt
        .query_map([], |row| {
            Ok(CfabMachineRow {
                machine_name: row.get(0)?,
                hub_instance_id: row.get(1)?,
                last_ended_at: row.get(2)?,
                total_renders: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(CfabHubPeerInfo {
        state,
        version,
        db_path,
        contract,
        heartbeat_at,
        source: source.to_string(),
        resolved_path: resolved.to_string_lossy().into_owned(),
        probe_status: probe,
        machines,
    })
}

#[derive(Debug, Clone)]
pub struct HubLedgerRow {
    pub instance: String,
    pub ledger_id: i64,
    pub working_path: String,
    pub render_seconds: f64,
    pub ended_at: f64,
    pub hint: Option<i64>,
    pub machine_name: Option<String>,
    pub thumbnail_path: Option<String>,
    pub contract: i64,
}

pub fn hub_ledger_has_instance(hub: &Connection) -> bool {
    hub.prepare("SELECT COUNT(*) FROM pragma_table_info('render_ledger') WHERE name='hub_instance_id'")
        .and_then(|mut stmt| stmt.query_row([], |r| r.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false)
}

pub fn hub_ledger_has_thumbnail_path(hub: &Connection) -> bool {
    hub.prepare("SELECT COUNT(*) FROM pragma_table_info('render_ledger') WHERE name='thumbnail_path'")
        .and_then(|mut stmt| stmt.query_row([], |r| r.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false)
}

pub fn hub_ledger_has_machine_name(hub: &Connection) -> bool {
    hub.prepare("SELECT COUNT(*) FROM pragma_table_info('render_ledger') WHERE name='machine_name'")
        .and_then(|mut stmt| stmt.query_row([], |r| r.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false)
}

pub fn read_open_ledger(hub: &Connection) -> Result<Vec<HubLedgerRow>, String> {
    let has_instance = hub_ledger_has_instance(hub);
    let has_machine = hub_ledger_has_machine_name(hub);
    let has_thumb = hub_ledger_has_thumbnail_path(hub);
    if has_instance {
        let machine_col = if has_machine { "machine_name" } else { "NULL AS machine_name" };
        let thumb_col = if has_thumb { "thumbnail_path" } else { "NULL AS thumbnail_path" };
        let sql = format!(
            "SELECT COALESCE(hub_instance_id, 'legacy'), id, working_path, render_seconds, ended_at, project_hint, {}, {}, contract
             FROM render_ledger
             WHERE contract IN (1, 2, 3) AND status = 'open'",
            machine_col, thumb_col
        );
        let mut stmt = hub.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(HubLedgerRow {
                    instance: row.get(0)?,
                    ledger_id: row.get(1)?,
                    working_path: row.get(2)?,
                    render_seconds: row.get(3)?,
                    ended_at: row.get(4)?,
                    hint: row.get(5)?,
                    machine_name: row.get(6)?,
                    thumbnail_path: row.get(7)?,
                    contract: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    } else {
        let mut stmt = hub
            .prepare(
                "SELECT id, working_path, render_seconds, ended_at, project_hint
                 FROM render_ledger
                 WHERE contract = 1 AND status = 'open'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(HubLedgerRow {
                    instance: "legacy".to_string(),
                    ledger_id: row.get(0)?,
                    working_path: row.get(1)?,
                    render_seconds: row.get(2)?,
                    ended_at: row.get(3)?,
                    hint: row.get(4)?,
                    machine_name: None,
                    thumbnail_path: None,
                    contract: 1,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

pub fn normalize_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    #[cfg(any(windows, target_os = "macos"))]
    {
        trimmed.to_lowercase()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        trimmed.to_string()
    }
}

fn resolve_merge(project: &ProjectRow, by_name: &HashMap<&str, &ProjectRow>) -> Option<i64> {
    match project.merged_into.as_deref() {
        Some(name) if !name.is_empty() => match by_name.get(name) {
            Some(parent) if parent.excluded_at.is_none() => Some(parent.id),
            _ => None,
        },
        _ => Some(project.id),
    }
}

pub fn match_project(
    working_path: &str,
    projects: &[ProjectRow],
    hint: Option<i64>,
) -> Option<i64> {
    if working_path.is_empty() || working_path == "(unknown)" {
        return None;
    }

    let normalized_working = normalize_path(working_path);
    let by_id: HashMap<i64, &ProjectRow> = projects.iter().map(|p| (p.id, p)).collect();
    let by_name: HashMap<&str, &ProjectRow> =
        projects.iter().map(|p| (p.name.as_str(), p)).collect();

    if let Some(hint_id) = hint {
        if let Some(hinted) = by_id.get(&hint_id) {
            if hinted.excluded_at.is_none() {
                return resolve_merge(hinted, &by_name);
            }
        }
    }

    let mut best: Option<&ProjectRow> = None;
    let mut best_len: i64 = -1;
    for project in projects {
        if project.excluded_at.is_some() {
            continue;
        }
        let Some(folder) = project.assigned_folder_path.as_deref() else {
            continue;
        };
        if folder.is_empty() {
            continue;
        }
        let normalized_folder = normalize_path(folder);
        if normalized_folder.is_empty() {
            continue;
        }
        if normalized_working == normalized_folder
            || normalized_working.starts_with(&format!("{normalized_folder}/"))
        {
            let folder_len = normalized_folder.len() as i64;
            let better = match best {
                None => true,
                Some(current) => {
                    folder_len > best_len || (folder_len == best_len && project.id < current.id)
                }
            };
            if better {
                best = Some(project);
                best_len = folder_len;
            }
        }
    }

    best.and_then(|project| resolve_merge(project, &by_name))
}


pub fn rebuild_cfab_path_index(tf: &Connection) -> Result<usize, String> {
    let mut stmt = tf
        .prepare(
            "SELECT id, assigned_folder_path FROM projects
             WHERE excluded_at IS NULL AND assigned_folder_path IS NOT NULL AND TRIM(assigned_folder_path) != ''",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut count = 0usize;
    for res in rows {
        let (project_id, folder) = res.map_err(|e| e.to_string())?;
        let norm = normalize_path(&folder);
        if norm.is_empty() {
            continue;
        }
        let inserted = tf.execute(
            "INSERT INTO cfab_project_path_index (folder_norm, project_id, source, updated_at)
             VALUES (?1, ?2, 'auto', ?3)
             ON CONFLICT(folder_norm) DO UPDATE SET
                 project_id = excluded.project_id,
                 updated_at = excluded.updated_at
             WHERE cfab_project_path_index.source != 'manual'",
            rusqlite::params![norm, project_id, now],
        ).map_err(|e| e.to_string())?;
        if inserted > 0 {
            count += 1;
        }
    }
    Ok(count)
}

pub fn load_cfab_path_index(tf: &Connection) -> Result<Vec<(String, i64, String)>, String> {
    let mut stmt = tf
        .prepare(
            "SELECT folder_norm, project_id, source
             FROM cfab_project_path_index
             ORDER BY LENGTH(folder_norm) DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn match_project_with_index(
    working_path: &str,
    projects: &[ProjectRow],
    hint: Option<i64>,
    path_index: &[(String, i64, String)],
) -> Option<i64> {
    if working_path.is_empty() || working_path == "(unknown)" {
        return None;
    }

    let by_id: HashMap<i64, &ProjectRow> = projects.iter().map(|p| (p.id, p)).collect();
    let by_name: HashMap<&str, &ProjectRow> =
        projects.iter().map(|p| (p.name.as_str(), p)).collect();

    // 1. Hint has highest priority if valid and not excluded
    if let Some(hint_id) = hint {
        if let Some(hinted) = by_id.get(&hint_id) {
            if hinted.excluded_at.is_none() {
                return resolve_merge(hinted, &by_name);
            }
        }
    }

    let normalized_working = normalize_path(working_path);

    // 2. Longest-prefix match in path_index (ordered by length DESC)
    for (folder_norm, project_id, _source) in path_index {
        if normalized_working == *folder_norm
            || normalized_working.starts_with(&format!("{folder_norm}/"))
        {
            if let Some(proj) = by_id.get(project_id) {
                if proj.excluded_at.is_none() {
                    return resolve_merge(proj, &by_name);
                }
            }
        }
    }

    // 3. Fallback: projects.assigned_folder_path
    match_project(working_path, projects, None)
}

fn read_single_hub_ledger(
    hub: &Connection,
    hub_instance_id: &str,
    ledger_id: i64,
) -> Result<Option<HubLedgerRow>, String> {
    let has_instance = hub
        .prepare("SELECT 1 FROM render_ledger WHERE hub_instance_id = ?1 LIMIT 1")
        .is_ok();
    let has_machine = hub_ledger_has_machine_name(hub);
    let has_thumb = hub_ledger_has_thumbnail_path(hub);
    if has_instance {
        let machine_col = if has_machine { "machine_name" } else { "NULL AS machine_name" };
        let thumb_col = if has_thumb { "thumbnail_path" } else { "NULL AS thumbnail_path" };
        let sql = format!(
            "SELECT hub_instance_id, id, working_path, render_seconds, ended_at, project_hint, {}, {}, contract
             FROM render_ledger
             WHERE hub_instance_id = ?1 AND id = ?2",
            machine_col, thumb_col
        );
        let mut stmt = hub.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(rusqlite::params![hub_instance_id, ledger_id], |row| {
                Ok(HubLedgerRow {
                    instance: row.get(0)?,
                    ledger_id: row.get(1)?,
                    working_path: row.get(2)?,
                    render_seconds: row.get(3)?,
                    ended_at: row.get(4)?,
                    hint: row.get(5)?,
                    machine_name: row.get(6)?,
                    thumbnail_path: row.get(7)?,
                    contract: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        if let Some(r) = rows.next() {
            return r.map(Some).map_err(|e| e.to_string());
        }
    } else {
        let mut stmt = hub
            .prepare(
                "SELECT id, working_path, render_seconds, ended_at, project_hint
                 FROM render_ledger
                 WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(rusqlite::params![ledger_id], |row| {
                Ok(HubLedgerRow {
                    instance: "legacy".to_string(),
                    ledger_id: row.get(0)?,
                    working_path: row.get(1)?,
                    render_seconds: row.get(2)?,
                    ended_at: row.get(3)?,
                    hint: row.get(4)?,
                    machine_name: None,
                    thumbnail_path: None,
                    contract: 1,
                })
            })
            .map_err(|e| e.to_string())?;
        if let Some(r) = rows.next() {
            return r.map(Some).map_err(|e| e.to_string());
        }
    }
    Ok(None)
}

fn parse_date_boundary(date_str: &str, end_of_day: bool) -> Option<f64> {
    let date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
    let time = if end_of_day {
        chrono::NaiveTime::from_hms_opt(23, 59, 59)?
    } else {
        chrono::NaiveTime::from_hms_opt(0, 0, 0)?
    };
    let dt = date.and_time(time);
    match chrono::Local.from_local_datetime(&dt) {
        chrono::LocalResult::Single(local_dt) | chrono::LocalResult::Ambiguous(local_dt, _) => {
            Some(local_dt.timestamp() as f64)
        }
        chrono::LocalResult::None => {
            Some(chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc).timestamp() as f64)
        }
    }
}

fn load_projects(tf: &Connection) -> Result<Vec<ProjectRow>, String> {
    let mut stmt = tf
        .prepare(
            "SELECT id, name, assigned_folder_path, frozen_at, excluded_at, merged_into
             FROM projects",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                assigned_folder_path: row.get(2)?,
                frozen_at: row.get(3)?,
                excluded_at: row.get(4)?,
                merged_into: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_project_settings(tf: &Connection, project_id: i64) -> Result<(f64, bool, bool), String> {
    let has_limit_col = tf
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_project_settings') WHERE name='include_render_in_hours_limit'")
        .and_then(|mut stmt| stmt.query_row([], |r| r.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false);

    let sql = if has_limit_col {
        "SELECT coefficient, include_in_billing, include_render_in_hours_limit FROM cfab_render_project_settings WHERE project_id = ?1"
    } else {
        "SELECT coefficient, include_in_billing, 0 FROM cfab_render_project_settings WHERE project_id = ?1"
    };

    let row: Option<(f64, i64, i64)> = tf
        .query_row(
            sql,
            [project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(match row {
        Some((c, include, include_limit)) => (
            if c.is_finite() {
                c
            } else {
                DEFAULT_COEFFICIENT
            },
            include != 0,
            include_limit != 0,
        ),
        None => (DEFAULT_COEFFICIENT, false, false),
    })
}

fn project_coefficient(tf: &Connection, project_id: i64) -> Result<f64, String> {
    Ok(load_project_settings(tf, project_id)?.0)
}

/// SUM(cfab_render_cost.value) when include_in_billing=1; otherwise 0.
/// Missing settings row is treated as include_in_billing=0.
pub fn cfab_render_billing_addend(conn: &Connection, project_id: i64) -> Result<f64, String> {
    let include = load_project_settings(conn, project_id)?.1;
    if !include {
        return Ok(0.0);
    }
    conn.query_row(
        "SELECT COALESCE(SUM(value), 0) FROM cfab_render_cost WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn effective_hourly_rate(tf: &Connection, project_id: i64) -> Result<f64, String> {
    let project_rate: Option<f64> = match tf.query_row(
        "SELECT hourly_rate FROM projects WHERE id = ?1",
        [project_id],
        |row| row.get::<_, Option<f64>>(0),
    ) {
        Ok(rate) => rate,
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e.to_string()),
    };
    if let Some(rate) = project_rate {
        if rate.is_finite() && rate > 0.0 {
            return Ok(rate);
        }
    }
    get_global_hourly_rate(tf)
}

fn local_date_from_unix(ended_at: f64) -> String {
    let secs = ended_at.trunc() as i64;
    let nsecs = ((ended_at.fract().abs()) * 1_000_000_000.0).round() as u32;
    let nsecs = nsecs.min(999_999_999);
    match chrono::Local.timestamp_opt(secs, nsecs) {
        chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => {
            dt.format("%Y-%m-%d").to_string()
        }
        chrono::LocalResult::None => chrono::Utc
            .timestamp_opt(secs, nsecs)
            .single()
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "1970-01-01".to_string()),
    }
}

pub fn ingest_cfab_render_into(
    tf: &mut Connection,
    hub: &Connection,
    project_id: i64,
) -> Result<CfabRenderIngestResult, String> {
    let projects = load_projects(tf)?;
    let coefficient = project_coefficient(tf, project_id)?;
    let rate = effective_hourly_rate(tf, project_id)?;

    let _ = rebuild_cfab_path_index(tf);
    let path_index = load_cfab_path_index(tf)?;
    let hub_rows = read_open_ledger(hub)?;

    let tx = tf.transaction().map_err(|e| e.to_string())?;

    let updated = tx
        .execute(
            "UPDATE cfab_render_cost
             SET coefficient = ?1,
                 value = (render_seconds / 3600.0) * ?1 * ?2
             WHERE project_id = ?3 AND (ABS(coefficient - ?1) > 1e-9 OR ABS(value - (render_seconds / 3600.0) * ?1 * ?2) > 1e-9)",
            rusqlite::params![coefficient, rate, project_id],
        )
        .map_err(|e| e.to_string())?;

    let ingested_at = chrono::Utc::now().to_rfc3339();
    let mut ingested = 0usize;

    for row in hub_rows {
        if match_project_with_index(&row.working_path, &projects, row.hint, &path_index) != Some(project_id) {
            continue;
        }

        let already_acked: bool = tx
            .query_row(
                "SELECT 1 FROM cfab_render_ack WHERE hub_instance_id = ?1 AND ledger_id = ?2",
                rusqlite::params![row.instance, row.ledger_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        if already_acked {
            continue;
        }

        let rbh = row.render_seconds / 3600.0;
        let value = rbh * coefficient * rate;
        tx.execute(
            "INSERT INTO cfab_render_cost (
                hub_instance_id, ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at, machine_name, thumbnail_path
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                row.instance,
                row.ledger_id,
                project_id,
                row.working_path,
                row.render_seconds,
                row.ended_at,
                rbh,
                coefficient,
                value,
                ingested_at,
                row.machine_name,
                row.thumbnail_path,
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO cfab_render_ack (
                hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract, thumbnail_path
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                row.instance,
                row.ledger_id,
                ingested_at,
                project_id,
                rbh,
                coefficient,
                row.contract,
                row.thumbnail_path,
            ],
        )
        .map_err(|e| e.to_string())?;
        ingested += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    let days = list_cfab_render_for_project(tf, project_id)?;
    Ok(CfabRenderIngestResult {
        ingested,
        updated,
        days,
    })
}

pub fn list_cfab_render_for_project(
    tf: &Connection,
    project_id: i64,
) -> Result<Vec<CfabRenderDay>, String> {
    let mut stmt = tf
        .prepare(
            "SELECT hub_instance_id, ledger_id, working_path, render_seconds, rbh, value, ended_at, thumbnail_path
             FROM cfab_render_cost
             WHERE project_id = ?1
             ORDER BY ended_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<CfabRenderRow> = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(CfabRenderRow {
                hub_instance_id: row.get(0)?,
                ledger_id: row.get(1)?,
                working_path: row.get(2)?,
                render_seconds: row.get(3)?,
                rbh: row.get(4)?,
                value: row.get(5)?,
                ended_at: row.get(6)?,
                thumbnail_path: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut by_date: BTreeMap<String, Vec<CfabRenderRow>> = BTreeMap::new();
    for row in rows {
        let date = local_date_from_unix(row.ended_at);
        by_date.entry(date).or_default().push(row);
    }

    Ok(by_date
        .into_iter()
        .rev()
        .filter(|(_, rows)| !rows.is_empty())
        .map(|(date, rows)| {
            let render_seconds: f64 = rows.iter().map(|r| r.render_seconds).sum();
            let rbh: f64 = rows.iter().map(|r| r.rbh).sum();
            let value: f64 = rows.iter().map(|r| r.value).sum();
            CfabRenderDay {
                date,
                render_seconds,
                rbh,
                value,
                rows,
            }
        })
        .collect())
}

/// Wrapper used when the Hub file may be missing: do not call ingest, return ingested=0.
pub fn ingest_cfab_render_from_hub_path(
    tf: &mut Connection,
    hub_path: &Path,
    project_id: i64,
) -> Result<CfabRenderIngestResult, String> {
    match open_foreign(hub_path)? {
        None => Ok(CfabRenderIngestResult {
            ingested: 0,
            updated: 0,
            days: list_cfab_render_for_project(tf, project_id)?,
        }),
        Some(hub) => ingest_cfab_render_into(tf, &hub, project_id),
    }
}

pub fn ingest_cfab_render_with_integration(
    tf: &mut Connection,
    settings: &CfabHubIntegration,
    project_id: i64,
) -> Result<CfabRenderIngestResult, String> {
    if !settings.enabled {
        return Ok(CfabRenderIngestResult {
            ingested: 0,
            updated: 0,
            days: list_cfab_render_for_project(tf, project_id)?,
        });
    }
    ingest_cfab_render_from_hub_path(tf, &hub_db_path_from(settings), project_id)
}

pub fn validate_coefficient(coefficient: f64) -> Result<(), String> {
    if !coefficient.is_finite() {
        return Err("Coefficient must be a finite number".to_string());
    }
    if coefficient <= 0.0 || coefficient > 100.0 {
        return Err("Coefficient must be in (0, 100]".to_string());
    }
    Ok(())
}

pub fn get_cfab_render_project_state(
    tf: &Connection,
    project_id: i64,
) -> Result<CfabRenderProjectState, String> {
    let (coefficient, include_in_billing, include_render_in_hours_limit) = load_project_settings(tf, project_id)?;
    Ok(CfabRenderProjectState {
        coefficient,
        include_in_billing,
        include_render_in_hours_limit,
        effective_hourly_rate: effective_hourly_rate(tf, project_id)?,
        days: list_cfab_render_for_project(tf, project_id)?,
    })
}

pub fn update_cfab_render_project_settings_in_conn(
    tf: &Connection,
    project_id: i64,
    coefficient: f64,
    include_in_billing: bool,
    include_render_in_hours_limit: Option<bool>,
) -> Result<CfabRenderProjectState, String> {
    validate_coefficient(coefficient)?;
    let rate = effective_hourly_rate(tf, project_id)?;
    let updated_at = chrono::Utc::now().to_rfc3339();
    let current_limit_setting = load_project_settings(tf, project_id)?.2;
    let include_limit = include_render_in_hours_limit.unwrap_or(current_limit_setting);
    tf.execute(
        "INSERT INTO cfab_render_project_settings (
            project_id, coefficient, include_in_billing, include_render_in_hours_limit, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(project_id) DO UPDATE SET
            coefficient = excluded.coefficient,
            include_in_billing = excluded.include_in_billing,
            include_render_in_hours_limit = excluded.include_render_in_hours_limit,
            updated_at = excluded.updated_at",
        rusqlite::params![
            project_id,
            coefficient,
            include_in_billing as i64,
            include_limit as i64,
            updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    tf.execute(
        "UPDATE cfab_render_cost
         SET coefficient = ?1,
             value = (render_seconds / 3600.0) * ?1 * ?2
         WHERE project_id = ?3",
        rusqlite::params![coefficient, rate, project_id],
    )
    .map_err(|e| e.to_string())?;
    get_cfab_render_project_state(tf, project_id)
}

#[tauri::command]
pub async fn get_cfab_render_project(
    app: AppHandle,
    project_id: i64,
) -> Result<CfabRenderProjectState, String> {
    run_db_blocking(app, move |conn| get_cfab_render_project_state(conn, project_id)).await
}

#[tauri::command]
pub async fn ingest_cfab_render_for_project(
    app: AppHandle,
    project_id: i64,
) -> Result<CfabRenderIngestResult, String> {
    run_db_blocking(app, move |conn| {
        ingest_cfab_render_with_integration(conn, &load_cfab_hub_integration(), project_id)
    })
    .await
}

#[tauri::command]
pub async fn get_cfab_hub_peer(app: AppHandle) -> Result<CfabHubPeerInfo, String> {
    run_db_blocking(app, |conn| get_cfab_hub_peer_info(conn)).await
}

#[tauri::command]
pub fn probe_cfab_hub_db(path: Option<String>) -> Result<String, String> {
    let resolved = match path.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(override_path) => PathBuf::from(override_path),
        None => hub_db_path(),
    };
    Ok(probe_hub_db(&resolved).to_string())
}

#[tauri::command]
pub async fn update_cfab_render_project_settings(
    app: AppHandle,
    project_id: i64,
    coefficient: f64,
    include_in_billing: bool,
    include_render_in_hours_limit: Option<bool>,
) -> Result<CfabRenderProjectState, String> {
    validate_coefficient(coefficient)?;
    run_db_blocking(app, move |conn| {
        update_cfab_render_project_settings_in_conn(
            conn,
            project_id,
            coefficient,
            include_in_billing,
            include_render_in_hours_limit,
        )
    })
    .await
}


pub fn get_unassigned_cfab_renders_in_conn(
    tf: &Connection,
    hub_path: &Path,
) -> Result<Vec<CfabUnassignedRenderRow>, String> {
    let hub_conn = match open_foreign(hub_path)? {
        Some(conn) => conn,
        None => return Ok(Vec::new()),
    };

    let projects = load_projects(tf)?;
    let _ = rebuild_cfab_path_index(tf);
    let path_index = load_cfab_path_index(tf)?;

    let hub_rows = read_open_ledger(&hub_conn)?;

    let mut ack_stmt = tf
        .prepare("SELECT hub_instance_id, ledger_id FROM cfab_render_ack")
        .map_err(|e| e.to_string())?;
    let ack_rows = ack_stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut acked_set = std::collections::HashSet::new();
    for r in ack_rows {
        acked_set.insert(r.map_err(|e| e.to_string())?);
    }

    let proj_names: HashMap<i64, String> = projects.iter().map(|p| (p.id, p.name.clone())).collect();

    let mut unassigned = Vec::new();
    for row in hub_rows {
        if acked_set.contains(&(row.instance.clone(), row.ledger_id)) {
            continue;
        }
        let matched_id = match_project_with_index(&row.working_path, &projects, row.hint, &path_index);
        let matched_name = matched_id.and_then(|id| proj_names.get(&id).cloned());

        unassigned.push(CfabUnassignedRenderRow {
            hub_instance_id: row.instance,
            ledger_id: row.ledger_id,
            working_path: row.working_path,
            render_seconds: row.render_seconds,
            rbh: row.render_seconds / 3600.0,
            ended_at: row.ended_at,
            machine_name: row.machine_name,
            thumbnail_path: row.thumbnail_path,
            matched_project_id: matched_id,
            matched_project_name: matched_name,
        });
    }

    unassigned.sort_by(|a, b| b.ended_at.partial_cmp(&a.ended_at).unwrap_or(std::cmp::Ordering::Equal));
    Ok(unassigned)
}

pub fn get_all_cfab_renders_in_conn(
    tf: &Connection,
    project_id: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<CfabAllRendersResponse, String> {
    let mut where_clauses = Vec::new();
    let mut params = Vec::<rusqlite::types::Value>::new();

    if let Some(pid) = project_id {
        where_clauses.push(format!("c.project_id = ?{}", params.len() + 1));
        params.push(pid.into());
    }

    if let Some(df) = date_from {
        if let Some(ts) = parse_date_boundary(&df, false) {
            where_clauses.push(format!("c.ended_at >= ?{}", params.len() + 1));
            params.push(ts.into());
        }
    }

    if let Some(dt) = date_to {
        if let Some(ts) = parse_date_boundary(&dt, true) {
            where_clauses.push(format!("c.ended_at <= ?{}", params.len() + 1));
            params.push(ts.into());
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let count_query = format!(
        "SELECT COUNT(*), COALESCE(SUM(c.render_seconds), 0.0), COALESCE(SUM(c.rbh), 0.0), COALESCE(SUM(c.value), 0.0)
         FROM cfab_render_cost c
         LEFT JOIN projects p ON p.id = c.project_id
         {where_sql}"
    );

    let (total, total_seconds, total_rbh, total_value): (i64, f64, f64, f64) = tf
        .query_row(&count_query, rusqlite::params_from_iter(params.iter()), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?;

    let lim = limit.unwrap_or(100).max(1);
    let off = offset.unwrap_or(0).max(0);

    let query = format!(
        "SELECT c.id, c.hub_instance_id, c.ledger_id, c.project_id, COALESCE(p.name, 'Unknown'),
                c.working_path, c.render_seconds, c.rbh, c.coefficient, c.value,
                c.ended_at, c.ingested_at, c.machine_name, c.assigned_by, c.assigned_at, c.thumbnail_path
         FROM cfab_render_cost c
         LEFT JOIN projects p ON p.id = c.project_id
         {where_sql}
         ORDER BY c.ended_at DESC, c.id DESC
         LIMIT ?{} OFFSET ?{}",
        params.len() + 1,
        params.len() + 2,
    );

    let mut list_params = params;
    list_params.push(lim.into());
    list_params.push(off.into());

    let mut stmt = tf.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(list_params.iter()), |r| {
            Ok(CfabRenderCostDetail {
                id: r.get(0)?,
                hub_instance_id: r.get(1)?,
                ledger_id: r.get(2)?,
                project_id: r.get(3)?,
                project_name: r.get(4)?,
                working_path: r.get(5)?,
                render_seconds: r.get(6)?,
                rbh: r.get(7)?,
                coefficient: r.get(8)?,
                value: r.get(9)?,
                ended_at: r.get(10)?,
                ingested_at: r.get(11)?,
                machine_name: r.get(12)?,
                assigned_by: r.get(13)?,
                assigned_at: r.get(14)?,
                thumbnail_path: r.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let items = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(CfabAllRendersResponse {
        total,
        total_seconds,
        total_rbh,
        total_value,
        items,
    })
}

pub fn assign_cfab_render_in_conn(
    tf: &mut Connection,
    hub_path: &Path,
    hub_instance_id: &str,
    ledger_id: i64,
    project_id: i64,
    remember_rule: bool,
) -> Result<(), String> {
    let hub_conn = open_foreign(hub_path)?
        .ok_or_else(|| "CFAB Hub database not accessible".to_string())?;

    let hub_row = read_single_hub_ledger(&hub_conn, hub_instance_id, ledger_id)?
        .ok_or_else(|| format!("Render record {hub_instance_id}:{ledger_id} not found in Hub"))?;

    let coefficient = project_coefficient(tf, project_id)?;
    let rate = effective_hourly_rate(tf, project_id)?;
    let rbh = hub_row.render_seconds / 3600.0;
    let value = rbh * coefficient * rate;
    let now = chrono::Utc::now().to_rfc3339();

    let tx = tf.transaction().map_err(|e| e.to_string())?;

    if remember_rule {
        let p = Path::new(&hub_row.working_path);
        if let Some(parent) = p.parent() {
            let parent_str = parent.to_string_lossy();
            let norm = normalize_path(&parent_str);
            if !norm.is_empty() && norm != "." {
                tx.execute(
                    "INSERT INTO cfab_project_path_index (folder_norm, project_id, source, updated_at)
                     VALUES (?1, ?2, 'manual', ?3)
                     ON CONFLICT(folder_norm) DO UPDATE SET
                         project_id = excluded.project_id,
                         source = 'manual',
                         updated_at = excluded.updated_at",
                    rusqlite::params![norm, project_id, now],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    tx.execute(
        "INSERT INTO cfab_render_cost (
            hub_instance_id, ledger_id, project_id, working_path, render_seconds,
            ended_at, rbh, coefficient, value, ingested_at, machine_name, assigned_by, assigned_at, thumbnail_path
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'manual', ?10, ?12)
        ON CONFLICT(hub_instance_id, ledger_id) DO UPDATE SET
            project_id = excluded.project_id,
            coefficient = excluded.coefficient,
            value = excluded.value,
            assigned_by = 'manual',
            assigned_at = excluded.assigned_at,
            thumbnail_path = COALESCE(excluded.thumbnail_path, cfab_render_cost.thumbnail_path)",
        rusqlite::params![
            hub_row.instance,
            hub_row.ledger_id,
            project_id,
            hub_row.working_path,
            hub_row.render_seconds,
            hub_row.ended_at,
            rbh,
            coefficient,
            value,
            now,
            hub_row.machine_name,
            hub_row.thumbnail_path,
        ],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO cfab_render_ack (
            hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract, assigned_by, assigned_at, thumbnail_path
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', ?3, ?8)
        ON CONFLICT(hub_instance_id, ledger_id) DO UPDATE SET
            project_id = excluded.project_id,
            coefficient = excluded.coefficient,
            assigned_by = 'manual',
            assigned_at = excluded.assigned_at,
            thumbnail_path = COALESCE(excluded.thumbnail_path, cfab_render_ack.thumbnail_path)",
        rusqlite::params![
            hub_row.instance,
            hub_row.ledger_id,
            now,
            project_id,
            rbh,
            coefficient,
            hub_row.contract,
            hub_row.thumbnail_path,
        ],
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reassign_cfab_render_in_conn(
    tf: &mut Connection,
    hub_instance_id: &str,
    ledger_id: i64,
    new_project_id: i64,
) -> Result<(), String> {
    let (render_seconds,): (f64,) = tf
        .query_row(
            "SELECT render_seconds FROM cfab_render_cost WHERE hub_instance_id = ?1 AND ledger_id = ?2",
            rusqlite::params![hub_instance_id, ledger_id],
            |r| Ok((r.get(0)?,)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Render record {hub_instance_id}:{ledger_id} not found in costs"))?;

    let coefficient = project_coefficient(tf, new_project_id)?;
    let rate = effective_hourly_rate(tf, new_project_id)?;
    let rbh = render_seconds / 3600.0;
    let value = rbh * coefficient * rate;
    let now = chrono::Utc::now().to_rfc3339();

    let tx = tf.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE cfab_render_cost
         SET project_id = ?1, coefficient = ?2, value = ?3, assigned_by = 'manual', assigned_at = ?4
         WHERE hub_instance_id = ?5 AND ledger_id = ?6",
        rusqlite::params![new_project_id, coefficient, value, now, hub_instance_id, ledger_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE cfab_render_ack
         SET project_id = ?1, coefficient = ?2, assigned_by = 'manual', assigned_at = ?3
         WHERE hub_instance_id = ?4 AND ledger_id = ?5",
        rusqlite::params![new_project_id, coefficient, now, hub_instance_id, ledger_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn detach_cfab_render_in_conn(
    tf: &mut Connection,
    hub_instance_id: &str,
    ledger_id: i64,
) -> Result<(), String> {
    let tx = tf.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM cfab_render_cost WHERE hub_instance_id = ?1 AND ledger_id = ?2",
        rusqlite::params![hub_instance_id, ledger_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM cfab_render_ack WHERE hub_instance_id = ?1 AND ledger_id = ?2",
        rusqlite::params![hub_instance_id, ledger_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_unassigned_cfab_renders(
    app: AppHandle,
) -> Result<Vec<CfabUnassignedRenderRow>, String> {
    run_db_blocking(app, move |conn| {
        let settings = load_cfab_hub_integration();
        let hub_path = hub_db_path_from(&settings);
        get_unassigned_cfab_renders_in_conn(conn, &hub_path)
    })
    .await
}

#[tauri::command]
pub async fn get_all_cfab_renders(
    app: AppHandle,
    project_id: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<CfabAllRendersResponse, String> {
    run_db_blocking(app, move |conn| {
        get_all_cfab_renders_in_conn(conn, project_id, date_from, date_to, limit, offset)
    })
    .await
}

#[tauri::command]
pub async fn assign_cfab_render(
    app: AppHandle,
    hub_instance_id: String,
    ledger_id: i64,
    project_id: i64,
    remember_rule: bool,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let settings = load_cfab_hub_integration();
        let hub_path = hub_db_path_from(&settings);
        assign_cfab_render_in_conn(
            conn,
            &hub_path,
            &hub_instance_id,
            ledger_id,
            project_id,
            remember_rule,
        )
    })
    .await
}

#[tauri::command]
pub async fn reassign_cfab_render(
    app: AppHandle,
    hub_instance_id: String,
    ledger_id: i64,
    new_project_id: i64,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        reassign_cfab_render_in_conn(conn, &hub_instance_id, ledger_id, new_project_id)
    })
    .await
}

#[tauri::command]
pub async fn detach_cfab_render(
    app: AppHandle,
    hub_instance_id: String,
    ledger_id: i64,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        detach_cfab_render_in_conn(conn, &hub_instance_id, ledger_id)
    })
    .await
}


pub fn find_dcc_document_in_hub(
    hub: &Connection,
    app_name: &str,
    start_ts: f64,
    end_ts: f64,
) -> Result<Option<String>, String> {
    let app_lower = app_name.to_lowercase();
    let app_code = if app_lower.contains("c4d") || app_lower.contains("cinema") {
        "c4d"
    } else if app_lower.contains("blender") {
        "blender"
    } else {
        &app_lower
    };

    let has_dcc_act = hub
        .prepare("SELECT 1 FROM dcc_activity LIMIT 1")
        .is_ok();
    if !has_dcc_act {
        return Ok(None);
    }

    // 1. Try to find activity inside the window
    let mut stmt = hub
        .prepare(
            "SELECT document_path FROM dcc_activity
             WHERE app = ?1 AND at >= ?2 AND at <= ?3
             ORDER BY at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let in_window = stmt
        .query_row(rusqlite::params![app_code, start_ts, end_ts], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;

    if in_window.is_some() {
        return Ok(in_window);
    }

    // 2. Fallback: latest activity before end_ts (up to 4 hours earlier)
    let lookback = start_ts - 14400.0;
    let mut stmt2 = hub
        .prepare(
            "SELECT document_path FROM dcc_activity
             WHERE app = ?1 AND at <= ?2 AND at >= ?3
             ORDER BY at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let prior = stmt2
        .query_row(rusqlite::params![app_code, end_ts, lookback], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(prior)
}

pub fn infer_dcc_project_from_hub(
    tf: &Connection,
    hub: &Connection,
    app_name: &str,
    start_ts: f64,
    end_ts: f64,
) -> Result<Option<i64>, String> {
    let doc = find_dcc_document_in_hub(hub, app_name, start_ts, end_ts)?;
    let Some(working_path) = doc else {
        return Ok(None);
    };

    let projects = load_projects(tf)?;
    let _ = rebuild_cfab_path_index(tf);
    let path_index = load_cfab_path_index(tf)?;

    Ok(match_project_with_index(&working_path, &projects, None, &path_index))
}

pub fn get_render_overlap_seconds(
    hub: &Connection,
    start_ts: f64,
    end_ts: f64,
) -> Result<f64, String> {
    if end_ts <= start_ts {
        return Ok(0.0);
    }

    let has_ledger = hub
        .prepare("SELECT 1 FROM render_ledger LIMIT 1")
        .is_ok();
    if !has_ledger {
        return Ok(0.0);
    }

    let mut stmt = hub
        .prepare(
            "SELECT started_at, ended_at FROM render_ledger
             WHERE ended_at > ?1 AND started_at < ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![start_ts, end_ts], |row| {
            Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut total_overlap = 0.0;
    for r in rows {
        let (s_at, e_at) = r.map_err(|e| e.to_string())?;
        let s = s_at.max(start_ts);
        let e = e_at.min(end_ts);
        if e > s {
            total_overlap += e - s;
        }
    }

    let max_dur = end_ts - start_ts;
    Ok(total_overlap.min(max_dur))
}

#[tauri::command]
pub async fn infer_dcc_session_project(
    app: AppHandle,
    app_name: String,
    start_ts: f64,
    end_ts: f64,
) -> Result<Option<i64>, String> {
    run_db_blocking(app, move |conn| {
        let settings = load_cfab_hub_integration();
        let hub_path = hub_db_path_from(&settings);
        match open_foreign(&hub_path)? {
            Some(hub) => infer_dcc_project_from_hub(conn, &hub, &app_name, start_ts, end_ts),
            None => Ok(None),
        }
    })
    .await
}

#[tauri::command]
pub async fn get_dcc_render_overlap(
    app: AppHandle,
    start_ts: f64,
    end_ts: f64,
) -> Result<f64, String> {
    run_db_blocking(app, move |_conn| {
        let settings = load_cfab_hub_integration();
        let hub_path = hub_db_path_from(&settings);
        match open_foreign(&hub_path)? {
            Some(hub) => get_render_overlap_seconds(&hub, start_ts, end_ts),
            None => Ok(0.0),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    use super::*;
    use chrono::{Local, TimeZone};
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn setup_tf() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                assigned_folder_path TEXT,
                frozen_at TEXT,
                excluded_at TEXT,
                merged_into TEXT,
                hourly_rate REAL
            );
            CREATE TABLE estimate_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        crate::db_migrations::m29_cfab_render::run(&conn).unwrap();
        crate::db_migrations::m30_cfab_render_instance::run(&conn).unwrap();
        crate::db_migrations::m31_cfab_path_index_and_manual::run(&conn).unwrap();
        crate::db_migrations::m32_cfab_thumbnails_and_project_summary::run(&conn).unwrap();
        conn
    }

    fn insert_project(
        conn: &Connection,
        id: i64,
        name: &str,
        folder: &str,
        frozen_at: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO projects (id, name, assigned_folder_path, frozen_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, name, folder, frozen_at],
        )
        .unwrap();
    }

    fn setup_hub() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER,
                working_path TEXT NOT NULL,
                output_path TEXT,
                render_seconds REAL NOT NULL,
                started_at REAL,
                ended_at REAL NOT NULL,
                source TEXT NOT NULL,
                project_hint INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 1
            );",
        )
        .unwrap();
        conn
    }

    fn insert_open_ledger(
        hub: &Connection,
        working_path: &str,
        render_seconds: f64,
        ended_at: f64,
    ) -> i64 {
        hub.execute(
            "INSERT INTO render_ledger (
                job_id, working_path, render_seconds, started_at, ended_at, source, status, contract
            ) VALUES (1, ?1, ?2, ?3, ?3, 'test', 'open', 1)",
            rusqlite::params![working_path, render_seconds, ended_at],
        )
        .unwrap();
        hub.last_insert_rowid()
    }

    fn temp_test_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "cfab_test_dir_{}_{}_{}",
            tag,
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_db_path(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cfab_render_{}_{}_{}.db",
            tag,
            std::process::id(),
            nanos
        ))
    }

    fn project(id: i64, name: &str, folder: &str) -> ProjectRow {
        ProjectRow {
            id,
            name: name.to_string(),
            assigned_folder_path: Some(folder.to_string()),
            frozen_at: None,
            excluded_at: None,
            merged_into: None,
        }
    }

    #[test]
    fn hub_db_path_ends_with_c4dwatch_db() {
        let _lock = ENV_LOCK.lock().unwrap();
        let dir = temp_test_dir("canon1");
        std::env::set_var("CFAB_INTEGRATION_DIR", &dir);
        let path = hub_db_path_from(&CfabHubIntegration::default());
        let posix = path.to_string_lossy().replace('\\', "/");
        assert!(
            posix.ends_with("c4dwatch/c4dwatch.db"),
            "hub_db_path should end with c4dwatch/c4dwatch.db, got {posix}"
        );
        #[cfg(target_os = "macos")]
        assert!(
            posix.contains("Library/Application Support/c4dwatch"),
            "macOS hub path should use Application Support/c4dwatch, got {posix}"
        );
        std::env::remove_var("CFAB_INTEGRATION_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_foreign_missing_file_returns_none() {
        let path = std::env::temp_dir().join(format!(
            "cfab_missing_hub_{}_{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&path);
        let opened = open_foreign(&path).expect("open_foreign must not panic");
        assert!(opened.is_none(), "missing Hub file must yield None");
        assert!(!path.exists(), "must not create the Hub file");
    }

    #[test]
    fn missing_hub_wrapper_returns_ingested_zero() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let missing = std::env::temp_dir().join(format!(
            "cfab_missing_wrapper_{}_{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&missing);
        let result = ingest_cfab_render_from_hub_path(&mut tf, &missing, 1)
            .expect("missing Hub must not panic");
        assert_eq!(result.ingested, 0);
        assert!(!missing.exists(), "wrapper must not create Hub file");
    }

    #[test]
    fn open_foreign_query_only_blocks_insert() {
        let path = temp_db_path("query_only");
        let _ = std::fs::remove_file(&path);
        {
            let setup = Connection::open(&path).unwrap();
            setup
                .execute_batch("CREATE TABLE render_ledger (id INTEGER PRIMARY KEY);")
                .unwrap();
        }
        let hub = open_foreign(&path)
            .expect("open")
            .expect("file exists so Some");
        let err = hub
            .execute("INSERT INTO render_ledger (id) VALUES (1)", [])
            .expect_err("query_only must reject INSERT");
        let msg = err.to_string().to_lowercase();
        assert!(
            msg.contains("readonly") || msg.contains("read-only") || msg.contains("query_only"),
            "expected read-only error, got: {err}"
        );
        drop(hub);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn normalize_path_backslashes_and_trailing_slash() {
        let got = normalize_path(r"C:\Work\A\\");
        #[cfg(any(windows, target_os = "macos"))]
        assert_eq!(got, "c:/work/a");
        #[cfg(not(any(windows, target_os = "macos")))]
        assert_eq!(got, "C:/Work/A");
    }

    #[test]
    fn match_project_longest_prefix_wins() {
        let projects = vec![
            project(1, "Root", "/work"),
            project(2, "Scene", "/work/A"),
        ];
        assert_eq!(match_project("/work/A/scena.c4d", &projects, None), Some(2));
    }

    #[test]
    fn match_project_merge_excluded_parent_is_none() {
        let projects = vec![
            ProjectRow {
                id: 10,
                name: "Parent".into(),
                assigned_folder_path: Some("/work/parent".into()),
                frozen_at: None,
                excluded_at: Some("2026-04-01T10:00:00+02:00".into()),
                merged_into: None,
            },
            ProjectRow {
                id: 20,
                name: "Child".into(),
                assigned_folder_path: Some("/work/child".into()),
                frozen_at: None,
                excluded_at: None,
                merged_into: Some("Parent".into()),
            },
        ];
        assert_eq!(
            match_project("/work/child/scena.c4d", &projects, None),
            None
        );
    }

    #[test]
    fn ingest_matching_open_row_then_second_pass_skips_insert() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        let ledger_id = insert_open_ledger(&hub, "/work/A/scena.c4d", 3600.0, ended);

        let first = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(first.ingested, 1);

        let ack: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_ack WHERE ledger_id = ?1 AND project_id = 1",
                [ledger_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ack, 1);

        let value: f64 = tf
            .query_row(
                "SELECT value FROM cfab_render_cost WHERE ledger_id = ?1",
                [ledger_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            (value - 20.0).abs() < 1e-9,
            "3600s * 0.2 * 100 = 20, got {value}"
        );

        let second = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(second.ingested, 0);
        assert_eq!(second.updated, 0, "second pass without rate change must not recompute");

        let costs: i64 = tf
            .query_row("SELECT COUNT(*) FROM cfab_render_cost", [], |row| row.get(0))
            .unwrap();
        assert_eq!(costs, 1, "same ledger must not duplicate cost");
    }

    #[test]
    fn ingest_does_not_ack_other_project_rows() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        insert_project(&tf, 2, "B", "/work/B", None);
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        let id_a = insert_open_ledger(&hub, "/work/A/a.c4d", 3600.0, ended);
        let id_b = insert_open_ledger(&hub, "/work/B/b.c4d", 1800.0, ended);

        ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();

        let ack_a: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_ack WHERE ledger_id = ?1",
                [id_a],
                |row| row.get(0),
            )
            .unwrap();
        let ack_b: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_ack WHERE ledger_id = ?1",
                [id_b],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ack_a, 1);
        assert_eq!(ack_b, 0, "ingest(A) must not ACK a row matching B");
    }

    #[test]
    fn ingest_accepts_frozen_project() {
        let mut tf = setup_tf();
        insert_project(&tf, 7, "Frozen", "/work/frozen", Some("2026-04-01T10:00:00+02:00"));
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        insert_open_ledger(&hub, "/work/frozen/scena.c4d", 3600.0, ended);

        let result = ingest_cfab_render_into(&mut tf, &hub, 7).unwrap();
        assert_eq!(result.ingested, 1);
    }

    #[test]
    fn list_groups_two_days_with_sums_descending() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub();
        let day_old = Local
            .with_ymd_and_hms(2026, 3, 1, 15, 0, 0)
            .unwrap()
            .timestamp() as f64;
        let day_new = Local
            .with_ymd_and_hms(2026, 3, 3, 15, 0, 0)
            .unwrap()
            .timestamp() as f64;
        insert_open_ledger(&hub, "/work/A/old.c4d", 3600.0, day_old);
        insert_open_ledger(&hub, "/work/A/new.c4d", 7200.0, day_new);

        ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        let days = list_cfab_render_for_project(&tf, 1).unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].date, "2026-03-03");
        assert_eq!(days[1].date, "2026-03-01");
        assert!((days[0].render_seconds - 7200.0).abs() < 1e-9);
        assert!((days[1].render_seconds - 3600.0).abs() < 1e-9);
        assert!((days[0].rbh - 2.0).abs() < 1e-9);
        assert!((days[1].rbh - 1.0).abs() < 1e-9);
        assert!((days[0].value - 40.0).abs() < 1e-9);
        assert!((days[1].value - 20.0).abs() < 1e-9);
        assert_eq!(days[0].rows.len(), 1);
        assert_eq!(days[1].rows.len(), 1);
    }

    #[test]
    fn validate_coefficient_rejects_non_finite_and_out_of_range() {
        assert!(validate_coefficient(f64::NAN).is_err());
        assert!(validate_coefficient(f64::INFINITY).is_err());
        assert!(validate_coefficient(0.0).is_err());
        assert!(validate_coefficient(-0.1).is_err());
        assert!(validate_coefficient(100.1).is_err());
        assert!(validate_coefficient(0.2).is_ok());
        assert!(validate_coefficient(100.0).is_ok());
    }

    #[test]
    fn get_state_defaults_when_no_settings_row() {
        let tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        tf.execute(
            "INSERT INTO estimate_settings (key, value, updated_at)
             VALUES ('global_hourly_rate', '100', datetime('now'))",
            [],
        )
        .unwrap();
        let state = get_cfab_render_project_state(&tf, 1).unwrap();
        assert!((state.coefficient - 0.2).abs() < 1e-9);
        assert!(!state.include_in_billing);
        assert!((state.effective_hourly_rate - 100.0).abs() < 1e-9);
        assert!(state.days.is_empty());
    }

    #[test]
    fn update_settings_rejects_invalid_coefficient_without_write() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let err = update_cfab_render_project_settings_in_conn(&mut tf, 1, 0.0, true, None)
            .expect_err("zero coefficient must be rejected");
        assert!(!err.is_empty());
        let count: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_project_settings",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "invalid coefficient must not persist settings");
    }

    #[test]
    fn update_settings_upserts_and_recomputes_cost_value() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        insert_open_ledger(&hub, "/work/A/scena.c4d", 3600.0, ended);
        ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();

        let state =
            update_cfab_render_project_settings_in_conn(&mut tf, 1, 0.5, true, None).unwrap();
        assert!((state.coefficient - 0.5).abs() < 1e-9);
        assert!(state.include_in_billing);

        let (coeff, include): (f64, i64) = tf
            .query_row(
                "SELECT coefficient, include_in_billing FROM cfab_render_project_settings
                 WHERE project_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!((coeff - 0.5).abs() < 1e-9);
        assert_eq!(include, 1);

        let value: f64 = tf
            .query_row(
                "SELECT value FROM cfab_render_cost WHERE project_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            (value - 50.0).abs() < 1e-9,
            "3600s * 0.5 * 100 = 50, got {value}"
        );
    }

    fn insert_cost_row(conn: &Connection, project_id: i64, value: f64) {
        conn.execute(
            "INSERT INTO cfab_render_cost (
                hub_instance_id, ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at, machine_name
            ) VALUES ('legacy', ?1, ?2, '/work/A/scena.c4d', 3600.0, 1.0, 1.0, 0.2, ?3, '2026-03-15T12:00:00Z', NULL)",
            rusqlite::params![project_id, project_id, value],
        )
        .unwrap();
    }

    fn set_include_in_billing(conn: &Connection, project_id: i64, include: bool) {
        conn.execute(
            "INSERT INTO cfab_render_project_settings (
                project_id, coefficient, include_in_billing, updated_at
            ) VALUES (?1, 0.2, ?2, '2026-03-15T12:00:00Z')
            ON CONFLICT(project_id) DO UPDATE SET include_in_billing = excluded.include_in_billing",
            rusqlite::params![project_id, include as i64],
        )
        .unwrap();
    }

    #[test]
    fn billing_addend_zero_when_settings_missing_or_include_off() {
        let tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        insert_cost_row(&tf, 1, 20.0);

        let missing = cfab_render_billing_addend(&tf, 1).unwrap();
        assert!(
            (missing - 0.0).abs() < 1e-9,
            "missing settings row must yield 0, got {missing}"
        );

        set_include_in_billing(&tf, 1, false);
        let off = cfab_render_billing_addend(&tf, 1).unwrap();
        assert!(
            (off - 0.0).abs() < 1e-9,
            "include_in_billing=0 must not add cost 20, got {off}"
        );
    }

    #[test]
    fn billing_addend_sums_value_when_include_on() {
        let tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        insert_cost_row(&tf, 1, 20.0);
        set_include_in_billing(&tf, 1, true);

        let addend = cfab_render_billing_addend(&tf, 1).unwrap();
        assert!(
            (addend - 20.0).abs() < 1e-9,
            "3600s * 0.2 * 100 = 20, include=1 must add 20, got {addend}"
        );
    }

    #[test]
    fn list_shows_cost_values_regardless_of_billing_toggle() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        insert_open_ledger(&hub, "/work/A/scena.c4d", 3600.0, ended);
        ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        set_include_in_billing(&tf, 1, false);

        let days = list_cfab_render_for_project(&tf, 1).unwrap();
        assert_eq!(days.len(), 1);
        assert!(
            (days[0].value - 20.0).abs() < 1e-9,
            "card list must show 20 even with include_in_billing=0, got {}",
            days[0].value
        );
        let addend = cfab_render_billing_addend(&tf, 1).unwrap();
        assert!((addend - 0.0).abs() < 1e-9);
    }

    #[test]
    fn ingest_project_without_assigned_folder_returns_zero() {
        let mut tf = setup_tf();
        tf.execute(
            "INSERT INTO projects (id, name, assigned_folder_path)
             VALUES (9, 'NoFolder', NULL)",
            [],
        )
        .unwrap();
        let hub = setup_hub();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        insert_open_ledger(&hub, "/work/elsewhere/scena.c4d", 3600.0, ended);
        let result = ingest_cfab_render_into(&mut tf, &hub, 9).unwrap();
        assert_eq!(result.ingested, 0);
        assert!(result.days.is_empty());
    }

    #[test]
    fn hub_db_path_empty_override_is_canonical() {
        let _lock = ENV_LOCK.lock().unwrap();
        let dir = temp_test_dir("canon2");
        std::env::set_var("CFAB_INTEGRATION_DIR", &dir);
        let path = hub_db_path_from(&CfabHubIntegration {
            enabled: true,
            hub_db_path: String::new(),
        });
        let posix = path.to_string_lossy().replace('\\', "/");
        assert!(
            posix.ends_with("c4dwatch/c4dwatch.db"),
            "empty override must use canonical c4dwatch.db, got {posix}"
        );
        std::env::remove_var("CFAB_INTEGRATION_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hub_db_path_override_wins() {
        let path = hub_db_path_from(&CfabHubIntegration {
            enabled: true,
            hub_db_path: "/tmp/history.db".into(),
        });
        assert_eq!(path, PathBuf::from("/tmp/history.db"));
    }

    #[test]
    fn load_integration_reads_user_settings_json() {
        let dir = std::env::temp_dir().join(format!(
            "cfab_hub_settings_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("user_settings.json"),
            r#"{"timeflow.settings.cfab-hub-integration":{"enabled":false,"hubDbPath":"/tmp/h.db"}}"#,
        )
        .unwrap();
        let loaded = load_cfab_hub_integration_from(&dir);
        assert!(!loaded.enabled);
        assert_eq!(loaded.hub_db_path, "/tmp/h.db");
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn file_hub_with_open_row(tag: &str, working_path: &str) -> (PathBuf, i64) {
        let hub_path = temp_db_path(tag);
        let hub = Connection::open(&hub_path).unwrap();
        hub.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER,
                working_path TEXT NOT NULL,
                output_path TEXT,
                render_seconds REAL NOT NULL,
                started_at REAL,
                ended_at REAL NOT NULL,
                source TEXT NOT NULL,
                project_hint INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 1
            );",
        )
        .unwrap();
        let ended = Local
            .with_ymd_and_hms(2026, 3, 15, 12, 0, 0)
            .unwrap()
            .timestamp() as f64;
        let ledger_id = insert_open_ledger(&hub, working_path, 3600.0, ended);
        drop(hub);
        (hub_path, ledger_id)
    }

    #[test]
    fn ingest_override_hub_db_path_reads_tmp_ledger() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let (hub_path, ledger_id) = file_hub_with_open_row("override_hub", "/work/A/scena.c4d");
        let settings = CfabHubIntegration {
            enabled: true,
            hub_db_path: hub_path.to_string_lossy().into_owned(),
        };
        let result = ingest_cfab_render_with_integration(&mut tf, &settings, 1).unwrap();
        assert_eq!(result.ingested, 1);
        let ack: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_ack WHERE ledger_id = ?1",
                [ledger_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ack, 1);
        let _ = std::fs::remove_file(&hub_path);
    }

    #[test]
    fn ingest_disabled_is_noop_without_ack() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let (hub_path, ledger_id) = file_hub_with_open_row("disabled_hub", "/work/A/scena.c4d");
        let settings = CfabHubIntegration {
            enabled: false,
            hub_db_path: hub_path.to_string_lossy().into_owned(),
        };
        let result = ingest_cfab_render_with_integration(&mut tf, &settings, 1).unwrap();
        assert_eq!(result.ingested, 0);
        let ack: i64 = tf
            .query_row(
                "SELECT COUNT(*) FROM cfab_render_ack WHERE ledger_id = ?1",
                [ledger_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ack, 0);
        let _ = std::fs::remove_file(&hub_path);
    }

    #[test]
    fn ingest_contract1_without_hub_instance_id_column() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub(); // contract 1, no hub_instance_id column
        let ended = Local.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap().timestamp() as f64;
        insert_open_ledger(&hub, "/work/A/scena.c4d", 3600.0, ended);
        let result = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(result.ingested, 1);
        let (inst, count): (String, i64) = tf.query_row(
            "SELECT hub_instance_id, COUNT(*) FROM cfab_render_ack WHERE ledger_id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?))
        ).unwrap();
        assert_eq!(inst, "legacy");
        assert_eq!(count, 1);
    }

    #[test]
    fn ingest_contract2_with_instance_id_and_collision_resolution() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        tf.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('legacy', 5, '2026-03-15T10:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).unwrap();

        let hub = Connection::open_in_memory().unwrap();
        hub.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                ended_at REAL NOT NULL,
                project_hint INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 2,
                hub_instance_id TEXT,
                machine_name TEXT
            );
            INSERT INTO render_ledger (id, working_path, render_seconds, ended_at, status, contract, hub_instance_id, machine_name)
            VALUES (5, '/work/A/scena.c4d', 3600.0, 123456789.0, 'open', 2, 'inst-A', 'node-1');",
        ).unwrap();

        let result = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(result.ingested, 1, "Must ingest row 5 for inst-A even if legacy 5 exists");

        let result2 = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(result2.ingested, 0);

        let (inst, machine): (String, Option<String>) = tf.query_row(
            "SELECT hub_instance_id, machine_name FROM cfab_render_cost WHERE hub_instance_id = 'inst-A' AND ledger_id = 5",
            [],
            |r| Ok((r.get(0)?, r.get(1)?))
        ).unwrap();
        assert_eq!(inst, "inst-A");
        assert_eq!(machine.as_deref(), Some("node-1"));
    }

    #[test]
    fn ingest_contract1_legacy_row_already_acked_is_skipped() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        tf.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('legacy', 5, '2026-03-15T10:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).unwrap();

        let hub = Connection::open_in_memory().unwrap();
        hub.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                ended_at REAL NOT NULL,
                project_hint INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 1,
                hub_instance_id TEXT,
                machine_name TEXT
            );
            INSERT INTO render_ledger (id, working_path, render_seconds, ended_at, status, contract, hub_instance_id)
            VALUES (5, '/work/A/scena.c4d', 3600.0, 123456789.0, 'open', 1, NULL);",
        ).unwrap();

        let result = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(result.ingested, 0, "Already acked legacy row 5 must be skipped");
    }

    #[test]
    fn ingest_skips_contract_4_without_error() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = Connection::open_in_memory().unwrap();
        hub.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                ended_at REAL NOT NULL,
                project_hint INTEGER,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL,
                hub_instance_id TEXT
            );
            INSERT INTO render_ledger (id, working_path, render_seconds, ended_at, status, contract, hub_instance_id)
            VALUES (10, '/work/A/future.c4d', 3600.0, 123456789.0, 'open', 4, 'hub-x');",
        ).unwrap();

        let result = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(result.ingested, 0, "Unknown contract 4 must be skipped");
    }

    #[test]
    fn ingest_updates_only_on_rate_or_coefficient_change() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "A", "/work/A", None);
        let hub = setup_hub();
        let ended = Local.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap().timestamp() as f64;
        insert_open_ledger(&hub, "/work/A/scena.c4d", 3600.0, ended);

        let res1 = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(res1.ingested, 1);
        assert_eq!(res1.updated, 0);

        // Second click without change -> updated = 0
        let res2 = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(res2.ingested, 0);
        assert_eq!(res2.updated, 0);

        // Change project rate
        tf.execute("UPDATE projects SET hourly_rate = 200.0 WHERE id = 1", []).unwrap();
        let res3 = ingest_cfab_render_into(&mut tf, &hub, 1).unwrap();
        assert_eq!(res3.ingested, 0);
        assert_eq!(res3.updated, 1);
    }

    #[test]
    fn hub_db_path_source_resolution() {
        let _lock = ENV_LOCK.lock().unwrap();
        let dir = temp_test_dir("source_res");
        std::env::set_var("CFAB_INTEGRATION_DIR", &dir);

        // 1. Override wins
        let s_override = CfabHubIntegration {
            enabled: true,
            hub_db_path: "/custom/h.db".to_string(),
        };
        let (p1, src1) = resolve_hub_db_path_with_source(&s_override);
        assert_eq!(p1, PathBuf::from("/custom/h.db"));
        assert_eq!(src1, "override");

        // 2. Beacon used if file exists
        let empty_settings = CfabHubIntegration::default();
        let fake_db = dir.join("fake_history.db");
        std::fs::write(&fake_db, "sqlite").unwrap();

        let beacon = Beacon {
            schema: 1,
            app: "hub".to_string(),
            version: "0.15".to_string(),
            db_path: fake_db.to_string_lossy().into_owned(),
            instance_id: None,
            contracts: HashMap::new(),
            pid: 1,
            started_at: 1.0,
            heartbeat_at: 1.0,
        };
        timeflow_shared::cfab_integration::write_beacon_in_dir(&dir, "hub", &beacon).unwrap();

        let (p2, src2) = resolve_hub_db_path_with_source(&empty_settings);
        assert_eq!(p2, fake_db);
        assert_eq!(src2, "beacon");

        // 3. Beacon points to non-existent file -> fallback to canonical
        let missing_beacon = Beacon {
            db_path: "/does/not/exist.db".to_string(),
            ..beacon
        };
        timeflow_shared::cfab_integration::write_beacon_in_dir(&dir, "hub", &missing_beacon).unwrap();
        let (p3, src3) = resolve_hub_db_path_with_source(&empty_settings);
        assert_eq!(src3, "canonical");
        assert!(p3.to_string_lossy().ends_with("c4dwatch.db"));

        std::env::remove_var("CFAB_INTEGRATION_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }


    #[test]
    fn path_index_rebuild_and_manual_override() {
        let tf = setup_tf();
        insert_project(&tf, 1, "Alpha", "/work/alpha", None);
        insert_project(&tf, 2, "Beta", "/work/beta", None);

        let count = rebuild_cfab_path_index(&tf).unwrap();
        assert_eq!(count, 2);

        let idx = load_cfab_path_index(&tf).unwrap();
        assert_eq!(idx.len(), 2);

        // Add a manual rule for a subfolder
        let now = chrono::Utc::now().to_rfc3339();
        tf.execute(
            "INSERT INTO cfab_project_path_index (folder_norm, project_id, source, updated_at)
             VALUES ('/work/alpha/special', 2, 'manual', ?1)",
            rusqlite::params![now],
        ).unwrap();

        // Rebuild again: manual rule must not be overwritten
        rebuild_cfab_path_index(&tf).unwrap();
        let idx2 = load_cfab_path_index(&tf).unwrap();
        assert_eq!(idx2.len(), 3);
        let special = idx2.iter().find(|(f, _, _)| f == "/work/alpha/special").unwrap();
        assert_eq!(special.1, 2);
        assert_eq!(special.2, "manual");

        let projects = load_projects(&tf).unwrap();
        // Path in /work/alpha/special matches project 2 (special), not 1 (alpha)
        let m = match_project_with_index("/work/alpha/special/shot1.c4d", &projects, None, &idx2);
        assert_eq!(m, Some(2));

        // Path in /work/alpha/normal matches project 1
        let m2 = match_project_with_index("/work/alpha/normal/shot1.c4d", &projects, None, &idx2);
        assert_eq!(m2, Some(1));
    }

    #[test]
    fn assign_reassign_detach_lifecycle() {
        let mut tf = setup_tf();
        insert_project(&tf, 1, "Proj1", "/work/p1", None);
        insert_project(&tf, 2, "Proj2", "/work/p2", None);

        let ended = 1710500000.0;
        let hub_dir = temp_test_dir("hub_assign");
        let hub_path = hub_dir.join("c4dwatch.db");
        let hub_conn = Connection::open(&hub_path).unwrap();
        hub_conn.execute_batch(
            "CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY,
                hub_instance_id TEXT NOT NULL,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                started_at REAL,
                ended_at REAL NOT NULL,
                source TEXT NOT NULL,
                project_hint INTEGER,
                machine_name TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 2
            );",
        ).unwrap();
        hub_conn.execute(
            "INSERT INTO render_ledger (
                id, hub_instance_id, working_path, render_seconds, started_at, ended_at, source, machine_name, status, contract
            ) VALUES (10, 'hub-abc', '/unknown/folder/scene.c4d', 3600.0, ?1, ?1, 'c4d', 'MacBook-Pro', 'open', 2)",
            rusqlite::params![ended],
        ).unwrap();

        // 1. Check unassigned
        let unassigned = get_unassigned_cfab_renders_in_conn(&tf, &hub_path).unwrap();
        assert_eq!(unassigned.len(), 1);
        assert_eq!(unassigned[0].ledger_id, 10);
        assert_eq!(unassigned[0].matched_project_id, None);

        // 2. Assign with remember_rule = true
        assign_cfab_render_in_conn(&mut tf, &hub_path, "hub-abc", 10, 1, true).unwrap();

        // Now should not be unassigned
        let unassigned2 = get_unassigned_cfab_renders_in_conn(&tf, &hub_path).unwrap();
        assert_eq!(unassigned2.len(), 0);

        // Check path index created
        let idx = load_cfab_path_index(&tf).unwrap();
        assert!(idx.iter().any(|(f, pid, src)| f == "/unknown/folder" && *pid == 1 && src == "manual"));

        // Check all renders list
        let all = get_all_cfab_renders_in_conn(&tf, None, None, None, None, None).unwrap();
        assert_eq!(all.total, 1);
        assert_eq!(all.items[0].project_id, 1);
        assert_eq!(all.items[0].assigned_by, "manual");

        // 3. Reassign to project 2
        reassign_cfab_render_in_conn(&mut tf, "hub-abc", 10, 2).unwrap();
        let all2 = get_all_cfab_renders_in_conn(&tf, None, None, None, None, None).unwrap();
        assert_eq!(all2.items[0].project_id, 2);

        // 4. Detach
        detach_cfab_render_in_conn(&mut tf, "hub-abc", 10).unwrap();
        let all3 = get_all_cfab_renders_in_conn(&tf, None, None, None, None, None).unwrap();
        assert_eq!(all3.total, 0);

        // Now it shows up in unassigned again, and this time matched_project_id is 1 because of remembered rule!
        let unassigned3 = get_unassigned_cfab_renders_in_conn(&tf, &hub_path).unwrap();
        assert_eq!(unassigned3.len(), 1);
        assert_eq!(unassigned3[0].matched_project_id, Some(1));

        let _ = std::fs::remove_dir_all(&hub_dir);
    }


    #[test]
    fn dcc_document_inference_and_render_overlap() {
        let tf = setup_tf();
        insert_project(&tf, 1, "ProjectX", "/work/project_x", None);

        let hub_dir = temp_test_dir("dcc_hub");
        let hub_path = hub_dir.join("c4dwatch.db");
        let hub = Connection::open(&hub_path).unwrap();
        hub.execute_batch(
            "CREATE TABLE dcc_activity (
                id INTEGER PRIMARY KEY,
                hub_instance_id TEXT NOT NULL,
                app TEXT NOT NULL,
                app_version TEXT,
                pid INTEGER NOT NULL,
                document_path TEXT NOT NULL,
                kind TEXT NOT NULL,
                at REAL NOT NULL,
                contract INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE render_ledger (
                id INTEGER PRIMARY KEY,
                hub_instance_id TEXT NOT NULL,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                started_at REAL,
                ended_at REAL NOT NULL,
                source TEXT NOT NULL,
                project_hint INTEGER,
                machine_name TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                contract INTEGER NOT NULL DEFAULT 2
            );",
        ).unwrap();

        let base_ts = 1710500000.0;
        hub.execute(
            "INSERT INTO dcc_activity (hub_instance_id, app, pid, document_path, kind, at, contract)
             VALUES ('hub-1', 'c4d', 100, '/work/project_x/scene1.c4d', 'active_doc', ?1, 1)",
            rusqlite::params![base_ts],
        ).unwrap();

        // 1. Infer project within window
        let proj = infer_dcc_project_from_hub(&tf, &hub, "Cinema 4D", base_ts - 10.0, base_ts + 10.0).unwrap();
        assert_eq!(proj, Some(1));

        // 2. Infer project with lookback
        let proj2 = infer_dcc_project_from_hub(&tf, &hub, "c4d", base_ts + 50.0, base_ts + 100.0).unwrap();
        assert_eq!(proj2, Some(1));

        // 3. Render overlap
        hub.execute(
            "INSERT INTO render_ledger (id, hub_instance_id, working_path, render_seconds, started_at, ended_at, source, status, contract)
             VALUES (1, 'hub-1', '/work/project_x/scene1.c4d', 100.0, ?1, ?2, 'queue', 'open', 2)",
            rusqlite::params![base_ts + 100.0, base_ts + 200.0],
        ).unwrap();

        // Window completely covers render
        let ov1 = get_render_overlap_seconds(&hub, base_ts + 50.0, base_ts + 250.0).unwrap();
        assert_eq!(ov1, 100.0);

        // Window overlaps half of render
        let ov2 = get_render_overlap_seconds(&hub, base_ts + 150.0, base_ts + 300.0).unwrap();
        assert_eq!(ov2, 50.0);

        // Window has no overlap
        let ov3 = get_render_overlap_seconds(&hub, base_ts + 300.0, base_ts + 400.0).unwrap();
        assert_eq!(ov3, 0.0);

        let _ = std::fs::remove_dir_all(&hub_dir);
    }

}
