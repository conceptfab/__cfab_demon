//! Rdzeń LWW-merge + tombstony — wspólny dla LAN sync (daemon) i importu (dashboard).
//! Logowanie wstrzykiwane domknięciem (hooks.log). Działa na otwartej transakcji.
//! NIE obejmuje sesji: daemon (upsert) i dashboard (overlap-merge) mają celowo różne
//! algorytmy sesji (finding #8) — sesje aplikuje wołający.

use crate::sync::timestamp::normalize_ts;
use std::collections::HashMap;

/// Wstrzykiwane zależności merge: sink logów + flaga diagnostyki.
/// `log` zastępuje daemonowy `lan_common::sync_log`; `diag` zastępuje
/// `diag_logging_enabled()` (rozstrzygane raz przez wołającego).
pub struct MergeHooks<'a> {
    pub log: &'a dyn Fn(&str),
    pub diag: bool,
}

/// Mapy remote-id → stabilna nazwa + lokalne name→id, budowane raz i współdzielone
/// przez merge applications / manual_sessions ORAZ (u wołającego) merge sesji.
pub struct MergeIdMaps {
    pub remote_app_id_to_name: HashMap<i64, String>,
    pub remote_project_id_to_name: HashMap<i64, String>,
    pub project_name_to_local_id: HashMap<String, i64>,
    pub app_name_to_local_id: HashMap<String, i64>,
}

// ── JSON helpers (przeniesione 1:1 z sync_common.rs) ──

pub fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

