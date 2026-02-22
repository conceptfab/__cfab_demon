use tauri::AppHandle;

use super::helpers::timeflow_data_dir;
use super::import::upsert_daily_data;
use super::types::{DailyData, RefreshResult, TodayFileSignature};
use crate::db;

fn is_fake_named_json(path: &std::path::Path) -> bool {
    path.file_name()
        .map(|n| n.to_string_lossy().to_lowercase().contains("fake"))
        .unwrap_or(false)
}

fn resolve_today_data_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let base_dir = timeflow_data_dir()?;
    let demo_mode = db::is_demo_mode_enabled(app)?;

    if !demo_mode {
        return Ok(base_dir.join("data").join(format!("{}.json", today)));
    }

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
pub async fn refresh_today(app: AppHandle) -> Result<RefreshResult, String> {
    let data_path = resolve_today_data_file(&app)?;

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
    let daily = daily.ok_or_else(|| {
        format!(
            "Failed to load daily data from '{}': {}",
            data_path.display(),
            last_err
        )
    })?;

    let mut conn = db::get_connection(&app)?;
    let sessions_upserted = upsert_daily_data(&mut conn, &daily);

    Ok(RefreshResult {
        sessions_upserted,
        file_found: true,
    })
}

#[tauri::command]
pub async fn get_today_file_signature(app: AppHandle) -> Result<TodayFileSignature, String> {
    let data_path = resolve_today_data_file(&app)?;

    if !data_path.exists() {
        return Ok(TodayFileSignature {
            exists: false,
            path: data_path.to_string_lossy().to_string(),
            modified_unix_ms: None,
            size_bytes: None,
        });
    }

    let meta = std::fs::metadata(&data_path).map_err(|e| e.to_string())?;
    let modified_unix_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis());

    Ok(TodayFileSignature {
        exists: true,
        path: data_path.to_string_lossy().to_string(),
        modified_unix_ms,
        size_bytes: Some(meta.len()),
    })
}

#[tauri::command]
pub async fn reset_app_time(app: AppHandle, app_id: i64) -> Result<(), String> {
    let mut conn = db::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM file_activities WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sessions WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_application(
    app: AppHandle,
    app_id: i64,
    display_name: String,
) -> Result<(), String> {
    let new_name = display_name.trim();
    if new_name.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }

    let conn = db::get_connection(&app)?;
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
}

#[tauri::command]
pub async fn delete_app_and_data(app: AppHandle, app_id: i64) -> Result<(), String> {
    let mut conn = db::get_connection(&app)?;
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

    // Remove AI/model records first to avoid orphaned rows (some tables don't use FKs).
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
    tx.execute("DELETE FROM assignment_model_app WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM assignment_model_time WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;

    // Session-linked auto-run items are removed by FK cascade when sessions are deleted.
    tx.execute("DELETE FROM file_activities WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sessions WHERE app_id = ?1", [app_id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM applications WHERE id = ?1", [app_id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn reset_project_time(app: AppHandle, project_id: i64) -> Result<(), String> {
    let mut conn = db::get_connection(&app)?;
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
    Ok(())
}

#[tauri::command]
pub async fn clear_all_data(app: AppHandle) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute_batch(
        "DELETE FROM file_activities;
         DELETE FROM sessions;
         DELETE FROM manual_sessions;
         DELETE FROM applications;
         DELETE FROM imported_files;
         DELETE FROM project_folders;
         DELETE FROM projects;
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
    Ok(())
}

#[tauri::command]
pub async fn export_database(app: AppHandle, path: String) -> Result<(), String> {
    let conn = db::get_connection(&app)?;

    // Flush WAL content into the main database file before export.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("Failed WAL checkpoint before export: {}", e))?;

    let export_path = std::path::Path::new(&path);
    if export_path.exists() {
        std::fs::remove_file(export_path)
            .map_err(|e| format!("Cannot replace existing export file: {}", e))?;
    }

    // VACUUM INTO creates a consistent standalone SQLite snapshot.
    let escaped_path = path.replace('\'', "''");
    let vacuum_sql = format!("VACUUM INTO '{}'", escaped_path);
    conn.execute_batch(&vacuum_sql)
        .map_err(|e| format!("Database export failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_data_dir(app: AppHandle) -> Result<String, String> {
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
pub async fn get_demo_mode_status(app: AppHandle) -> Result<db::DemoModeStatus, String> {
    db::get_demo_mode_status(&app)
}

#[tauri::command]
pub async fn set_demo_mode(app: AppHandle, enabled: bool) -> Result<db::DemoModeStatus, String> {
    db::set_demo_mode(&app, enabled)
}

