use std::collections::HashMap;

use rusqlite::OptionalExtension;
use tauri::AppHandle;

use super::analysis::compute_project_activity_unique;
use super::types::{DateRange, EstimateProjectRow, EstimateSettings, EstimateSummary};
use crate::db;

const DEFAULT_GLOBAL_HOURLY_RATE: f64 = 100.0;
const MAX_HOURLY_RATE: f64 = 100000.0;

fn sanitize_rate(rate: f64) -> Option<f64> {
    if rate.is_finite() && rate >= 0.0 && rate <= MAX_HOURLY_RATE {
        Some(rate)
    } else {
        None
    }
}

fn validate_hourly_rate(rate: f64) -> Result<(), String> {
    if !rate.is_finite() {
        return Err("Rate must be a finite number".to_string());
    }
    if rate < 0.0 {
        return Err("Rate must be >= 0".to_string());
    }
    if rate > MAX_HOURLY_RATE {
        return Err(format!("Rate must be <= {}", MAX_HOURLY_RATE));
    }
    Ok(())
}

fn get_global_hourly_rate(conn: &rusqlite::Connection) -> Result<f64, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM estimate_settings WHERE key = 'global_hourly_rate' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let parsed = raw
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok())
        .and_then(sanitize_rate)
        .unwrap_or(DEFAULT_GLOBAL_HOURLY_RATE);

    Ok(parsed)
}

fn query_project_meta(
    conn: &rusqlite::Connection,
) -> Result<HashMap<String, (i64, String, String, Option<f64>)>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT id, name, color, hourly_rate FROM projects")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let rate: Option<f64> = row.get(3)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                rate.and_then(sanitize_rate),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        out.insert(row.1.to_lowercase(), row);
    }
    Ok(out)
}

fn query_project_session_counts(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
) -> Result<HashMap<String, i64>, String> {
    let mut stmt = conn
        .prepare_cached(
            "WITH session_project_overlap AS (
                SELECT s.id as session_id,
                       fa.project_id as project_id,
                       SUM(
                           MAX(
                               0,
                               MIN(strftime('%s', s.end_time), strftime('%s', fa.last_seen)) -
                               MAX(strftime('%s', s.start_time), strftime('%s', fa.first_seen))
                           )
                       ) as overlap_seconds,
                       (strftime('%s', s.end_time) - strftime('%s', s.start_time)) as span_seconds
                FROM sessions s
                JOIN file_activities fa
                  ON fa.app_id = s.app_id
                 AND fa.date = s.date
                 AND fa.project_id IS NOT NULL
                 AND fa.last_seen > s.start_time
                 AND fa.first_seen < s.end_time
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
                GROUP BY s.id, fa.project_id
            ),
            ranked_overlap AS (
                SELECT session_id, project_id, overlap_seconds, span_seconds,
                       ROW_NUMBER() OVER (
                           PARTITION BY session_id
                           ORDER BY overlap_seconds DESC, project_id ASC
                       ) as rn,
                       COUNT(*) OVER (PARTITION BY session_id) as project_count
                FROM session_project_overlap
            ),
            session_projects AS (
                SELECT s.id,
                       CASE
                           WHEN s.project_id IS NOT NULL THEN s.project_id
                           WHEN ro.project_count = 1
                            AND ro.overlap_seconds * 2 >= ro.span_seconds
                           THEN ro.project_id
                           ELSE NULL
                       END as project_id
                FROM sessions s
                LEFT JOIN ranked_overlap ro
                  ON ro.session_id = s.id
                 AND ro.rn = 1
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
            ),
            combined AS (
                SELECT COALESCE(p.name, 'Unassigned') as project_name, 1 as session_count
                FROM session_projects sp
                LEFT JOIN projects p ON p.id = sp.project_id
                UNION ALL
                SELECT p.name as project_name, 1 as session_count
                FROM manual_sessions ms
                JOIN projects p ON p.id = ms.project_id
                WHERE ms.date >= ?1 AND ms.date <= ?2
            )
            SELECT project_name, SUM(session_count) as session_count
            FROM combined
            GROUP BY project_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        out.insert(row.0.to_lowercase(), row.1);
    }
    Ok(out)
}

