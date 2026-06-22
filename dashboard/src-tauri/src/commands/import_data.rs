use super::daily_store_bridge;
use super::helpers::{run_app_blocking, timeflow_data_dir, validate_import_path};
use super::types::{
    ExportArchive, FileActivityExportRow, ImportSummary, ImportValidation, SessionConflict,
    SessionRow,
};
use crate::db;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn save_demo_daily_file(
    date: &str,
    daily: &crate::commands::types::DailyData,
) -> Result<(), String> {
    let fake_data_dir = timeflow_data_dir()?.join("fake_data");
    if !fake_data_dir.exists() {
        fs::create_dir_all(&fake_data_dir).map_err(|e| e.to_string())?;
    }
    let file_path = fake_data_dir.join(format!("{}_fake.json", date));
    let final_daily = if file_path.exists() {
        let existing_content = fs::read_to_string(&file_path).unwrap_or_default();
        if let Ok(mut existing_daily) =
            serde_json::from_str::<crate::commands::types::DailyData>(&existing_content)
        {
            for (exe, app_data) in &daily.apps {
                existing_daily.apps.insert(exe.clone(), app_data.clone());
            }
            existing_daily
        } else {
            daily.clone()
        }
    } else {
        daily.clone()
    };
    let json = serde_json::to_string_pretty(&final_daily).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())
}

/// Parsuje archiwum eksportu; gdy plik wygląda na dzienny JSON demona,
/// zwraca czytelny komunikat zamiast surowego błędu serde.
fn parse_export_archive(content: &str) -> Result<ExportArchive, String> {
    serde_json::from_str::<ExportArchive>(content).map_err(|e| {
        let looks_like_daily = serde_json::from_str::<serde_json::Value>(content)
            .map(|v| v.get("apps").is_some() && v.get("date").is_some())
            .unwrap_or(false);
        if looks_like_daily {
            "This is a TIMEFLOW daily activity file, not an export archive. Import it on the Import page (drag & drop or Browse Files).".to_string()
        } else {
            format!("Not a valid TIMEFLOW export archive: {}", e)
        }
    })
}

