use crate::commands::CommandError;
use tauri::AppHandle;

use super::daily_store_bridge;
use super::helpers::{run_app_blocking, run_db_blocking, timeflow_data_dir};
use super::import::upsert_daily_data;
use super::types::{BackfillResult, DailyData, RefreshResult, TodayFileSignature};
use crate::db;
use std::collections::HashSet;

/// How far back to look when recovering days recorded by the daemon while the
/// dashboard was closed. Bounds the daily_store range scan; already-imported
/// days are skipped, so this is only meaningful for the first run after a gap.
const BACKFILL_WINDOW_DAYS: i64 = 365;

fn is_fake_named_json(path: &std::path::Path) -> bool {
    path.file_name()
        .map(|n| n.to_string_lossy().to_lowercase().contains("fake"))
        .unwrap_or(false)
}

fn resolve_today_demo_file(_app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let base_dir = timeflow_data_dir()?;

    let fake_data_dir = base_dir.join("fake_data");
    let preferred = fake_data_dir.join(format!("{}_fake.json", today));
    if preferred.exists() {
        return Ok(preferred);
    }

    if !fake_data_dir.exists() {
        return Ok(preferred);
    }

    let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(&fake_data_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().map(|e| e == "json").unwrap_or(false)
                && !path
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
                && is_fake_named_json(path)
                && path
                    .file_name()
                    .map(|n| n.to_string_lossy().starts_with(&today))
                    .unwrap_or(false)
        })
        .collect();

    matches.sort_by(|a, b| {
        let a_meta = std::fs::metadata(a).ok();
        let b_meta = std::fs::metadata(b).ok();
        let a_modified = a_meta.and_then(|m| m.modified().ok());
        let b_modified = b_meta.and_then(|m| m.modified().ok());
        b_modified.cmp(&a_modified).then_with(|| a.cmp(b))
    });

    Ok(matches.into_iter().next().unwrap_or(preferred))
}

#[tauri::command]
pub async fn refresh_today(app: AppHandle) -> Result<RefreshResult, CommandError> {
    let demo_mode = db::is_demo_mode_enabled(&app)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let daily = if demo_mode {
        let data_path = resolve_today_demo_file(&app)?;
        if !data_path.exists() {
            return Ok(RefreshResult {
                sessions_upserted: 0,
                file_found: false,
            });
        }

        let mut daily: Option<DailyData> = None;
        let mut last_err = String::new();
        for attempt in 1..=3 {
            match std::fs::read_to_string(&data_path) {
                Ok(content) => match serde_json::from_str::<DailyData>(&content) {
                    Ok(parsed) => {
                        daily = Some(parsed);
                        break;
                    }
                    Err(e) => {
                        last_err = format!("Invalid JSON (attempt {}): {}", attempt, e);
                    }
                },
                Err(e) => {
                    last_err = format!("Read error (attempt {}): {}", attempt, e);
                }
            }

            if attempt < 3 {
                tokio::time::sleep(std::time::Duration::from_millis(60)).await;
            }
        }

        daily.ok_or_else(|| {
            format!(
                "Failed to load daily data from '{}': {}",
                data_path.display(),
                last_err
            )
        })?
    } else {
        let today_for_load = today.clone();
        match run_app_blocking(app.clone(), move |_| {
            daily_store_bridge::load_day(&today_for_load)
        })
        .await?
        {
            Some(daily) => daily,
            None => {
                return Ok(RefreshResult {
                    sessions_upserted: 0,
                    file_found: false,
                });
            }
        }
    };

    let sessions_upserted =
        run_db_blocking(app, move |conn| Ok(upsert_daily_data(conn, &daily))).await?;

    Ok(RefreshResult {
        sessions_upserted,
        file_found: true,
    })
}

