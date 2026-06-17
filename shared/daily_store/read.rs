use crate::daily_store::types::decode_detected_path;
use crate::daily_store::{
    DaySignature, StoredAppDailyData, StoredDailyData, StoredFileEntry, StoredSession,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
fn parse_title_history_json(title_history_json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(title_history_json).unwrap_or_default()
}

fn parse_activity_spans_json(json: &str) -> Vec<(String, String)> {
    serde_json::from_str::<Vec<(String, String)>>(json).unwrap_or_default()
}

pub fn load_day_snapshot(conn: &Connection, date: &str) -> Result<Option<StoredDailyData>, String> {
    let generated_at = conn
        .query_row(
            "SELECT generated_at FROM daily_snapshots WHERE date = ?1",
            [date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read daily snapshot header for {}: {}", date, e))?;

    let Some(generated_at) = generated_at else {
        return Ok(None);
    };

    let mut apps = BTreeMap::new();
    let mut app_stmt = conn
        .prepare_cached(
            "SELECT exe_name, display_name, total_seconds
             FROM daily_apps
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to prepare daily app select for {}: {}", date, e))?;
    let app_rows = app_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily apps for {}: {}", date, e))?;
    for row in app_rows {
        let (exe_name, display_name, total_seconds) =
            row.map_err(|e| format!("Failed to map daily app row for {}: {}", date, e))?;
        apps.insert(
            exe_name,
            StoredAppDailyData {
                display_name,
                total_seconds,
                sessions: Vec::new(),
                files: Vec::new(),
            },
        );
    }
    drop(app_stmt);

    let mut session_stmt = conn
        .prepare_cached(
            "SELECT exe_name, start_time, end_time, duration_seconds
             FROM daily_sessions
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE, session_index ASC",
        )
        .map_err(|e| format!("Failed to prepare daily session select for {}: {}", date, e))?;
    let session_rows = session_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                StoredSession {
                    start: row.get(1)?,
                    end: row.get(2)?,
                    duration_seconds: row.get(3)?,
                },
            ))
        })
        .map_err(|e| format!("Failed to query daily sessions for {}: {}", date, e))?;
    for row in session_rows {
        let (exe_name, session) =
            row.map_err(|e| format!("Failed to map daily session row for {}: {}", date, e))?;
        if let Some(app) = apps.get_mut(&exe_name) {
            app.sessions.push(session);
        }
    }
    drop(session_stmt);

    let mut file_stmt = conn
        .prepare_cached(
            "SELECT exe_name, file_name, total_seconds, first_seen, last_seen,
                    window_title, detected_path, title_history_json, activity_type,
                    activity_spans_json
             FROM daily_files
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE, ordinal ASC",
        )
        .map_err(|e| format!("Failed to prepare daily file select for {}: {}", date, e))?;
    let file_rows = file_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            ))
        })
        .map_err(|e| format!("Failed to query daily files for {}: {}", date, e))?;
    for row in file_rows {
        let (
            exe_name,
            name,
            total_seconds,
            first_seen,
            last_seen,
            window_title,
            detected_path,
            title_history_json,
            activity_type,
            activity_spans_json,
        ) = row.map_err(|e| format!("Failed to map daily file row for {}: {}", date, e))?;
        let title_history = parse_title_history_json(&title_history_json);
        if let Some(app) = apps.get_mut(&exe_name) {
            app.files.push(StoredFileEntry {
                name,
                total_seconds,
                first_seen,
                last_seen,
                window_title,
                detected_path: decode_detected_path(detected_path),
                title_history,
                activity_type,
                activity_spans: parse_activity_spans_json(&activity_spans_json),
            });
        }
    }

    Ok(Some(StoredDailyData {
        date: date.to_string(),
        generated_at,
        apps,
    }))
}

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
pub fn load_range_snapshots(
    conn: &Connection,
    start: &str,
    end: &str,
) -> Result<BTreeMap<String, StoredDailyData>, String> {
    let mut snapshots_stmt = conn
        .prepare_cached(
            "SELECT snapshots.date,
                    snapshots.generated_at,
                    apps.exe_name,
                    apps.display_name,
                    apps.total_seconds
             FROM daily_snapshots AS snapshots
             LEFT JOIN daily_apps AS apps
               ON apps.date = snapshots.date
             WHERE snapshots.date >= ?1 AND snapshots.date <= ?2
             ORDER BY snapshots.date ASC, apps.exe_name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to prepare daily snapshot/app range query: {}", e))?;
    let snapshot_rows = snapshots_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<u64>>(4)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily snapshot/app range: {}", e))?;

    let mut snapshots = BTreeMap::new();
    for row in snapshot_rows {
        let (date, generated_at, exe_name, display_name, total_seconds) =
            row.map_err(|e| format!("Failed to map daily snapshot/app range row: {}", e))?;
        let snapshot = snapshots
            .entry(date.clone())
            .or_insert_with(|| StoredDailyData {
                date,
                generated_at,
                apps: BTreeMap::new(),
            });
        if let Some(exe_name) = exe_name {
            snapshot.apps.insert(
                exe_name,
                StoredAppDailyData {
                    display_name: display_name.unwrap_or_default(),
                    total_seconds: total_seconds.unwrap_or(0),
                    sessions: Vec::new(),
                    files: Vec::new(),
                },
            );
        }
    }

    if snapshots.is_empty() {
        return Ok(snapshots);
    }

    drop(snapshots_stmt);

    let mut session_stmt = conn
        .prepare_cached(
            "SELECT date, exe_name, start_time, end_time, duration_seconds
             FROM daily_sessions
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC, exe_name COLLATE NOCASE, session_index ASC",
        )
        .map_err(|e| format!("Failed to prepare daily session range select: {}", e))?;
    let session_rows = session_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                StoredSession {
                    start: row.get(2)?,
                    end: row.get(3)?,
                    duration_seconds: row.get(4)?,
                },
            ))
        })
        .map_err(|e| format!("Failed to query daily session range: {}", e))?;
    for row in session_rows {
        let (date, exe_name, session) =
            row.map_err(|e| format!("Failed to map daily session range row: {}", e))?;
        if let Some(snapshot) = snapshots.get_mut(&date) {
            if let Some(app) = snapshot.apps.get_mut(&exe_name) {
                app.sessions.push(session);
            }
        }
    }
    drop(session_stmt);

    let mut file_stmt = conn
        .prepare_cached(
            "SELECT date, exe_name, file_name, total_seconds, first_seen, last_seen,
                    window_title, detected_path, title_history_json, activity_type,
                    activity_spans_json
             FROM daily_files
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC, exe_name COLLATE NOCASE, ordinal ASC",
        )
        .map_err(|e| format!("Failed to prepare daily file range select: {}", e))?;
    let file_rows = file_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string()),
            ))
        })
        .map_err(|e| format!("Failed to query daily file range: {}", e))?;
    for row in file_rows {
        let (
            date,
            exe_name,
            name,
            total_seconds,
            first_seen,
            last_seen,
            window_title,
            detected_path,
            title_history_json,
            activity_type,
            activity_spans_json,
        ) = row.map_err(|e| format!("Failed to map daily file range row: {}", e))?;
        if let Some(snapshot) = snapshots.get_mut(&date) {
            if let Some(app) = snapshot.apps.get_mut(&exe_name) {
                app.files.push(StoredFileEntry {
                    name,
                    total_seconds,
                    first_seen,
                    last_seen,
                    window_title,
                    detected_path: decode_detected_path(detected_path),
                    title_history: parse_title_history_json(&title_history_json),
                    activity_type,
                    activity_spans: parse_activity_spans_json(&activity_spans_json),
                });
            }
        }
    }
    Ok(snapshots)
}

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
pub fn get_day_signature(conn: &Connection, date: &str) -> Result<Option<DaySignature>, String> {
    let signature = conn
        .query_row(
            "SELECT updated_unix_ms, revision
         FROM daily_snapshots
         WHERE date = ?1",
            [date],
            |row| {
                let updated_unix_ms: u64 = row.get(0)?;
                let revision: u64 = row.get(1)?;
                Ok((updated_unix_ms, revision))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read daily signature for {}: {}", date, e))?
        .map(|(updated_unix_ms, revision)| DaySignature {
            updated_unix_ms,
            revision,
        });
    Ok(signature)
}