fn query_project_multiplier_extra_seconds(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
) -> Result<HashMap<String, f64>, String> {
    let mut stmt = conn
        .prepare_cached(
            "WITH session_project_overlap AS (
                SELECT s.id as session_id,
                       fa.project_id as project_id,
                       SUM(
                           MAX(
                               0,
                               MIN(strftime('%s', s.end_time), strftime('%s', fa.last_seen)) -
                               MAX(strftime('%s', s.start_time), strftime('%s', fa.first_seen))
                           )
                       ) as overlap_seconds,
                       (strftime('%s', s.end_time) - strftime('%s', s.start_time)) as span_seconds
                FROM sessions s
                JOIN file_activities fa
                  ON fa.app_id = s.app_id
                 AND fa.date = s.date
                 AND fa.project_id IS NOT NULL
                 AND fa.last_seen > s.start_time
                 AND fa.first_seen < s.end_time
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
                GROUP BY s.id, fa.project_id
            ),
            ranked_overlap AS (
                SELECT session_id, project_id, overlap_seconds, span_seconds,
                       ROW_NUMBER() OVER (
                           PARTITION BY session_id
                           ORDER BY overlap_seconds DESC, project_id ASC
                       ) as rn,
                       COUNT(*) OVER (PARTITION BY session_id) as project_count
                FROM session_project_overlap
            ),
            session_projects AS (
                SELECT s.id,
                       CASE
                           WHEN s.project_id IS NOT NULL THEN s.project_id
                           WHEN ro.project_count = 1
                            AND ro.overlap_seconds * 2 >= ro.span_seconds
                           THEN ro.project_id
                           ELSE NULL
                       END as project_id,
                       CAST(s.duration_seconds AS REAL) as duration_seconds,
                       CASE
                           WHEN s.rate_multiplier IS NULL OR s.rate_multiplier <= 0 THEN 1.0
                           ELSE s.rate_multiplier
                       END as rate_multiplier
                FROM sessions s
                LEFT JOIN ranked_overlap ro
                  ON ro.session_id = s.id
                 AND ro.rn = 1
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
            ),
            combined AS (
                SELECT COALESCE(p.name, 'Unassigned') as project_name,
                       CASE
                           WHEN sp.rate_multiplier <= 1.0 THEN 0.0
                           ELSE (sp.duration_seconds * (sp.rate_multiplier - 1.0))
                       END as extra_seconds
                FROM session_projects sp
                LEFT JOIN projects p ON p.id = sp.project_id
                UNION ALL
                SELECT p.name as project_name,
                       0.0 as extra_seconds
                FROM manual_sessions ms
                JOIN projects p ON p.id = ms.project_id
                WHERE ms.date >= ?1 AND ms.date <= ?2
            )
            SELECT project_name, SUM(extra_seconds) as extra_seconds
            FROM combined
            GROUP BY project_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        out.insert(row.0.to_lowercase(), row.1);
    }
    Ok(out)
}

fn build_estimate_rows(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
) -> Result<Vec<EstimateProjectRow>, String> {
    let global_hourly_rate = get_global_hourly_rate(conn)?;
    let (_, totals) = compute_project_activity_unique(conn, date_range, false)?;
    if totals.is_empty() {
        return Ok(Vec::new());
    }

    let project_meta = query_project_meta(conn)?;
    let session_counts = query_project_session_counts(conn, date_range)?;
    let multiplier_extra_seconds_by_project = query_project_multiplier_extra_seconds(conn, date_range)?;

    let mut rows: Vec<EstimateProjectRow> = Vec::new();
    for (project_name, seconds_f64) in totals {
        if project_name.trim().eq_ignore_ascii_case("unassigned") {
            continue;
        }

        let key = project_name.to_lowercase();
        let Some((project_id, mapped_name, project_color, project_hourly_rate)) = project_meta.get(&key) else {
            log::warn!(
                "Could not resolve project metadata for '{}' while building estimates",
                project_name
            );
            continue;
        };

        let seconds = seconds_f64.round() as i64;
        let hours = seconds_f64 / 3600.0;
        let effective_hourly_rate = project_hourly_rate.unwrap_or(global_hourly_rate);
        let weighted_hours = hours + (multiplier_extra_seconds_by_project
            .get(&key)
            .copied()
            .unwrap_or(0.0)
            / 3600.0);
        let estimated_value = weighted_hours * effective_hourly_rate;
        let session_count = session_counts.get(&key).copied().unwrap_or(0);

        rows.push(EstimateProjectRow {
            project_id: *project_id,
            project_name: mapped_name.clone(),
            project_color: project_color.clone(),
            seconds,
            hours,
            project_hourly_rate: *project_hourly_rate,
            effective_hourly_rate,
            estimated_value,
            session_count,
        });
    }

    rows.sort_by(|a, b| {
        b.estimated_value
            .total_cmp(&a.estimated_value)
            .then_with(|| a.project_name.to_lowercase().cmp(&b.project_name.to_lowercase()))
    });

    Ok(rows)
}

