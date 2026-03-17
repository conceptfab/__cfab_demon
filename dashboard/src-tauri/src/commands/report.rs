use tauri::AppHandle;

use super::estimates::get_global_hourly_rate;
use super::helpers::{run_app_blocking, run_db_blocking};
use super::manual_sessions::get_manual_sessions;
use super::sql_fragments::ACTIVE_SESSION_FILTER_S;
use super::types::{
    DateRange, ManualSessionFilters, ProjectDbStats, ProjectExtraInfo, ProjectReportData,
    ProjectWithStats, SessionWithApp, TopApp,
};

/// Lightweight project query for reports.
/// Uses simple SUM(duration_seconds) instead of the expensive SESSION_PROJECT_CTE.
async fn get_report_project(
    app: AppHandle,
    project_id: i64,
) -> Result<ProjectWithStats, String> {
    run_db_blocking(app, move |conn| {
        conn.query_row(
            "SELECT p.id, p.name, p.color, p.created_at, p.excluded_at, p.frozen_at,
                    p.assigned_folder_path,
                    COALESCE((SELECT CAST(SUM(s.duration_seconds) AS INTEGER) FROM sessions s WHERE s.project_id = p.id), 0),
                    COALESCE((SELECT COUNT(DISTINCT s.app_id) FROM sessions s WHERE s.project_id = p.id), 0),
                    (SELECT MAX(s.end_time) FROM sessions s WHERE s.project_id = p.id)
             FROM projects p
             WHERE p.id = ?1",
            [project_id],
            |row| {
                Ok(ProjectWithStats {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                    excluded_at: row.get(4)?,
                    frozen_at: row.get(5)?,
                    assigned_folder_path: row.get(6)?,
                    total_seconds: row.get(7)?,
                    period_seconds: None,
                    app_count: row.get(8)?,
                    last_activity: row.get(9)?,
                })
            },
        )
        .map_err(|e| {
            // Debug: check if the project exists at all (including excluded)
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM projects WHERE id = ?1",
                    [project_id],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            let total: i64 = conn
                .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
                .unwrap_or(-1);
            format!(
                "Project {} not found (exists_check={}, total_projects={}): {}",
                project_id, exists, total, e
            )
        })
    })
    .await
}

/// Lightweight estimate for a single project in reports.
/// Computes: (total_seconds / 3600) * effective_hourly_rate, plus rate_multiplier bonus.
/// Avoids the expensive compute_project_activity_unique CTE entirely.
async fn get_report_estimate(
    app: AppHandle,
    project_id: i64,
) -> Result<f64, String> {
    run_db_blocking(app, move |conn| {
        let hourly_rate: Option<f64> = conn
            .query_row(
                "SELECT hourly_rate FROM projects WHERE id = ?1",
                [project_id],
                |row| row.get(0),
            )
            .unwrap_or(None);

        let global_rate = get_global_hourly_rate(conn)?;
        let effective_rate = hourly_rate.unwrap_or(global_rate);

        // Single query: base seconds + multiplier bonus
        let (base_seconds, multiplier_extra): (f64, f64) = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_seconds), 0),
                        COALESCE(SUM(CASE WHEN rate_multiplier > 1.0
                            THEN duration_seconds * (rate_multiplier - 1.0) ELSE 0 END), 0)
                 FROM sessions WHERE project_id = ?1",
                [project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0.0, 0.0));

        let total_hours = (base_seconds + multiplier_extra) / 3600.0;
        Ok(total_hours * effective_rate)
    })
    .await
}

