use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::analysis::query_activity_date_range;
use super::daemon::load_persisted_session_min_duration;
use super::helpers::run_db_blocking;
use super::manual_sessions::get_manual_sessions;
use super::projects::{query_active_project_with_stats, query_project_extra_info};
use super::sql_fragments::{ensure_session_project_cache, SESSION_PROJECT_CTE};
use super::time_algorithm::{compute_project_activity_unique, source_key};
use super::types::{
    DateRange, ManualSessionFilters, ManualSessionWithProject, ProjectExtraInfo,
    ProjectReportData, ProjectWithStats, SessionWithApp,
};

async fn get_report_project(app: AppHandle, project_id: i64) -> Result<ProjectWithStats, String> {
    run_db_blocking(app, move |conn| {
        query_active_project_with_stats(conn, project_id)
    })
    .await
}

async fn get_report_extra_info(
    app: AppHandle,
    project_id: i64,
) -> Result<ProjectExtraInfo, String> {
    run_db_blocking(app, move |conn| {
        let all_time_range = query_activity_date_range(conn)?.unwrap_or(DateRange {
            start: "0001-01-01".to_string(),
            end: "0001-01-01".to_string(),
        });
        query_project_extra_info(conn, project_id, &all_time_range)
    })
    .await
}

fn query_report_sessions(
    conn: &rusqlite::Connection,
    project_id: i64,
    date_range: &DateRange,
    min_duration: i64,
) -> Result<Vec<SessionWithApp>, String> {
    ensure_session_project_cache(conn, &date_range.start, &date_range.end)?;

    let sql = format!(
        "{SESSION_PROJECT_CTE}
             SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    sp.multiplier,
                    a.display_name, a.executable_name,
                    sp.project_id as effective_project_id,
                    p_eff.name, p_eff.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment,
                    s.split_source_session_id,
                    asug_latest.suggested_confidence,
                    asug_latest.suggested_project_id,
                    p_sug.name
             FROM sessions s
             JOIN session_projects sp ON sp.id = s.id
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p_eff ON p_eff.id = sp.project_id
             LEFT JOIN (
                 SELECT session_id, source
                 FROM assignment_feedback
                 WHERE id IN (SELECT MAX(id) FROM assignment_feedback GROUP BY session_id)
             ) af_last ON af_last.session_id = s.id
             LEFT JOIN (
                 SELECT session_id, suggested_confidence, suggested_project_id
                     FROM assignment_suggestions
                     WHERE id IN (SELECT MAX(id) FROM assignment_suggestions GROUP BY session_id)
                 ) asug_latest ON asug_latest.session_id = s.id
                 LEFT JOIN projects p_sug ON p_sug.id = asug_latest.suggested_project_id
             WHERE sp.project_id = ?3
               AND s.duration_seconds >= ?4
             ORDER BY s.start_time DESC"
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![
                date_range.start,
                date_range.end,
                project_id,
                min_duration
            ],
            |row| {
                Ok(SessionWithApp {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    start_time: row.get(2)?,
                    end_time: row.get(3)?,
                    duration_seconds: row.get(4)?,
                    effective_seconds: 0,
                    rate_multiplier: row.get(5)?,
                    app_name: row.get(6)?,
                    executable_name: row.get(7)?,
                    project_id: row.get(8)?,
                    project_name: row.get(9)?,
                    project_color: row.get(10)?,
                    ai_assigned: row.get::<_, i64>(11).unwrap_or(0) != 0,
                    comment: row.get(12)?,
                    split_source_session_id: row.get(13)?,
                    suggested_confidence: row.get(14).unwrap_or(None),
                    suggested_project_id: row.get(15).unwrap_or(None),
                    suggested_project_name: row.get(16).unwrap_or(None),
                    files: Vec::new(),
                })
            },
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

async fn get_report_sessions(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
    min_duration: i64,
) -> Result<Vec<SessionWithApp>, String> {
    run_db_blocking(app, move |conn| {
        query_report_sessions(conn, project_id, &date_range, min_duration)
    })
    .await
}

fn compute_effective_by_source(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    min_duration: i64,
) -> Result<std::collections::HashMap<String, f64>, String> {
    let (_buckets, _totals, _meta, _flags, _comments, effective) =
        compute_project_activity_unique(
            conn,
            date_range,
            false,
            true,
            None,
            Some(min_duration),
            true,
        )?;
    Ok(effective)
}

fn attach_effective_seconds(
    sessions: &mut [SessionWithApp],
    manual_sessions: &mut [ManualSessionWithProject],
    effective: &std::collections::HashMap<String, f64>,
) {
    for session in sessions {
        session.effective_seconds = effective
            .get(&source_key(false, session.id))
            .copied()
            .unwrap_or(0.0)
            .round() as i64;
    }
    for session in manual_sessions {
        session.effective_seconds = effective
            .get(&source_key(true, session.id))
            .copied()
            .unwrap_or(0.0)
            .round() as i64;
    }
}

#[tauri::command]
pub async fn get_project_report_data(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<ProjectReportData, CommandError> {
    log::info!(
        "[report] START project_id={}, date_range={:?}",
        project_id,
        date_range
    );

    let t0 = std::time::Instant::now();
    let min_duration = load_persisted_session_min_duration();

    // Phase 1: independent tasks — run in parallel
    let project_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            log::info!("[report] get_report_project START");
            let r = get_report_project(app, project_id).await;
            log::info!("[report] get_report_project DONE ({:?})", t0.elapsed());
            r
        }
    });
    let extra_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_report_extra_info START");
            let r = get_report_extra_info(app, project_id).await;
            log::info!("[report] get_report_extra_info DONE ({:?})", t0.elapsed());
            r
        }
    });
    let sessions_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_report_sessions START");
            let r = get_report_sessions(app, project_id, date_range, min_duration).await;
            log::info!("[report] get_report_sessions DONE ({:?})", t0.elapsed());
            r
        }
    });
    let manual_sessions_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_manual_sessions START");
            let r = get_manual_sessions(
                app,
                ManualSessionFilters {
                    date_range: Some(date_range),
                    project_id: Some(project_id),
                    limit: None,
                    offset: None,
                },
            )
            .await;
            log::info!("[report] get_manual_sessions DONE ({:?})", t0.elapsed());
            r
        }
    });
    let effective_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        let t0 = t0;
        async move {
            log::info!("[report] compute_effective_by_source START");
            let r = run_db_blocking(app, move |conn| {
                compute_effective_by_source(conn, &date_range, min_duration)
            })
            .await;
            log::info!(
                "[report] compute_effective_by_source DONE ({:?})",
                t0.elapsed()
            );
            r
        }
    });

    let project = project_handle
        .await
        .map_err(|e| format!("Project task join failed: {}", e))??;
    log::info!("[report] project joined");
    let extra = extra_handle
        .await
        .map_err(|e| format!("Extra info task join failed: {}", e))??;
    log::info!("[report] extra joined");
    let estimate = extra.current_value;

    let mut sessions = sessions_handle
        .await
        .map_err(|e| format!("Sessions task join failed: {}", e))??;
    log::info!("[report] sessions joined ({} sessions)", sessions.len());
    let mut manual_sessions = manual_sessions_handle
        .await
        .map_err(|e| format!("Manual sessions task join failed: {}", e))??;
    log::info!(
        "[report] manual_sessions joined ({} manual)",
        manual_sessions.len()
    );
    let effective = effective_handle
        .await
        .map_err(|e| format!("Effective seconds task join failed: {}", e))??;
    attach_effective_seconds(&mut sessions, &mut manual_sessions, &effective);
    log::info!("[report] effective seconds attached");

    log::info!(
        "[report] DONE project_id={} in {:?}",
        project_id,
        t0.elapsed()
    );

    Ok(ProjectReportData {
        project,
        extra,
        estimate,
        sessions,
        manual_sessions,
    })
}

