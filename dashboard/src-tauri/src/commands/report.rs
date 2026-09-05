use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::daemon::load_persisted_session_min_duration;
use super::helpers::run_db_blocking;
use super::manual_sessions::get_manual_sessions;
use super::projects::{query_active_project_with_stats_in_range, query_project_extra_info};
use super::sql_fragments::{
    ensure_session_project_cache, ensure_session_project_cache_all, SESSION_PROJECT_CTE,
};
use super::time_algorithm::{compute_project_activity_unique, source_key};
use super::types::{
    CostRow, DateRange, ManualSessionFilters, ManualSessionWithProject, ProjectExtraInfo,
    ProjectReportData, ProjectWithStats, SessionWithApp,
};

/// Pozycje kosztowe projektu w okresie raportu + ich suma.
/// Projekt rozwiązywany po `id` → NAZWA, bo koszty linkują się nazwą (brak FK).
pub(crate) fn load_report_costs(
    conn: &rusqlite::Connection,
    project_id: i64,
    date_range: &DateRange,
) -> Result<(Vec<CostRow>, f64), String> {
    let project_name: String = conn
        .query_row("SELECT name FROM projects WHERE id = ?1", [project_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let costs = super::costs::list_costs(conn, &project_name, date_range)?;
    let total = costs.iter().map(|c| c.amount).sum();
    Ok((costs, total))
}

/// `date_range` zawęża statystyki projektu do okresu raportu (rozliczenie miesięczne).
/// Zakres obejmujący całą historię daje ten sam wynik co wcześniej.
async fn get_report_project(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
    min_duration: i64,
) -> Result<ProjectWithStats, String> {
    run_db_blocking(app, move |conn| {
        query_active_project_with_stats_in_range(conn, project_id, min_duration, Some(&date_range))
    })
    .await
}

async fn get_report_extra_info(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<ProjectExtraInfo, String> {
    run_db_blocking(app, move |conn| {
        query_project_extra_info(conn, project_id, &date_range)
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

/// Faktyczne granice danych projektu: najwcześniejszy i najpóźniejszy dzień,
/// w którym projekt ma cokolwiek do pokazania w raporcie — sesję automatyczną
/// (po EFEKTYWNYM przypisaniu, czyli z `session_project_cache`), sesję ręczną
/// lub pozycję kosztową. `None` = projekt nie ma jeszcze żadnych danych.
///
/// Preset „cały okres" w raporcie używa tego zakresu zamiast sztywnego
/// `2020-01-01 .. 2100-01-01`, żeby nagłówek dokumentu pokazywał realny okres
/// projektu. Granice są celowo SZERSZE niż zawartość raportu (bez filtra
/// `min_duration`) — szerszy zakres nigdy nie gubi danych, węższy by gubił.
pub(crate) fn query_project_date_bounds(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<Option<DateRange>, String> {
    ensure_session_project_cache_all(conn)?;

    let mut bounds: Option<(String, String)> = None;
    let mut merge = |min: Option<String>, max: Option<String>| {
        if let (Some(min), Some(max)) = (min, max) {
            bounds = Some(match bounds.take() {
                Some((lo, hi)) => (lo.min(min), hi.max(max)),
                None => (min, max),
            });
        }
    };

    let read = |sql: &str, params: &[&dyn rusqlite::ToSql]| -> Result<(Option<String>, Option<String>), String> {
        conn.query_row(sql, params, |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())
    };

    let (s_min, s_max) = read(
        "SELECT MIN(session_date), MAX(session_date) \
         FROM session_project_cache WHERE project_id = ?1",
        &[&project_id],
    )?;
    merge(s_min, s_max);

    let (m_min, m_max) = read(
        "SELECT MIN(date), MAX(date) FROM manual_sessions WHERE project_id = ?1",
        &[&project_id],
    )?;
    merge(m_min, m_max);

    // Koszty linkują się NAZWĄ projektu (brak FK) — tak samo jak w raporcie.
    let (c_min, c_max) = read(
        "SELECT MIN(cost_date), MAX(cost_date) FROM project_costs \
         WHERE project_name = (SELECT name FROM projects WHERE id = ?1)",
        &[&project_id],
    )?;
    merge(c_min, c_max);

    Ok(bounds.map(|(start, end)| DateRange { start, end }))
}

/// Zakres dat projektu dla pickera okresu raportu. `null` = brak danych.
#[tauri::command]
pub async fn get_project_date_bounds(
    app: AppHandle,
    project_id: i64,
) -> Result<Option<DateRange>, CommandError> {
    Ok(run_db_blocking(app, move |conn| {
        query_project_date_bounds(conn, project_id)
    })
    .await?)
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
        let date_range = date_range.clone();
        async move {
            log::info!("[report] get_report_project START");
            let r = get_report_project(app, project_id, date_range, min_duration).await;
            log::info!("[report] get_report_project DONE ({:?})", t0.elapsed());
            r
        }
    });
    let extra_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        let t0 = t0;
        async move {
            log::info!("[report] get_report_extra_info START");
            let r = get_report_extra_info(app, project_id, date_range).await;
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

    let costs_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move {
            run_db_blocking(app, move |conn| {
                load_report_costs(conn, project_id, &date_range)
            })
            .await
        }
    });

    // Limit godzin liczymy dla OKRESU ROZLICZENIOWEGO obejmującego koniec okresu raportu —
    // limit ma własny kalendarz (dzień startu), niekoniecznie równy zakresowi raportu.
    // Sekcja raportu drukuje daty tego okresu, żeby nie było wątpliwości czego dotyczą.
    let limit_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let reference = date_range.end.clone();
        async move {
            run_db_blocking(app, move |conn| {
                super::project_limits::compute_limit_status(
                    conn,
                    project_id,
                    Some(&reference),
                    min_duration,
                )
            })
            .await
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
    let (costs, costs_total) = costs_handle
        .await
        .map_err(|e| format!("Costs task join failed: {}", e))??;
    log::info!("[report] costs joined ({} items)", costs.len());
    let limit = limit_handle
        .await
        .map_err(|e| format!("Limit task join failed: {}", e))??;
    log::info!("[report] limit joined (configured={})", limit.is_some());

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
        costs,
        costs_total,
        limit,
    })
}

#[cfg(test)]
mod costs_tests {
    use super::*;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            INSERT INTO projects (id, name) VALUES (1, 'Acme');
            INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at) VALUES
                ('a', 'Acme', '2026-05-05', 100.0, '2026-05-05 10:00:00'),
                ('b', 'Acme', '2026-05-25', 50.0, '2026-05-25 10:00:00'),
                ('c', 'Acme', '2026-06-05', 999.0, '2026-06-05 10:00:00');",
        )
        .expect("schema");
        conn
    }

    /// Raport bierze tylko koszty z okresu i podaje ich sumę.
    #[test]
    fn report_costs_are_scoped_to_period() {
        let conn = setup();
        let range = DateRange {
            start: "2026-05-01".into(),
            end: "2026-05-31".into(),
        };

        let (costs, total) = load_report_costs(&conn, 1, &range).expect("costs");

        assert_eq!(costs.len(), 2);
        assert_eq!(costs[0].uid, "a", "pozycje musza byc chronologiczne");
        assert_eq!(costs[1].uid, "b");
        assert_eq!(total, 150.0);
    }

    /// Projekt bez kosztów daje pustą listę i zero — nie błąd.
    #[test]
    fn report_costs_empty_for_project_without_costs() {
        let conn = setup();
        conn.execute("INSERT INTO projects (id, name) VALUES (2, 'Globex')", [])
            .unwrap();
        let range = DateRange {
            start: "2026-05-01".into(),
            end: "2026-05-31".into(),
        };

        let (costs, total) = load_report_costs(&conn, 2, &range).expect("costs");

        assert!(costs.is_empty());
        assert_eq!(total, 0.0);
    }
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
        attach_effective_seconds, compute_effective_by_source,
        query_active_project_with_stats_in_range, query_project_date_bounds,
        query_project_extra_info, query_report_sessions,
        DateRange,
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

    /// Zakres „cały okres" ma pokazywać FAKTYCZNE granice projektu — od pierwszej
    /// sesji do ostatniej pozycji kosztowej — a nie sztywne 2020-01-01 .. 2100-01-01.
    #[test]
    fn project_date_bounds_span_sessions_manual_and_costs() {
        let conn = test_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name, project_id)
             VALUES (1, 'code', 'Code', 1);
             INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id)
               VALUES (1, 1, '2026-03-10T10:00:00', '2026-03-10T11:00:00', 3600, '2026-03-10', 1),
                      (2, 1, '2026-05-02T10:00:00', '2026-05-02T11:00:00', 3600, '2026-05-02', 1);
             INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, end_time, duration_seconds, date)
               VALUES ('m', 'meeting', 1, 1, '2026-02-11T10:00:00', '2026-02-11T11:00:00', 3600, '2026-02-11');
             INSERT INTO project_costs (uid, project_name, cost_date, amount)
               VALUES ('c1', 'P', '2026-06-30', 100.0);",
        )
        .unwrap();

        let bounds = query_project_date_bounds(&conn, 1).unwrap().expect("granice");
        assert_eq!(bounds.start, "2026-02-11", "najwcześniejsza jest sesja ręczna");
        assert_eq!(bounds.end, "2026-06-30", "najpóźniejszy jest koszt");
    }

    /// Projekt bez danych nie ma granic — front zostaje wtedy przy otwartym zakresie.
    #[test]
    fn project_date_bounds_none_without_data() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'))",
            [],
        )
        .unwrap();

        assert!(query_project_date_bounds(&conn, 1).unwrap().is_none());
    }

    /// Raport za okres: sesje, suma godzin i wartość ($) muszą pochodzić z TEGO SAMEGO
    /// okresu — inaczej kwota na fakturze nie zgadza się z wykazanymi sesjami.
    #[test]
    fn report_period_narrows_sessions_total_and_value() {
        let conn = test_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, hourly_rate, created_at)
               VALUES (1, 'P', 100.0, datetime('now'));
             INSERT INTO applications (id, executable_name, display_name, project_id)
             VALUES (1, 'code', 'Code', 1);
             INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id)
               VALUES (1, 1, '2026-06-15T10:00:00', '2026-06-15T11:00:00', 3600, '2026-06-15', 1),
                      (2, 1, '2026-07-10T10:00:00', '2026-07-10T12:00:00', 7200, '2026-07-10', 1);",
        )
        .unwrap();

        let july = DateRange {
            start: "2026-07-01".into(),
            end: "2026-07-31".into(),
        };
        let all_time = DateRange {
            start: "2020-01-01".into(),
            end: "2100-01-01".into(),
        };

        let july_sessions = query_report_sessions(&conn, 1, &july, 0).unwrap();
        assert_eq!(july_sessions.len(), 1, "tylko sesja lipcowa");
        assert_eq!(july_sessions[0].id, 2);

        let july_extra = query_project_extra_info(&conn, 1, &july).unwrap();
        let all_time_extra = query_project_extra_info(&conn, 1, &all_time).unwrap();

        // 2h × 100 = 200 za lipiec; 3h × 100 = 300 za całą historię.
        assert!((july_extra.current_value - 200.0).abs() < 0.01);
        assert!((all_time_extra.current_value - 300.0).abs() < 0.01);
        assert!((july_extra.value_base_seconds - 7200.0).abs() < 1.0);

        let july_project =
            query_active_project_with_stats_in_range(&conn, 1, 0, Some(&july)).unwrap();
        let all_time_project = query_active_project_with_stats_in_range(&conn, 1, 0, None).unwrap();
        assert_eq!(july_project.total_seconds, 7200);
        assert_eq!(july_project.period_seconds, Some(7200));
        assert_eq!(all_time_project.total_seconds, 10800);
        assert_eq!(all_time_project.period_seconds, None);
    }
}