pub fn json_str_opt(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub fn json_i64(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
}

pub fn json_f64(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

pub fn json_f64_opt(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key)
        .and_then(|inner| inner.as_f64())
        .filter(|n| n.is_finite() && *n > 0.0)
}

// ── Tombstone guards + conflict log (przeniesione 1:1) ──

pub fn log_merge_conflict(
    tx: &rusqlite::Transaction,
    table_name: &str,
    record_key: &str,
    local_updated_at: &str,
    remote_updated_at: &str,
    winner: &str,
) {
    let _ = tx.execute(
        "INSERT INTO sync_merge_log (table_name, record_key, resolution, local_updated_at, remote_updated_at, winner) \
         VALUES (?1, ?2, 'last_writer_wins', ?3, ?4, ?5)",
        rusqlite::params![table_name, record_key, local_updated_at, remote_updated_at, winner],
    );
}

pub fn local_tombstone_covers(
    tx: &rusqlite::Transaction,
    table_name: &str,
    sync_key: &str,
    record_updated_at: &str,
) -> bool {
    let deleted_at: Option<String> = tx
        .query_row(
            "SELECT MAX(deleted_at) FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
            rusqlite::params![table_name, sync_key],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    deleted_at
        .as_deref()
        .map(|deleted| normalize_ts(deleted) >= normalize_ts(record_updated_at))
        .unwrap_or(false)
}

pub fn local_manual_tombstone_covers(
    tx: &rusqlite::Transaction,
    start_time: &str,
    title: &str,
    record_updated_at: &str,
) -> bool {
    let pattern = format!("%|{}|{}", start_time, title);
    let deleted_at: Option<String> = tx
        .query_row(
            "SELECT MAX(deleted_at) FROM tombstones WHERE table_name = 'manual_sessions' AND sync_key LIKE ?1",
            rusqlite::params![pattern],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    deleted_at
        .as_deref()
        .map(|deleted| normalize_ts(deleted) >= normalize_ts(record_updated_at))
        .unwrap_or(false)
}

// ── Tombstone application (przeniesione 1:1 z merge_incoming_data ~385-593) ──

/// Apply incoming tombstones BEFORE merging records. See the daemon's original
/// comment block: deletions must precede INSERT/UPDATE so a tombstone arriving in
/// the same payload as a fresh record does not wipe the freshly-inserted row, and
/// subsequent INSERT/UPDATE re-introduce records the peer still has.
pub fn apply_tombstones(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    hooks: &MergeHooks<'_>,
) -> Result<(), String> {
    if let Some(tombstones) = archive.pointer("/data/tombstones").and_then(|v| v.as_array()) {
        for ts in tombstones {
            let table_name = ts.get("table_name").and_then(|v| v.as_str()).unwrap_or("");
            let sync_key = ts.get("sync_key").and_then(|v| v.as_str()).unwrap_or("");
            if table_name.is_empty() || sync_key.is_empty() {
                continue;
            }

            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
                    rusqlite::params![table_name, sync_key],
                    |_| Ok(()),
                )
                .is_ok();

            if !exists {
                let deleted_at_str = ts.get("deleted_at").and_then(|v| v.as_str()).unwrap_or("");
                let deleted_at_norm = normalize_ts(deleted_at_str);

                // Guard: don't delete a record that was re-created/updated AFTER the tombstone
                // Applied to ALL tables, not just projects (5.7 fix)
                let skip_tombstone = match table_name {
                    "projects" => {
                        let local_updated: Option<String> = tx
                            .query_row("SELECT updated_at FROM projects WHERE name = ?1", [sync_key], |row| row.get(0))
                            .ok();
                        local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                    }
                    "applications" => {
                        let local_updated: Option<String> = tx
                            .query_row("SELECT updated_at FROM applications WHERE executable_name = ?1", [sync_key], |row| row.get(0))
                            .ok();
                        let app_newer = local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false);
                        // This tombstone's cascade deletes ALL sessions of the
                        // application. If any session is fresher than the
                        // tombstone, the deletion is stale — skip it entirely.
                        let newest_session: Option<String> = tx
                            .query_row(
                                "SELECT MAX(s.updated_at) FROM sessions s
                                 JOIN applications a ON a.id = s.app_id
                                 WHERE a.executable_name = ?1",
                                [sync_key],
                                |row| row.get::<_, Option<String>>(0),
                            )
                            .ok()
                            .flatten();
                        let sessions_newer = newest_session.as_deref().map(|su| normalize_ts(su) > normalize_ts(deleted_at_str)).unwrap_or(false);
                        app_newer || sessions_newer
                    }
                    "sessions" => {
                        // sync_key = "executable_name|start_time" (legacy: "app_id|start_time")
                        if let Some((app_key, start_time)) = sync_key.split_once('|') {
                            let local_updated: Option<String> = tx
                                .query_row(
                                    "SELECT s.updated_at
                                     FROM sessions s
                                     JOIN applications a ON a.id = s.app_id
                                     WHERE a.executable_name = ?1 AND s.start_time = ?2",
                                    rusqlite::params![app_key, start_time],
                                    |row| row.get(0),
                                )
                                .or_else(|_| {
                                    tx.query_row(
                                        "SELECT updated_at
                                         FROM sessions
                                         WHERE app_id = CAST(?1 AS INTEGER) AND start_time = ?2",
                                        rusqlite::params![app_key, start_time],
                                        |row| row.get(0),
                                    )
                                })
                                .ok();
                            local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                        } else { false }
                    }
                    "manual_sessions" => {
                        // sync_key = "project_id|start_time|title"
                        let parts: Vec<&str> = sync_key.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let local_updated: Option<String> = tx
                                .query_row(
                                    "SELECT updated_at FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                                    rusqlite::params![parts[1], parts[2]],
                                    |row| row.get(0),
                                )
                                .ok();
                            local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                        } else { false }
                    }
                    _ => false,
                };
                if skip_tombstone {
                    // Record was updated after tombstone — skip deletion, just record the tombstone
                    tx.execute(
                        "INSERT OR IGNORE INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                         VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![table_name, json_i64(ts, "record_id"), deleted_at_norm, sync_key],
                    ).map_err(|e| e.to_string())?;
                    continue;
                }

                // Delete the record — also clean up FK references to prevent orphans
                match table_name {
                    "projects" => {
                        // Diagnostyka: czy istnieje lokalny projekt który zostanie usunięty?
                        let proj_exists: bool = tx
                            .query_row("SELECT 1 FROM projects WHERE name = ?1", [sync_key], |_| Ok(()))
                            .is_ok();
                        if proj_exists && hooks.diag {
                            (hooks.log)(&format!(
                                "  [DIAG] TOMBSTONE kasuje projekt '{}' (deleted_at={})",
                                sync_key, deleted_at_str
                            ));
                        }
                        // Null out project_id in sessions/manual_sessions BEFORE deleting the project
                        if let Err(e) = tx.execute(
                            "UPDATE sessions SET project_id = NULL \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup sessions for project '{}': {}", sync_key, e); }
                        if let Err(e) = tx.execute(
                            "UPDATE manual_sessions SET project_id = 0 \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup manual_sessions for project '{}': {}", sync_key, e); }
                        if let Err(e) = tx.execute(
                            "UPDATE applications SET project_id = NULL \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup applications for project '{}': {}", sync_key, e); }
                        let _ = tx.execute("DELETE FROM projects WHERE name = ?1", [sync_key]);
                    }
                    "applications" => {
                        if let Err(e) = tx.execute(
                            "DELETE FROM sessions WHERE app_id IN \
                             (SELECT id FROM applications WHERE executable_name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup sessions for app '{}': {}", sync_key, e); }
                        let _ = tx.execute("DELETE FROM applications WHERE executable_name = ?1", [sync_key]);
                    }
                    "sessions" => {
                        // sync_key = "executable_name|start_time" (legacy: "app_id|start_time")
                        if let Some((app_key, start_time)) = sync_key.split_once('|') {
                            let deleted = tx.execute(
                                "DELETE FROM sessions
                                 WHERE app_id IN (
                                     SELECT id FROM applications WHERE executable_name = ?1
                                 ) AND start_time = ?2",
                                rusqlite::params![app_key, start_time],
                            ).unwrap_or(0);
                            if deleted == 0 {
                                let _ = tx.execute(
                                    "DELETE FROM sessions WHERE app_id = CAST(?1 AS INTEGER) AND start_time = ?2",
                                    rusqlite::params![app_key, start_time],
                                );
                            }
                        } else {
                            // Fallback for legacy integer sync_key
                            let _ = tx.execute("DELETE FROM sessions WHERE id = CAST(?1 AS INTEGER)", [sync_key]);
                        }
                    }
                    "manual_sessions" => {
                        // sync_key = "project_id|start_time|title"
                        let parts: Vec<&str> = sync_key.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let _ = tx.execute(
                                "DELETE FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                                rusqlite::params![parts[1], parts[2]],
                            );
                        } else {
                            // Fallback for legacy integer sync_key
                            let _ = tx.execute("DELETE FROM manual_sessions WHERE id = CAST(?1 AS INTEGER)", [sync_key]);
                        }
                    }
                    "clients" => {
                        // sync_key = client name. Detach projects first (assignment
                        // becomes unset), mirroring the dashboard delete_client path.
                        if let Err(e) = tx.execute(
                            "UPDATE projects SET client_name = NULL \
                             WHERE lower(client_name) = lower(?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup projects for client '{}': {}", sync_key, e); }
                        let _ = tx.execute("DELETE FROM clients WHERE name = ?1", [sync_key]);
                    }
                    _ => { log::warn!("Tombstone for unknown table: {}", table_name); }
                }

                tx.execute(
                    "INSERT OR IGNORE INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        table_name,
                        json_i64(ts, "record_id"),
                        deleted_at_norm,
                        sync_key,
                    ],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

