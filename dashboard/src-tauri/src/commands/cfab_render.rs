//! CFAB Hub render ingest (on demand, no daemon tick) and project-page commands.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::TimeZone;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::estimates::get_global_hourly_rate;
use super::helpers::run_db_blocking;

const DEFAULT_COEFFICIENT: f64 = 0.2;
pub const CFAB_HUB_INTEGRATION_KEY: &str = "timeflow.settings.cfab-hub-integration";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderDay {
    pub date: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub value: f64,
    pub rows: Vec<CfabRenderRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CfabRenderRow {
    pub ledger_id: i64,
    pub working_path: String,
    pub render_seconds: f64,
    pub rbh: f64,
    pub value: f64,
    pub ended_at: f64,
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

pub fn hub_db_path_from(settings: &CfabHubIntegration) -> PathBuf {
    let override_path = settings.hub_db_path.trim();
    if !override_path.is_empty() {
        PathBuf::from(override_path)
    } else {
        app_support_root().join("c4dwatch").join("c4dwatch.db")
    }
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
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA query_only=ON;")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| e.to_string())?;
    Ok(Some(conn))
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

fn load_projects(tf: &Connection) -> Result<Vec<ProjectRow>, String> {
    let mut stmt = tf
        .prepare(
            "SELECT id, name, assigned_folder_path, frozen_at, excluded_at, merged_into
             FROM projects
             WHERE assigned_folder_path IS NOT NULL AND assigned_folder_path != ''",
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

fn load_project_settings(tf: &Connection, project_id: i64) -> Result<(f64, bool), String> {
    let row: Option<(f64, i64)> = tf
        .query_row(
            "SELECT coefficient, include_in_billing
             FROM cfab_render_project_settings
             WHERE project_id = ?1",
            [project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(match row {
        Some((c, include)) => (
            if c.is_finite() {
                c
            } else {
                DEFAULT_COEFFICIENT
            },
            include != 0,
        ),
        None => (DEFAULT_COEFFICIENT, false),
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

    let mut hub_stmt = hub
        .prepare(
            "SELECT id, working_path, render_seconds, ended_at, project_hint
             FROM render_ledger
             WHERE contract = 1 AND status = 'open'",
        )
        .map_err(|e| e.to_string())?;
    let hub_rows: Vec<(i64, String, f64, f64, Option<i64>)> = hub_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let tx = tf.transaction().map_err(|e| e.to_string())?;

    let acked: HashSet<i64> = {
        let mut stmt = tx
            .prepare("SELECT ledger_id FROM cfab_render_ack")
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        ids.collect::<Result<HashSet<i64>, _>>()
            .map_err(|e| e.to_string())?
    };

    let updated = tx
        .execute(
            "UPDATE cfab_render_cost
             SET coefficient = ?1,
                 value = (render_seconds / 3600.0) * ?1 * ?2
             WHERE project_id = ?3",
            rusqlite::params![coefficient, rate, project_id],
        )
        .map_err(|e| e.to_string())?;

    let ingested_at = chrono::Utc::now().to_rfc3339();
    let mut ingested = 0usize;

    for (ledger_id, working_path, render_seconds, ended_at, hint) in hub_rows {
        if match_project(&working_path, &projects, hint) != Some(project_id) {
            continue;
        }
        if acked.contains(&ledger_id) {
            continue;
        }
        let rbh = render_seconds / 3600.0;
        let value = rbh * coefficient * rate;
        tx.execute(
            "INSERT INTO cfab_render_cost (
                ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                ledger_id,
                project_id,
                working_path,
                render_seconds,
                ended_at,
                rbh,
                coefficient,
                value,
                ingested_at
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO cfab_render_ack (
                ledger_id, ingested_at, project_id, rbh, coefficient, contract
            ) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            rusqlite::params![ledger_id, ingested_at, project_id, rbh, coefficient],
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
            "SELECT ledger_id, working_path, render_seconds, rbh, value, ended_at
             FROM cfab_render_cost
             WHERE project_id = ?1
             ORDER BY ended_at DESC, ledger_id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<CfabRenderRow> = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(CfabRenderRow {
                ledger_id: row.get(0)?,
                working_path: row.get(1)?,
                render_seconds: row.get(2)?,
                rbh: row.get(3)?,
                value: row.get(4)?,
                ended_at: row.get(5)?,
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
    let (coefficient, include_in_billing) = load_project_settings(tf, project_id)?;
    Ok(CfabRenderProjectState {
        coefficient,
        include_in_billing,
        effective_hourly_rate: effective_hourly_rate(tf, project_id)?,
        days: list_cfab_render_for_project(tf, project_id)?,
    })
}

pub fn update_cfab_render_project_settings_in_conn(
    tf: &Connection,
    project_id: i64,
    coefficient: f64,
    include_in_billing: bool,
) -> Result<CfabRenderProjectState, String> {
    validate_coefficient(coefficient)?;
    let rate = effective_hourly_rate(tf, project_id)?;
    let updated_at = chrono::Utc::now().to_rfc3339();
    tf.execute(
        "INSERT INTO cfab_render_project_settings (
            project_id, coefficient, include_in_billing, updated_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(project_id) DO UPDATE SET
            coefficient = excluded.coefficient,
            include_in_billing = excluded.include_in_billing,
            updated_at = excluded.updated_at",
        rusqlite::params![
            project_id,
            coefficient,
            include_in_billing as i64,
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
) -> Result<CfabRenderProjectState, String> {
    validate_coefficient(coefficient)?;
    run_db_blocking(app, move |conn| {
        update_cfab_render_project_settings_in_conn(
            conn,
            project_id,
            coefficient,
            include_in_billing,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
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
        assert!(second.updated >= 1);

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
        let err = update_cfab_render_project_settings_in_conn(&mut tf, 1, 0.0, true)
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
            update_cfab_render_project_settings_in_conn(&mut tf, 1, 0.5, true).unwrap();
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
                ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at
            ) VALUES (?1, ?2, '/work/A/scena.c4d', 3600.0, 1.0, 1.0, 0.2, ?3, '2026-03-15T12:00:00Z')",
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
        let path = hub_db_path_from(&CfabHubIntegration {
            enabled: true,
            hub_db_path: String::new(),
        });
        let posix = path.to_string_lossy().replace('\\', "/");
        assert!(
            posix.ends_with("c4dwatch/c4dwatch.db"),
            "empty override must use canonical c4dwatch.db, got {posix}"
        );
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
}
