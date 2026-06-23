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

        let daily_mode = if db::is_demo_mode_enabled(&app)? { DailyFilesMode::Demo } else { DailyFilesMode::Live };
        // FK=OFF for the merge import (shared::sync::merge contract) — see
        // import_archive_with_fk_off. Restored to ON afterwards.
        let summary = import_archive_with_fk_off(&mut conn, |tx| {
            import_archive_into_tx(tx, &archive, false, daily_mode)
        })?;

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

/// How to handle the archive's daily JSON files during import.
/// `Skip` keeps the import fully headless (offline harness / tests) —
/// the DB merge is identical, only daily-store files are not written.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DailyFilesMode {
    Live,
    Demo,
    Skip,
}

/// Open a transaction with `foreign_keys=OFF` for the merge import, run `body`,
/// and ALWAYS restore `foreign_keys=ON` on the connection afterwards (commit,
/// early-return, or rollback). The shared merge core requires FK enforcement
/// OFF — it manages FK references MANUALLY (sets manual_sessions.project_id to
/// the sentinel 0, expects a project tombstone-delete NOT to CASCADE-delete its
/// manual_sessions). This mirrors the daemon's `open_dashboard_db` contract
/// (`src/lan_common.rs:175-183`). The dashboard pool checks connections out with
/// `foreign_keys=ON` (`db/pool.rs`), so without this the sentinel write fails
/// (FK 787, aborting the whole import) and a project delete would CASCADE-drop
/// manual_sessions (silent data loss).
///
/// IMPORTANT: `PRAGMA foreign_keys` is a no-op inside an open transaction, so it
/// MUST be toggled before `conn.transaction()`. We restore FK=ON explicitly
/// (not relying solely on the pool re-arming on release) to leave the pooled
/// connection clean regardless of pool timing.
fn import_archive_with_fk_off<F>(conn: &mut rusqlite::Connection, body: F) -> Result<ImportSummary, String>
where
    F: FnOnce(&rusqlite::Transaction<'_>) -> Result<ImportSummary, String>,
{
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| format!("Failed to disable foreign_keys for merge import: {}", e))?;
    // Inner block so the transaction is fully concluded (commit/rollback) before
    // we restore FK enforcement on the connection.
    let result = (|| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let summary = body(&tx)?;
        tx.commit()
            .map_err(|e| format!("Failed to commit merge import transaction: {}", e))?;
        Ok(summary)
    })();
    // Restore FK enforcement on ALL paths (success or error) so the pooled
    // connection is never handed back with FKs disabled.
    if let Err(e) = conn.execute_batch("PRAGMA foreign_keys=ON;") {
        log::warn!("Failed to re-enable foreign_keys after merge import: {}", e);
    }
    result
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

    // 0. Shared merge core (finding #1): tombstones + projects + clients +
    // applications + manual_sessions now run through timeflow_shared::sync::merge,
    // the SAME code the daemon's LAN sync uses. This unifies semantics: tombstone
    // guards apply to all tables, applications get full LWW (display_name +
    // updated_at), manual_sessions UPDATE includes `date`. Sessions stay inline
    // below (the dashboard's overlap-merge is intentionally different — finding #8).
    //
    // The whole import runs with tombstone triggers DISABLED (mirrors the
    // daemon's LAN merge): every DELETE inside the shared merge is a technical
    // replay/merge, not a user deletion — trigger-minted copies with
    // deleted_at = NOW would block importing the same records from a second
    // archive and propagate false deletions to peers. Remote deletions still
    // propagate, because the archive's tombstones are persisted with their
    // ORIGINAL deleted_at. DDL is transactional — a rollback restores the triggers.
    {
        use crate::db_migrations::tombstone_triggers;
        for sql in tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
            tx.execute(sql, []).map_err(|e| e.to_string())?;
        }
    }

    // Serialize the archive to the wire shape the shared merge reads
    // (`.pointer("/data/<entity>")`). This is the SAME format the daemon already
    // imports from the dashboard's export over LAN sync — field names match 1:1.
    let archive_value =
        serde_json::to_value(archive).map_err(|e| format!("serialize archive: {e}"))?;
    let hooks = timeflow_shared::sync::merge::MergeHooks {
        log: &|m: &str| log::info!("{m}"),
        diag: false,
    };

    // Created-count bookkeeping: the shared merges don't return per-row counts,
    // so derive projects_created / apps_created from before/after row totals.
    let projects_before_merge: i64 = tx
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap_or(0);
    let apps_before_merge: i64 = tx
        .query_row("SELECT COUNT(*) FROM applications", [], |r| r.get(0))
        .unwrap_or(0);

    // tombstones FIRST (replaces apply_archive_tombstones + apply_manual_session_tombstone)
    timeflow_shared::sync::merge::apply_tombstones(tx, &archive_value, &hooks)?;
    timeflow_shared::sync::merge::merge_projects(tx, &archive_value, &hooks)?;
    timeflow_shared::sync::merge::merge_clients(tx, &archive_value, &hooks)?;
    let mut id_maps = timeflow_shared::sync::merge::build_id_maps(tx, &archive_value)?;
    timeflow_shared::sync::merge::merge_applications(tx, &archive_value, &hooks, &mut id_maps)?;

    let projects_after_merge: i64 = tx
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap_or(0);
    let apps_after_merge: i64 = tx
        .query_row("SELECT COUNT(*) FROM applications", [], |r| r.get(0))
        .unwrap_or(0);
    summary.projects_created = (projects_after_merge - projects_before_merge).max(0) as usize;
    summary.apps_created = (apps_after_merge - apps_before_merge).max(0) as usize;

    // Rebuild the dashboard's archive-id → local-id maps that the SESSION loop
    // needs, by resolving each archive entity to its local row by stable name
    // (the shared merges have already populated the local tables). This keeps the
    // session loop EXACTLY as before.
    let mut project_mapping: HashMap<i64, i64> = HashMap::new();
    for p in &archive.data.projects {
        if let Some(local_id) = tx
            .query_row(
                "SELECT id FROM projects WHERE name = ?1",
                [p.name.as_str()],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            project_mapping.insert(p.id, local_id);
        }
    }
    let mut app_mapping: HashMap<i64, i64> = HashMap::new();
    for a in &archive.data.applications {
        // mirror the dashboard's existing resolution: executable_name, fallback display_name
        let local_id = tx
            .query_row(
                "SELECT id FROM applications WHERE LOWER(executable_name) = LOWER(?1)",
                [a.executable_name.as_str()],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .or_else(|| {
                tx.query_row(
                    "SELECT id FROM applications WHERE LOWER(display_name) = LOWER(?1)",
                    [a.display_name.as_str()],
                    |r| r.get::<_, i64>(0),
                )
                .optional()
                .ok()
                .flatten()
            });
        if let Some(id) = local_id {
            app_mapping.insert(a.id, id);
        }
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

    // 4. Manual Sessions — via shared merge core (finding #1). Replaces the
    // dashboard's inline block. The shared merge keys on (title, start_time),
    // resolves remote project_id/app_id by name through `id_maps`, applies the
    // manual-tombstone guard, and includes `date` in the UPDATE.
    timeflow_shared::sync::merge::merge_manual_sessions(tx, &archive_value, &hooks, &id_maps)?;

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

        // Merge server data with local instead of clearing — preserves
        // locally-recorded sessions that haven't been pushed yet.
        let daily_mode = if db::is_demo_mode_enabled(&app)? { DailyFilesMode::Demo } else { DailyFilesMode::Live };
        // FK=OFF for the merge import (shared::sync::merge contract) — see
        // import_archive_with_fk_off. Commits internally; FK restored to ON after.
        let summary = import_archive_with_fk_off(&mut conn, |tx| {
            import_archive_into_tx(tx, &archive, false, daily_mode)
        })?;

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
        // Exercise the SAME FK=OFF lifecycle as production (import_data /
        // import_data_archive) so tests catch FK-contract regressions.
        import_archive_with_fk_off(conn, |tx| {
            import_archive_into_tx(tx, archive, false, DailyFilesMode::Skip)
        })
        .expect("import");
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
    fn online_sync_preserves_local_client_when_peer_omits_the_key() {
        // BEHAVIOR CHANGE (3.2b): import now runs through
        // `timeflow_shared::sync::merge::merge_projects`, which distinguishes an
        // ABSENT key (old peer that has no concept of client_name/status →
        // preserve local) from an EXPLICIT null (clear). A genuine pre-m24 peer
        // OMITS the keys entirely, so this still preserves the local assignment.
        // (The old inline path used COALESCE/NULLIF and so could not tell absent
        // from explicit-null — see `online_sync_explicit_null_clears_client` for
        // the now-distinct null case.)
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (name, color, client_name, status, created_at, updated_at) \
             VALUES ('P', '#fff', 'Acme', 'archived', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .expect("seed");
        // Old-peer wire shape: client_name / status keys are absent.
        let archive_value = serde_json::json!({
            "data": { "projects": [{
                "name": "P", "color": "#999", "hourly_rate": null,
                "created_at": "2026-01-01 00:00:00", "excluded_at": null, "frozen_at": null,
                "updated_at": "2026-03-01 00:00:00"
            }]}
        });
        let tx = conn.transaction().expect("tx");
        let hooks = timeflow_shared::sync::merge::MergeHooks { log: &|_| {}, diag: false };
        timeflow_shared::sync::merge::merge_projects(&tx, &archive_value, &hooks).expect("merge");
        tx.commit().expect("commit");
        let (cn, st) = read_project_client(&conn, "P");
        assert_eq!(cn.as_deref(), Some("Acme"), "absent client_name key preserves local");
        assert_eq!(st, "archived", "absent status key preserves local");
    }

    #[test]
    fn online_sync_explicit_null_clears_client() {
        // BEHAVIOR CHANGE (3.2b): when the peer sends an EXPLICIT null for
        // client_name (the dashboard's own export wire shape, since the typed
        // `Project` serializes `None` → JSON null), the newer remote wins and the
        // local assignment is CLEARED. Mirrors the daemon's LAN-sync semantics
        // (explicit null = "cleared"). The pre-3.2b inline path could not express
        // this — it always preserved local via COALESCE.
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (name, color, client_name, status, created_at, updated_at) \
             VALUES ('P', '#fff', 'Acme', 'archived', '2026-01-01 00:00:00', '2026-01-01 00:00:00');",
        )
        .expect("seed");
        let mut a = base_archive();
        // proj_row builds a typed Project with client_name: None → serializes to
        // JSON null (no skip_serializing_if), and status "active".
        a.data
            .projects
            .push(proj_row("P", "2026-03-01 00:00:00", None, "active"));
        run_sync_import(&mut conn, &a);
        let (cn, st) = read_project_client(&conn, "P");
        assert_eq!(cn, None, "explicit-null client_name clears local (newer remote wins)");
        assert_eq!(st, "active", "explicit status from newer remote wins");
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

    /// End-to-end proof that `import_archive_into_tx` is wired onto the shared
    /// merge core (finding #1) and that the Value-shape (`serde_json::to_value`
    /// → `.pointer("/data/<entity>")`) resolves. Builds a full ExportArchive
    /// (projects + clients + applications + manual_sessions + a tombstone) and
    /// asserts the two NEW behaviors the shared core brings:
    ///   1. a record covered by a NEWER LOCAL tombstone is NOT resurrected, and
    ///   2. an existing application's display_name IS updated when remote is newer (full LWW).
    #[test]
    fn roundtrip_shared_merge_tombstone_guard_and_app_lww() {
        use super::super::types::*;
        let mut conn = full_schema_conn();
        // Seed: an existing application (older updated_at) + a local tombstone for
        // a project, NEWER than the incoming project row → must block resurrection.
        conn.execute_batch(
            "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('blender.exe', 'Old Name', '2026-01-01 00:00:00');
             INSERT INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                 VALUES ('projects', 1, '2026-05-01 00:00:00', 'Ghost');",
        )
        .expect("seed");

        let mut a = base_archive();
        // Incoming project 'Ghost' is OLDER than the local tombstone → guard skips it.
        a.data
            .projects
            .push(proj_row("Ghost", "2026-02-01 00:00:00", None, "active"));
        // Incoming application with a NEWER updated_at → full LWW updates display_name.
        a.data.applications.push(ApplicationRow {
            id: 1,
            executable_name: "blender.exe".into(),
            display_name: "Blender 4.5".into(),
            project_id: None,
            is_imported: 0,
            updated_at: Some("2026-03-01 00:00:00".into()),
        });
        // A client + an UNASSIGNED manual session (project_id=0 sentinel), to prove
        // those entities flow through the shared core via the Value shape — and
        // that the sentinel INSERT is valid under the FK=OFF import lifecycle.
        a.data.clients.push(client_row("Acme", "2026-02-01 00:00:00"));
        a.data.manual_sessions.push(ManualSession {
            id: 0,
            title: "Modeling".into(),
            session_type: "work".into(),
            project_id: 0,
            app_id: None,
            start_time: "2026-02-02T10:00".into(),
            end_time: "2026-02-02T12:00".into(),
            duration_seconds: 7200,
            date: "2026-02-02".into(),
            created_at: "2026-02-02 10:00:00".into(),
            updated_at: "2026-02-02 12:00:00".into(),
        });

        run_sync_import(&mut conn, &a);

        // 1. Tombstone guard: 'Ghost' must NOT be resurrected (local tombstone is newer).
        let ghost: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE name = 'Ghost'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ghost, 0, "newer local tombstone must block resurrection");

        // 2. Application LWW: display_name updated because remote updated_at is newer.
        let dn: String = conn
            .query_row(
                "SELECT display_name FROM applications WHERE executable_name = 'blender.exe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dn, "Blender 4.5", "remote-newer application updates display_name (full LWW)");

        // Sanity: client + manual session flowed through the Value shape.
        let clients: i64 = conn
            .query_row("SELECT COUNT(*) FROM clients WHERE name = 'Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(clients, 1, "client merged via shared core");
        let manual: i64 = conn
            .query_row("SELECT COUNT(*) FROM manual_sessions WHERE title = 'Modeling'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(manual, 1, "manual session merged via shared core");
    }

    /// FK contract (finding #5): an UNASSIGNED manual session (sentinel
    /// project_id=0) must import cleanly under the FK=OFF merge lifecycle. The
    /// shared core INSERTs the sentinel; under the dashboard pool's default
    /// foreign_keys=ON this would abort with FK 787. `import_archive_with_fk_off`
    /// (used by run_sync_import, mirroring production) disables FK enforcement.
    #[test]
    fn unassigned_manual_session_imports_under_fk_off() {
        use super::super::types::*;
        let mut conn = full_schema_conn();
        // Sanity: the harness connection has FK enforcement ON by default
        // (same as the production pool) — the guard must turn it OFF.
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1, "harness mirrors the FK=ON production pool");

        let mut a = base_archive();
        a.data.manual_sessions.push(ManualSession {
            id: 0,
            title: "Solo".into(),
            session_type: "work".into(),
            project_id: 0, // unassigned sentinel — no project row id=0 exists
            app_id: None,
            start_time: "2026-02-02T10:00".into(),
            end_time: "2026-02-02T12:00".into(),
            duration_seconds: 7200,
            date: "2026-02-02".into(),
            created_at: "2026-02-02 10:00:00".into(),
            updated_at: "2026-02-02 12:00:00".into(),
        });

        // Must NOT panic / FK-787-abort.
        run_sync_import(&mut conn, &a);

        let pid: i64 = conn
            .query_row("SELECT project_id FROM manual_sessions WHERE title = 'Solo'", [], |r| r.get(0))
            .expect("unassigned manual session present");
        assert_eq!(pid, 0, "sentinel project_id=0 preserved (unassigned)");

        // FK enforcement restored on the connection afterwards.
        let fk_after: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_after, 1, "import_archive_with_fk_off restores foreign_keys=ON");
    }

    /// FK contract (finding #5): a `projects` tombstone for a project that has a
    /// manual session must DELETE the project but the manual session SURVIVES,
    /// detached to the sentinel project_id=0. Under foreign_keys=ON the
    /// `ON DELETE CASCADE` would silently drop the manual session (data loss);
    /// the FK=OFF lifecycle + the shared core's manual FK-nulling prevent it.
    #[test]
    fn project_tombstone_detaches_manual_session_no_cascade_delete() {
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, color, created_at, updated_at) \
                 VALUES (3, 'Doomed', '#fff', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date) \
                 VALUES ('Keep me', 'work', 3, '2026-01-05T10:00', '2026-01-05T11:00', 3600, '2026-01-05');",
        )
        .expect("seed");

        let mut a = base_archive();
        a.data.tombstones.push(super::super::types::Tombstone {
            id: None,
            table_name: "projects".into(),
            record_id: Some(3),
            record_uuid: None,
            deleted_at: "2026-02-01 00:00:00".into(),
            sync_key: Some("Doomed".into()),
        });

        run_sync_import(&mut conn, &a);

        let proj: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE name = 'Doomed'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(proj, 0, "tombstone deletes the project");

        // The manual session must SURVIVE (not cascade-deleted) and be detached.
        let (cnt, pid): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MIN(project_id), -1) FROM manual_sessions WHERE title = 'Keep me'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(cnt, 1, "manual session must NOT cascade-delete with its project");
        assert_eq!(pid, 0, "manual session detached to sentinel project_id=0");
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
            // Same FK=OFF lifecycle as production.
            let summary = import_archive_with_fk_off(&mut conn, |tx| {
                import_archive_into_tx(tx, &archive, false, DailyFilesMode::Skip)
            })
            .expect("import");
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

    // BEHAVIOR CHANGE (3.2b): the standalone tests
    // `archive_tombstones_persist_original_date_without_minting_new_ones` and
    // `manual_tombstone_older_than_record_is_ignored` exercised the dashboard's
    // private `apply_archive_tombstones` / `apply_manual_session_tombstone`
    // helpers directly. Those helpers are deleted — import now routes through
    // `timeflow_shared::sync::merge::apply_tombstones`, which has its own unit
    // tests in `shared/sync/merge.rs` and is covered end-to-end by
    // `roundtrip_shared_merge_*` below. The tombstone-guard + original-deleted_at
    // semantics they checked are preserved by the shared core.

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