/// Natywny druk bieżącego webview → systemowy panel druku / zapis do PDF.
/// `window.print()` z JS jest no-op w WKWebView (macOS desktop), dlatego front woła
/// tę komendę; WRY wykonuje natywny print per platforma (WKWebView / WebView2 / WebKitGTK).
#[tauri::command]
pub fn print_report(window: tauri::WebviewWindow) -> Result<(), CommandError> {
    window
        .print()
        .map_err(|e| CommandError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        attach_effective_seconds, compute_effective_by_source, query_report_sessions, DateRange,
    };

    fn test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(include_str!("../../resources/sql/schema.sql"))
            .expect("schema");
        crate::db_migrations::run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn report_effective_seconds_sum_matches_total() {
        let conn = test_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name, project_id)
             VALUES (1, 'code', 'Code', 1);
             INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id)
               VALUES (1, 1, '2026-03-01T10:00:00', '2026-03-01T11:00:00', 3600, '2026-03-01', 1),
                      (2, 1, '2026-03-01T10:30:00', '2026-03-01T11:00:00', 1800, '2026-03-01', 1);",
        )
        .unwrap();
        let range = DateRange {
            start: "2026-03-01".into(),
            end: "2026-03-01".into(),
        };
        let mut sessions = query_report_sessions(&conn, 1, &range, 0).unwrap();
        let mut manual_sessions = Vec::new();
        let effective = compute_effective_by_source(&conn, &range, 0).unwrap();
        attach_effective_seconds(&mut sessions, &mut manual_sessions, &effective);

        let sum_eff: i64 = sessions.iter().map(|s| s.effective_seconds).sum();
        assert_eq!(sum_eff, 3600, "Σ effective == total raportu");
        assert_eq!(sessions.iter().find(|s| s.id == 1).unwrap().effective_seconds, 2700);
    }
}