#[tauri::command]
pub async fn get_estimate_settings(app: AppHandle) -> Result<EstimateSettings, String> {
    let conn = db::get_connection(&app)?;
    Ok(EstimateSettings {
        global_hourly_rate: get_global_hourly_rate(&conn)?,
    })
}

#[tauri::command]
pub async fn update_global_hourly_rate(app: AppHandle, rate: f64) -> Result<(), String> {
    validate_hourly_rate(rate)?;
    let conn = db::get_connection(&app)?;
    conn.execute(
        "INSERT INTO estimate_settings (key, value, updated_at)
         VALUES ('global_hourly_rate', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = datetime('now')",
        rusqlite::params![rate.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_project_hourly_rate(
    app: AppHandle,
    project_id: i64,
    rate: Option<f64>,
) -> Result<(), String> {
    if let Some(v) = rate {
        validate_hourly_rate(v)?;
    }
    let conn = db::get_connection(&app)?;
    let updated = conn
        .execute(
            "UPDATE projects SET hourly_rate = ?2 WHERE id = ?1",
            rusqlite::params![project_id, rate],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Project not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_project_estimates(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<EstimateProjectRow>, String> {
    let conn = db::get_connection(&app)?;
    build_estimate_rows(&conn, &date_range)
}

#[tauri::command]
pub async fn get_estimates_summary(
    app: AppHandle,
    date_range: DateRange,
) -> Result<EstimateSummary, String> {
    let conn = db::get_connection(&app)?;
    let rows = build_estimate_rows(&conn, &date_range)?;

    let total_seconds = rows.iter().map(|r| r.seconds).sum::<i64>();
    let total_hours = total_seconds as f64 / 3600.0;
    let total_value = rows.iter().map(|r| r.estimated_value).sum::<f64>();
    let projects_count = rows.len() as i64;
    let overrides_count = rows
        .iter()
        .filter(|r| r.project_hourly_rate.is_some())
        .count() as i64;

    Ok(EstimateSummary {
        total_seconds,
        total_hours,
        total_value,
        projects_count,
        overrides_count,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_estimate_rows, get_global_hourly_rate};
    use crate::commands::types::DateRange;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                hourly_rate REAL
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                project_id INTEGER,
                is_hidden INTEGER DEFAULT 0
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                project_id INTEGER,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL
            );
            CREATE TABLE estimate_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn global_rate_falls_back_to_default() {
        let conn = setup_conn();
        let global = get_global_hourly_rate(&conn).expect("global rate");
        assert_eq!(global, 100.0);
    }

    #[test]
    fn estimate_rows_use_project_override_or_global() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO estimate_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params!["global_hourly_rate", "100"],
        )
        .expect("insert setting");

        conn.execute(
            "INSERT INTO projects (id, name, color, hourly_rate) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![1i64, "Project A", "#111111", Option::<f64>::None],
        )
        .expect("insert project a");
        conn.execute(
            "INSERT INTO projects (id, name, color, hourly_rate) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![2i64, "Project B", "#222222", Some(150.0f64)],
        )
        .expect("insert project b");

        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![
                1i64,
                "2026-01-01T10:00:00",
                "2026-01-01T12:00:00",
                7200i64,
                "2026-01-01",
                1i64
            ],
        )
        .expect("insert session a");
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![
                2i64,
                "2026-01-01T12:00:00",
                "2026-01-01T13:00:00",
                3600i64,
                "2026-01-01",
                2i64
            ],
        )
        .expect("insert session b");

        // Unassigned session should be omitted from estimates.
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0)",
            rusqlite::params![
                3i64,
                "2026-01-01T13:00:00",
                "2026-01-01T14:00:00",
                3600i64,
                "2026-01-01"
            ],
        )
        .expect("insert unassigned session");

        let rows = build_estimate_rows(
            &conn,
            &DateRange {
                start: "2026-01-01".to_string(),
                end: "2026-01-01".to_string(),
            },
        )
        .expect("estimate rows");

        assert_eq!(rows.len(), 2);

        let row_a = rows
            .iter()
            .find(|r| r.project_name == "Project A")
            .expect("row a");
        let row_b = rows
            .iter()
            .find(|r| r.project_name == "Project B")
            .expect("row b");

        assert_eq!(row_a.seconds, 7200);
        assert_eq!(row_a.project_hourly_rate, None);
        assert!((row_a.effective_hourly_rate - 100.0).abs() < 0.0001);
        assert!((row_a.estimated_value - 200.0).abs() < 0.0001);

        assert_eq!(row_b.seconds, 3600);
        assert_eq!(row_b.project_hourly_rate, Some(150.0));
        assert!((row_b.effective_hourly_rate - 150.0).abs() < 0.0001);
        assert!((row_b.estimated_value - 150.0).abs() < 0.0001);
    }
}
