use std::collections::HashMap;
use tauri::AppHandle;

use super::analysis::compute_project_activity_unique;
use super::types::{
    AppWithStats, DashboardStats, DateRange, HourlyData, ProjectTimeRow, TimelinePoint, TopApp,
    TopProject,
};
use crate::db;

#[tauri::command]
pub async fn get_dashboard_stats(
    app: AppHandle,
    date_range: DateRange,
) -> Result<DashboardStats, String> {
    let conn = db::get_connection(&app)?;

    let (total_seconds, app_count, session_count, day_count) =
        query_dashboard_counters(&conn, &date_range.start, &date_range.end)?;

    let avg_daily = if day_count == 0 {
        0
    } else {
        total_seconds / day_count
    };

    let mut stmt = conn
        .prepare_cached(
            "SELECT a.display_name, SUM(s.duration_seconds) as total, 
                    COALESCE(a.color, p.color) as color
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = a.project_id
             WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
             GROUP BY s.app_id
             ORDER BY total DESC
             LIMIT 5",
        )
        .map_err(|e| e.to_string())?;

    let top_apps: Vec<TopApp> = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            let color: Option<String> = row.get(2)?;
            Ok(TopApp {
                name: row.get(0)?,
                seconds: row.get(1)?,
                color,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|mut app| {
            // Generate color if none exists
            if app.color.is_none() {
                app.color = Some(generate_color_for_app(&app.name));
            }
            app
        })
        .collect();

    let (_, project_totals, _, _) =
        compute_project_activity_unique(&conn, &date_range, false, true, None)?;
    let project_colors = query_project_color_map(&conn)?;
    let top_project = project_totals
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(name, seconds)| TopProject {
            color: project_colors
                .get(&name.to_lowercase())
                .cloned()
                .unwrap_or_else(|| "#64748b".to_string()),
            name,
            seconds: seconds.round() as i64,
        });

    Ok(DashboardStats {
        total_seconds,
        app_count,
        session_count,
        avg_daily_seconds: avg_daily,
        top_apps,
        top_project,
    })
}

fn query_dashboard_counters(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
) -> Result<(i64, i64, i64, i64), String> {
    let date_range = DateRange {
        start: start.to_string(),
        end: end.to_string(),
    };
    let (_, totals, _, _) = compute_project_activity_unique(conn, &date_range, false, true, None)?;
    let total_seconds = totals.values().copied().sum::<f64>().round() as i64;

    let (app_count, session_count, day_count): (i64, i64, i64) = conn
        .query_row(
            "SELECT
                (SELECT COUNT(DISTINCT app_id)
                 FROM sessions
                 WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)),
                (SELECT COUNT(*)
                 FROM sessions
                 WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)) +
                (SELECT COUNT(*)
                 FROM manual_sessions
                 WHERE date >= ?1 AND date <= ?2),
                (SELECT
                    CASE
                        WHEN COUNT(DISTINCT date) = 0 THEN 1
                        ELSE COUNT(DISTINCT date)
                    END
                 FROM (
                     SELECT date FROM sessions WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)
                     UNION
                     SELECT date FROM manual_sessions WHERE date >= ?1 AND date <= ?2
                 ))",
            rusqlite::params![start, end],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    Ok((total_seconds, app_count, session_count, day_count))
}

fn query_project_color_map(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT name, color FROM projects")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        out.insert(row.0.to_lowercase(), row.1);
    }
    Ok(out)
}

fn query_project_counts(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
    active_only: bool,
) -> Result<HashMap<String, (i64, i64)>, String> {
    let mut stmt = conn
        .prepare_cached(
            "WITH session_project_overlap AS (
                SELECT s.id as session_id,
                       s.app_id as app_id,
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
                GROUP BY s.id, s.app_id, fa.project_id
            ),
            ranked_overlap AS (
                SELECT session_id, app_id, project_id, overlap_seconds, span_seconds,
                       ROW_NUMBER() OVER (
                           PARTITION BY session_id
                           ORDER BY overlap_seconds DESC, project_id ASC
                       ) as rn,
                       COUNT(*) OVER (PARTITION BY session_id) as project_count
                FROM session_project_overlap
            ),
            session_projects AS (
                SELECT s.id, s.app_id as app_id,
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
                SELECT COALESCE(p.name, 'Unassigned') as project_name, sp.app_id as app_id, 1 as session_count
                FROM session_projects sp
                LEFT JOIN projects p ON p.id = sp.project_id AND (?3 = 0 OR p.excluded_at IS NULL)
                UNION ALL
                SELECT p.name as project_name, NULL as app_id, 1 as session_count
                FROM manual_sessions ms
                JOIN projects p ON p.id = ms.project_id
                WHERE ms.date >= ?1 AND ms.date <= ?2 AND (?3 = 0 OR p.excluded_at IS NULL)
            )
            SELECT project_name, SUM(session_count) as session_count, COUNT(DISTINCT app_id) as app_count
            FROM combined
            GROUP BY project_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![start, end, active_only as i32], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows.filter_map(|r| r.ok()) {
        out.insert(row.0.to_lowercase(), (row.1, row.2));
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_top_projects(
    app: AppHandle,
    date_range: DateRange,
    limit: Option<i64>,
) -> Result<Vec<ProjectTimeRow>, String> {
    let conn = db::get_connection(&app)?;
    let limit = limit.unwrap_or(8).clamp(1, 50) as usize;
    let (_, totals, _, _) = compute_project_activity_unique(&conn, &date_range, false, true, None)?;
    if totals.is_empty() {
        return Ok(Vec::new());
    }
    let colors = query_project_color_map(&conn)?;
    let counts = query_project_counts(&conn, &date_range.start, &date_range.end, true)?;

    let mut rows: Vec<ProjectTimeRow> = totals
        .into_iter()
        .map(|(name, seconds_f)| {
            let key = name.to_lowercase();
            let (session_count, app_count) = counts.get(&key).copied().unwrap_or((0, 0));
            ProjectTimeRow {
                name,
                color: colors
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| "#64748b".to_string()),
                seconds: seconds_f.round() as i64,
                session_count,
                app_count,
            }
        })
        .collect();

    rows.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| a.name.cmp(&b.name)));
    rows.truncate(limit);
    Ok(rows)
}