#[tauri::command]
pub async fn validate_import(
    app: AppHandle,
    archive_path: String,
) -> Result<ImportValidation, String> {
    run_app_blocking(app, move |app| {
        validate_import_path(&archive_path)?;
        let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
        let archive = parse_export_archive(&content)?;
        let conn = db::get_connection(&app)?;

        let mut existing_projects: HashSet<String> = HashSet::new();
        let mut stmt = conn
            .prepare_cached("SELECT name FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let name = row.map_err(|e| format!("Failed to read existing project row: {}", e))?;
            existing_projects.insert(name);
        }

        let mut existing_apps: HashSet<String> = HashSet::new();
        let mut stmt = conn
            .prepare_cached("SELECT executable_name FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let exe = row.map_err(|e| format!("Failed to read existing application row: {}", e))?;
            existing_apps.insert(exe);
        }

        let mut missing_projects = Vec::new();
        let mut missing_applications = Vec::new();
        let mut overlapping_sessions = Vec::new();
        let app_exe_by_id: HashMap<i64, String> = archive
            .data
            .applications
            .iter()
            .map(|a| (a.id, a.executable_name.clone()))
            .collect();

        // Check Projects
        for p in &archive.data.projects {
            if !existing_projects.contains(&p.name) {
                missing_projects.push(p.name.clone());
            }
        }

        // Check Applications
        for a in &archive.data.applications {
            if !existing_apps.contains(&a.executable_name) {
                missing_applications.push(format!("{} ({})", a.display_name, a.executable_name));
            }
        }

        // Check Overlapping Sessions in one DB pass:
        // stage archive sessions into a TEMP table and join with local sessions.
        if !archive.data.sessions.is_empty() {
            conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _tf_import_session_probe (
                 executable_name TEXT NOT NULL,
                 start_time TEXT NOT NULL,
                 end_time TEXT NOT NULL
             );
             DELETE FROM _tf_import_session_probe;",
            )
            .map_err(|e| e.to_string())?;

            {
                let mut insert_probe = conn
                .prepare_cached(
                    "INSERT INTO _tf_import_session_probe (executable_name, start_time, end_time)
                     VALUES (?1, ?2, ?3)",
                )
                .map_err(|e| e.to_string())?;
                for s in &archive.data.sessions {
                    if let Some(exe) = app_exe_by_id.get(&s.app_id) {
                        insert_probe
                            .execute(rusqlite::params![exe, s.start_time, s.end_time])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }

            let mut overlap_stmt = conn
                .prepare_cached(
                    "SELECT
                     i.start_time,
                     i.end_time,
                     s.start_time,
                     s.end_time,
                     COALESCE(a.display_name, a.executable_name) AS app_name
                 FROM _tf_import_session_probe i
                 JOIN applications a
                   ON a.executable_name = i.executable_name
                 JOIN sessions s
                   ON s.app_id = a.id
                  AND i.start_time < s.end_time
                  AND i.end_time > s.start_time
                 LIMIT 11",
                )
                .map_err(|e| e.to_string())?;
            let rows = overlap_stmt
                .query_map([], |row| {
                    Ok(SessionConflict {
                        app_name: row.get(4)?,
                        start: row.get(0)?,
                        end: row.get(1)?,
                        existing_start: row.get(2)?,
                        existing_end: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                overlapping_sessions
                    .push(row.map_err(|e| format!("Failed to read overlap conflict row: {}", e))?);
                if overlapping_sessions.len() > 10 {
                    break;
                }
            }

            conn.execute("DELETE FROM _tf_import_session_probe", [])
                .map_err(|e| e.to_string())?;
        }

        Ok(ImportValidation {
            valid: missing_projects.is_empty()
                && missing_applications.is_empty()
                && overlapping_sessions.is_empty(),
            missing_projects,
            missing_applications,
            overlapping_sessions,
        })
    })
    .await
}

#[tauri::command]
pub async fn import_data(app: AppHandle, archive_path: String) -> Result<ImportSummary, String> {
    run_app_blocking(app, move |app| {
        validate_import_path(&archive_path)?;
        let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
        let archive = parse_export_archive(&content)?;
        let mut conn = db::get_connection(&app)?;

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let daily_mode = if db::is_demo_mode_enabled(&app)? { DailyFilesMode::Demo } else { DailyFilesMode::Live };
        let summary = import_archive_into_tx(&tx, &archive, false, daily_mode)?;
        tx.commit().map_err(|e| e.to_string())?;

        log::info!(
            "import_data: archive '{}' imported — projects_created={}, apps_created={}, sessions_imported={}, sessions_merged={}, daily_files_imported={}",
            archive_path,
            summary.projects_created,
            summary.apps_created,
            summary.sessions_imported,
            summary.sessions_merged,
            summary.daily_files_imported
        );

        match super::sessions::apply_manual_session_overrides(&conn) {
            Ok(reapplied) if reapplied > 0 => {
                log::info!(
                    "Reapplied {} manual session override(s) after import_data",
                    reapplied
                );
            }
            Ok(_) => {}
            Err(e) => {
                log::warn!(
                    "Failed to reapply manual session overrides after import_data: {}",
                    e
                );
            }
        }

        Ok(summary)
    })
    .await
}

/// Import archive data into a transaction (shared logic for import_data and import_data_archive).
/// When `clear_before_import` is true, all synchronized tables are wiped first (online sync mode).
/// Technical replace-mode clear. The DELETEs are NOT user deletions — they
/// only make room for the archive being imported — so tombstone triggers are
/// disabled for the duration (DDL is transactional: rollback restores them).
/// Otherwise the clear mints tombstones with deleted_at = NOW that (a) block
/// importing the same records from a second archive (LWW) and (b) propagate
/// via LAN sync and delete those records on every peer.
fn clear_synchronized_tables(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    use crate::db_migrations::tombstone_triggers;
    for sql in tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
        tx.execute(sql, []).map_err(|e| e.to_string())?;
    }
    tx.execute_batch(
        "DELETE FROM file_activities;
         DELETE FROM sessions;
         DELETE FROM manual_sessions;
         DELETE FROM applications;
         DELETE FROM projects;
         DELETE FROM assignment_auto_run_items;
         DELETE FROM assignment_auto_runs;
         DELETE FROM assignment_feedback;
         DELETE FROM assignment_suggestions;
         DELETE FROM assignment_model_app;
         DELETE FROM assignment_model_token;
         DELETE FROM assignment_model_time;
         DELETE FROM assignment_model_state
           WHERE key NOT IN (
             'mode',
             'min_confidence_suggest',
             'min_confidence_auto',
             'min_evidence_auto',
             'feedback_weight',
             'cooldown_until'
           );",
    )
    .map_err(|e| format!("Failed to clear tables before sync import: {}", e))?;
    for sql in tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
        tx.execute(sql, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Applies archive tombstones to local records and persists them locally with
/// their ORIGINAL deleted_at (dedup by table_name + sync_key), so deletions
/// keep propagating with correct LWW semantics. Caller must have tombstone
/// triggers disabled — the DELETEs here are replays of remote deletions.
fn apply_archive_tombstones(
    tx: &rusqlite::Transaction<'_>,
    tombstones: &[super::types::Tombstone],
) -> Result<(), String> {
    for t in tombstones {
        let Some(ref sync_key) = t.sync_key else {
            continue;
        };
        let already_known: bool = tx
            .query_row(
                "SELECT 1 FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
                rusqlite::params![t.table_name, sync_key],
                |_| Ok(()),
            )
            .is_ok();
        if !already_known {
            tx.execute(
                "INSERT INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![t.table_name, t.record_id, t.deleted_at, sync_key],
            )
            .map_err(|e| e.to_string())?;
        }

        match t.table_name.as_str() {
            "projects" => {
                let name = sync_key;
                // Guard: skip if project was updated after tombstone (normalize for timezone-safe comparison)
                let local_updated: Option<String> = tx
                    .query_row(
                        "SELECT updated_at FROM projects WHERE name = ?1",
                        [name.as_str()],
                        |row| row.get(0),
                    )
                    .ok();
                if let Some(ref lu) = local_updated {
                    let norm_local = super::delta_export::normalize_datetime_for_sqlite_pub(lu);
                    let norm_deleted =
                        super::delta_export::normalize_datetime_for_sqlite_pub(&t.deleted_at);
                    if norm_local > norm_deleted {
                        continue; // Project re-created/updated after deletion — skip
                    }
                }
                // Null out FK references before deleting project
                tx.execute(
                    "UPDATE sessions SET project_id = NULL \
                     WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                    [name.as_str()],
                )
                .ok();
                tx.execute(
                    "UPDATE manual_sessions SET project_id = 0 \
                     WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                    [name.as_str()],
                )
                .ok();
                tx.execute(
                    "UPDATE applications SET project_id = NULL \
                     WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                    [name.as_str()],
                )
                .ok();
                tx.execute("DELETE FROM projects WHERE name = ?1", [name.as_str()])
                    .ok();
            }
            "manual_sessions" => {
                apply_manual_session_tombstone(tx, sync_key, &t.deleted_at)?;
            }
            "clients" => {
                // sync_key = client name. Detach projects first (assignment becomes
                // unset), mirroring the local delete_client path, then delete the
                // client. Matches the LAN merge tombstone handling.
                tx.execute(
                    "UPDATE projects SET client_name = NULL \
                     WHERE lower(client_name) = lower(?1)",
                    [sync_key.as_str()],
                )
                .ok();
                tx.execute("DELETE FROM clients WHERE name = ?1", [sync_key.as_str()])
                    .ok();
            }
            _ => {}
        }
    }
    Ok(())
}

/// Applies one manual_sessions tombstone with a last-writer-wins guard:
/// a record re-created/updated AFTER the deletion must survive (mirrors the
/// projects tombstone guard). Without this, stale tombstones from an old
/// incident on one machine permanently delete restored data on every import.
fn apply_manual_session_tombstone(
    tx: &rusqlite::Transaction<'_>,
    sync_key: &str,
    deleted_at: &str,
) -> Result<(), String> {
    let parts: Vec<&str> = sync_key.split('|').collect();
    if parts.len() != 3 {
        return Ok(());
    }
    let start_time = parts[1];
    let title = parts[2];
    let local_updated: Option<String> = tx
        .query_row(
            "SELECT MAX(updated_at) FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
            [start_time, title],
            |row| row.get(0),
        )
        .ok()
        .flatten();
    if let Some(ref lu) = local_updated {
        let norm_local = super::delta_export::normalize_datetime_for_sqlite_pub(lu);
        let norm_deleted = super::delta_export::normalize_datetime_for_sqlite_pub(deleted_at);
        if norm_local > norm_deleted {
            return Ok(()); // Record re-created/updated after deletion — skip
        }
    }
    tx.execute(
        "DELETE FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
        [start_time, title],
    )
    .map_err(|e| format!("Failed to apply manual_sessions tombstone: {}", e))?;
    Ok(())
}

/// How to handle the archive's daily JSON files during import.
/// `Skip` keeps the import fully headless (offline harness / tests) —
/// the DB merge is identical, only daily-store files are not written.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DailyFilesMode {
    Live,
    Demo,
    Skip,
}

fn import_archive_into_tx(
    tx: &rusqlite::Transaction<'_>,
    archive: &ExportArchive,
    clear_before_import: bool,
    daily_files: DailyFilesMode,
) -> Result<ImportSummary, String> {
    let mut summary = ImportSummary {
        projects_created: 0,
        apps_created: 0,
        sessions_imported: 0,
        sessions_merged: 0,
        daily_files_imported: 0,
    };

    // --- Safety: snapshot counts before any changes ---
    let sessions_before: i64 = tx
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let projects_before: i64 = tx
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap_or(0);

    // --- Clear synchronized tables (online sync only) ---
    if clear_before_import {
        clear_synchronized_tables(tx)?;
    }

    // 0. Handle Tombstones.
    //
    // The whole import runs with tombstone triggers DISABLED (mirrors the
    // daemon's LAN merge): every DELETE below is a technical replay/merge, not
    // a user deletion — trigger-minted copies with deleted_at = NOW would
    // block importing the same records from a second archive and propagate
    // false deletions to peers. Remote deletions still propagate, because the
    // archive's tombstones are persisted with their ORIGINAL deleted_at.
    // DDL is transactional — a rollback restores the triggers.
    {
        use crate::db_migrations::tombstone_triggers;
        for sql in tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
            tx.execute(sql, []).map_err(|e| e.to_string())?;
        }
    }
    apply_archive_tombstones(tx, &archive.data.tombstones)?;

    // 1. Map and Create Projects
    let mut existing_projects_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT name, id FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (name, id) =
                row.map_err(|e| format!("Failed to read local project mapping row: {}", e))?;
            existing_projects_map.insert(name.trim().to_lowercase(), id);
        }
    }

    let mut project_mapping = HashMap::new();
    for p in &archive.data.projects {
        let project_key = p.name.trim().to_lowercase();
        let local_id = existing_projects_map.get(&project_key).copied();

        let id = if let Some(id) = local_id {
            let local_updated_at: String = tx
                .query_row(
                    "SELECT updated_at FROM projects WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or_default();

            if p.updated_at > local_updated_at {
                // client_name / status (m24): absent or null in the archive means
                // "preserve local" (COALESCE / NULLIF), so a pre-m24 export never
                // wipes a local client assignment or status. Explicit re-assignment
                // propagates; explicit unassignment (client_name → null) does not
                // — an acceptable trade for online sync, which is server-mediated.
                tx.execute(
                    "UPDATE projects
                     SET color = ?1,
                         hourly_rate = COALESCE(?2, hourly_rate),
                         frozen_at = COALESCE(?3, frozen_at),
                         excluded_at = COALESCE(?4, excluded_at),
                         merged_into = COALESCE(?5, merged_into),
                         merged_at = COALESCE(?6, merged_at),
                         client_name = COALESCE(?7, client_name),
                         status = COALESCE(NULLIF(?8, ''), status, 'active'),
                         updated_at = ?9
                     WHERE id = ?10",
                    rusqlite::params![
                        p.color,
                        p.hourly_rate,
                        p.frozen_at,
                        p.excluded_at,
                        p.merged_into,
                        p.merged_at,
                        p.client_name,
                        p.status,
                        p.updated_at,
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            id
        } else {
            // status is NOT NULL — a pre-m24 archive omits it (deserializes to "")
            // so fall back to 'active' on insert.
            let insert_status = if p.status.trim().is_empty() { "active" } else { p.status.as_str() };
            tx.execute(
                "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported, frozen_at, merged_into, merged_at, client_name, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 1, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![p.name, p.color, p.hourly_rate, p.created_at, p.excluded_at, p.frozen_at, p.merged_into, p.merged_at, p.client_name, insert_status, p.updated_at]
            ).map_err(|e| e.to_string())?;
            summary.projects_created += 1;
            let new_id = tx.last_insert_rowid();
            existing_projects_map.insert(project_key, new_id);
            new_id
        };
        project_mapping.insert(p.id, id);
    }

    // 1b. Merge clients (m24 entity). Identified by NAME, last-writer-wins on
    // updated_at — same semantics as the projects merge above. Deletions arrive
    // as tombstones (handled in apply_archive_tombstones).
    for c in &archive.data.clients {
        if c.name.trim().is_empty() {
            continue;
        }
        let local_ts: Option<String> = tx
            .query_row(
                "SELECT updated_at FROM clients WHERE name = ?1",
                [c.name.as_str()],
                |row| row.get(0),
            )
            .ok();
        let color = c.color.clone().unwrap_or_else(|| "#38bdf8".to_string());
        match local_ts {
            Some(ref lt) if lt >= &c.updated_at => { /* local wins */ }
            Some(_) => {
                tx.execute(
                    "UPDATE clients SET contact = ?1, address = ?2, tax_id = ?3, currency = ?4, \
                     default_hourly_rate = ?5, color = ?6, archived_at = ?7, updated_at = ?8 WHERE name = ?9",
                    rusqlite::params![
                        c.contact, c.address, c.tax_id, c.currency,
                        c.default_hourly_rate, color, c.archived_at, c.updated_at, c.name
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute(
                    "INSERT INTO clients (name, contact, address, tax_id, currency, \
                     default_hourly_rate, color, archived_at, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        c.name, c.contact, c.address, c.tax_id, c.currency,
                        c.default_hourly_rate, color, c.archived_at, c.created_at, c.updated_at
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    // 2. Map and Create Applications
    let mut existing_apps_map: HashMap<String, i64> = HashMap::new();
    let mut existing_apps_display_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT executable_name, display_name, id FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (exe, display_name, id) =
                row.map_err(|e| format!("Failed to read local application mapping row: {}", e))?;
            existing_apps_map.insert(exe.trim().to_lowercase(), id);
            existing_apps_display_map.insert(display_name.trim().to_lowercase(), id);
        }
    }

    let mut app_mapping = HashMap::new();
    for a in &archive.data.applications {
        let exe_key = a.executable_name.trim().to_lowercase();
        let display_key = a.display_name.trim().to_lowercase();
        let local_id = existing_apps_map
            .get(&exe_key)
            .copied()
            .or_else(|| existing_apps_display_map.get(&display_key).copied());

        let mapped_project_id = a
            .project_id
            .and_then(|old_pid| project_mapping.get(&old_pid).copied());

        let id = if let Some(id) = local_id {
            if let Some(pid) = mapped_project_id {
                tx.execute(
                    "UPDATE applications
                     SET project_id = COALESCE(project_id, ?1)
                     WHERE id = ?2",
                    rusqlite::params![pid, id],
                )
                .map_err(|e| e.to_string())?;
            }
            id
        } else {
            tx.execute(
                "INSERT INTO applications (executable_name, display_name, project_id, is_imported) VALUES (?1, ?2, ?3, 1)",
                rusqlite::params![a.executable_name, a.display_name, mapped_project_id]
            ).map_err(|e| e.to_string())?;
            summary.apps_created += 1;
            let new_id = tx.last_insert_rowid();
            existing_apps_map.insert(exe_key, new_id);
            existing_apps_display_map.insert(display_key, new_id);
            new_id
        };
        app_mapping.insert(a.id, id);
    }

    // 3. Import and Merge Sessions
    //
    // Project resolution mirrors LAN sync: mapped archive id first, then the
    // session's project_name against LOCAL projects (covers "ghost" sessions
    // that carry only a label), else unassigned — but the label is persisted
    // so it survives the trip and the startup ghost-repair can finish the job.
    let local_projects_by_name: HashMap<String, i64> = {
        let mut stmt = tx
            .prepare("SELECT name, id FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = HashMap::new();
        for row in rows {
            let (name, id) = row.map_err(|e| e.to_string())?;
            out.insert(name.trim().to_lowercase(), id);
        }
        out
    };
    for s in &archive.data.sessions {
        if let Some(&local_app_id) = app_mapping.get(&s.app_id) {
            let local_project_id = s
                .project_id
                .and_then(|old_pid| project_mapping.get(&old_pid).copied())
                .or_else(|| {
                    s.project_name
                        .as_deref()
                        .and_then(|n| local_projects_by_name.get(&n.trim().to_lowercase()))
                        .copied()
                });
            let incoming = SessionRow {
                id: s.id,
                app_id: local_app_id,
                project_id: local_project_id,
                start_time: s.start_time.clone(),
                end_time: s.end_time.clone(),
                duration_seconds: s.duration_seconds,
                rate_multiplier: s.rate_multiplier,
                date: s.date.clone(),
                comment: s.comment.clone(),
                is_hidden: s.is_hidden,
                updated_at: s.updated_at.clone(),
                project_name: s.project_name.clone(),
            };

            let merged = merge_or_insert_session(tx, local_app_id, &incoming)?;
            if merged {
                summary.sessions_merged += 1;
            } else {
                summary.sessions_imported += 1;
            }
        }
    }

    // 4. Manual Sessions
    for ms in &archive.data.manual_sessions {
        if let Some(&local_pid) = project_mapping.get(&ms.project_id) {
            let local_manual_app_id = ms
                .app_id
                .and_then(|archive_app_id| app_mapping.get(&archive_app_id).copied());
            let local_status: Option<(i64, String)> = tx.query_row(
                "SELECT id, updated_at FROM manual_sessions WHERE project_id = ?1 AND start_time = ?2 AND title = ?3",
                rusqlite::params![local_pid, ms.start_time, ms.title],
                |row| Ok((row.get(0)?, row.get(1)?))
            ).optional().map_err(|e| e.to_string())?;

            if let Some((local_id, local_updated_at)) = local_status {
                if ms.updated_at > local_updated_at {
                    tx.execute(
                        "UPDATE manual_sessions SET
                            session_type = ?1,
                            end_time = ?2,
                            duration_seconds = ?3,
                            updated_at = ?4,
                            app_id = ?5
                         WHERE id = ?6",
                        rusqlite::params![
                            ms.session_type,
                            ms.end_time,
                            ms.duration_seconds,
                            ms.updated_at,
                            local_manual_app_id,
                            local_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else {
                tx.execute(
                    "INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, end_time, duration_seconds, date, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![ms.title, ms.session_type, local_pid, local_manual_app_id, ms.start_time, ms.end_time, ms.duration_seconds, ms.date, ms.created_at, ms.updated_at]
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    // 4a. File Activities (szczegóły plików/tytułów okien — dane AI i widok
    // Detailed). Upsert po UNIQUE(app_id, date, file_path) z merge MAX/MIN.
    let file_activities_imported = import_file_activities(
        tx,
        &archive.data.file_activities,
        &app_mapping,
        &project_mapping,
    )?;
    if file_activities_imported > 0 {
        log::info!(
            "import: {} file_activities row(s) inserted/merged",
            file_activities_imported
        );
    }

    // 4b. Assignment Feedback (dedup by source + created_at to avoid double-importing)
    for fb in &archive.data.assignment_feedback {
        let local_session_id = fb.session_id.and_then(|sid| {
            // Try session mapping first; fall back to using the ID as-is
            // (feedback may reference sessions not in this delta)
            Some(sid)
        });
        let local_app_id = fb.app_id;
        let local_from_project = fb.from_project_id.and_then(|pid| project_mapping.get(&pid).copied());
        let local_to_project = fb.to_project_id.and_then(|pid| project_mapping.get(&pid).copied());

        // Dedup: check if we already have a feedback entry with same source + created_at
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM assignment_feedback WHERE source = ?1 AND created_at = ?2",
                rusqlite::params![fb.source, fb.created_at],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) > 0;

        if !exists {
            tx.execute(
                "INSERT INTO assignment_feedback (session_id, app_id, from_project_id, to_project_id, source, weight, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    local_session_id,
                    local_app_id,
                    local_from_project,
                    local_to_project,
                    fb.source,
                    fb.weight,
                    fb.created_at,
                ],
            ).ok();
        }
    }

    // 4c. Assignment Auto Runs (dedup by started_at)
    for run in &archive.data.assignment_auto_runs {
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM assignment_auto_runs WHERE started_at = ?1",
                rusqlite::params![run.started_at],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) > 0;

        if !exists {
            tx.execute(
                "INSERT INTO assignment_auto_runs (started_at, finished_at, sessions_scanned, sessions_assigned, sessions_skipped, rolled_back_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    run.started_at,
                    run.finished_at,
                    run.sessions_scanned,
                    run.sessions_assigned,
                    run.sessions_skipped,
                    run.rolled_back_at,
                ],
            ).ok();
        }
    }

    // 5. Daily Files
    if daily_files != DailyFilesMode::Skip {
    let demo_mode = daily_files == DailyFilesMode::Demo;
    for (date, daily) in &archive.data.daily_files {
        if demo_mode {
            save_demo_daily_file(date, daily)?;
        } else {
            let final_daily = if let Some(mut existing_daily) = daily_store_bridge::load_day(date)?
            {
                for (exe, app_data) in &daily.apps {
                    existing_daily.apps.insert(exe.clone(), app_data.clone());
                }
                existing_daily
            } else {
                daily.clone()
            };
            daily_store_bridge::save_day(&final_daily)?;
        }
        summary.daily_files_imported += 1;
    }
    }

    // --- Safety: pre-commit validation (online sync only) ---
    // If we had data before and the import produced nothing, abort.
    if clear_before_import {
        let sessions_after: i64 = tx
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap_or(0);
        let projects_after: i64 = tx
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap_or(0);

        if sessions_before > 10 && sessions_after == 0 {
            return Err(format!(
                "Sync safety check failed: had {} sessions before sync but 0 after import. \
                 Aborting to prevent data loss. The server payload may be empty or corrupt.",
                sessions_before
            ));
        }
        if projects_before > 3 && projects_after == 0 {
            return Err(format!(
                "Sync safety check failed: had {} projects before sync but 0 after import. \
                 Aborting to prevent data loss.",
                projects_before
            ));
        }

        log::info!(
            "Sync import pre-commit check OK: sessions {}→{}, projects {}→{}",
            sessions_before,
            sessions_after,
            projects_before,
            projects_after
        );
    }

    // Re-arm tombstone triggers (disabled for the whole import — see step 0).
    {
        use crate::db_migrations::tombstone_triggers;
        for sql in tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
            tx.execute(sql, []).map_err(|e| e.to_string())?;
        }
    }

    Ok(summary)
}

/// Importuje wiersze `file_activities` z archiwum: app_id/project_id mapowane
/// na lokalne ID, upsert po UNIQUE(app_id, date, file_path) — total_seconds
/// bierze MAX, first_seen MIN, last_seen MAX, pola opisowe COALESCE (lokalne
/// wygrywają), activity_spans zastępowane tylko gdy lokalnie puste ('[]').
/// Wiersze bez zmapowanej aplikacji są pomijane. Zwraca liczbę
/// wstawionych/scalonych wierszy.
fn import_file_activities(
    tx: &rusqlite::Transaction<'_>,
    rows: &[FileActivityExportRow],
    app_mapping: &HashMap<i64, i64>,
    project_mapping: &HashMap<i64, i64>,
) -> Result<usize, String> {
    if rows.is_empty() {
        return Ok(0);
    }

    let mut stmt = tx
        .prepare_cached(
            "INSERT INTO file_activities (app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, project_id, window_title, detected_path, title_history, activity_type, activity_spans)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(app_id, date, file_path) DO UPDATE SET
                total_seconds = CASE WHEN excluded.total_seconds > file_activities.total_seconds THEN excluded.total_seconds ELSE file_activities.total_seconds END,
                first_seen = CASE WHEN excluded.first_seen < file_activities.first_seen THEN excluded.first_seen ELSE file_activities.first_seen END,
                last_seen = CASE WHEN excluded.last_seen > file_activities.last_seen THEN excluded.last_seen ELSE file_activities.last_seen END,
                project_id = COALESCE(file_activities.project_id, excluded.project_id),
                window_title = COALESCE(file_activities.window_title, excluded.window_title),
                detected_path = COALESCE(file_activities.detected_path, excluded.detected_path),
                title_history = COALESCE(file_activities.title_history, excluded.title_history),
                activity_type = COALESCE(file_activities.activity_type, excluded.activity_type),
                activity_spans = CASE WHEN file_activities.activity_spans = '[]' THEN excluded.activity_spans ELSE file_activities.activity_spans END",
        )
        .map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    let mut skipped_unmapped_app = 0usize;
    for fa in rows {
        let Some(&local_app_id) = app_mapping.get(&fa.app_id) else {
            skipped_unmapped_app += 1;
            continue;
        };
        let local_project_id = fa
            .project_id
            .and_then(|old_pid| project_mapping.get(&old_pid).copied());

        stmt.execute(rusqlite::params![
            local_app_id,
            fa.date,
            fa.file_name,
            fa.file_path,
            fa.total_seconds,
            fa.first_seen,
            fa.last_seen,
            local_project_id,
            fa.window_title,
            fa.detected_path,
            fa.title_history,
            fa.activity_type,
            fa.activity_spans,
        ])
        .map_err(|e| format!("Failed to import file_activities row: {}", e))?;
        imported += 1;
    }

    if skipped_unmapped_app > 0 {
        log::warn!(
            "import_file_activities: skipped {} row(s) with unmapped app_id",
            skipped_unmapped_app
        );
    }

    Ok(imported)
}

#[tauri::command]
pub async fn import_data_archive(
    app: AppHandle,
    archive: ExportArchive,
) -> Result<ImportSummary, String> {
    // Persistent backup to user-configured Backup Destination (before any sync changes)
    run_app_blocking(app.clone(), |app| {
        create_pre_sync_backup(&app, "online")
    }).await.ok(); // non-fatal — don't block sync if backup dir is not configured

    // Temporary restore-backup as extra safety net (kept even if tx approach works)
    let backup_path =
        run_app_blocking(app.clone(), move |app| create_sync_restore_backup(&app)).await?;

    // CRITICAL: DELETE + import in a SINGLE transaction.
    // If anything fails, SQLite automatically rolls back — no data loss.
    let result = run_app_blocking(app.clone(), move |app| {
        let mut conn = db::get_connection(&app)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Merge server data with local instead of clearing — preserves
        // locally-recorded sessions that haven't been pushed yet.
        let daily_mode = if db::is_demo_mode_enabled(&app)? { DailyFilesMode::Demo } else { DailyFilesMode::Live };
        let summary = import_archive_into_tx(&tx, &archive, false, daily_mode)?;

        tx.commit()
            .map_err(|e| format!("Failed to commit sync import transaction: {}", e))?;

        // Post-commit: reapply overrides and retrain model
        match super::sessions::apply_manual_session_overrides(&conn) {
            Ok(reapplied) if reapplied > 0 => {
                log::info!(
                    "Reapplied {} manual session override(s) after sync import",
                    reapplied
                );
            }
            Ok(_) => {}
            Err(e) => {
                log::warn!(
                    "Failed to reapply manual session overrides after sync import: {}",
                    e
                );
            }
        }
        if let Err(e) = super::assignment_model::retrain_model_sync(&mut conn) {
            log::warn!("Auto-retrain after sync import failed: {}", e);
        }

        Ok(summary)
    })
    .await;

    match result {
        Ok(summary) => {
            // Success — remove backup
            let _ = fs::remove_file(&backup_path);
            Ok(summary)
        }
        Err(e) => {
            // Transaction rolled back automatically — data intact.
            // Keep backup file for manual recovery just in case.
            log::error!(
                "Sync import transaction failed (auto-rolled-back, data intact): {}. Backup kept at: {}",
                e,
                backup_path.display()
            );
            Err(format!(
                "Sync import failed (data preserved, nothing was deleted): {}",
                e
            ))
        }
    }
}

fn merge_or_insert_session(
    tx: &rusqlite::Transaction<'_>,
    local_app_id: i64,
    incoming: &SessionRow,
) -> Result<bool, String> {
    let mut merged_start = incoming.start_time.clone();
    let mut merged_end = incoming.end_time.clone();
    // Preserve local assignment when overlapping sessions already exist.
    // This prevents remote sync payloads from repeatedly overwriting manual local changes.
    let mut merged_project_id: Option<i64> = None;
    let mut merged_project_name: Option<String> = None;
    let mut merged_rate_multiplier = incoming.rate_multiplier.max(1.0);
    let mut merged_comment = incoming.comment.clone().unwrap_or_default();
    // Interval merging happens ONLY within the same visibility track: a hidden
    // session must never absorb overlapping visible time (it would silently
    // drop those hours from every stat), and vice versa. Hidden and visible
    // rows may overlap — the wall-clock CTE only counts visible rows.
    let merged_is_hidden = incoming.is_hidden;
    let mut overlap_ids: HashSet<i64> = HashSet::new();

    // Expand interval until closure: if merged range touches more sessions,
    // include them too so we end with one normalized interval.
    loop {
        let mut stmt = tx
            .prepare(
                "SELECT id, start_time, end_time, project_id
                        , COALESCE(rate_multiplier, 1.0), comment, project_name
                 FROM sessions
                 WHERE app_id = ?1 AND date = ?2
                   AND start_time <= ?3
                   AND end_time >= ?4
                   AND COALESCE(is_hidden, 0) = ?5",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(
                rusqlite::params![
                    local_app_id,
                    incoming.date,
                    merged_end,
                    merged_start,
                    merged_is_hidden as i64
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;

        let prev_count = overlap_ids.len();
        for row in rows {
            let (id, start, end, project_id, rate_multiplier, comment, project_name) =
                row.map_err(|e| e.to_string())?;
            overlap_ids.insert(id);
            merged_start = min_timestamp(&merged_start, &start);
            merged_end = max_timestamp(&merged_end, &end);
            if merged_project_id.is_none() {
                merged_project_id = project_id;
            }
            if merged_project_name.is_none() {
                merged_project_name = project_name;
            }
            if rate_multiplier.is_finite() && rate_multiplier > merged_rate_multiplier {
                merged_rate_multiplier = rate_multiplier;
            }
            if let Some(c) = comment {
                if !merged_comment.contains(&c) {
                    if !merged_comment.is_empty() {
                        merged_comment.push_str(" | ");
                    }
                    merged_comment.push_str(&c);
                }
            }
        }

        if overlap_ids.len() == prev_count {
            break;
        }
    }

    if merged_project_id.is_none() {
        merged_project_id = incoming.project_id;
    }
    if merged_project_name.is_none() {
        merged_project_name = incoming.project_name.clone();
    }

    if overlap_ids.is_empty() {
        upsert_session_interval(
            tx,
            local_app_id,
            merged_project_id,
            incoming.project_name.as_deref(),
            &incoming.start_time,
            &incoming.end_time,
            incoming.duration_seconds,
            &incoming.date,
            merged_rate_multiplier,
            incoming.comment.as_deref(),
            incoming.is_hidden,
        )?;
        return Ok(false);
    }

    let duration = calculate_duration(&merged_start, &merged_end);

    let final_comment = if merged_comment.is_empty() {
        None
    } else {
        Some(merged_comment)
    };

    // Delete ALL absorbed rows of this track, then UPSERT the merged interval.
    // An UPDATE of the kept row's start_time could collide with a row of the
    // OTHER visibility track sharing that exact start (UNIQUE app_id+start_time)
    // and abort the whole import — the upsert resolves such collisions with the
    // same visible-wins semantics as the fresh-insert path.
    for id in overlap_ids.iter() {
        tx.execute("DELETE FROM sessions WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }

    upsert_session_interval(
        tx,
        local_app_id,
        merged_project_id,
        merged_project_name.as_deref(),
        &merged_start,
        &merged_end,
        duration,
        &incoming.date,
        merged_rate_multiplier,
        final_comment.as_deref(),
        merged_is_hidden,
    )?;

    Ok(true)
}

/// Single upsert point for session intervals. On an exact (app_id, start_time)
/// collision — possible across visibility tracks — the interval is widened to
/// the larger end and visibility wins (counting time someone hid on one
/// machine beats silently losing visible time).
#[allow(clippy::too_many_arguments)]
fn upsert_session_interval(
    tx: &rusqlite::Transaction<'_>,
    app_id: i64,
    project_id: Option<i64>,
    project_name: Option<&str>,
    start_time: &str,
    end_time: &str,
    duration_seconds: i64,
    date: &str,
    rate_multiplier: f64,
    comment: Option<&str>,
    is_hidden: bool,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO sessions (app_id, project_id, project_name, start_time, end_time, duration_seconds, date, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(app_id, start_time) DO UPDATE SET
            end_time = CASE WHEN excluded.end_time > sessions.end_time THEN excluded.end_time ELSE sessions.end_time END,
            duration_seconds = CASE WHEN excluded.duration_seconds > sessions.duration_seconds THEN excluded.duration_seconds ELSE sessions.duration_seconds END,
            project_id = COALESCE(sessions.project_id, excluded.project_id),
            project_name = COALESCE(sessions.project_name, excluded.project_name),
            rate_multiplier = CASE WHEN excluded.rate_multiplier > sessions.rate_multiplier THEN excluded.rate_multiplier ELSE sessions.rate_multiplier END,
            comment = CASE WHEN excluded.comment IS NOT NULL AND (sessions.comment IS NULL OR sessions.comment = '') THEN excluded.comment ELSE sessions.comment END,
            is_hidden = CASE WHEN excluded.is_hidden AND sessions.is_hidden THEN 1 ELSE 0 END",
        rusqlite::params![
            app_id,
            project_id,
            project_name,
            start_time,
            end_time,
            duration_seconds,
            date,
            rate_multiplier,
            comment,
            is_hidden
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn min_timestamp(a: &str, b: &str) -> String {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(da), Ok(db)) => {
            if da <= db {
                a.to_string()
            } else {
                b.to_string()
            }
        }
        _ => {
            if a <= b {
                a.to_string()
            } else {
                b.to_string()
            }
        }
    }
}

fn max_timestamp(a: &str, b: &str) -> String {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(da), Ok(db)) => {
            if da >= db {
                a.to_string()
            } else {
                b.to_string()
            }
        }
        _ => {
            if a >= b {
                a.to_string()
            } else {
                b.to_string()
            }
        }
    }
}

fn calculate_duration(start: &str, end: &str) -> i64 {
    let s = chrono::DateTime::parse_from_rfc3339(start).ok();
    let e = chrono::DateTime::parse_from_rfc3339(end).ok();
    if let (Some(s), Some(e)) = (s, e) {
        (e - s).num_seconds()
    } else {
        0
    }
}

use rusqlite::OptionalExtension;

fn create_sync_restore_backup(app: &AppHandle) -> Result<PathBuf, String> {
    let status = db::get_demo_mode_status(app)?;
    let active_db_path = PathBuf::from(status.active_db_path);
    let parent = active_db_path
        .parent()
        .ok_or_else(|| "Cannot resolve active database directory".to_string())?;

    // Flush WAL into the main file so a plain file copy is consistent.
    {
        let conn = db::get_connection(app)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Failed WAL checkpoint before sync backup: {}", e))?;
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let backup_path = parent.join(format!(
        "timeflow-sync-restore-{}-{}.db",
        std::process::id(),
        ts
    ));

    fs::copy(&active_db_path, &backup_path).map_err(|e| {
        format!(
            "Failed to create sync restore backup '{}' -> '{}': {}",
            active_db_path.display(),
            backup_path.display(),
            e
        )
    })?;

    Ok(backup_path)
}

/// Create a persistent backup to the user-configured Backup Destination before sync.
/// Uses the same backup mechanism as manual/auto backups (VACUUM INTO).
/// If backup_path is not configured, falls back to a `sync_backups` subfolder
/// next to the active database.
fn create_pre_sync_backup(app: &AppHandle, sync_type: &str) -> Result<String, String> {
    let conn = db::get_connection(app)?;

    // Read user-configured backup_path from system_settings
    let backup_dir = db::get_system_setting(app, "backup_path")?
        .filter(|p| !p.is_empty());

    let backup_dir = match backup_dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            // Fallback: sync_backups/ next to the active database
            let status = db::get_demo_mode_status(app)?;
            let db_path = PathBuf::from(status.active_db_path);
            db_path.parent()
                .ok_or_else(|| "Cannot resolve database directory".to_string())?
                .join("sync_backups")
        }
    };

    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create sync backup directory: {}", e))?;
    }

    // Flush WAL
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint before sync backup failed: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_pre_{}_sync_{}.db", sync_type, timestamp);
    let dest_path = backup_dir.join(&file_name);

    // Escape the path via SQLite quote() instead of manual replace (mirrors
    // sync_markers.rs) — robust quoting, no format! string-injection antipattern.
    let dest = dest_path.to_string_lossy().to_string();
    let quoted: String = conn
        .query_row("SELECT quote(?1)", [&dest], |row| row.get(0))
        .map_err(|e| format!("Failed to escape backup path: {}", e))?;
    conn.execute_batch(&format!("VACUUM INTO {}", quoted))
        .map_err(|e| format!("Pre-sync backup failed: {}", e))?;

    // Rotate: keep max 10 pre-sync backups per type
    let prefix = format!("timeflow_pre_{}_sync_", sync_type);
    let mut backups: Vec<PathBuf> = fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str())
            .map(|n| n.starts_with(&prefix)).unwrap_or(false))
        .collect();
    backups.sort();
    while backups.len() > 10 {
        if let Some(oldest) = backups.first() {
            let _ = fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Pre-{}-sync backup created: {:?}", sync_type, dest_path);
    Ok(dest_path.to_string_lossy().to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_export_archive_reports_daily_file_clearly() {
        // Dzienny plik demona podany zamiast archiwum eksportu
        let daily = r#"{"date":"2026-06-11","generated_at":"x","apps":{}}"#;
        let err = parse_export_archive(daily).err().expect("daily file must not parse");
        assert!(err.contains("daily activity file"), "got: {err}");

        // Zwykły niepoprawny JSON → standardowy błąd parsowania
        let err = parse_export_archive("{\"foo\": 1}").err().expect("invalid JSON must not parse");
        assert!(err.contains("Not a valid TIMEFLOW export archive"), "got: {err}");
    }

    #[test]
    fn looks_like_export_archive_detects_archive_content() {
        use crate::commands::import::looks_like_export_archive;
        let archive = r#"{"version":"1.1","export_type":"all_data","data":{"projects":[]}}"#;
        assert!(looks_like_export_archive(archive));
        let daily = r#"{"date":"2026-06-11","apps":{}}"#;
        assert!(!looks_like_export_archive(daily));
        assert!(!looks_like_export_archive("not json"));
    }

    fn setup_sessions_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                project_id INTEGER,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                comment TEXT,
                is_hidden INTEGER NOT NULL DEFAULT 0,
                project_name TEXT
            );
            CREATE UNIQUE INDEX idx_sessions_app_start ON sessions(app_id, start_time);",
        )
        .expect("create sessions schema");
        conn
    }

    #[test]
    fn merge_or_insert_session_merges_transitive_overlaps() {
        let mut conn = setup_sessions_conn();
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                1i64,
                "2026-01-01T10:00:00+00:00",
                "2026-01-01T11:00:00+00:00",
                3600i64,
                "2026-01-01"
            ],
        )
        .expect("insert session 1");
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                1i64,
                "2026-01-01T10:50:00+00:00",
                "2026-01-01T12:00:00+00:00",
                4200i64,
                "2026-01-01"
            ],
        )
        .expect("insert session 2");

        let tx = conn.transaction().expect("transaction");
        let incoming = SessionRow {
            id: 999,
            app_id: 1,
            project_id: None,
            start_time: "2026-01-01T09:30:00+00:00".to_string(),
            end_time: "2026-01-01T10:10:00+00:00".to_string(),
            duration_seconds: 2400,
            rate_multiplier: 1.0,
            date: "2026-01-01".to_string(),
            comment: None,
            is_hidden: false,
            updated_at: None,
            project_name: None,
        };

        let merged = merge_or_insert_session(&tx, 1, &incoming).expect("merge");
        assert!(merged);
        tx.commit().expect("commit");

        let (count, start, end, duration): (i64, String, String, i64) = conn
            .query_row(
                "SELECT COUNT(*), MIN(start_time), MAX(end_time), MAX(duration_seconds) FROM sessions WHERE app_id = 1 AND date = '2026-01-01'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query merged session");

        assert_eq!(count, 1);
        assert_eq!(start, "2026-01-01T09:30:00+00:00");
        assert_eq!(end, "2026-01-01T12:00:00+00:00");
        assert_eq!(duration, 9000);
    }

    fn incoming_session(start: &str, end: &str, duration: i64, hidden: bool) -> SessionRow {
        SessionRow {
            id: 999,
            app_id: 1,
            project_id: None,
            start_time: start.to_string(),
            end_time: end.to_string(),
            duration_seconds: duration,
            rate_multiplier: 1.0,
            date: "2026-01-01".to_string(),
            comment: None,
            is_hidden: hidden,
            updated_at: None,
            project_name: None,
        }
    }

    #[test]
    fn merge_does_not_absorb_visible_into_hidden() {
        let mut conn = setup_sessions_conn();
        // Lokalna UKRYTA sesja 10:00-14:00; przychodzi WIDOCZNA 11:00-12:00.
        // Widoczny czas nie może zostać połknięty przez ukryty interwał.
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, is_hidden)
             VALUES (1, '2026-01-01T10:00:00+00:00', '2026-01-01T14:00:00+00:00', 14400, '2026-01-01', 1)",
            [],
        )
        .expect("insert hidden session");

        let tx = conn.transaction().expect("transaction");
        let incoming = incoming_session("2026-01-01T11:00:00+00:00", "2026-01-01T12:00:00+00:00", 3600, false);
        merge_or_insert_session(&tx, 1, &incoming).expect("merge");
        tx.commit().expect("commit");

        let visible_secs: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_seconds), 0) FROM sessions WHERE is_hidden = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let hidden_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE is_hidden = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(visible_secs, 3600, "visible time must stay visible");
        assert_eq!(hidden_count, 1, "hidden session stays intact");
    }

    #[test]
    fn merge_does_not_absorb_hidden_into_visible() {
        let mut conn = setup_sessions_conn();
        // Lokalna WIDOCZNA 10:00-11:00; przychodzi UKRYTA 10:30-12:00.
        // Ukryta nie może rozszerzyć/ukryć widocznej — trafia jako osobny wiersz.
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, is_hidden)
             VALUES (1, '2026-01-01T10:00:00+00:00', '2026-01-01T11:00:00+00:00', 3600, '2026-01-01', 0)",
            [],
        )
        .expect("insert visible session");

        let tx = conn.transaction().expect("transaction");
        let incoming = incoming_session("2026-01-01T10:30:00+00:00", "2026-01-01T12:00:00+00:00", 5400, true);
        merge_or_insert_session(&tx, 1, &incoming).expect("merge");
        tx.commit().expect("commit");

        let (visible_secs, visible_end): (i64, String) = conn
            .query_row(
                "SELECT duration_seconds, end_time FROM sessions WHERE is_hidden = 0",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(visible_secs, 3600, "visible session untouched");
        assert_eq!(visible_end, "2026-01-01T11:00:00+00:00");
        let hidden_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE is_hidden = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hidden_count, 1, "hidden session inserted separately");
    }

    #[test]
    fn merged_interval_start_colliding_with_other_track_does_not_fail() {
        let mut conn = setup_sessions_conn();
        // UKRYTY wiersz startuje o 10:00; WIDOCZNY lokalny 10:30-13:00.
        // Przychodzi WIDOCZNA 10:00-12:00 → scalony widoczny interwał ma start
        // 10:00 == start ukrytego wiersza. Stary kod robił UPDATE start_time
        // bez ON CONFLICT → "UNIQUE constraint failed: sessions.app_id,
        // sessions.start_time" i cały import padał.
        conn.execute_batch(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, is_hidden)
             VALUES (1, '2026-01-01T10:00:00+00:00', '2026-01-01T11:00:00+00:00', 3600, '2026-01-01', 1);
             INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, is_hidden)
             VALUES (1, '2026-01-01T10:30:00+00:00', '2026-01-01T13:00:00+00:00', 9000, '2026-01-01', 0);",
        )
        .expect("seed");

        let tx = conn.transaction().expect("transaction");
        let incoming = incoming_session("2026-01-01T10:00:00+00:00", "2026-01-01T12:00:00+00:00", 7200, false);
        merge_or_insert_session(&tx, 1, &incoming).expect("merge must not hit UNIQUE constraint");
        tx.commit().expect("commit");

        // Kolizja rozstrzygnięta: jeden wiersz 10:00-13:00, widoczność wygrywa.
        let (count, start, end, hidden): (i64, String, String, i64) = conn
            .query_row(
                "SELECT COUNT(*), MIN(start_time), MAX(end_time), MAX(is_hidden) FROM sessions",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(start, "2026-01-01T10:00:00+00:00");
        assert_eq!(end, "2026-01-01T13:00:00+00:00");
        assert_eq!(hidden, 0, "visible wins on collision");
    }

    #[test]
    fn exact_start_collision_visible_wins() {
        let mut conn = setup_sessions_conn();
        // Identyczny start_time w obu trackach → jeden wiersz; widoczność wygrywa
        // (lepiej policzyć czas, który ktoś ukrył na jednej maszynie, niż zgubić widoczny).
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, is_hidden)
             VALUES (1, '2026-01-01T10:00:00+00:00', '2026-01-01T11:00:00+00:00', 3600, '2026-01-01', 1)",
            [],
        )
        .expect("insert hidden session");

        let tx = conn.transaction().expect("transaction");
        let incoming = incoming_session("2026-01-01T10:00:00+00:00", "2026-01-01T10:30:00+00:00", 1800, false);
        merge_or_insert_session(&tx, 1, &incoming).expect("merge");
        tx.commit().expect("commit");

        let (count, hidden): (i64, i64) = conn
            .query_row("SELECT COUNT(*), MAX(is_hidden) FROM sessions", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(hidden, 0, "visible wins on exact-start collision");
    }

    fn full_schema_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(include_str!("../../resources/sql/schema.sql"))
            .expect("schema");
        crate::db_migrations::run_migrations(&conn).expect("migrations");
        conn
    }

    // ---- m24 online-sync parity (client_name / status / clients) ----

    fn base_archive() -> super::super::types::ExportArchive {
        use super::super::types::*;
        ExportArchive {
            version: "2.0".into(),
            exported_at: "2026-06-01 00:00:00".into(),
            machine_id: "test".into(),
            export_type: "all_data".into(),
            date_range: DateRange { start: String::new(), end: String::new() },
            metadata: ExportMetadata {
                project_id: None,
                project_name: None,
                total_sessions: 0,
                total_seconds: 0,
            },
            data: ExportData {
                projects: vec![],
                clients: vec![],
                applications: vec![],
                sessions: vec![],
                manual_sessions: vec![],
                daily_files: std::collections::BTreeMap::new(),
                tombstones: vec![],
                assignment_feedback: vec![],
                assignment_auto_runs: vec![],
                file_activities: vec![],
            },
        }
    }

    fn proj_row(
        name: &str,
        updated_at: &str,
        client_name: Option<&str>,
        status: &str,
    ) -> super::super::types::Project {
        super::super::types::Project {
            id: 0,
            name: name.into(),
            color: "#fff".into(),
            hourly_rate: None,
            created_at: "2026-01-01 00:00:00".into(),
            excluded_at: None,
            frozen_at: None,
            merged_into: None,
            merged_at: None,
            assigned_folder_path: None,
            is_imported: 1,
            updated_at: updated_at.into(),
            client_name: client_name.map(|s| s.to_string()),
            status: status.into(),
        }
    }

    fn client_row(name: &str, updated_at: &str) -> super::super::types::ClientRow {
        super::super::types::ClientRow {
            name: name.into(),
            contact: None,
            address: None,
            tax_id: None,
            currency: None,
            default_hourly_rate: None,
            color: Some("#abc".into()),
            archived_at: None,
            created_at: Some("2026-01-01 00:00:00".into()),
            updated_at: updated_at.into(),
        }
    }

    fn run_sync_import(
        conn: &mut rusqlite::Connection,
        archive: &super::super::types::ExportArchive,
    ) {
        let tx = conn.transaction().expect("tx");
        import_archive_into_tx(&tx, archive, false, DailyFilesMode::Skip).expect("import");
        tx.commit().expect("commit");
    }

    fn read_project_client(conn: &rusqlite::Connection, name: &str) -> (Option<String>, String) {
        conn.query_row(
            "SELECT client_name, status FROM projects WHERE name = ?1",
            [name],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn online_sync_applies_client_name_and_status_to_existing_project() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (name, color, created_at, updated_at) \
             VALUES ('P', '#fff', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .expect("seed");
        let mut a = base_archive();
        a.data
            .projects
            .push(proj_row("P", "2026-02-01 00:00:00", Some("Acme"), "archived"));
        run_sync_import(&mut conn, &a);
        let (cn, st) = read_project_client(&conn, "P");
        assert_eq!(cn.as_deref(), Some("Acme"), "client assignment must propagate");
        assert_eq!(st, "archived", "status must propagate");
    }

    #[test]
    fn online_sync_inserts_new_project_with_client_name_and_status() {
        let mut conn = full_schema_conn();
        let mut a = base_archive();
        a.data
            .projects
            .push(proj_row("Q", "2026-02-01 00:00:00", Some("Beta"), "active"));
        run_sync_import(&mut conn, &a);
        let (cn, st) = read_project_client(&conn, "Q");
        assert_eq!(cn.as_deref(), Some("Beta"));
        assert_eq!(st, "active");
    }

    #[test]
    fn online_sync_preserves_local_client_when_archive_omits_it() {
        // A pre-m24 archive deserializes client_name → None, status → "".
        // A newer such archive must NOT wipe a local client assignment/status.
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (name, color, client_name, status, created_at, updated_at) \
             VALUES ('P', '#fff', 'Acme', 'archived', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .expect("seed");
        let mut a = base_archive();
        a.data
            .projects
            .push(proj_row("P", "2026-03-01 00:00:00", None, ""));
        run_sync_import(&mut conn, &a);
        let (cn, st) = read_project_client(&conn, "P");
        assert_eq!(cn.as_deref(), Some("Acme"), "absent client_name preserves local");
        assert_eq!(st, "archived", "empty status preserves local");
    }

    #[test]
    fn online_sync_merges_clients_last_writer_wins() {
        let mut conn = full_schema_conn();
        let mut insert = base_archive();
        insert.data.clients.push(client_row("Acme", "2026-02-01 00:00:00"));
        run_sync_import(&mut conn, &insert);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients WHERE name='Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "client inserted");

        // Older archive must lose (local wins on updated_at).
        let mut older = base_archive();
        let mut c_old = client_row("Acme", "2026-01-01 00:00:00");
        c_old.contact = Some("OLD".into());
        older.data.clients.push(c_old);
        run_sync_import(&mut conn, &older);
        let contact: Option<String> = conn
            .query_row("SELECT contact FROM clients WHERE name='Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contact, None, "older archive must not overwrite (LWW)");

        // Newer archive wins.
        let mut newer = base_archive();
        let mut c_new = client_row("Acme", "2026-03-01 00:00:00");
        c_new.contact = Some("NEW".into());
        newer.data.clients.push(c_new);
        run_sync_import(&mut conn, &newer);
        let contact: Option<String> = conn
            .query_row("SELECT contact FROM clients WHERE name='Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contact.as_deref(), Some("NEW"), "newer archive wins");
    }

    #[test]
    fn online_sync_client_tombstone_deletes_and_detaches_projects() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO clients (name, color, created_at, updated_at) \
                 VALUES ('Acme', '#abc', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO projects (name, color, client_name, status, created_at, updated_at) \
                 VALUES ('P', '#fff', 'Acme', 'active', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .expect("seed");
        let mut a = base_archive();
        a.data.tombstones.push(super::super::types::Tombstone {
            id: None,
            table_name: "clients".into(),
            record_id: None,
            record_uuid: None,
            deleted_at: "2026-02-01 00:00:00".into(),
            sync_key: Some("Acme".into()),
        });
        run_sync_import(&mut conn, &a);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients WHERE name='Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "client deleted by tombstone");
        let cn: Option<String> = conn
            .query_row("SELECT client_name FROM projects WHERE name='P'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cn, None, "project detached from the deleted client");
    }

    #[test]
    fn clear_synchronized_tables_does_not_mint_tombstones() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name) VALUES (1, 'app', 'App');
             INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (1, '2026-01-01 10:00:00', '2026-01-01 11:00:00', 3600, '2026-01-01');
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('t', 'work', 1, '2026-01-01 12:00:00', '2026-01-01 13:00:00', 3600, '2026-01-01');",
        )
        .expect("seed");

        let tx = conn.transaction().expect("tx");
        clear_synchronized_tables(&tx).expect("clear");
        tx.commit().expect("commit");

        let tombstones: i64 = conn
            .query_row("SELECT COUNT(*) FROM tombstones", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tombstones, 0, "technical clear must not mint tombstones");

        // Triggers must be re-armed: a real user deletion still mints one.
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (2, 'Q', datetime('now'));
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('t2', 'work', 2, '2026-01-02 12:00:00', '2026-01-02 13:00:00', 3600, '2026-01-02');
             DELETE FROM manual_sessions WHERE title = 't2';",
        )
        .expect("user delete");
        let tombstones: i64 = conn
            .query_row("SELECT COUNT(*) FROM tombstones WHERE table_name='manual_sessions'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tombstones, 1, "tombstone triggers must be re-created after clear");
    }

    #[test]
    fn session_with_only_project_name_resolves_and_persists_label() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (7, 'notch', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name) VALUES (1, 'app', 'App');",
        )
        .expect("seed");

        // 1) Nazwa wskazuje istniejący lokalny projekt → sesja dostaje project_id.
        let tx = conn.transaction().expect("tx");
        let mut incoming = incoming_session(
            "2026-01-01T10:00:00+00:00",
            "2026-01-01T11:00:00+00:00",
            3600,
            false,
        );
        incoming.project_name = Some("Notch".to_string()); // case-insensitive
        // symulacja pętli importu: id niemapowalne, fallback po nazwie
        let by_name: std::collections::HashMap<String, i64> =
            [("notch".to_string(), 7i64)].into_iter().collect();
        incoming.project_id = incoming.project_id.or_else(|| {
            incoming
                .project_name
                .as_deref()
                .and_then(|n| by_name.get(&n.trim().to_lowercase()))
                .copied()
        });
        merge_or_insert_session(&tx, 1, &incoming).expect("merge");

        // 2) Nazwa nieznana lokalnie → bez przypisania, ale etykieta przeżywa.
        let mut ghost = incoming_session(
            "2026-01-02T10:00:00+00:00",
            "2026-01-02T11:00:00+00:00",
            3600,
            false,
        );
        ghost.date = "2026-01-02".to_string();
        ghost.project_name = Some("nieistniejacy_projekt".to_string());
        merge_or_insert_session(&tx, 1, &ghost).expect("merge ghost");
        tx.commit().expect("commit");

        let (pid, pname): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT project_id, project_name FROM sessions WHERE date='2026-01-01'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(pid, Some(7), "session must resolve project by name");
        assert_eq!(pname.as_deref(), Some("Notch"), "explicit label is preserved verbatim");

        let (gpid, gpname): (Option<i64>, Option<String>) = conn
            .query_row(
                "SELECT project_id, project_name FROM sessions WHERE date='2026-01-02'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(gpid, None);
        assert_eq!(
            gpname.as_deref(),
            Some("nieistniejacy_projekt"),
            "label must survive import for the startup ghost-repair to finish later"
        );
    }

    /// Offline harness: PRAWDZIWY import na kopii PRAWDZIWEJ bazy, headless.
    /// Uruchamianie (ręczne):
    /// TIMEFLOW_BASE_DB=/sciezka/baza.db TIMEFLOW_ARCHIVES=/a.json:/b.json \
    ///   cargo test -p timeflow-dashboard offline_import_harness -- --ignored --nocapture
    #[test]
    #[ignore]
    fn offline_import_harness() {
        let base = std::env::var("TIMEFLOW_BASE_DB").expect("set TIMEFLOW_BASE_DB");
        let archives = std::env::var("TIMEFLOW_ARCHIVES").expect("set TIMEFLOW_ARCHIVES");
        let work = std::env::temp_dir().join("timeflow_offline_import.db");
        let _ = std::fs::remove_file(&work);
        std::fs::copy(&base, &work).expect("copy base db");
        let mut conn = rusqlite::Connection::open(&work).expect("open work db");
        crate::db_migrations::run_migrations(&conn).expect("migrations (jak przy starcie aplikacji)");
        for path in archives.split(':').filter(|p| !p.is_empty()) {
            let content = std::fs::read_to_string(path).expect("read archive");
            let archive = parse_export_archive(&content).expect("parse archive");
            let tx = conn.transaction().expect("tx");
            let summary = import_archive_into_tx(&tx, &archive, false, DailyFilesMode::Skip)
                .expect("import");
            tx.commit().expect("commit");
            println!(
                "== {path}: imported={} merged={} projects_created={} apps_created={}",
                summary.sessions_imported,
                summary.sessions_merged,
                summary.projects_created,
                summary.apps_created
            );
        }
        let repaired = crate::db::repair_ghost_project_names(&conn).expect("ghost repair");
        println!("ghost-repair przypisal: {repaired}");
        let q = |sql: &str| -> String {
            conn.query_row(sql, [], |r| r.get::<_, Option<String>>(0))
                .unwrap()
                .unwrap_or_default()
        };
        println!("sessions: {}", q("SELECT COUNT(*) || ' / ' || ROUND(SUM(duration_seconds)/3600.0,1) || 'h' FROM sessions"));
        println!("unassigned visible: {}", q("SELECT CAST(COUNT(*) AS TEXT) FROM sessions WHERE project_id IS NULL AND COALESCE(is_hidden,0)=0"));
        println!("hidden: {}", q("SELECT COUNT(*) || ' / ' || ROUND(SUM(duration_seconds)/3600.0,1) || 'h' FROM sessions WHERE is_hidden=1"));
        println!("manual: {}", q("SELECT COUNT(*) || ' / ' || ROUND(SUM(duration_seconds)/3600.0,1) || 'h' FROM manual_sessions"));
        println!("file_activities: {}", q("SELECT CAST(COUNT(*) AS TEXT) FROM file_activities"));
        println!("workdb: {}", work.display());
    }

    #[test]
    fn archive_tombstones_persist_original_date_without_minting_new_ones() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('old-entry', 'work', 1, '2026-01-05T10:00', '2026-01-05T11:00', 3600, '2026-01-05');
             UPDATE manual_sessions SET updated_at = '2026-02-01 00:00:00' WHERE title = 'old-entry';",
        )
        .expect("seed");

        let tombstones = vec![super::super::types::Tombstone {
            id: None,
            table_name: "manual_sessions".to_string(),
            record_id: Some(7),
            record_uuid: None,
            deleted_at: "2026-03-01 12:00:00".to_string(),
            sync_key: Some("9|2026-01-05T10:00|old-entry".to_string()),
        }];

        let tx = conn.transaction().expect("tx");
        // jak w imporcie: triggery wyłączone na czas aplikowania
        for sql in crate::db_migrations::tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
            tx.execute(sql, []).unwrap();
        }
        apply_archive_tombstones(&tx, &tombstones).expect("apply");
        apply_archive_tombstones(&tx, &tombstones).expect("apply twice (dedup)");
        for sql in crate::db_migrations::tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
            tx.execute(sql, []).unwrap();
        }
        tx.commit().expect("commit");

        // Rekord starszy niż tombstone → skasowany; w tabeli tombstones JEDEN
        // wpis z ORYGINALNĄ datą (zero kopii mintowanych przez triggery z NOW).
        let manual_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM manual_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(manual_left, 0);
        let rows: Vec<(String, String)> = conn
            .prepare("SELECT sync_key, deleted_at FROM tombstones WHERE table_name='manual_sessions'")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows.len(), 1, "exactly one persisted tombstone, no trigger-minted copy");
        assert_eq!(rows[0].1, "2026-03-01 12:00:00", "original deleted_at preserved");
    }

    #[test]
    fn manual_tombstone_older_than_record_is_ignored() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('modeling', 'work', 1, '2026-01-02T10:00', '2026-01-02T13:00', 10800, '2026-01-02');
             -- jawny UPDATE: trigger m20 (project_name) bumpnął updated_at do NOW przy inssercie
             UPDATE manual_sessions SET updated_at = '2026-04-23 08:05:10' WHERE title = 'modeling';",
        )
        .expect("seed");

        let tx = conn.transaction().expect("tx");
        // Stale tombstone z marca — rekord odtworzony w kwietniu MUSI przetrwać.
        apply_manual_session_tombstone(&tx, "26|2026-01-02T10:00|modeling", "2026-03-01 12:55:54")
            .expect("apply stale");
        // Świeższy tombstone — kasuje.
        apply_manual_session_tombstone(&tx, "26|2026-01-02T10:00|modeling", "2026-05-01 00:00:00")
            .expect("apply fresh");
        tx.commit().expect("commit");

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM manual_sessions WHERE title='modeling'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "fresh tombstone deletes");

        // Osobno: sam stale tombstone nie kasuje
        conn.execute_batch(
            "INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('modeling', 'work', 1, '2026-01-02T10:00', '2026-01-02T13:00', 10800, '2026-01-02');
             UPDATE manual_sessions SET updated_at = '2026-04-23 08:05:10' WHERE title = 'modeling';",
        )
        .unwrap();
        let tx = conn.transaction().expect("tx2");
        apply_manual_session_tombstone(&tx, "26|2026-01-02T10:00|modeling", "2026-03-01 12:55:54")
            .expect("apply stale 2");
        tx.commit().expect("commit2");
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM manual_sessions WHERE title='modeling'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1, "stale tombstone must NOT delete a newer record");
    }

    fn fa_row(app_id: i64, date: &str, file_path: &str) -> FileActivityExportRow {
        FileActivityExportRow {
            app_id,
            date: date.to_string(),
            file_name: file_path.rsplit('/').next().unwrap_or(file_path).to_string(),
            file_path: file_path.to_string(),
            total_seconds: 100,
            first_seen: "2026-01-01T10:00:00+00:00".to_string(),
            last_seen: "2026-01-01T11:00:00+00:00".to_string(),
            project_id: None,
            window_title: None,
            detected_path: None,
            title_history: None,
            activity_type: None,
            activity_spans: "[]".to_string(),
        }
    }

    #[test]
    fn import_file_activities_upserts_and_merges() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (1, 'P', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name) VALUES (1, 'app', 'App');
             INSERT INTO file_activities (app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, window_title, activity_spans)
             VALUES (1, '2026-01-01', 'a.txt', '/x/a.txt', 500,
                     '2026-01-01T09:00:00+00:00', '2026-01-01T10:30:00+00:00', 'local title', '[]');",
        )
        .expect("seed");

        // archiwum: app 10 → lokalny 1, projekt 20 → lokalny 1
        let app_mapping: HashMap<i64, i64> = HashMap::from([(10, 1)]);
        let project_mapping: HashMap<i64, i64> = HashMap::from([(20, 1)]);

        // 1) nowy wiersz z mapowanym projektem
        let mut new_row = fa_row(10, "2026-01-02", "/x/b.txt");
        new_row.project_id = Some(20);
        new_row.activity_spans =
            r#"[["2026-01-02T10:00:00+00:00","2026-01-02T10:05:00+00:00"]]"#.to_string();
        // 2) kolizja z pre-seedem: total mniejszy (lokalny MAX wygrywa),
        //    first_seen wcześniejszy (MIN), last_seen późniejszy (MAX),
        //    window_title nie nadpisuje lokalnego, spans wypełnia puste '[]'
        let mut colliding = fa_row(10, "2026-01-01", "/x/a.txt");
        colliding.total_seconds = 200;
        colliding.first_seen = "2026-01-01T08:00:00+00:00".to_string();
        colliding.last_seen = "2026-01-01T12:00:00+00:00".to_string();
        colliding.window_title = Some("remote title".to_string());
        colliding.activity_spans =
            r#"[["2026-01-01T08:00:00+00:00","2026-01-01T08:10:00+00:00"]]"#.to_string();
        // 3) niezmapowana aplikacja → skip
        let unmapped = fa_row(99, "2026-01-03", "/x/c.txt");

        let rows = vec![new_row, colliding, unmapped];
        let tx = conn.transaction().expect("tx");
        let imported =
            import_file_activities(&tx, &rows, &app_mapping, &project_mapping).expect("import");
        tx.commit().expect("commit");

        assert_eq!(imported, 2, "unmapped app row must be skipped");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM file_activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "no row for unmapped app");

        // Nowy wiersz: projekt zmapowany
        let new_pid: Option<i64> = conn
            .query_row(
                "SELECT project_id FROM file_activities WHERE file_path = '/x/b.txt'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(new_pid, Some(1));

        // Kolizja: merge MAX/MIN/COALESCE/spans
        let (total, first, last, title, spans): (i64, String, String, String, String) = conn
            .query_row(
                "SELECT total_seconds, first_seen, last_seen, window_title, activity_spans
                 FROM file_activities WHERE file_path = '/x/a.txt'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(total, 500, "MAX total_seconds (local bigger) wins");
        assert_eq!(first, "2026-01-01T08:00:00+00:00", "MIN first_seen");
        assert_eq!(last, "2026-01-01T12:00:00+00:00", "MAX last_seen");
        assert_eq!(title, "local title", "local window_title wins (COALESCE)");
        assert!(
            spans.contains("08:10:00"),
            "empty local spans replaced by incoming, got: {spans}"
        );
    }

    #[test]
    fn old_archive_without_file_activities_deserializes() {
        // Archiwum sprzed tej funkcji — brak klucza file_activities → pusty Vec.
        let json = r#"{
            "version": "1.1",
            "exported_at": "2026-06-11T10:00:00+02:00",
            "machine_id": "m1",
            "export_type": "all_data",
            "date_range": {"start": "2000-01-01", "end": "2026-06-11"},
            "metadata": {"project_id": null, "project_name": null, "total_sessions": 0, "total_seconds": 0},
            "data": {
                "projects": [],
                "applications": [],
                "sessions": [],
                "manual_sessions": [],
                "daily_files": {},
                "tombstones": []
            }
        }"#;
        let archive = parse_export_archive(json).expect("old archive must still parse");
        assert!(archive.data.file_activities.is_empty());
    }

    #[test]
    fn file_activities_roundtrip_through_serde() {
        let data = super::super::types::ExportData {
            projects: Vec::new(),
            clients: Vec::new(),
            applications: Vec::new(),
            sessions: Vec::new(),
            manual_sessions: Vec::new(),
            daily_files: std::collections::BTreeMap::new(),
            tombstones: Vec::new(),
            assignment_feedback: Vec::new(),
            assignment_auto_runs: Vec::new(),
            file_activities: vec![FileActivityExportRow {
                project_id: Some(7),
                window_title: Some("Doc — Editor".to_string()),
                activity_type: Some("document".to_string()),
                ..fa_row(3, "2026-02-01", "/p/doc.pdf")
            }],
        };
        let json = serde_json::to_string(&data).expect("serialize");
        let parsed: super::super::types::ExportData =
            serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.file_activities.len(), 1);
        let fa = &parsed.file_activities[0];
        assert_eq!(fa.app_id, 3);
        assert_eq!(fa.date, "2026-02-01");
        assert_eq!(fa.file_path, "/p/doc.pdf");
        assert_eq!(fa.project_id, Some(7));
        assert_eq!(fa.window_title.as_deref(), Some("Doc — Editor"));
        assert_eq!(fa.activity_type.as_deref(), Some("document"));
        assert_eq!(fa.activity_spans, "[]");
    }
}
