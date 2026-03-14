use std::collections::HashMap;
use tauri::AppHandle;

use super::analysis::{
    build_stacked_bar_output, compute_project_activity_unique, project_series_key,
};
use super::helpers::{disambiguate_name, duplicate_name_counts, name_hash, run_db_blocking};
use super::sql_fragments::{ACTIVE_SESSION_FILTER, ACTIVE_SESSION_FILTER_S, SESSION_PROJECT_CTE};
use super::types::{
    AppWithStats, DashboardData, DashboardStats, DateRange, HourlyData, ProjectTimeRow,
    StackedSeriesMeta, TimelinePoint, TopApp, TopProject,
};

fn build_dashboard_stats(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    project_totals: &HashMap<String, f64>,
    series_meta_by_key: &HashMap<String, StackedSeriesMeta>,
) -> Result<DashboardStats, String> {
    let total_seconds = project_totals.values().copied().sum::<f64>().round() as i64;

    let (app_count, session_count, day_count) =
        query_dashboard_counters(conn, &date_range.start, &date_range.end)?;

    let avg_daily = if day_count == 0 {
        0
    } else {
        total_seconds / day_count
    };

    let sql = format!(
        "SELECT a.display_name, SUM(s.duration_seconds) as total, 
                COALESCE(a.color, p.color) as color
         FROM sessions s
         JOIN applications a ON a.id = s.app_id
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE s.date >= ?1 AND s.date <= ?2 AND {ACTIVE_SESSION_FILTER_S}
         GROUP BY s.app_id
         ORDER BY total DESC
         LIMIT 5",
    );
    let mut stmt = conn
        .prepare_cached(&sql)
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![&date_range.start, &date_range.end],
            |row| {
                let color: Option<String> = row.get(2)?;
                Ok(TopApp {
                    name: row.get(0)?,
                    seconds: row.get(1)?,
                    color,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let mut top_apps: Vec<TopApp> = Vec::new();
    for row in rows {
        let mut app = row.map_err(|e| format!("Failed to read top app row: {}", e))?;
        if app.color.is_none() {
            app.color = Some(generate_color_for_app(&app.name));
        }
        top_apps.push(app);
    }

    let top_project = project_totals
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .and_then(|(key, seconds)| series_meta_by_key.get(key).map(|series| (series, seconds)))
        .map(|(series, seconds)| TopProject {
            color: series.color.clone(),
            name: series.label.clone(),
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

fn build_top_project_rows(
    project_totals: &HashMap<String, f64>,
    series_meta_by_key: &HashMap<String, StackedSeriesMeta>,
    counts: &HashMap<String, (i64, i64)>,
    limit: usize,
) -> Result<Vec<ProjectTimeRow>, String> {
    if project_totals.is_empty() {
        return Ok(Vec::new());
    }

    let mut rows: Vec<ProjectTimeRow> = project_totals
        .iter()
        .filter_map(|(series_key, seconds_f)| {
            let series = series_meta_by_key.get(series_key)?;
            let (session_count, app_count) = counts.get(series_key).copied().unwrap_or((0, 0));
            Some(ProjectTimeRow {
                project_id: series.project_id,
                name: series.label.clone(),
                color: series.color.clone(),
                seconds: seconds_f.round() as i64,
                session_count,
                app_count,
            })
        })
        .collect();

    rows.sort_by(|a, b| b.seconds.cmp(&a.seconds).then_with(|| a.name.cmp(&b.name)));
    rows.truncate(limit);
    Ok(rows)
}

fn build_dashboard_project_rows(
    conn: &rusqlite::Connection,
    project_totals: &HashMap<String, f64>,
    counts: &HashMap<String, (i64, i64)>,
) -> Result<Vec<ProjectTimeRow>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT p.id, p.name, p.color
             FROM projects p
             WHERE p.excluded_at IS NULL
             ORDER BY lower(p.name) ASC, p.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut project_rows = Vec::new();
    for row in rows {
        project_rows.push(row.map_err(|e| format!("Failed to read dashboard project row: {}", e))?);
    }

    let duplicate_counts =
        duplicate_name_counts(project_rows.iter().map(|(_, name, _)| name.as_str()));

    let mut out = Vec::with_capacity(project_rows.len());
    for (project_id, name, color) in project_rows {
        let key = project_series_key(Some(project_id));
        let (session_count, app_count) = counts.get(&key).copied().unwrap_or((0, 0));
        let seconds = project_totals.get(&key).copied().unwrap_or(0.0).round() as i64;
        let display_name = disambiguate_name(&name, project_id, &duplicate_counts);
        out.push(ProjectTimeRow {
            project_id: Some(project_id),
            name: display_name,
            color,
            seconds,
            session_count,
            app_count,
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn get_dashboard_data(
    app: AppHandle,
    date_range: DateRange,
    top_limit: Option<i64>,
    timeline_limit: Option<i64>,
    timeline_granularity: Option<String>,
) -> Result<DashboardData, String> {
    run_db_blocking(app, move |conn| {
        let top_limit = top_limit.unwrap_or(5).clamp(1, 50) as usize;
        let timeline_limit = timeline_limit.unwrap_or(8).clamp(1, 200) as usize;
        let hourly = matches!(timeline_granularity.as_deref(), Some("hour"));

        let (
            bucket_project_seconds,
            project_totals,
            series_meta_by_key,
            bucket_flags,
            bucket_comments,
        ) = compute_project_activity_unique(conn, &date_range, hourly, true, None)?;
        let counts = query_project_counts(conn, &date_range.start, &date_range.end, true)?;

        Ok(DashboardData {
            stats: build_dashboard_stats(conn, &date_range, &project_totals, &series_meta_by_key)?,
            top_projects: build_top_project_rows(
                &project_totals,
                &series_meta_by_key,
                &counts,
                top_limit,
            )?,
            all_projects: build_dashboard_project_rows(conn, &project_totals, &counts)?,
            project_timeline: build_stacked_bar_output(
                bucket_project_seconds,
                &project_totals,
                &series_meta_by_key,
                &bucket_flags,
                &bucket_comments,
                timeline_limit,
            ),
        })
    })
    .await
}

#[tauri::command]
pub async fn get_dashboard_stats(
    app: AppHandle,
    date_range: DateRange,
) -> Result<DashboardStats, String> {
    run_db_blocking(app, move |conn| {
        let (_, project_totals, series_meta_by_key, _, _) =
            compute_project_activity_unique(conn, &date_range, false, true, None)?;
        build_dashboard_stats(conn, &date_range, &project_totals, &series_meta_by_key)
    })
    .await
}

fn query_dashboard_counters(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
) -> Result<(i64, i64, i64), String> {
    let sql = format!(
        "SELECT
            (SELECT COUNT(DISTINCT app_id)
             FROM sessions
             WHERE date >= ?1 AND date <= ?2 AND {ACTIVE_SESSION_FILTER}),
            (SELECT COUNT(*)
             FROM sessions
             WHERE date >= ?1 AND date <= ?2 AND {ACTIVE_SESSION_FILTER}) +
            (SELECT COUNT(*)
             FROM manual_sessions
             WHERE date >= ?1 AND date <= ?2),
            (SELECT
                CASE
                    WHEN COUNT(DISTINCT date) = 0 THEN 1
                    ELSE COUNT(DISTINCT date)
                END
             FROM (
                 SELECT date FROM sessions WHERE date >= ?1 AND date <= ?2 AND {ACTIVE_SESSION_FILTER}
                 UNION
                 SELECT date FROM manual_sessions WHERE date >= ?1 AND date <= ?2
             ))",
    );
    let (app_count, session_count, day_count): (i64, i64, i64) = conn
        .query_row(&sql, rusqlite::params![start, end], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?;

    Ok((app_count, session_count, day_count))
}

fn query_project_counts(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
    active_only: bool,
) -> Result<HashMap<String, (i64, i64)>, String> {
    let sql = format!(
        "{SESSION_PROJECT_CTE},
         combined AS (
             SELECT sp.project_id as project_id,
                    sp.app_id as app_id,
                    1 as session_count
             FROM session_projects sp
             LEFT JOIN projects p ON p.id = sp.project_id AND (?3 = 0 OR p.excluded_at IS NULL)
             WHERE sp.project_id IS NULL OR p.id IS NOT NULL
             UNION ALL
             SELECT ms.project_id as project_id,
                    NULL as app_id,
                    1 as session_count
             FROM manual_sessions ms
             JOIN projects p ON p.id = ms.project_id
             WHERE ms.date >= ?1 AND ms.date <= ?2 AND (?3 = 0 OR p.excluded_at IS NULL)
         )
         SELECT project_id,
                SUM(session_count) as session_count,
                COUNT(DISTINCT app_id) as app_count
         FROM combined
         GROUP BY project_id"
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![start, end, active_only as i32], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let row = row.map_err(|e| format!("Failed to read project counts row: {}", e))?;
        out.insert(project_series_key(row.0), (row.1, row.2));
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_activity_date_span(app: AppHandle) -> Result<Option<DateRange>, String> {
    run_db_blocking(app, move |conn| {
        let sql = format!(
            "SELECT MIN(d), MAX(d)
             FROM (
                 SELECT date as d
                 FROM sessions
                 WHERE {ACTIVE_SESSION_FILTER}
                 UNION ALL
                 SELECT date as d
                 FROM manual_sessions
             )",
        );
        let (start, end): (Option<String>, Option<String>) = conn
            .query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;

        match (start, end) {
            (Some(start), Some(end)) => Ok(Some(DateRange { start, end })),
            _ => Ok(None),
        }
    })
    .await
}

#[tauri::command]
pub async fn get_top_projects(
    app: AppHandle,
    date_range: DateRange,
    limit: Option<i64>,
) -> Result<Vec<ProjectTimeRow>, String> {
    run_db_blocking(app, move |conn| {
        let limit = limit.unwrap_or(8).clamp(1, 50) as usize;
        let (_, totals, series_meta_by_key, _, _) =
            compute_project_activity_unique(conn, &date_range, false, true, None)?;
        let counts = query_project_counts(conn, &date_range.start, &date_range.end, true)?;
        build_top_project_rows(&totals, &series_meta_by_key, &counts, limit)
    })
    .await
}

#[tauri::command]
pub async fn get_dashboard_projects(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<ProjectTimeRow>, String> {
    run_db_blocking(app, move |conn| {
        let (_, totals, _, _, _) =
            compute_project_activity_unique(conn, &date_range, false, true, None)?;
        let counts = query_project_counts(conn, &date_range.start, &date_range.end, true)?;
        build_dashboard_project_rows(conn, &totals, &counts)
    })
    .await
}

#[tauri::command]
pub async fn get_timeline(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<TimelinePoint>, String> {
    run_db_blocking(app, move |conn| {
        let (bucket_map, _, _, _, _) =
            compute_project_activity_unique(conn, &date_range, false, true, None)?;
        let mut out = Vec::with_capacity(bucket_map.len());
        for (date, project_seconds) in bucket_map {
            let seconds = project_seconds.values().copied().sum::<f64>().round() as i64;
            out.push(TimelinePoint { date, seconds });
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn get_hourly_breakdown(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<HourlyData>, String> {
    run_db_blocking(app, move |conn| {
        let (bucket_map, _, _, _, _) =
            compute_project_activity_unique(conn, &date_range, true, true, None)?;

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
    })
    .await
}

pub(crate) fn generate_color_for_app(name: &str) -> String {
    let palette = [
        "#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee",
        "#f472b6", "#4ade80", "#facc15", "#c084fc",
    ];
    let idx = name_hash(&name.to_lowercase()) as usize % palette.len();
    palette[idx].to_string()
}

#[tauri::command]
pub async fn get_applications(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<AppWithStats>, String> {
    run_db_blocking(app, move |conn| {
        let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
            if let Some(dr) = date_range {
                (
                    format!(
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
                          AND {ACTIVE_SESSION_FILTER_S}
                         LEFT JOIN projects p ON p.id = a.project_id
                         GROUP BY a.id
                         ORDER BY total_seconds DESC",
                    ),
                    vec![Box::new(dr.start), Box::new(dr.end)],
                )
            } else {
                (
                    format!(
                        "SELECT a.id, a.executable_name, a.display_name, a.project_id,
                                COALESCE(SUM(s.duration_seconds), 0) as total_seconds,
                                COUNT(s.id) as session_count,
                                MAX(s.end_time) as last_used,
                                p.name as project_name,
                                p.color as project_color,
                                a.color as app_color
                         FROM applications a
                         LEFT JOIN sessions s ON s.app_id = a.id AND {ACTIVE_SESSION_FILTER_S}
                         LEFT JOIN projects p ON p.id = a.project_id
                         GROUP BY a.id
                         ORDER BY total_seconds DESC",
                    ),
                    Vec::new(),
                )
            };

        let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
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
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read application row: {}", e))?;

        let mut final_apps = Vec::with_capacity(apps.len());
        let mut missing_colors: Vec<(i64, String)> = Vec::new();
        for mut app in apps {
            if app.color.is_none() {
                let color = generate_color_for_app(&app.display_name);
                app.color = Some(color.clone());
                missing_colors.push((app.id, color));
            }
            final_apps.push(app);
        }

        if !missing_colors.is_empty() {
            let mut sql = String::from("UPDATE applications SET color = CASE id");
            for _ in &missing_colors {
                sql.push_str(" WHEN ? THEN ?");
            }
            sql.push_str(" ELSE color END WHERE id IN (");
            sql.push_str(&vec!["?"; missing_colors.len()].join(","));
            sql.push(')');

            let mut params: Vec<rusqlite::types::Value> =
                Vec::with_capacity(missing_colors.len() * 3);
            for (id, color) in &missing_colors {
                params.push((*id).into());
                params.push(color.clone().into());
            }
            for (id, _) in &missing_colors {
                params.push((*id).into());
            }

            if let Err(e) = conn.execute(&sql, rusqlite::params_from_iter(params.iter())) {
                log::warn!("Failed to persist generated app colors in bulk: {}", e);
            }
        }

        Ok(final_apps)
    })
    .await
}

#[tauri::command]
pub async fn update_app_color(app: AppHandle, id: i64, color: String) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute(
            "UPDATE applications SET color = ?1 WHERE id = ?2",
            rusqlite::params![color, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_app_timeline(
    app: AppHandle,
    app_id: i64,
    date_range: DateRange,
) -> Result<Vec<TimelinePoint>, String> {
    run_db_blocking(app, move |conn| {
        let sql = format!(
            "SELECT date, SUM(duration_seconds)
             FROM sessions
             WHERE app_id = ?1 AND date >= ?2 AND date <= ?3 AND {ACTIVE_SESSION_FILTER}
             GROUP BY date
             ORDER BY date",
        );
        let mut stmt = conn
            .prepare_cached(&sql)
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

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read app timeline row: {}", e))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{build_top_project_rows, query_dashboard_counters, query_project_counts};
    use crate::commands::analysis::compute_project_activity_unique;
    use crate::commands::types::DateRange;

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

        let (app_count, session_count, day_count) =
            query_dashboard_counters(&conn, "2026-02-01", "2026-02-05").expect("counters");
        let total_seconds = 3600 + 1800 + 7200;

        assert_eq!(total_seconds, 12600);
        assert_eq!(app_count, 0);
        assert_eq!(session_count, 3);
        assert_eq!(day_count, 2);
        assert_eq!(total_seconds / day_count, 6300);
    }

    #[test]
    fn top_project_rows_keep_duplicate_project_names_separate_by_id() {
        let conn = setup_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, color) VALUES
                (1, 'Client', '#111111'),
                (2, 'Client', '#222222');
             INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden, rate_multiplier) VALUES
                (10, '2026-02-01T09:00:00Z', '2026-02-01T11:00:00Z', 7200, '2026-02-01', 1, 0, 1.0),
                (20, '2026-02-01T11:00:00Z', '2026-02-01T12:00:00Z', 3600, '2026-02-01', 2, 0, 1.0);",
        )
        .expect("seed duplicate-name projects");

        let date_range = DateRange {
            start: "2026-02-01".to_string(),
            end: "2026-02-01".to_string(),
        };
        let (_, totals, series_meta_by_key, _, _) =
            compute_project_activity_unique(&conn, &date_range, false, true, None)
                .expect("compute project activity");
        let counts = query_project_counts(&conn, &date_range.start, &date_range.end, true)
            .expect("query project counts");
        let rows =
            build_top_project_rows(&totals, &series_meta_by_key, &counts, 10).expect("top rows");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].project_id, Some(1));
        assert_eq!(rows[0].name, "Client · #1");
        assert_eq!(rows[0].seconds, 7200);
        assert_eq!(rows[0].color, "#111111");
        assert_eq!(rows[1].project_id, Some(2));
        assert_eq!(rows[1].name, "Client · #2");
        assert_eq!(rows[1].seconds, 3600);
        assert_eq!(rows[1].color, "#222222");
    }
}