#[tauri::command]
pub async fn get_dashboard_projects(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<ProjectTimeRow>, String> {
    let conn = db::get_connection(&app)?;
    let (_, totals, _, _) = compute_project_activity_unique(&conn, &date_range, false, true, None)?;
    let totals_ci: HashMap<String, f64> = totals
        .into_iter()
        .map(|(name, secs)| (name.to_lowercase(), secs))
        .collect();
    let counts = query_project_counts(&conn, &date_range.start, &date_range.end, true)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT p.name, p.color
             FROM projects p
             WHERE p.excluded_at IS NULL
             ORDER BY lower(p.name) ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows.filter_map(|r| r.ok()) {
        let key = row.0.to_lowercase();
        let (session_count, app_count) = counts.get(&key).copied().unwrap_or((0, 0));
        let seconds = totals_ci.get(&key).copied().unwrap_or(0.0).round() as i64;
        out.push(ProjectTimeRow {
            name: row.0,
            color: row.1,
            seconds,
            session_count,
            app_count,
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn get_timeline(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<TimelinePoint>, String> {
    let conn = db::get_connection(&app)?;
    let (bucket_map, _, _, _) =
        compute_project_activity_unique(&conn, &date_range, false, true, None)?;
    let mut out = Vec::with_capacity(bucket_map.len());
    for (date, project_seconds) in bucket_map {
        let seconds = project_seconds.values().copied().sum::<f64>().round() as i64;
        out.push(TimelinePoint { date, seconds });
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_hourly_breakdown(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<HourlyData>, String> {
    let conn = db::get_connection(&app)?;
    let (bucket_map, _, _, _) =
        compute_project_activity_unique(&conn, &date_range, true, true, None)?;

    let mut totals_by_hour = [0f64; 24];
    for (bucket, project_seconds) in bucket_map {
        let hour = bucket
            .split('T')
            .nth(1)
            .and_then(|time| time.split(':').next())
            .and_then(|h| h.parse::<usize>().ok());
        if let Some(hour) = hour.filter(|h| *h < 24) {
            totals_by_hour[hour] += project_seconds.values().copied().sum::<f64>();
        }
    }

    Ok(totals_by_hour
        .iter()
        .enumerate()
        .map(|(hour, seconds)| HourlyData {
            hour: hour as i32,
            seconds: seconds.round() as i64,
        })
        .collect())
}

pub(crate) fn generate_color_for_app(name: &str) -> String {
    let palette = [
        "#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee",
        "#f472b6", "#4ade80", "#facc15", "#c084fc",
    ];
    let idx = name
        .to_lowercase()
        .bytes()
        .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32)) as usize
        % palette.len();
    palette[idx].to_string()
}

#[tauri::command]
pub async fn get_applications(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<AppWithStats>, String> {
    let conn = db::get_connection(&app)?;
    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(dr) = date_range
    {
        (
            "SELECT a.id, a.executable_name, a.display_name, a.project_id,
                    COALESCE(SUM(s.duration_seconds), 0) as total_seconds,
                    COUNT(s.id) as session_count,
                    MAX(s.end_time) as last_used,
                    p.name as project_name,
                    p.color as project_color,
                    a.color as app_color
             FROM applications a
             LEFT JOIN sessions s
               ON s.app_id = a.id
              AND s.date >= ?1
              AND s.date <= ?2
              AND (s.is_hidden IS NULL OR s.is_hidden = 0)
             LEFT JOIN projects p ON p.id = a.project_id
             GROUP BY a.id
             ORDER BY total_seconds DESC"
                .to_string(),
            vec![Box::new(dr.start), Box::new(dr.end)],
        )
    } else {
        (
            "SELECT a.id, a.executable_name, a.display_name, a.project_id,
                    COALESCE(SUM(s.duration_seconds), 0) as total_seconds,
                    COUNT(s.id) as session_count,
                    MAX(s.end_time) as last_used,
                    p.name as project_name,
                    p.color as project_color,
                    a.color as app_color
             FROM applications a
             LEFT JOIN sessions s ON s.app_id = a.id AND (s.is_hidden IS NULL OR s.is_hidden = 0)
             LEFT JOIN projects p ON p.id = a.project_id
             GROUP BY a.id
             ORDER BY total_seconds DESC"
                .to_string(),
            Vec::new(),
        )
    };

    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| {
            Ok(AppWithStats {
                id: row.get(0)?,
                executable_name: row.get(1)?,
                display_name: row.get(2)?,
                project_id: row.get(3)?,
                total_seconds: row.get(4)?,
                session_count: row.get(5)?,
                last_used: row.get(6)?,
                project_name: row.get(7)?,
                project_color: row.get(8)?,
                color: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let apps: Vec<AppWithStats> = rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect();

    // Fill in missing colors
    let mut final_apps = Vec::with_capacity(apps.len());
    for mut app in apps {
        if app.color.is_none() {
            let color = generate_color_for_app(&app.display_name);
            app.color = Some(color.clone());
            // Optionally update DB here, but to avoid multiple writes in a loop
            // we'll just return it and let the DB stay NULL until manually changed
            // or if the user wants it persisted. The requirement was "auto and manual".
            // Let's persist it to avoid re-generation every time.
            if let Err(e) = conn.execute(
                "UPDATE applications SET color = ?1 WHERE id = ?2",
                rusqlite::params![color, app.id],
            ) {
                log::warn!("Failed to auto-persist app color: {}", e);
            }
        }
        final_apps.push(app);
    }

    Ok(final_apps)
}

#[tauri::command]
pub async fn update_app_color(app: AppHandle, id: i64, color: String) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute(
        "UPDATE applications SET color = ?1 WHERE id = ?2",
        rusqlite::params![color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_app_timeline(
    app: AppHandle,
    app_id: i64,
    date_range: DateRange,
) -> Result<Vec<TimelinePoint>, String> {
    let conn = db::get_connection(&app)?;
    let mut stmt = conn
        .prepare_cached(
            "SELECT date, SUM(duration_seconds)
             FROM sessions
             WHERE app_id = ?1 AND date >= ?2 AND date <= ?3 AND (is_hidden IS NULL OR is_hidden = 0)
             GROUP BY date
             ORDER BY date",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![app_id, date_range.start, date_range.end],
            |row| {
                Ok(TimelinePoint {
                    date: row.get(0)?,
                    seconds: row.get(1)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::query_dashboard_counters;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL DEFAULT '',
                end_time TEXT NOT NULL DEFAULT '',
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                project_id INTEGER,
                is_hidden INTEGER DEFAULT 0,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                comment TEXT
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL DEFAULT '',
                total_seconds INTEGER NOT NULL DEFAULT 0,
                first_seen TEXT NOT NULL DEFAULT '',
                last_seen TEXT NOT NULL DEFAULT '',
                project_id INTEGER
            );
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#64748b',
                excluded_at TEXT,
                frozen_at TEXT
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                session_type TEXT NOT NULL DEFAULT 'other',
                project_id INTEGER,
                start_time TEXT NOT NULL DEFAULT '',
                end_time TEXT NOT NULL DEFAULT '',
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn dashboard_counters_use_manual_session_days() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO projects (id, name, color) VALUES (?1, ?2, ?3)",
            rusqlite::params![1i64, "Manual", "#64748b"],
        )
        .expect("insert project");
        conn.execute(
            "INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "Work",
                "other",
                1i64,
                "2026-02-01T09:00:00",
                "2026-02-01T10:00:00",
                3600i64,
                "2026-02-01"
            ],
        )
        .expect("insert ms1");
        conn.execute(
            "INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "Work",
                "other",
                1i64,
                "2026-02-01T10:30:00",
                "2026-02-01T11:00:00",
                1800i64,
                "2026-02-01"
            ],
        )
        .expect("insert ms2");
        conn.execute(
            "INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                "Work",
                "other",
                1i64,
                "2026-02-03T09:00:00",
                "2026-02-03T11:00:00",
                7200i64,
                "2026-02-03"
            ],
        )
        .expect("insert ms3");

        let (total_seconds, app_count, session_count, day_count) =
            query_dashboard_counters(&conn, "2026-02-01", "2026-02-05").expect("counters");

        assert_eq!(total_seconds, 12600);
        assert_eq!(app_count, 0);
        assert_eq!(session_count, 3);
        assert_eq!(day_count, 2);
        assert_eq!(total_seconds / day_count, 6300);
    }
}
