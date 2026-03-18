use tauri::AppHandle;

use super::analysis::query_activity_date_range;
use super::daemon::load_persisted_session_min_duration;
use super::helpers::{run_app_blocking, run_db_blocking};
use super::manual_sessions::get_manual_sessions;
use super::projects::{query_active_project_with_stats, query_project_extra_info};
use super::sql_fragments::SESSION_PROJECT_CTE;
use super::types::{
    DateRange, ManualSessionFilters, ProjectExtraInfo, ProjectReportData, ProjectWithStats,
    SessionWithApp,
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

async fn get_report_sessions(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
    min_duration: i64,
) -> Result<Vec<SessionWithApp>, String> {
    run_db_blocking(app, move |conn| {
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
                rusqlite::params![date_range.start, date_range.end, project_id, min_duration],
                |row| {
                    Ok(SessionWithApp {
                        id: row.get(0)?,
                        app_id: row.get(1)?,
                        start_time: row.get(2)?,
                        end_time: row.get(3)?,
                        duration_seconds: row.get(4)?,
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
    })
    .await
}

#[tauri::command]
pub async fn get_project_report_data(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<ProjectReportData, String> {
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
            let r = run_app_blocking(app, move |app| {
                get_manual_sessions(
                    app,
                    ManualSessionFilters {
                        date_range: Some(date_range),
                        project_id: Some(project_id),
                    },
                )
            })
            .await;
            log::info!("[report] get_manual_sessions DONE ({:?})", t0.elapsed());
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

    let sessions = sessions_handle
        .await
        .map_err(|e| format!("Sessions task join failed: {}", e))??;
    log::info!("[report] sessions joined ({} sessions)", sessions.len());
    let manual_sessions = manual_sessions_handle
        .await
        .map_err(|e| format!("Manual sessions task join failed: {}", e))??;
    log::info!(
        "[report] manual_sessions joined ({} manual)",
        manual_sessions.len()
    );

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
