use super::helpers::timeflow_data_dir;
use super::types::{
    AppDailyData, ApplicationRow, DailyData, DateRange, ExportArchive, ExportData, ExportMetadata,
    ManualSession, Project, SessionRow,
};
use crate::db;
use rfd::AsyncFileDialog;
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;

fn build_export_archive(
    app: &AppHandle,
    project_id: Option<i64>,
    date_start: Option<String>,
    date_end: Option<String>,
) -> Result<(ExportArchive, String), String> {
    let (archive, default_name) = {
        let conn = db::get_connection(app)?;

        // 1. Resolve date range
        let start = date_start.unwrap_or_else(|| "2000-01-01".to_string());
        let end = date_end.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
        let date_range = DateRange {
            start: start.clone(),
            end: end.clone(),
        };

        // 2. Fetch Projects
        let project_query = if project_id.is_some() {
            "SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported FROM projects WHERE id = ?1"
        } else {
            "SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported FROM projects"
        };

        let mut stmt = conn.prepare(project_query).map_err(|e| e.to_string())?;
        let projects: Vec<Project> = if let Some(pid) = project_id {
            stmt.query_map([pid], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    hourly_rate: row.get(3)?,
                    created_at: row.get(4)?,
                    excluded_at: row.get(5)?,
                    assigned_folder_path: row.get(6)?,
                    is_imported: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        } else {
            stmt.query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    hourly_rate: row.get(3)?,
                    created_at: row.get(4)?,
                    excluded_at: row.get(5)?,
                    assigned_folder_path: row.get(6)?,
                    is_imported: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        };

        let project_ids: Vec<i64> = projects.iter().map(|p| p.id).collect();
        if project_ids.is_empty() && project_id.is_some() {
            return Err("Project not found".to_string());
        }

        // 3. Fetch Applications
        let app_query = if project_id.is_some() {
            "SELECT id, executable_name, display_name, project_id, is_imported FROM applications WHERE project_id IN (SELECT id FROM projects WHERE id = ?1)"
        } else {
            "SELECT id, executable_name, display_name, project_id, is_imported FROM applications"
        };

        let mut stmt = conn.prepare(app_query).map_err(|e| e.to_string())?;
        let applications: Vec<ApplicationRow> = if let Some(pid) = project_id {
            stmt.query_map([pid], |row| {
                Ok(ApplicationRow {
                    id: row.get(0)?,
                    executable_name: row.get(1)?,
                    display_name: row.get(2)?,
                    project_id: row.get(3)?,
                    is_imported: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        } else {
            stmt.query_map([], |row| {
                Ok(ApplicationRow {
                    id: row.get(0)?,
                    executable_name: row.get(1)?,
                    display_name: row.get(2)?,
                    project_id: row.get(3)?,
                    is_imported: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        };

        let app_ids: Vec<i64> = applications.iter().map(|a| a.id).collect();

        conn.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS _export_app_ids (id INTEGER PRIMARY KEY);
         CREATE TEMP TABLE IF NOT EXISTS _export_project_ids (id INTEGER PRIMARY KEY);
         DELETE FROM _export_app_ids;
         DELETE FROM _export_project_ids;",
        )
        .map_err(|e| e.to_string())?;

        if !app_ids.is_empty() {
            let mut insert_app_id = conn
                .prepare_cached("INSERT INTO _export_app_ids (id) VALUES (?1)")
                .map_err(|e| e.to_string())?;
            for app_id in &app_ids {
                insert_app_id.execute([app_id]).map_err(|e| e.to_string())?;
            }
        }

        if !project_ids.is_empty() {
            let mut insert_project_id = conn
                .prepare_cached("INSERT INTO _export_project_ids (id) VALUES (?1)")
                .map_err(|e| e.to_string())?;
            for project_id in &project_ids {
                insert_project_id
                    .execute([project_id])
                    .map_err(|e| e.to_string())?;
            }
        }

        // 4. Fetch Sessions
        let mut sessions = Vec::new();
        if !app_ids.is_empty() {
            let mut stmt = conn
                .prepare(
                    "SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds, s.date
                        , COALESCE(s.rate_multiplier, 1.0)
                 FROM sessions s
                 INNER JOIN _export_app_ids e ON e.id = s.app_id
                 WHERE s.date >= ?1 AND s.date <= ?2",
                )
                .map_err(|e| e.to_string())?;
            let s_rows = stmt
                .query_map([&start, &end], |row| {
                    Ok(SessionRow {
                        id: row.get(0)?,
                        app_id: row.get(1)?,
                        start_time: row.get(2)?,
                        end_time: row.get(3)?,
                        duration_seconds: row.get(4)?,
                        date: row.get(5)?,
                        rate_multiplier: row.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;

            for s in s_rows {
                sessions.push(s.map_err(|e| e.to_string())?);
            }
        }

        // 5. Fetch Manual Sessions
        let mut manual_sessions = Vec::new();
        if !project_ids.is_empty() {
            let mut stmt = conn
            .prepare(
                "SELECT ms.id, ms.title, ms.session_type, ms.project_id, ms.start_time, ms.end_time,
                        ms.duration_seconds, ms.date, ms.created_at
                 FROM manual_sessions ms
                 INNER JOIN _export_project_ids e ON e.id = ms.project_id
                 WHERE ms.date >= ?1 AND ms.date <= ?2",
            )
            .map_err(|e| e.to_string())?;
            let ms_rows = stmt
                .query_map([&start, &end], |row| {
                    Ok(ManualSession {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        session_type: row.get(2)?,
                        project_id: row.get(3)?,
                        start_time: row.get(4)?,
                        end_time: row.get(5)?,
                        duration_seconds: row.get(6)?,
                        date: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                })
                .map_err(|e| e.to_string())?;

            for ms in ms_rows {
                manual_sessions.push(ms.map_err(|e| e.to_string())?);
            }
        }

        // 6. Fetch Daily JSON Files
        let mut daily_files = HashMap::new();
        let data_dir = timeflow_data_dir()?.join("data");
        if data_dir.exists() {
            for entry in fs::read_dir(data_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_file() && path.extension().map(|s| s == "json").unwrap_or(false) {
                    let Some(stem) = path.file_stem() else {
                        continue;
                    };
                    let file_name = stem.to_string_lossy().to_string();
                    if file_name >= start && file_name <= end {
                        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                        if let Ok(daily) = serde_json::from_str::<DailyData>(&content) {
                            // If single project, filter apps in daily data
                            if project_id.is_some() {
                                let filtered_apps: HashMap<String, AppDailyData> = daily
                                    .apps
                                    .into_iter()
                                    .filter(|(exe, _)| {
                                        applications.iter().any(|a| a.executable_name == *exe)
                                    })
                                    .collect();
                                if !filtered_apps.is_empty() {
                                    daily_files.insert(
                                        file_name,
                                        DailyData {
                                            date: daily.date,
                                            apps: filtered_apps,
                                        },
                                    );
                                }
                            } else {
                                daily_files.insert(file_name, daily);
                            }
                        }
                    }
                }
            }
        }

        // 7. Metadata calculation
        let total_sessions = (sessions.len() + manual_sessions.len()) as i64;
        let total_seconds: i64 = sessions.iter().map(|s| s.duration_seconds).sum::<i64>()
            + manual_sessions
                .iter()
                .map(|s| s.duration_seconds)
                .sum::<i64>();

        let project_name = if let Some(pid) = project_id {
            projects
                .iter()
                .find(|p| p.id == pid)
                .map(|p| p.name.clone())
        } else {
            None
        };

        let machine_id = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());

        let default_name = format!(
            "timeflow-export-{}.json",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        );
        let archive = ExportArchive {
            version: "1.1".to_string(),
            exported_at: chrono::Local::now().to_rfc3339(),
            machine_id,
            export_type: if project_id.is_some() {
                "single_project".to_string()
            } else {
                "all_data".to_string()
            },
            date_range,
            metadata: ExportMetadata {
                project_id,
                project_name,
                total_sessions,
                total_seconds,
            },
            data: ExportData {
                projects,
                applications,
                sessions,
                manual_sessions,
                daily_files,
            },
        };
        (archive, default_name)
    };

    Ok((archive, default_name))
}

#[tauri::command]
pub async fn export_data(
    app: AppHandle,
    project_id: Option<i64>,
    date_start: Option<String>,
    date_end: Option<String>,
) -> Result<String, String> {
    let (archive, default_name) = build_export_archive(&app, project_id, date_start, date_end)?;

    // Save dialog
    let path = AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .save_file()
        .await;

    if let Some(file_handle) = path {
        let json = serde_json::to_string_pretty(&archive).map_err(|e| e.to_string())?;
        fs::write(file_handle.path(), json).map_err(|e| e.to_string())?;
        Ok(file_handle.path().to_string_lossy().to_string())
    } else {
        Err("Export cancelled".to_string())
    }
}

#[tauri::command]
pub async fn export_data_archive(
    app: AppHandle,
    project_id: Option<i64>,
    date_start: Option<String>,
    date_end: Option<String>,
) -> Result<ExportArchive, String> {
    let (archive, _default_name) = build_export_archive(&app, project_id, date_start, date_end)?;
    Ok(archive)
}