/// Lightweight session query for reports.
/// Bypasses the expensive SESSION_PROJECT_CTE entirely — filters directly by s.project_id.
async fn get_report_sessions(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<Vec<SessionWithApp>, String> {
    run_db_blocking(app, move |conn| {
        let sql = format!(
            "SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, p.name, p.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment,
                    s.split_source_session_id,
                    asug_latest.suggested_confidence,
                    asug_latest.suggested_project_id,
                    p_sug.name
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = s.project_id
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
             WHERE {ACTIVE_SESSION_FILTER_S}
               AND s.project_id = ?1
               AND s.date >= ?2 AND s.date <= ?3
             ORDER BY s.start_time DESC"
        );
        let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![project_id, date_range.start, date_range.end], |row| {
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
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
    .await
}

/// Lightweight version of get_project_extra_info for reports.
/// Avoids the expensive compute_project_activity_unique CTE entirely.
/// `estimate` is passed in from the already-computed get_report_estimate result.
async fn get_report_extra_info(
    app: AppHandle,
    project_id: i64,
    estimate: f64,
) -> Result<ProjectExtraInfo, String> {
    run_db_blocking(app, move |conn| {
        // Top apps: group sessions by app, sum duration
        let mut app_stmt = conn
            .prepare_cached(
                "SELECT a.display_name, CAST(SUM(s.duration_seconds) AS INTEGER)
                 FROM sessions s
                 JOIN applications a ON a.id = s.app_id
                 WHERE s.project_id = ?1
                 GROUP BY a.id
                 ORDER BY SUM(s.duration_seconds) DESC
                 LIMIT 10",
            )
            .map_err(|e| e.to_string())?;
        let top_apps: Vec<TopApp> = app_stmt
            .query_map([project_id], |row| {
                Ok(TopApp {
                    name: row.get(0)?,
                    seconds: row.get(1)?,
                    color: None,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // Consolidated session stats — single scan instead of 3 separate queries
        let (session_count, comment_count, boosted_session_count): (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(*),
                        SUM(CASE WHEN comment IS NOT NULL AND comment <> '' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rate_multiplier > 1.0 THEN 1 ELSE 0 END)
                 FROM sessions WHERE project_id = ?1",
                [project_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or((0, 0, 0));

        let file_activity_count: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT LOWER(
                    COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), ''))
                ))
                FROM file_activities fa
                WHERE fa.project_id = ?1
                  AND COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), '')) IS NOT NULL
                  AND LOWER(COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), ''))) <> '(background)'",
                [project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let manual_session_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM manual_sessions WHERE project_id = ?1",
                [project_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(ProjectExtraInfo {
            current_value: estimate,
            period_value: estimate,
            db_stats: ProjectDbStats {
                session_count,
                file_activity_count,
                manual_session_count,
                comment_count,
                boosted_session_count,
                estimated_size_bytes: 0,
            },
            top_apps,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_project_report_data(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<ProjectReportData, String> {
    log::info!("[report] START project_id={}, date_range={:?}", project_id, date_range);

    let t0 = std::time::Instant::now();

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
    let estimate_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_report_estimate START");
            let r = get_report_estimate(app, project_id).await;
            log::info!("[report] get_report_estimate DONE ({:?})", t0.elapsed());
            r
        }
    });
    let sessions_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_report_sessions START");
            let r = get_report_sessions(app, project_id, date_range).await;
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
    let estimate = estimate_handle
        .await
        .map_err(|e| format!("Estimate task join failed: {}", e))??;
    log::info!("[report] estimate joined");

    // Phase 2: extra_info depends on estimate (reuses the value instead of recomputing)
    log::info!("[report] get_report_extra_info START");
    let extra = get_report_extra_info(app.clone(), project_id, estimate).await?;
    log::info!("[report] get_report_extra_info DONE ({:?})", t0.elapsed());

    let sessions = sessions_handle
        .await
        .map_err(|e| format!("Sessions task join failed: {}", e))??;
    log::info!("[report] sessions joined ({} sessions)", sessions.len());
    let manual_sessions = manual_sessions_handle
        .await
        .map_err(|e| format!("Manual sessions task join failed: {}", e))??;
    log::info!("[report] manual_sessions joined ({} manual)", manual_sessions.len());

    log::info!("[report] DONE project_id={} in {:?}", project_id, t0.elapsed());

    Ok(ProjectReportData {
        project,
        extra,
        estimate,
        sessions,
        manual_sessions,
    })
}