/// Recovers days that the daemon recorded into the daily_store but that never
/// made it into the dashboard database — typically days the user worked while
/// the dashboard was closed (only `refresh_today` materializes the current day).
///
/// Safety: only days with **zero** sessions in the dashboard are backfilled.
/// Days already present (which may carry manual edits, splits or assignments)
/// are never touched.
#[tauri::command]
pub async fn refresh_missing_days(app: AppHandle) -> Result<BackfillResult, CommandError> {
    // Demo mode reads fake data files, not the daily_store — nothing to recover.
    if db::is_demo_mode_enabled(&app)? {
        return Ok(BackfillResult::default());
    }

    let today = chrono::Local::now().date_naive();
    let start = (today - chrono::Duration::days(BACKFILL_WINDOW_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    let end = today.format("%Y-%m-%d").to_string();

    // Load the daily_store snapshots for the window (opens its own store conn).
    let range = run_app_blocking(app.clone(), move |_| {
        daily_store_bridge::load_range(&start, &end)
    })
    .await?;

    if range.is_empty() {
        return Ok(BackfillResult::default());
    }

    run_db_blocking(app, move |conn| {
        let existing_dates: HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT DISTINCT date FROM sessions")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<HashSet<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        // Po "Restore Data" baza ma odzwierciedlać PLIK backupu, nie lokalną
        // historię trackingu — restore zapisuje watermark i dni sprzed niego
        // nie są backfillowane (dzisiejszy, żywy tracking wraca normalnie).
        let backfill_min_date: Option<String> = conn
            .query_row(
                "SELECT value FROM system_settings WHERE key = 'daily_backfill_min_date'",
                [],
                |row| row.get(0),
            )
            .ok();

        let mut result = BackfillResult::default();
        for (date, daily) in &range {
            result.days_scanned += 1;
            if daily.apps.is_empty() || existing_dates.contains(date) {
                continue;
            }
            if let Some(ref min_date) = backfill_min_date {
                if date < min_date {
                    continue;
                }
            }
            let upserted = upsert_daily_data(conn, daily);
            if upserted > 0 {
                result.days_backfilled += 1;
                result.sessions_upserted += upserted;
            }
        }

        if result.days_backfilled > 0 {
            log::info!(
                "Backfill from daily_store: recovered {} day(s), {} session(s)",
                result.days_backfilled,
                result.sessions_upserted
            );
        }
        Ok(result)
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn get_today_file_signature(app: AppHandle) -> Result<TodayFileSignature, CommandError> {
    run_app_blocking(app, move |app| {
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        if demo_mode {
            let data_path = resolve_today_demo_file(&app)?;
            if !data_path.exists() {
                return Ok(TodayFileSignature {
                    exists: false,
                    path: data_path.to_string_lossy().to_string(),
                    modified_unix_ms: None,
                    size_bytes: None,
                    revision: None,
                });
            }

            let meta = std::fs::metadata(&data_path).map_err(|e| e.to_string())?;
            let modified_unix_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis());

            return Ok(TodayFileSignature {
                exists: true,
                path: data_path.to_string_lossy().to_string(),
                modified_unix_ms,
                size_bytes: Some(meta.len()),
                revision: None,
            });
        }

        let store_path = daily_store_bridge::store_path()?;
        let signature = daily_store_bridge::get_day_signature(&today)?;
        let meta = std::fs::metadata(&store_path).ok();

        Ok(TodayFileSignature {
            exists: signature.is_some(),
            path: store_path.to_string_lossy().to_string(),
            modified_unix_ms: signature.map(|sig| sig.updated_unix_ms as u128),
            size_bytes: meta.map(|value| value.len()),
            revision: signature.map(|sig| sig.revision),
        })
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn reset_app_time(app: AppHandle, app_id: i64) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM file_activities WHERE app_id = ?1", [app_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE app_id = ?1", [app_id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        if let Err(e) = super::assignment_model::retrain_model_sync(conn) {
            log::warn!("Auto-retrain after reset_app_time failed: {}", e);
        }
        Ok(())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn rename_application(
    app: AppHandle,
    app_id: i64,
    display_name: String,
) -> Result<(), CommandError> {
    let new_name = display_name.trim();
    if new_name.is_empty() {
        return Err("Display name cannot be empty".to_string().into());
    }

    let new_name = new_name.to_string();
    run_db_blocking(app, move |conn| {
        let updated = conn
            .execute(
                "UPDATE applications SET display_name = ?1 WHERE id = ?2",
                rusqlite::params![new_name, app_id],
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            return Err("Application not found".to_string());
        }

        Ok(())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_app_and_data(app: AppHandle, app_id: i64) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM applications WHERE id = ?1",
                [app_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err("Application not found".to_string());
        }

        tx.execute(
            "DELETE FROM assignment_feedback WHERE app_id = ?1 OR session_id IN (SELECT id FROM sessions WHERE app_id = ?1)",
            [app_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM assignment_suggestions WHERE app_id = ?1 OR session_id IN (SELECT id FROM sessions WHERE app_id = ?1)",
            [app_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM assignment_model_app WHERE app_id = ?1",
            [app_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM assignment_model_time WHERE app_id = ?1",
            [app_id],
        )
        .map_err(|e| e.to_string())?;

        tx.execute("DELETE FROM file_activities WHERE app_id = ?1", [app_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE app_id = ?1", [app_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM applications WHERE id = ?1", [app_id])
            .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;

        if let Err(e) = super::assignment_model::retrain_model_sync(conn) {
            log::warn!("Auto-retrain after delete_app_and_data failed: {}", e);
        }
        Ok(())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn reset_project_time(app: AppHandle, project_id: i64) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM file_activities WHERE app_id IN (SELECT id FROM applications WHERE project_id = ?1)",
            [project_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM sessions WHERE app_id IN (SELECT id FROM applications WHERE project_id = ?1)",
            [project_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        if let Err(e) = super::assignment_model::retrain_model_sync(conn) {
            log::warn!("Auto-retrain after reset_project_time failed: {}", e);
        }
        Ok(())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn clear_all_data(app: AppHandle) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "DELETE FROM file_activities;
             DELETE FROM sessions;
             DELETE FROM manual_sessions;
             DELETE FROM applications;
             DELETE FROM imported_files;
             DELETE FROM project_folders;
             DELETE FROM projects;
             DELETE FROM session_manual_overrides;
             DELETE FROM tombstones;
             DELETE FROM assignment_auto_run_items;
             DELETE FROM assignment_auto_runs;
             DELETE FROM assignment_feedback;
             DELETE FROM assignment_suggestions;
             DELETE FROM assignment_model_app;
             DELETE FROM assignment_model_token;
             DELETE FROM assignment_model_time;
             DELETE FROM assignment_model_state;",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn get_data_dir(app: AppHandle) -> Result<String, CommandError> {
    let base_dir = timeflow_data_dir()?;
    let demo_mode = db::is_demo_mode_enabled(&app)?;
    let dir = if demo_mode {
        base_dir.join("fake_data")
    } else {
        base_dir.join("data")
    };
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_demo_mode_status(app: AppHandle) -> Result<db::DemoModeStatus, CommandError> {
    db::get_demo_mode_status(&app).map_err(Into::into)
}

#[tauri::command]
pub async fn set_demo_mode(app: AppHandle, enabled: bool) -> Result<db::DemoModeStatus, CommandError> {
    run_app_blocking(app, move |app| db::set_demo_mode(&app, enabled))
        .await
        .map_err(Into::into)
}