// ── Projects merge (przeniesione 1:1 ~595-741, incl. blacklist guard) ──

pub fn merge_projects(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    hooks: &MergeHooks<'_>,
) -> Result<(), String> {
    // Merge projects
    //
    // The blacklist BEFORE-triggers (schema.sql: trg_projects_blacklist_block_insert/update)
    // RAISE(ABORT) whenever an *active* project (excluded_at IS NULL) whose name sits on the
    // local blacklist is inserted/updated — which aborts the WHOLE merge transaction. Incoming
    // sync data is authoritative, so when the peer says a project is active we drop any stale
    // local blacklist row for that name before upserting it (active/excluded is still resolved
    // by LWW on excluded_at). Guarded on table presence so older DBs without the table are safe.
    let has_blacklist_table = tx
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='project_name_blacklist'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    let mut diag_proj_new: Vec<String> = Vec::new();
    let mut diag_proj_updated: Vec<String> = Vec::new();
    let mut diag_proj_local_wins: u32 = 0;
    if let Some(projects) = archive.pointer("/data/projects").and_then(|v| v.as_array()) {
        for proj in projects {
            let name = proj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = proj.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            if local_tombstone_covers(tx, "projects", name, updated_at) {
                (hooks.log)(&format!(
                    "  SKIP projekt '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    name
                ));
                continue;
            }

            let existing: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>)> = tx
                .query_row(
                    "SELECT updated_at, merged_into, merged_at, client_name, status FROM projects WHERE name = ?1",
                    [name],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )
                .ok();

            match existing {
                Some((local_ts, _, _, _, _)) if normalize_ts(&local_ts) >= normalize_ts(updated_at) => {
                    // Local wins — log only if timestamps differ (actual conflict)
                    if normalize_ts(&local_ts) != normalize_ts(updated_at) {
                        log_merge_conflict(tx, "projects", name, &local_ts, updated_at, "local");
                    }
                    diag_proj_local_wins += 1;
                }
                Some((ref local_ts, ref local_merged_into, ref local_merged_at, ref local_client_name, ref local_status)) => {
                    log_merge_conflict(tx, "projects", name, local_ts, updated_at, "remote");
                    // Old peers don't know merged_*/client_name/status keys — absent
                    // key means "preserve local value", explicit null means "cleared".
                    let merged_into: Option<String> = match proj.get("merged_into") {
                        None => local_merged_into.clone(),
                        Some(v) => v.as_str().map(|s| s.to_string()),
                    };
                    let merged_at: Option<String> = match proj.get("merged_at") {
                        None => local_merged_at.clone(),
                        Some(v) => v.as_str().map(|s| s.to_string()),
                    };
                    let client_name: Option<String> = match proj.get("client_name") {
                        None => local_client_name.clone(),
                        Some(v) => v.as_str().map(|s| s.to_string()),
                    };
                    // status is NOT NULL — preserve local when absent, fall back to
                    // 'active' only if neither side has a value (shouldn't happen).
                    let status: String = match proj.get("status") {
                        None => local_status.clone().unwrap_or_else(|| "active".to_string()),
                        Some(v) => v.as_str().map(|s| s.to_string())
                            .or_else(|| local_status.clone())
                            .unwrap_or_else(|| "active".to_string()),
                    };
                    // Peer says this project is active → clear any stale local blacklist row
                    // so the BEFORE UPDATE trigger doesn't abort the merge.
                    if has_blacklist_table && json_str_opt(proj, "excluded_at").is_none() {
                        tx.execute(
                            "DELETE FROM project_name_blacklist WHERE name_key = lower(trim(?1))",
                            rusqlite::params![name],
                        ).map_err(|e| e.to_string())?;
                    }
                    // Note: assigned_folder_path is machine-specific — never overwrite from remote
                    tx.execute(
                        "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                         frozen_at = ?4, merged_into = ?5, merged_at = ?6, client_name = ?7, \
                         status = ?8, updated_at = ?9 WHERE name = ?10",
                        rusqlite::params![
                            json_str(proj, "color"),
                            json_f64_opt(proj, "hourly_rate"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            merged_into,
                            merged_at,
                            client_name,
                            status,
                            updated_at,
                            name,
                        ],
                    ).map_err(|e| e.to_string())?;
                    diag_proj_updated.push(name.to_string());
                }
                None => {
                    // Peer says this project is active → clear any stale local blacklist row
                    // so the BEFORE INSERT trigger doesn't abort the merge.
                    if has_blacklist_table && json_str_opt(proj, "excluded_at").is_none() {
                        tx.execute(
                            "DELETE FROM project_name_blacklist WHERE name_key = lower(trim(?1))",
                            rusqlite::params![name],
                        ).map_err(|e| e.to_string())?;
                    }
                    // status is NOT NULL — a peer that doesn't send the key (old
                    // version) defaults to 'active'.
                    let new_status =
                        json_str_opt(proj, "status").unwrap_or_else(|| "active".to_string());
                    tx.execute(
                        "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, \
                         frozen_at, assigned_folder_path, merged_into, merged_at, client_name, status, is_imported, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12)",
                        rusqlite::params![
                            name,
                            json_str(proj, "color"),
                            json_f64_opt(proj, "hourly_rate"),
                            json_str(proj, "created_at"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            json_str_opt(proj, "assigned_folder_path"),
                            json_str_opt(proj, "merged_into"),
                            json_str_opt(proj, "merged_at"),
                            json_str_opt(proj, "client_name"),
                            new_status,
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                    diag_proj_new.push(name.to_string());
                }
            }
        }
    }
    if hooks.diag {
        (hooks.log)(&format!(
            "  [DIAG] Projekty: NEW={} ({:?}), UPDATED={} ({:?}), LOCAL_WINS={}",
            diag_proj_new.len(), diag_proj_new,
            diag_proj_updated.len(), diag_proj_updated,
            diag_proj_local_wins
        ));
    }
    Ok(())
}

// ── Clients merge (przeniesione 1:1 ~743-804) ──

pub fn merge_clients(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    _hooks: &MergeHooks<'_>,
) -> Result<(), String> {
    // Merge clients (m24 entity). Identified by NAME (stable cross-machine key,
    // like projects). Last-writer-wins on updated_at. A local tombstone newer
    // than the incoming row blocks resurrection.
    if let Some(clients) = archive.pointer("/data/clients").and_then(|v| v.as_array()) {
        for c in clients {
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let updated_at = c.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if local_tombstone_covers(tx, "clients", name, updated_at) {
                continue;
            }
            let local_ts: Option<String> = tx
                .query_row(
                    "SELECT updated_at FROM clients WHERE name = ?1",
                    [name],
                    |row| row.get(0),
                )
                .ok();
            let color = json_str_opt(c, "color").unwrap_or_else(|| "#38bdf8".to_string());
            match local_ts {
                Some(lt) if normalize_ts(&lt) >= normalize_ts(updated_at) => { /* local wins */ }
                Some(_) => {
                    tx.execute(
                        "UPDATE clients SET contact = ?1, address = ?2, tax_id = ?3, currency = ?4, \
                         default_hourly_rate = ?5, color = ?6, archived_at = ?7, updated_at = ?8 WHERE name = ?9",
                        rusqlite::params![
                            json_str_opt(c, "contact"),
                            json_str_opt(c, "address"),
                            json_str_opt(c, "tax_id"),
                            json_str_opt(c, "currency"),
                            json_f64_opt(c, "default_hourly_rate"),
                            color,
                            json_str_opt(c, "archived_at"),
                            updated_at,
                            name,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
                None => {
                    tx.execute(
                        "INSERT INTO clients (name, contact, address, tax_id, currency, \
                         default_hourly_rate, color, archived_at, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            name,
                            json_str_opt(c, "contact"),
                            json_str_opt(c, "address"),
                            json_str_opt(c, "tax_id"),
                            json_str_opt(c, "currency"),
                            json_f64_opt(c, "default_hourly_rate"),
                            color,
                            json_str_opt(c, "archived_at"),
                            json_str_opt(c, "created_at"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

// ── ID maps (przeniesione 1:1 ~806-854) ──

/// Build ID maps once: remote ID → name, local name → ID.
/// These are used by applications, sessions, and manual_sessions merge.
/// Built AFTER project/app merge so local IDs reflect newly-inserted records.
pub fn build_id_maps(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
) -> Result<MergeIdMaps, String> {
    let mut remote_app_id_to_name: HashMap<i64, String> = HashMap::new();
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let remote_id = app.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !exe_name.is_empty() {
                remote_app_id_to_name.insert(remote_id, exe_name.to_string());
            }
        }
    }

    let mut remote_project_id_to_name: HashMap<i64, String> = HashMap::new();
    if let Some(projects) = archive.pointer("/data/projects").and_then(|v| v.as_array()) {
        for proj in projects {
            let remote_id = proj.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let name = proj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !name.is_empty() {
                remote_project_id_to_name.insert(remote_id, name.to_string());
            }
        }
    }

    // Refresh local ID maps from DB (includes newly-merged projects/apps)
    let mut project_name_to_local_id: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, name FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            project_name_to_local_id.insert(row.1, row.0);
        }
    }

    let mut app_name_to_local_id: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, executable_name FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            app_name_to_local_id.insert(row.1, row.0);
        }
    }

    Ok(MergeIdMaps {
        remote_app_id_to_name,
        remote_project_id_to_name,
        project_name_to_local_id,
        app_name_to_local_id,
    })
}

// ── Applications merge (przeniesione 1:1 ~856-921) ──

pub fn merge_applications(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    hooks: &MergeHooks<'_>,
    maps: &mut MergeIdMaps,
) -> Result<(), String> {
    // Merge applications (resolve remote project_id → local via name)
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = app.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if exe_name.is_empty() {
                continue;
            }
            if local_tombstone_covers(tx, "applications", exe_name, updated_at) {
                (hooks.log)(&format!(
                    "  SKIP aplikacja '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    exe_name
                ));
                continue;
            }

            // Resolve remote project_id → local project_id via name
            let remote_project_id = app.get("project_id").and_then(|v| v.as_i64());
            let local_project_id: Option<i64> = remote_project_id
                .and_then(|rid| maps.remote_project_id_to_name.get(&rid))
                .and_then(|name| maps.project_name_to_local_id.get(name))
                .copied();

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM applications WHERE executable_name = ?1",
                    [exe_name],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((_id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        log_merge_conflict(tx, "applications", exe_name, local, updated_at, "remote");
                        // Sync project_id: prefer remote if set, else keep local
                        tx.execute(
                            "UPDATE applications SET display_name = ?1, \
                             project_id = COALESCE(?2, project_id), \
                             updated_at = ?3 WHERE executable_name = ?4",
                            rusqlite::params![
                                json_str_opt(app, "display_name"),
                                local_project_id,
                                updated_at,
                                exe_name,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO applications (executable_name, display_name, project_id, is_imported, updated_at) \
                         VALUES (?1, ?2, ?3, 1, ?4)",
                        rusqlite::params![exe_name, json_str_opt(app, "display_name"), local_project_id, updated_at],
                    ).map_err(|e| e.to_string())?;
                    // Update app_name_to_local_id for newly-inserted apps
                    if let Ok(new_id) = tx.query_row(
                        "SELECT id FROM applications WHERE executable_name = ?1", [exe_name], |row| row.get::<_, i64>(0)
                    ) {
                        maps.app_name_to_local_id.insert(exe_name.to_string(), new_id);
                    }
                }
            }
        }
    }
    Ok(())
}

// ── Manual sessions merge (przeniesione 1:1 ~1069-1153) ──

pub fn merge_manual_sessions(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    hooks: &MergeHooks<'_>,
    maps: &MergeIdMaps,
) -> Result<(), String> {
    // Merge manual_sessions (using resolved local IDs)
    if let Some(manual_sessions) = archive.pointer("/data/manual_sessions").and_then(|v| v.as_array()) {
        log::info!("Sync orchestrator: merging {} manual sessions", manual_sessions.len());
        for ms in manual_sessions {
            let title = ms.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let start_time = ms.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = ms.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if title.is_empty() || start_time.is_empty() {
                continue;
            }
            if local_manual_tombstone_covers(tx, start_time, title, updated_at) {
                (hooks.log)(&format!(
                    "  SKIP sesja manualna '{}|{}' — lokalny tombstone jest nowszy niz rekord peera",
                    start_time, title
                ));
                continue;
            }

            // Resolve remote IDs to local
            // Sentinel 0 = nieprzypisane. manual_sessions.project_id jest NOT NULL,
            // więc nierozwiązany remote project_id (w tym jego własny sentinel 0)
            // MUSI zmapować się na 0 — bind NULL przerwałby cały merge i wymusił restore.
            let local_project_id: i64 = ms.get("project_id").and_then(|v| v.as_i64())
                .and_then(|rid| maps.remote_project_id_to_name.get(&rid))
                .and_then(|name| maps.project_name_to_local_id.get(name))
                .copied()
                .unwrap_or(0);
            let local_app_id: Option<i64> = ms.get("app_id").and_then(|v| v.as_i64())
                .and_then(|rid| maps.remote_app_id_to_name.get(&rid))
                .and_then(|name| maps.app_name_to_local_id.get(name))
                .copied();

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM manual_sessions WHERE title = ?1 AND start_time = ?2",
                    rusqlite::params![title, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        let key = format!("title={}|start_time={}", title, start_time);
                        log_merge_conflict(tx, "manual_sessions", &key, local, updated_at, "remote");
                        tx.execute(
                            "UPDATE manual_sessions SET session_type = ?1, project_id = ?2, \
                             app_id = ?3, end_time = ?4, duration_seconds = ?5, \
                             date = ?6, updated_at = ?7 WHERE id = ?8",
                            rusqlite::params![
                                json_str_opt(ms, "session_type"),
                                local_project_id,
                                local_app_id,
                                json_str_opt(ms, "end_time"),
                                json_i64(ms, "duration_seconds"),
                                json_str_opt(ms, "date"),
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO manual_sessions (title, session_type, project_id, app_id, \
                         start_time, end_time, duration_seconds, date, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            title,
                            json_str_opt(ms, "session_type"),
                            local_project_id,
                            local_app_id,
                            start_time,
                            json_str_opt(ms, "end_time"),
                            json_i64(ms, "duration_seconds"),
                            json_str_opt(ms, "date"),
                            json_str_opt(ms, "created_at"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn smoke_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT,
                hourly_rate REAL,
                created_at TEXT,
                excluded_at TEXT,
                frozen_at TEXT,
                assigned_folder_path TEXT,
                merged_into TEXT,
                merged_at TEXT,
                client_name TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                is_imported INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER,
                project_id INTEGER,
                project_name TEXT,
                start_time TEXT,
                end_time TEXT,
                duration_seconds INTEGER,
                date TEXT,
                rate_multiplier REAL,
                comment TEXT,
                is_hidden INTEGER,
                updated_at TEXT
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executable_name TEXT NOT NULL UNIQUE,
                display_name TEXT,
                project_id INTEGER,
                is_imported INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                session_type TEXT,
                project_id INTEGER NOT NULL DEFAULT 0,
                app_id INTEGER,
                start_time TEXT,
                end_time TEXT,
                duration_seconds INTEGER,
                date TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE tombstones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                record_id INTEGER,
                deleted_at TEXT,
                sync_key TEXT,
                UNIQUE(table_name, sync_key)
            );
            CREATE TABLE sync_merge_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT,
                record_key TEXT,
                resolution TEXT,
                local_updated_at TEXT,
                remote_updated_at TEXT,
                winner TEXT
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn apply_tombstones_and_merge_projects_lww() {
        let mut conn = smoke_db();
        // Local project that should survive (newer than the incoming row).
        conn.execute(
            "INSERT INTO projects (name, updated_at) VALUES ('local-fresh', '2026-01-02 00:00:00')",
            [],
        )
        .unwrap();
        // Local project that will be deleted by an incoming tombstone.
        conn.execute(
            "INSERT INTO projects (name, updated_at) VALUES ('to-delete', '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();

        let archive = serde_json::json!({
            "data": {
                "tombstones": [
                    { "table_name": "projects", "record_id": 2, "sync_key": "to-delete", "deleted_at": "2026-01-05 00:00:00" }
                ],
                "projects": [
                    // Stale incoming update for local-fresh → LWW keeps local.
                    { "id": 10, "name": "local-fresh", "color": "#000000", "updated_at": "2026-01-01 00:00:00", "created_at": "2026-01-01 00:00:00" },
                    // New project from peer → inserted.
                    { "id": 11, "name": "remote-new", "color": "#ffffff", "updated_at": "2026-01-03 00:00:00", "created_at": "2026-01-03 00:00:00" }
                ]
            }
        });

        let hooks = MergeHooks { log: &|_| {}, diag: false };
        let tx = conn.transaction().unwrap();
        apply_tombstones(&tx, &archive, &hooks).unwrap();
        merge_projects(&tx, &archive, &hooks).unwrap();
        tx.commit().unwrap();

        // Tombstone removed 'to-delete'.
        let deleted: i64 = conn
            .query_row("SELECT count(*) FROM projects WHERE name = 'to-delete'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(deleted, 0, "tombstone should delete the stale project");

        // LWW kept the local color for 'local-fresh' (incoming was older).
        let color: Option<String> = conn
            .query_row("SELECT color FROM projects WHERE name = 'local-fresh'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(color, None, "older incoming row must not overwrite local");

        // 'remote-new' inserted.
        let new_exists: i64 = conn
            .query_row("SELECT count(*) FROM projects WHERE name = 'remote-new'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(new_exists, 1, "fresh peer project should be inserted");
    }
}
