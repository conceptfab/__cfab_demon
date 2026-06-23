// sync_common.rs — shared sync utilities used by both LAN and online sync.

use crate::config;
use crate::lan_common;
use crate::lan_server;
use timeflow_shared::sync::timestamp::normalize_ts;

use std::sync::Mutex;

pub(crate) static MERGE_MUTEX: Mutex<()> = Mutex::new(());

fn diag_logging_enabled() -> bool {
    cfg!(debug_assertions) || config::load_log_settings().lan_sync_level.eq_ignore_ascii_case("debug")
}

pub fn compute_tables_hash_string_conn(conn: &rusqlite::Connection) -> String {
    lan_common::compute_tables_hash_string(conn)
}

pub fn generate_marker_hash_simple(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    lan_common::generate_marker_hash(tables_hash, timestamp, device_id)
}

// ── Database helpers ──

pub fn insert_sync_marker_db(
    conn: &rusqlite::Connection,
    marker_hash: &str,
    created_at: &str,
    device_id: &str,
    peer_id: Option<&str>,
    tables_hash: &str,
    full_sync: bool,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_markers (marker_hash, created_at, device_id, peer_id, tables_hash, full_sync) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![marker_hash, created_at, device_id, peer_id, tables_hash, full_sync as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn build_full_export(conn: &rusqlite::Connection) -> Result<String, String> {
    // Full convergence snapshot: include tombstones so deletes propagate in full
    // and force sync. The merge path applies tombstones before live rows, so rows
    // still present in the snapshot are restored by the following record merge.
    lan_server::build_full_snapshot_public(conn)
}

// ── Backup ──

pub fn backup_database_typed(conn: &rusqlite::Connection, sync_type: &str) -> Result<(), String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups").join(sync_type);
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = backup_dir.join(format!("timeflow_sync_backup_{}.db", timestamp));

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;

    // Use rusqlite backup API instead of string-interpolated VACUUM INTO
    let mut dest_conn = rusqlite::Connection::open(&dest)
        .map_err(|e| format!("Backup: cannot open dest: {}", e))?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest_conn)
        .map_err(|e| format!("Backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Backup failed: {}", e))?;
    drop(backup);
    drop(dest_conn);

    // Rotate: keep max 5
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str())
            .map(|n| n.starts_with("timeflow_sync_backup_")).unwrap_or(false))
        .collect();
    backups.sort();
    while backups.len() > 5 {
        if let Some(oldest) = backups.first() {
            let _ = std::fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Sync backup created: {:?}", dest);

    // Also create persistent backup to user-configured Backup Destination
    if let Err(e) = create_pre_sync_backup_to_destination(conn, "lan") {
        log::warn!("Pre-sync backup to Backup Destination skipped: {}", e);
    }

    Ok(())
}

/// Create a persistent pre-sync backup to the user-configured Backup Destination.
/// Reads `backup_path` from system_settings. Falls back silently if not configured.
fn create_pre_sync_backup_to_destination(conn: &rusqlite::Connection, sync_type: &str) -> Result<String, String> {
    // Read backup_path from system_settings
    let backup_path: Option<String> = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'backup_path'",
        [],
        |row| row.get(0),
    ).ok().filter(|p: &String| !p.is_empty());

    let backup_dir = match backup_path {
        Some(ref p) => std::path::PathBuf::from(p),
        None => return Err("backup_path not configured".to_string()),
    };

    // Validate path — reject traversal attempts
    let canonical = backup_dir.to_string_lossy();
    if canonical.contains("..") {
        return Err(format!("Invalid backup_path: path traversal detected in '{}'", canonical));
    }

    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_pre_{}_sync_{}.db", sync_type, timestamp);
    let dest_path = backup_dir.join(&file_name);

    // Use rusqlite backup API instead of string-interpolated VACUUM INTO to prevent SQL injection
    let mut dest_conn = rusqlite::Connection::open(&dest_path)
        .map_err(|e| format!("Pre-sync backup: cannot open dest: {}", e))?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest_conn)
        .map_err(|e| format!("Pre-sync backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Pre-sync backup failed: {}", e))?;
    drop(backup);
    drop(dest_conn);

    // Rotate: keep max 10 pre-sync backups per type
    let prefix = format!("timeflow_pre_{}_sync_", sync_type);
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str())
            .map(|n| n.starts_with(&prefix)).unwrap_or(false))
        .collect();
    backups.sort();
    while backups.len() > 10 {
        if let Some(oldest) = backups.first() {
            let _ = std::fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Pre-{}-sync backup to Backup Destination: {:?}", sync_type, dest_path);
    Ok(dest_path.to_string_lossy().to_string())
}

/// Restores from the most recent backup using SQLite backup API.
/// This is safe even with the caller's connection open — the backup API
/// handles locking correctly, unlike raw fs::copy which can corrupt on Windows.
/// Callers MUST re-open the connection after restore.
pub fn restore_database_backup_typed(conn: &mut rusqlite::Connection, sync_type: &str) -> Result<(), String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups").join(sync_type);

    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("Cannot read backup dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("timeflow_sync_backup_"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();

    let latest = backups.last().ok_or("No backup files found")?.clone();

    // Open backup file as source, then use SQLite backup API to restore safely
    let src = rusqlite::Connection::open(&latest)
        .map_err(|e| format!("Cannot open backup file: {}", e))?;
    let backup = rusqlite::backup::Backup::new(&src, conn)
        .map_err(|e| format!("Backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Backup restore failed: {}", e))?;

    drop(backup);
    drop(src);

    // Re-open connection to ensure clean state after restore
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    let new_conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Re-open after restore failed: {}", e))?;
    *conn = new_conn;

    log::warn!("Database restored from backup: {:?}. Connection re-opened.", latest);
    Ok(())
}

// ── Delta export for async sync ──

/// Build a delta export containing only records changed since `since_ts`.
/// Returns (json_string, byte_count). If since_ts is None, exports everything.
pub fn build_delta_export(conn: &rusqlite::Connection, since_ts: Option<&str>) -> Result<(String, usize), String> {
    let since = since_ts.unwrap_or("1970-01-01 00:00:00");
    let json = lan_server::build_delta_for_pull_public(conn, since)?;
    let size = json.len();
    Ok((json, size))
}

/// Get the timestamp of the last successful sync marker, or None if never synced.
pub fn get_last_sync_timestamp(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

// ── Merge conflict logging + tombstone guards live in timeflow_shared::sync::merge ──
// (przeniesione do współdzielonego rdzenia; daemonowy inline session block korzysta
//  z nich przez `use` poniżej).
use timeflow_shared::sync::merge::{
    json_f64, json_i64, json_str, json_str_opt, local_tombstone_covers, log_merge_conflict,
};

/// Daemon-side defensive schema guard: the dashboard owns migrations (m23),
/// but the daemon may touch a not-yet-migrated DB right after an upgrade.
/// Idempotent — "duplicate column" errors are expected and ignored.
pub(crate) fn ensure_project_merge_columns(conn: &rusqlite::Connection) {
    for sql in [
        "ALTER TABLE projects ADD COLUMN merged_into TEXT",
        "ALTER TABLE projects ADD COLUMN merged_at TEXT",
    ] {
        if let Err(e) = conn.execute(sql, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                lan_common::sync_log(&format!("ensure_project_merge_columns: {}", msg));
            }
        }
    }
}

/// Daemon-side defensive schema guard for the m24 client entity/columns.
/// Mirrors `ensure_project_merge_columns` — the dashboard owns the migration,
/// but the daemon may export/merge against a DB upgraded a moment earlier.
/// Idempotent: "duplicate column"/"already exists" are expected and ignored.
pub(crate) fn ensure_project_client_columns(conn: &rusqlite::Connection) {
    for sql in [
        "ALTER TABLE projects ADD COLUMN client_name TEXT",
        "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    ] {
        if let Err(e) = conn.execute(sql, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                lan_common::sync_log(&format!("ensure_project_client_columns: {}", msg));
            }
        }
    }
    // Clients entity (m24). Created if missing so export/merge never fail on it.
    if let Err(e) = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            contact TEXT,
            address TEXT,
            tax_id TEXT,
            currency TEXT,
            default_hourly_rate REAL,
            color TEXT NOT NULL DEFAULT '#38bdf8',
            archived_at TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );",
    ) {
        lan_common::sync_log(&format!("ensure_project_client_columns (clients table): {}", e));
    }
}

// ── Merge ──

pub fn merge_incoming_data(conn: &mut rusqlite::Connection, slave_data: &str) -> Result<(), String> {
    let _merge_guard = MERGE_MUTEX
        .lock()
        .map_err(|_| "merge mutex poisoned".to_string())?;
    ensure_project_merge_columns(conn);
    ensure_project_client_columns(conn);
    const MAX_PAYLOAD_SIZE: usize = 200 * 1024 * 1024; // 200 MB
    if slave_data.len() > MAX_PAYLOAD_SIZE {
        return Err(format!(
            "Sync payload too large: {} MB (limit {} MB)",
            slave_data.len() / (1024 * 1024),
            MAX_PAYLOAD_SIZE / (1024 * 1024)
        ));
    }

    // Parse into Value — the source string is caller-owned and will be freed after this call.
    // NOTE: For payloads >50 MB, peak memory usage is ~3× payload size (source + parsed Value).
    // Consider serde_json::StreamDeserializer for very large databases in the future.
    let payload_mb = slave_data.len() as f64 / (1024.0 * 1024.0);
    if payload_mb > 10.0 {
        lan_common::sync_log(&format!("  Parsowanie {:.1} MB payloadu...", payload_mb));
    }
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    // Log counts for visibility
    let count = |path: &str| archive.pointer(path).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    lan_common::sync_log(&format!("  Dane peera: {} projektow, {} aplikacji, {} sesji, {} sesji manualnych, {} tombstones",
        count("/data/projects"), count("/data/applications"), count("/data/sessions"),
        count("/data/manual_sessions"), count("/data/tombstones")));

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Suppress tombstone triggers for the whole merge transaction: every
    // DELETE below replays a peer tombstone that is recorded explicitly with
    // its original deleted_at. Trigger-minted copies (deleted_at = now) would
    // propagate onward and defeat updated_at guards on other devices.
    // DDL is transactional — a rollback restores the triggers.
    for sql in crate::tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
        tx.execute(sql, []).map_err(|e| e.to_string())?;
    }

    // Rdzeń merge (tombstony, projekty, klienci, mapy ID, aplikacje) wydzielony do
    // timeflow_shared::sync::merge. Sesje (poniżej) zostają inline — daemon i dashboard
    // mają celowo różne algorytmy sesji (finding #8). Kolejność zachowana 1:1.
    let diag = diag_logging_enabled();
    let hooks = timeflow_shared::sync::merge::MergeHooks {
        log: &|m: &str| lan_common::sync_log(m),
        diag,
    };
    timeflow_shared::sync::merge::apply_tombstones(&tx, &archive, &hooks)?;
    timeflow_shared::sync::merge::merge_projects(&tx, &archive, &hooks)?;
    timeflow_shared::sync::merge::merge_clients(&tx, &archive, &hooks)?;
    let mut id_maps = timeflow_shared::sync::merge::build_id_maps(&tx, &archive)?;
    timeflow_shared::sync::merge::merge_applications(&tx, &archive, &hooks, &mut id_maps)?;

    // Merge sessions (using local IDs resolved via name maps)
    let mut diag_sess_total: u32 = 0;
    let mut diag_sess_with_remote_pid: u32 = 0;
    let mut diag_sess_resolved_pid: u32 = 0;
    let mut diag_sess_unresolved_by_name: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut diag_sess_unresolved_remote_id_unknown: u32 = 0;
    if let Some(sessions) = archive.pointer("/data/sessions").and_then(|v| v.as_array()) {
        for sess in sessions {
            let remote_app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let start_time = sess.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = sess.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if start_time.is_empty() || remote_app_id == 0 {
                continue;
            }
            diag_sess_total += 1;

            // Resolve remote app_id → local app_id via executable_name
            let remote_app_name = match id_maps.remote_app_id_to_name.get(&remote_app_id) {
                Some(name) => name,
                None => {
                    lan_common::sync_log(&format!("  SKIP sesja (brak nazwy app dla remote={})", remote_app_id));
                    continue;
                }
            };
            let local_app_id = match id_maps.app_name_to_local_id.get(remote_app_name) {
                Some(&id) => id,
                None => {
                    lan_common::sync_log(&format!("  SKIP sesja (brak lokalnego app_id dla remote={})", remote_app_id));
                    continue;
                }
            };
            let session_sync_key = format!("{}|{}", remote_app_name, start_time);
            if local_tombstone_covers(&tx, "sessions", &session_sync_key, updated_at) {
                lan_common::sync_log(&format!(
                    "  SKIP sesja '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    session_sync_key
                ));
                continue;
            }

            // Resolve remote project_id → local project_id via name
            let remote_pid_opt = sess.get("project_id").and_then(|v| v.as_i64());
            let local_project_id: Option<i64> = remote_pid_opt
                .and_then(|rid| id_maps.remote_project_id_to_name.get(&rid))
                .and_then(|name| id_maps.project_name_to_local_id.get(name))
                .copied();
            // Determine project_name to persist. Priority:
            //   1) Remote sent explicit project_name (newer schema) — use it
            //   2) Look up peer's project_id in the peer's project list and use that name
            // This preserves the assignment LABEL even when the project is not present
            // locally (so sessions never appear "unassigned" just because the project
            // list differs per machine).
            let remote_project_name: Option<String> = sess
                .get("project_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    remote_pid_opt
                        .and_then(|rid| id_maps.remote_project_id_to_name.get(&rid))
                        .cloned()
                });
            if let Some(rid) = remote_pid_opt {
                diag_sess_with_remote_pid += 1;
                if local_project_id.is_some() {
                    diag_sess_resolved_pid += 1;
                } else {
                    match id_maps.remote_project_id_to_name.get(&rid) {
                        Some(pname) => {
                            *diag_sess_unresolved_by_name.entry(pname.clone()).or_insert(0) += 1;
                        }
                        None => { diag_sess_unresolved_remote_id_unknown += 1; }
                    }
                }
            }

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
                    rusqlite::params![local_app_id, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        let key = format!("app_id={}|start_time={}", local_app_id, start_time);
                        log_merge_conflict(&tx, "sessions", &key, local, updated_at, "remote");
                        // COALESCE for project_id: prefer remote-resolved if set, else keep local.
                        // project_name: prefer remote (peer's label), fallback to local — this
                        // ensures that even when the project isn't present locally, the label
                        // persists and the session is not rendered as "Unassigned".
                        tx.execute(
                            "UPDATE sessions SET end_time = ?1, duration_seconds = ?2, \
                             rate_multiplier = ?3, comment = ?4, is_hidden = ?5, \
                             project_id = COALESCE(?6, project_id), \
                             project_name = COALESCE(?7, project_name), \
                             updated_at = ?8 WHERE id = ?9",
                            rusqlite::params![
                                json_str_opt(sess, "end_time"),
                                json_i64(sess, "duration_seconds"),
                                json_f64(sess, "rate_multiplier"),
                                json_str_opt(sess, "comment"),
                                json_i64(sess, "is_hidden"),
                                local_project_id,
                                remote_project_name,
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT OR IGNORE INTO sessions (app_id, project_id, project_name, start_time, end_time, \
                         duration_seconds, date, rate_multiplier, comment, is_hidden, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                        rusqlite::params![
                            local_app_id,
                            local_project_id,
                            remote_project_name,
                            start_time,
                            json_str_opt(sess, "end_time"),
                            json_i64(sess, "duration_seconds"),
                            json_str(sess, "date"),
                            json_f64(sess, "rate_multiplier"),
                            json_str_opt(sess, "comment"),
                            json_i64(sess, "is_hidden"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    if diag_logging_enabled() {
        lan_common::sync_log(&format!(
            "  [DIAG] Sesje: total={}, z remote project_id={}, zresolwowane={}, NIEZRESOLWOWANE_po_nazwie={:?}, remote_id_nieznane={}",
            diag_sess_total, diag_sess_with_remote_pid, diag_sess_resolved_pid,
            diag_sess_unresolved_by_name, diag_sess_unresolved_remote_id_unknown
        ));
    }

    // Merge manual_sessions (resolved local IDs) — wydzielone do shared::sync::merge.
    timeflow_shared::sync::merge::merge_manual_sessions(&tx, &archive, &hooks, &id_maps)?;

    // Tombstones were merged at the top of the transaction (before records),
    // so any peer deletions are already applied. Subsequent INSERT/UPDATE
    // re-introduce records the peer still has — by design.

    // Restore tombstone triggers before committing so the production schema
    // is intact for subsequent write operations.
    for sql in crate::tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
        tx.execute(sql, []).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| {
        log::error!("Transaction commit failed: {}", e);
        e.to_string()
    })?;
    lan_common::sync_log("  Scalanie zakonczone — commit transakcji");
    Ok(())
}

// ── Tombstone garbage collection ──

/// Delete tombstones that every currently-paired peer has already received, so a
/// deletion is never resurrected by a peer that had not yet seen it.
///
/// A peer "received" a tombstone once it completed a sync with us after the
/// tombstone's `deleted_at` (merge propagates tombstones on every sync). The safe
/// cutoff is therefore the OLDEST "last sync" across all paired peers — tombstones
/// older than that have reached everyone.
///
/// - No paired peers (standalone / fully unpaired): nothing can resurrect a local
///   delete, so fall back to age-based GC using `max_age_days`.
/// - A paired peer that has never synced pins all tombstones until its first sync
///   (we cannot prove it received any deletion). Unpairing a dead peer advances the
///   cutoff; tombstones are tiny rows, so this is an acceptable trade-off.
///
/// Returns the number of deleted rows.
pub fn gc_tombstones(conn: &rusqlite::Connection, max_age_days: u32) -> Result<usize, String> {
    let paired = crate::lan_pairing::load_paired_devices();
    let paired_ids: Vec<String> = paired.into_keys().collect();
    let cutoff = compute_tombstone_gc_cutoff(conn, &paired_ids, max_age_days)?;
    match cutoff {
        None => Ok(0),
        Some(cutoff_str) => conn
            .execute(
                "DELETE FROM tombstones WHERE deleted_at < ?1",
                rusqlite::params![cutoff_str],
            )
            .map_err(|e| e.to_string()),
    }
}

/// Compute the `deleted_at` cutoff for tombstone GC. Returns `None` when nothing
/// may be deleted yet (a paired peer has not proven it received our deletions).
///
/// - No paired peers: age-based cutoff (`max_age_days`) — nothing can resurrect.
/// - Paired peers: the OLDEST "last sync" across all of them. A marker for a sync
///   with peer P appears as either `device_id = P` or `peer_id = P`. A paired peer
///   with no sync history yet pins all tombstones (`None`).
fn compute_tombstone_gc_cutoff(
    conn: &rusqlite::Connection,
    paired_ids: &[String],
    max_age_days: u32,
) -> Result<Option<String>, String> {
    if paired_ids.is_empty() {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days as i64);
        return Ok(Some(cutoff.format("%Y-%m-%d %H:%M:%S").to_string()));
    }

    let mut safe_cutoff: Option<String> = None;
    for peer_id in paired_ids {
        let last_sync: Option<String> = conn
            .query_row(
                "SELECT MAX(created_at) FROM sync_markers \
                 WHERE (device_id = ?1 OR peer_id = ?1) AND created_at IS NOT NULL",
                rusqlite::params![peer_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .map_err(|e| e.to_string())?;
        match last_sync {
            // Paired peer with no sync history yet → no proof of delivery → keep all.
            None => return Ok(None),
            Some(ts) => {
                safe_cutoff = Some(match safe_cutoff {
                    Some(cur) if cur <= ts => cur,
                    _ => ts,
                });
            }
        }
    }
    Ok(safe_cutoff)
}

/// Run tombstone GC using settings from lan_sync_settings.json. Opens its own DB connection.
pub fn run_gc_tombstones() {
    let gc_days = config::load_lan_sync_settings().tombstone_max_age_days;
    if let Ok(conn) = lan_common::open_dashboard_db() {
        match gc_tombstones(&conn, gc_days) {
            Ok(deleted) if deleted > 0 => {
                lan_common::sync_log(&format!("GC: usunięto {} starych tombstones", deleted));
            }
            _ => {}
        }
    }
}

// ── Integrity check ──

pub fn verify_merge_integrity(conn: &rusqlite::Connection) -> Result<(), String> {
    // Before nulling orphan project_id, try to re-attach sessions to local projects
    // by matching project_name → local projects.name. This catches the case where
    // a session's remote project_id points to a project whose name DOES exist
    // locally (possibly with a different local ID).
    let reattached = conn.execute(
        "UPDATE sessions SET project_id = (SELECT id FROM projects WHERE projects.name = sessions.project_name) \
         WHERE sessions.project_name IS NOT NULL AND sessions.project_name != '' \
           AND (sessions.project_id IS NULL \
                OR sessions.project_id NOT IN (SELECT id FROM projects)) \
           AND EXISTS (SELECT 1 FROM projects WHERE projects.name = sessions.project_name)",
        [],
    ).map_err(|e| e.to_string())?;
    if reattached > 0 && diag_logging_enabled() {
        lan_common::sync_log(&format!(
            "  [DIAG] Przywrocono project_id dla {} sesji po nazwie projektu",
            reattached
        ));
    }
    // Diagnostyka: PRZED zerowaniem zlicz pozostałe orphany per project_id
    {
        let mut stmt = conn.prepare(
            "SELECT project_id, COUNT(*) FROM sessions \
             WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects) \
             GROUP BY project_id"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        if !rows.is_empty() && diag_logging_enabled() {
            lan_common::sync_log(&format!(
                "  [DIAG] verify_merge_integrity ZARAZ wyzeruje project_id w sesjach: {:?} (project_id → liczba sesji). project_name zachowane.",
                rows
            ));
        }
    }
    // Null out orphan project_id references (FK consistency). project_name is preserved
    // so the UI can still display the project label even without a local project row.
    let orphan_sessions = conn.execute(
        "UPDATE sessions SET project_id = NULL \
         WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_sessions > 0 {
        log::warn!("Sync verify: fixed {} sessions with orphan project_id (project_name preserved)", orphan_sessions);
    }

    let orphan_manual = conn.execute(
        "UPDATE manual_sessions SET project_id = 0 \
         WHERE project_id NOT IN (SELECT id FROM projects) AND project_id != 0",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_manual > 0 {
        log::warn!("Sync verify: fixed {} manual_sessions with orphan project_id", orphan_manual);
    }

    let orphan_apps = conn.execute(
        "UPDATE applications SET project_id = NULL \
         WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_apps > 0 {
        log::warn!("Sync verify: fixed {} applications with orphan project_id", orphan_apps);
    }

    // Clear merge markers ONLY when the parent was genuinely DELETED (a parent
    // tombstone exists) — not merely absent. During a multi-step converge the
    // parent row can lag its children for a window; unconditionally nulling the
    // marker then (the old behaviour) silently un-merged projects and re-activated
    // the stage. A dangling marker is harmless meanwhile: the time rollup
    // LEFT-JOINs the parent and falls back to the child's own id, so no time is
    // lost or double-counted while we wait for the parent row to arrive.
    // Comparison is case-insensitive to match the rollup join (lower(name)).
    let dangling_merged = conn.execute(
        "UPDATE projects SET merged_into = NULL, merged_at = NULL \
         WHERE merged_into IS NOT NULL \
           AND lower(merged_into) NOT IN (SELECT lower(name) FROM projects) \
           AND lower(merged_into) IN \
               (SELECT lower(sync_key) FROM tombstones WHERE table_name = 'projects')",
        [],
    ).map_err(|e| e.to_string())?;
    if dangling_merged > 0 {
        log::warn!(
            "Sync verify: cleared {} merge markers whose parent was deleted (tombstoned)",
            dangling_merged
        );
    }

    // Check FK integrity
    let fk_errors: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let table: String = row.get(0)?;
                Ok(table)
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    if !fk_errors.is_empty() {
        log::warn!("Sync orchestrator: {} FK violations found, cleaning up", fk_errors.len());
        // Delete orphaned sessions (app_id not in applications) with tombstone
        // triggers suppressed: this is local housekeeping after merge, and the
        // trigger would mint legacy numeric sync_keys (no applications row to
        // resolve the name) that replay against unrelated app_ids on peers.
        // Single transaction so a crash cannot leave the triggers dropped.
        let mut batch = String::from("BEGIN IMMEDIATE;\n");
        for sql in crate::tombstone_triggers::DROP_ALL_TOMBSTONE_TRIGGERS_SQL {
            batch.push_str(sql);
            batch.push_str(";\n");
        }
        batch.push_str("DELETE FROM sessions WHERE app_id NOT IN (SELECT id FROM applications);\n");
        for sql in crate::tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
            batch.push_str(sql);
            batch.push('\n');
        }
        batch.push_str("COMMIT;");
        if let Err(e) = conn.execute_batch(&batch) {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(e.to_string());
        }
    }

    // Integrity check
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if integrity != "ok" {
        return Err(format!("Integrity check failed: {}", integrity));
    }

    Ok(())
}

// ── JSON helpers przeniesione do timeflow_shared::sync::merge ──
// (importowane na górze pliku; inline session block i testy korzystają stamtąd).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ts_iso_format() {
        assert_eq!(normalize_ts("2024-01-15T10:30:00"), "2024-01-15 10:30:00");
    }

    #[test]
    fn test_normalize_ts_already_normalized() {
        assert_eq!(normalize_ts("2024-01-15 10:30:00"), "2024-01-15 10:30:00");
    }

    #[test]
    fn test_normalize_ts_invalid_returns_original() {
        assert_eq!(normalize_ts("invalid"), "invalid");
    }

    #[test]
    fn test_json_helpers() {
        let v: serde_json::Value = serde_json::json!({
            "name": "test",
            "count": 42,
            "rate": 2.5,
            "empty": null
        });
        assert_eq!(json_str(&v, "name"), "test");
        assert_eq!(json_str(&v, "missing"), "");
        assert_eq!(json_i64(&v, "count"), 42);
        assert_eq!(json_i64(&v, "missing"), 0);
        assert!((json_f64(&v, "rate") - 2.5).abs() < f64::EPSILON);
        assert_eq!(json_str_opt(&v, "name"), Some("test".to_string()));
        assert_eq!(json_str_opt(&v, "empty"), None);
    }

    #[test]
    fn test_generate_marker_hash_deterministic() {
        let h1 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev1");
        let h2 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev1");
        assert_eq!(h1, h2);
        // Different input → different hash
        let h3 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev2");
        assert_ne!(h1, h3);
    }

    // ── Tombstone GC: per-peer ACK gate (W1) ──

    fn gc_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE tombstones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                record_id INTEGER,
                deleted_at TEXT,
                sync_key TEXT
            );
            CREATE TABLE sync_markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marker_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                peer_id TEXT,
                tables_hash TEXT NOT NULL,
                full_sync INTEGER NOT NULL DEFAULT 0
            );",
        )
        .expect("gc test schema");
        conn
    }

    fn add_marker(conn: &rusqlite::Connection, created_at: &str, device_id: &str, peer_id: &str) {
        conn.execute(
            "INSERT INTO sync_markers (marker_hash, created_at, device_id, peer_id, tables_hash) \
             VALUES ('h', ?1, ?2, ?3, 't')",
            rusqlite::params![created_at, device_id, peer_id],
        )
        .expect("insert marker");
    }

    #[test]
    fn gc_cutoff_standalone_uses_age() {
        let conn = gc_test_db();
        // No paired peers → age-based cutoff is returned (not None).
        let cutoff = compute_tombstone_gc_cutoff(&conn, &[], 90)
            .expect("cutoff")
            .expect("standalone returns an age cutoff");
        // Cutoff is ~90 days in the past, so it sits before "now".
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        assert!(cutoff < now, "age cutoff must be in the past");
    }

    #[test]
    fn gc_cutoff_paired_peer_never_synced_keeps_all() {
        let conn = gc_test_db();
        // Paired peer with zero markers → cannot prove delivery → keep everything.
        let cutoff =
            compute_tombstone_gc_cutoff(&conn, &["peerA".to_string()], 90).expect("cutoff");
        assert_eq!(cutoff, None, "unsynced paired peer must pin all tombstones");
    }

    #[test]
    fn gc_cutoff_is_oldest_last_sync_across_peers() {
        let conn = gc_test_db();
        // peerA last synced recently; peerB last synced long ago. Cutoff = peerB's.
        add_marker(&conn, "2026-01-10 00:00:00", "self", "peerA");
        add_marker(&conn, "2026-06-01 00:00:00", "self", "peerA"); // peerA newer
        add_marker(&conn, "2026-02-01 00:00:00", "peerB", "self"); // peerB only this
        let cutoff = compute_tombstone_gc_cutoff(
            &conn,
            &["peerA".to_string(), "peerB".to_string()],
            90,
        )
        .expect("cutoff")
        .expect("both peers synced → Some");
        assert_eq!(
            cutoff, "2026-02-01 00:00:00",
            "cutoff must be the oldest peer's last sync"
        );
    }

    #[test]
    fn gc_deletes_only_acked_tombstones() {
        let conn = gc_test_db();
        // One paired peer, last synced 2026-03-01.
        add_marker(&conn, "2026-03-01 00:00:00", "self", "peerA");
        // Tombstone before the sync (acked) and after the sync (not yet acked).
        conn.execute(
            "INSERT INTO tombstones (table_name, deleted_at) VALUES ('sessions', '2026-02-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tombstones (table_name, deleted_at) VALUES ('sessions', '2026-04-01 00:00:00')",
            [],
        )
        .unwrap();

        let cutoff = compute_tombstone_gc_cutoff(&conn, &["peerA".to_string()], 90)
            .expect("cutoff")
            .expect("Some");
        let deleted = conn
            .execute(
                "DELETE FROM tombstones WHERE deleted_at < ?1",
                rusqlite::params![cutoff],
            )
            .unwrap();
        assert_eq!(deleted, 1, "only the acked (pre-sync) tombstone is removed");

        let remaining: String = conn
            .query_row("SELECT deleted_at FROM tombstones", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            remaining, "2026-04-01 00:00:00",
            "the un-acked (post-sync) tombstone must survive"
        );
    }

    #[test]
    fn merge_incoming_data_waits_for_merge_mutex() {
        let guard = MERGE_MUTEX.lock().expect("merge mutex lock");
        let (tx, rx) = std::sync::mpsc::channel();

        let handle = std::thread::spawn(move || {
            let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
            let result = merge_incoming_data(&mut conn, "{");
            tx.send(result).expect("send merge result");
        });

        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(50))
                .is_err(),
            "merge should not start parsing while another merge holds the mutex"
        );

        drop(guard);

        let result = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("merge finishes after mutex release");
        assert!(result
            .expect_err("invalid JSON should fail after mutex release")
            .contains("Failed to parse slave data"));
        handle.join().expect("merge thread joins");
    }

    #[test]
    fn verify_clears_merge_marker_only_when_parent_tombstoned() {
        // Regresja krytyczna ("projekty zmergowane przestaly byc zmergowane"):
        // podczas wielokrokowej konwergencji wiersz rodzica potrafi chwilowo nie
        // dotrzec przed dzieckiem. Stary kod bezwarunkowo zerowal merged_into gdy
        // rodzic byl NIEOBECNY -> ciche rozmergowanie. Teraz marker czyscimy TYLKO
        // gdy rodzic zostal naprawde USUNIETY (istnieje jego tombstone).
        let conn = open_test_db();
        // 1) Rodzic tylko nieobecny (brak tombstona) -> marker MUSI przezyc.
        conn.execute(
            "INSERT INTO projects (name, merged_into, merged_at, updated_at) \
             VALUES ('child-pending', 'not-yet-arrived', '2026-06-10 10:00:00', '2026-06-10 10:00:00')",
            [],
        )
        .unwrap();
        // 2) Rodzic istnieje -> marker przezywa.
        conn.execute(
            "INSERT INTO projects (name, updated_at) VALUES ('parent', '2026-06-10 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (name, merged_into, merged_at, updated_at) \
             VALUES ('child-valid', 'parent', '2026-06-10 10:00:00', '2026-06-10 10:00:00')",
            [],
        )
        .unwrap();
        // 3) Rodzic naprawde usuniety (tombstone) -> marker MUSI byc wyczyszczony.
        conn.execute(
            "INSERT INTO projects (name, merged_into, merged_at, updated_at) \
             VALUES ('child-orphaned', 'deleted-parent', '2026-06-10 10:00:00', '2026-06-10 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tombstones (table_name, sync_key, deleted_at) \
             VALUES ('projects', 'deleted-parent', '2026-06-11 10:00:00')",
            [],
        )
        .unwrap();

        verify_merge_integrity(&conn).unwrap();

        let pending: Option<String> = conn
            .query_row(
                "SELECT merged_into FROM projects WHERE name = 'child-pending'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            pending.as_deref(),
            Some("not-yet-arrived"),
            "marker rodzica jeszcze-nieobecnego (bez tombstona) musi przezyc verify"
        );

        let valid: Option<String> = conn
            .query_row(
                "SELECT merged_into FROM projects WHERE name = 'child-valid'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(valid.as_deref(), Some("parent"), "poprawne merged_into musi przetrwac");

        let orphaned: Option<String> = conn
            .query_row(
                "SELECT merged_into FROM projects WHERE name = 'child-orphaned'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            orphaned.is_none(),
            "marker rodzica z tombstonem (naprawde usuniety) musi byc wyczyszczony"
        );
    }

    #[test]
    fn merge_active_project_clears_conflicting_blacklist() {
        // Regresja: czarna lista nazw na jednej maszynie nie moze blokowac calego
        // merge sync, gdy peer ma projekt o tej nazwie AKTYWNY. Pokrywa oba warianty:
        // UPDATE (lokalny projekt byl wykluczony) i INSERT (projekt tylko na czarnej liscie).
        let mut conn = open_test_db();
        // Zainstaluj realna tabele + BEFORE-triggery, ktore bez Fix A przerywaja transakcje.
        conn.execute_batch(
            "CREATE TABLE project_name_blacklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TRIGGER trg_projects_blacklist_block_insert
            BEFORE INSERT ON projects FOR EACH ROW
            WHEN NEW.excluded_at IS NULL AND trim(NEW.name) <> ''
             AND EXISTS (SELECT 1 FROM project_name_blacklist b WHERE b.name_key = lower(trim(NEW.name)))
            BEGIN SELECT RAISE(ABORT, 'Project name is blacklisted'); END;
            CREATE TRIGGER trg_projects_blacklist_block_update
            BEFORE UPDATE OF name, excluded_at ON projects FOR EACH ROW
            WHEN NEW.excluded_at IS NULL AND trim(NEW.name) <> ''
             AND EXISTS (SELECT 1 FROM project_name_blacklist b WHERE b.name_key = lower(trim(NEW.name)))
            BEGIN SELECT RAISE(ABORT, 'Project name is blacklisted'); END;",
        )
        .unwrap();

        // Lokalnie: 'reused' zostal kiedys wykluczony → nazwa wpadla na czarna liste.
        // 'fresh' nie ma lokalnego projektu — tylko wpis na czarnej liscie.
        conn.execute(
            "INSERT INTO projects (name, excluded_at, updated_at) \
             VALUES ('reused', '2026-06-01 09:00:00', '2026-06-01 09:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_name_blacklist (name, name_key) VALUES ('reused', 'reused'), ('fresh', 'fresh')",
            [],
        )
        .unwrap();

        // Peer (autorytatywny): 'reused' znow AKTYWNY i nowszy, plus nowy aktywny 'fresh'.
        let payload = serde_json::json!({
            "data": {
                "projects": [
                    { "name": "reused", "color": "#38bdf8", "created_at": "2026-05-01 08:00:00", "excluded_at": null, "updated_at": "2026-06-18 12:00:00" },
                    { "name": "fresh",  "color": "#38bdf8", "created_at": "2026-06-18 11:00:00", "excluded_at": null, "updated_at": "2026-06-18 12:00:00" }
                ]
            }
        })
        .to_string();

        // Bez Fix A triggery zrobilyby RAISE(ABORT) → merge zwrocilby Err.
        merge_incoming_data(&mut conn, &payload)
            .expect("merge nie moze byc blokowany przez czarna liste nazw");

        let active: i64 = conn
            .query_row(
                "SELECT count(*) FROM projects WHERE name IN ('reused','fresh') AND excluded_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(active, 2, "oba projekty musza byc aktywne po merge (UPDATE + INSERT)");

        let remaining: i64 = conn
            .query_row(
                "SELECT count(*) FROM project_name_blacklist WHERE name_key IN ('reused','fresh')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0, "kolidujace wpisy czarnej listy musza zniknac");
    }

    // ── Diagnostic round-trip test ──
    // Simulates two daemons sharing data via the real sync funnel
    // (build_delta_for_pull → merge_incoming_data, both directions).
    // Run with:  cargo test --release roundtrip -- --ignored --nocapture
    fn open_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        // Merge wymaga foreign_keys=OFF (finding #5): sentinel project_id=0 w manual_sessions
        // i ręczne zarządzanie FK; z ON → CASCADE skasuje manual_sessions.
        conn.execute_batch("PRAGMA foreign_keys=OFF;").expect("fk off");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#38bdf8',
                hourly_rate REAL,
                created_at TEXT,
                excluded_at TEXT,
                assigned_folder_path TEXT,
                frozen_at TEXT,
                merged_into TEXT,
                merged_at TEXT,
                client_name TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                is_imported INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                contact TEXT,
                address TEXT,
                tax_id TEXT,
                currency TEXT,
                default_hourly_rate REAL,
                color TEXT NOT NULL DEFAULT '#38bdf8',
                archived_at TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executable_name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                project_id INTEGER,
                is_imported INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                split_source_session_id INTEGER,
                project_id INTEGER,
                project_name TEXT,
                comment TEXT,
                is_hidden INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
                UNIQUE(app_id, start_time)
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                session_type TEXT NOT NULL,
                project_id INTEGER NOT NULL,
                project_name TEXT,
                app_id INTEGER,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(project_id, start_time, title)
            );
            CREATE TABLE tombstones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                record_id INTEGER,
                record_uuid TEXT,
                deleted_at TEXT,
                sync_key TEXT
            );
            CREATE TABLE sync_markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marker_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                peer_id TEXT,
                tables_hash TEXT NOT NULL,
                full_sync INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE sync_merge_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                resolution TEXT NOT NULL DEFAULT 'last_writer_wins',
                local_updated_at TEXT,
                remote_updated_at TEXT,
                winner TEXT NOT NULL,
                details TEXT
            );
            CREATE TABLE system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[derive(Debug, PartialEq)]
    struct Counts {
        projects: i64,
        apps: i64,
        sessions: i64,
        manual: i64,
        tombstones: i64,
    }

    fn counts(conn: &rusqlite::Connection) -> Counts {
        let q = |sql: &str| -> i64 {
            conn.query_row(sql, [], |row| row.get(0)).unwrap_or(-1)
        };
        Counts {
            projects: q("SELECT COUNT(*) FROM projects"),
            apps: q("SELECT COUNT(*) FROM applications"),
            sessions: q("SELECT COUNT(*) FROM sessions"),
            manual: q("SELECT COUNT(*) FROM manual_sessions"),
            tombstones: q("SELECT COUNT(*) FROM tombstones"),
        }
    }

    fn query_snapshot_rows(conn: &rusqlite::Connection, sql: &str) -> Vec<String> {
        let mut stmt = conn.prepare(sql).expect("snapshot query");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("snapshot rows")
            .map(|row| row.expect("snapshot row"))
            .collect()
    }

    fn user_data_snapshot(conn: &rusqlite::Connection) -> Vec<String> {
        let mut rows = Vec::new();
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'P|' || name || '|' || COALESCE(color, '') || '|' || COALESCE(hourly_rate, '') || '|' || COALESCE(excluded_at, '') || '|' || COALESCE(frozen_at, '') || '|' || COALESCE(merged_into, '')
             FROM projects ORDER BY name",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'A|' || a.executable_name || '|' || COALESCE(a.display_name, '') || '|' || COALESCE(p.name, '')
             FROM applications a LEFT JOIN projects p ON p.id = a.project_id
             ORDER BY a.executable_name",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'S|' || a.executable_name || '|' || s.start_time || '|' || s.end_time || '|' || s.duration_seconds || '|' || s.date || '|' || COALESCE(s.rate_multiplier, 1.0) || '|' || COALESCE(p.name, s.project_name, '') || '|' || COALESCE(s.comment, '') || '|' || COALESCE(s.is_hidden, 0)
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = s.project_id
             ORDER BY a.executable_name, s.start_time",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'M|' || title || '|' || session_type || '|' || start_time || '|' || end_time || '|' || duration_seconds || '|' || date || '|' || COALESCE(p.name, manual_sessions.project_name, CAST(manual_sessions.project_id AS TEXT), '') || '|' || COALESCE(a.executable_name, '')
             FROM manual_sessions
             LEFT JOIN projects p ON p.id = manual_sessions.project_id
             LEFT JOIN applications a ON a.id = manual_sessions.app_id
             ORDER BY title, start_time",
        ));
        rows
    }

    /// Seed disjoint data so master + slave should reach a perfect union.
    /// Prefix is a single character so unique keys never collide across peers.
    fn seed(conn: &rusqlite::Connection, prefix: &str) {
        let ts = "2026-04-20 10:00:00";

        for i in 1..=3 {
            conn.execute(
                "INSERT INTO projects (name, color, updated_at) VALUES (?1, '#abcdef', ?2)",
                rusqlite::params![format!("{}-proj-{}", prefix, i), ts],
            )
            .unwrap();
        }

        for i in 1..=2 {
            conn.execute(
                "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
                 VALUES (?1, ?2, NULL, ?3)",
                rusqlite::params![
                    format!("{}-app-{}.exe", prefix, i),
                    format!("{} App {}", prefix, i),
                    ts
                ],
            )
            .unwrap();
        }

        let app_ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM applications").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        let project_ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM projects").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        for i in 1..=5 {
            let st = format!("2026-04-20 1{}:00:00 {}", i, prefix);
            conn.execute(
                "INSERT INTO sessions (app_id, project_id, start_time, end_time, duration_seconds, \
                 date, rate_multiplier, updated_at) VALUES (?1, ?2, ?3, ?4, 600, '2026-04-20', 1.0, ?5)",
                rusqlite::params![
                    app_ids[(i - 1) % app_ids.len()],
                    project_ids[(i - 1) % project_ids.len()],
                    st,
                    format!("2026-04-20 1{}:10:00 {}", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }

        for i in 1..=2 {
            let st = format!("2026-04-21 09:0{}:00 {}", i, prefix);
            conn.execute(
                "INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, \
                 end_time, duration_seconds, date, created_at, updated_at) \
                 VALUES (?1, 'work', ?2, ?3, ?4, ?5, 1800, '2026-04-21', ?6, ?6)",
                rusqlite::params![
                    format!("{}-manual-{}", prefix, i),
                    project_ids[0],
                    app_ids[0],
                    st,
                    format!("2026-04-21 09:30:00 {}", i),
                    ts,
                ],
            )
            .unwrap();
        }
    }

    #[derive(Clone, Copy)]
    enum SimulatorPullMode {
        Delta,
        Full,
    }

    struct LanSyncSimulator {
        master: rusqlite::Connection,
        slave: rusqlite::Connection,
    }

    impl LanSyncSimulator {
        fn new() -> Self {
            Self {
                master: open_test_db(),
                slave: open_test_db(),
            }
        }

        fn seeded() -> Self {
            let sim = Self::new();
            seed(&sim.master, "M");
            seed(&sim.slave, "S");
            sim
        }

        fn run_master_cycle(&mut self, mode: SimulatorPullMode, since: &str) -> Result<(), String> {
            let slave_export = match mode {
                SimulatorPullMode::Delta => build_delta_export(&self.slave, Some(since))?.0,
                SimulatorPullMode::Full => build_full_export(&self.slave)?,
            };

            merge_incoming_data(&mut self.master, &slave_export)?;

            // This mirrors the LAN orchestrator contract: negotiation decides how
            // much master pulls, but slave always receives the final merged state.
            let master_export = build_full_export(&self.master)?;
            merge_incoming_data(&mut self.slave, &master_export)
        }

        fn assert_converged(&self) {
            assert_eq!(user_data_snapshot(&self.master), user_data_snapshot(&self.slave));
        }
    }

    fn query_string(conn: &rusqlite::Connection, sql: &str) -> String {
        conn.query_row(sql, [], |row| row.get(0)).expect("query string")
    }

    #[test]
    fn lan_sync_simulator_delta_and_full_converge_disjoint_data() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::seeded();
            let m_pre = counts(&sim.master);
            let s_pre = counts(&sim.slave);

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            let final_counts = counts(&sim.master);
            assert_eq!(final_counts.projects, m_pre.projects + s_pre.projects);
            assert_eq!(final_counts.apps, m_pre.apps + s_pre.apps);
            assert_eq!(final_counts.sessions, m_pre.sessions + s_pre.sessions);
            assert_eq!(final_counts.manual, m_pre.manual + s_pre.manual);
        }
    }

    #[test]
    fn lan_sync_simulator_newer_update_wins_on_both_peers() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::new();

            sim.master
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('conflict.exe', 'Older Master Name', '2026-04-20 10:00:00')",
                    [],
                )
                .unwrap();
            sim.slave
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('conflict.exe', 'Newer Slave Name', '2026-04-20 11:00:00')",
                    [],
                )
                .unwrap();

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            for conn in [&sim.master, &sim.slave] {
                assert_eq!(
                    query_string(conn, "SELECT display_name FROM applications WHERE executable_name = 'conflict.exe'"),
                    "Newer Slave Name"
                );
            }
        }
    }

    #[test]
    fn merge_marker_survives_sync_and_old_peer_archive() {
        let mut conn = open_test_db();

        // 1) Local state: stage1 merged into final (marker + auto-exclude set).
        conn.execute(
            "INSERT INTO projects (name, color, updated_at) \
             VALUES ('final', '#111111', '2026-06-01 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (name, color, excluded_at, merged_into, merged_at, updated_at) \
             VALUES ('stage1', '#222222', '2026-06-01 10:00:00', 'final', '2026-06-01 10:00:00', '2026-06-01 10:00:00')",
            [],
        )
        .unwrap();

        // 2) NEW peer sends explicit nulls (unmerge) with newer updated_at => LWW clears the marker.
        let new_peer_archive = serde_json::json!({
            "data": {
                "projects": [{
                    "name": "stage1",
                    "color": "#222222",
                    "hourly_rate": null,
                    "created_at": "2026-06-01 09:00:00",
                    "excluded_at": null,
                    "frozen_at": null,
                    "merged_into": null,
                    "merged_at": null,
                    "updated_at": "2026-06-02 10:00:00"
                }]
            }
        });
        merge_incoming_data(&mut conn, &new_peer_archive.to_string()).expect("merge new peer");
        let (mi, ma): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT merged_into, merged_at FROM projects WHERE name = 'stage1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(mi, None, "explicit null from a new peer must clear the marker (LWW)");
        assert_eq!(ma, None, "explicit null from a new peer must clear merged_at (LWW)");

        // 3) Restore the marker locally, then merge an OLD-peer archive
        //    (merged_* keys ABSENT) with an even newer updated_at.
        conn.execute(
            "UPDATE projects SET merged_into = 'final', merged_at = '2026-06-03 10:00:00', \
             excluded_at = '2026-06-03 10:00:00', updated_at = '2026-06-03 10:00:00' \
             WHERE name = 'stage1'",
            [],
        )
        .unwrap();
        let old_peer_archive = serde_json::json!({
            "data": {
                "projects": [{
                    "name": "stage1",
                    "color": "#999999",
                    "hourly_rate": 42.0,
                    "created_at": "2026-06-01 09:00:00",
                    "excluded_at": "2026-06-04 10:00:00",
                    "frozen_at": null,
                    "updated_at": "2026-06-04 10:00:00"
                }]
            }
        });
        merge_incoming_data(&mut conn, &old_peer_archive.to_string()).expect("merge old peer");
        let (mi, ma, color, excluded, updated): (Option<String>, Option<String>, String, Option<String>, String) = conn
            .query_row(
                "SELECT merged_into, merged_at, color, excluded_at, updated_at FROM projects WHERE name = 'stage1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap();
        assert_eq!(mi.as_deref(), Some("final"), "absent key from an old peer must preserve the marker");
        assert_eq!(ma.as_deref(), Some("2026-06-03 10:00:00"), "absent key must preserve merged_at");
        assert_eq!(color, "#999999", "remote-wins fields must still be applied");
        assert_eq!(excluded.as_deref(), Some("2026-06-04 10:00:00"), "remote excluded_at must be applied");
        assert_eq!(updated, "2026-06-04 10:00:00", "remote updated_at must be applied");
    }

    #[test]
    fn merge_carries_client_name_and_status_via_export_roundtrip() {
        // Regresja krytyczna ("przypisanie klientow do projektow zniknelo"):
        // eksport/merge demona ignorowal kolumny m24 (client_name, status), wiec
        // przypisanie nie przezywalo sync (gubione na sciezce INSERT/konwergencji).
        let master = open_test_db();
        master
            .execute(
                "INSERT INTO projects (name, color, client_name, status, updated_at) \
                 VALUES ('11_26_Metro', '#111111', 'METRO', 'done', '2026-06-20 10:00:00')",
                [],
            )
            .unwrap();

        let export = build_full_export(&master).expect("export master");

        // INSERT path (projekt nowy na slave) — przypisanie musi dojechac.
        let mut slave = open_test_db();
        merge_incoming_data(&mut slave, &export).expect("merge into slave");
        let (client, status): (Option<String>, String) = slave
            .query_row(
                "SELECT client_name, status FROM projects WHERE name = '11_26_Metro'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("project present on slave");
        assert_eq!(client.as_deref(), Some("METRO"), "client_name musi przezyc sync (INSERT)");
        assert_eq!(status, "done", "status musi przezyc sync (INSERT)");

        // UPDATE path (projekt istnieje, lokalnie stary) — nowszy peer wygrywa.
        slave
            .execute(
                "UPDATE projects SET client_name = 'STARY', status = 'active', \
                 updated_at = '2026-06-19 10:00:00' WHERE name = '11_26_Metro'",
                [],
            )
            .unwrap();
        merge_incoming_data(&mut slave, &export).expect("re-merge into slave");
        let (client2, status2): (Option<String>, String) = slave
            .query_row(
                "SELECT client_name, status FROM projects WHERE name = '11_26_Metro'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(client2.as_deref(), Some("METRO"), "nowszy peer nadpisuje client_name (UPDATE)");
        assert_eq!(status2, "done", "nowszy peer nadpisuje status (UPDATE)");
    }

    #[test]
    fn merge_preserves_client_name_on_old_peer_absent_key() {
        // Stary peer (brak kluczy client_name/status) z nowszym updated_at NIE moze
        // wyzerowac lokalnego przypisania — absent key = zachowaj (jak merged_into).
        let mut conn = open_test_db();
        conn.execute(
            "INSERT INTO projects (name, color, client_name, status, updated_at) \
             VALUES ('P', '#111111', 'METRO', 'done', '2026-06-01 10:00:00')",
            [],
        )
        .unwrap();
        let old_peer = serde_json::json!({
            "data": { "projects": [{
                "name": "P", "color": "#999999", "hourly_rate": null,
                "created_at": "2026-06-01 09:00:00", "excluded_at": null, "frozen_at": null,
                "updated_at": "2026-06-05 10:00:00"
            }]}
        });
        merge_incoming_data(&mut conn, &old_peer.to_string()).expect("merge old peer");
        let (client, status, color): (Option<String>, String, String) = conn
            .query_row(
                "SELECT client_name, status, color FROM projects WHERE name = 'P'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(client.as_deref(), Some("METRO"), "brak klucza client_name = zachowaj lokalne");
        assert_eq!(status, "done", "brak klucza status = zachowaj lokalne");
        assert_eq!(color, "#999999", "pola remote-wins (color) i tak sie aplikuja");
    }

    #[test]
    fn merge_syncs_clients_entity_lww_and_tombstone() {
        let mut conn = open_test_db();
        // 1) Nowy klient z peera -> insert.
        let a = serde_json::json!({
            "data": { "clients": [{
                "name": "METRO", "color": "#ff0000", "contact": "ania@metro",
                "updated_at": "2026-06-10 10:00:00"
            }]}
        });
        merge_incoming_data(&mut conn, &a.to_string()).expect("merge new client");
        let (color, contact): (String, Option<String>) = conn
            .query_row(
                "SELECT color, contact FROM clients WHERE name = 'METRO'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("client inserted");
        assert_eq!(color, "#ff0000");
        assert_eq!(contact.as_deref(), Some("ania@metro"));

        // 2) Nowszy update wygrywa (LWW).
        let b = serde_json::json!({
            "data": { "clients": [{
                "name": "METRO", "color": "#00ff00", "updated_at": "2026-06-12 10:00:00"
            }]}
        });
        merge_incoming_data(&mut conn, &b.to_string()).expect("merge client update");
        let color2: String = conn
            .query_row("SELECT color FROM clients WHERE name = 'METRO'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(color2, "#00ff00", "nowszy updated_at wygrywa (LWW)");

        // 3) Tombstone klienta usuwa wpis i odpina projekty.
        conn.execute(
            "INSERT INTO projects (name, client_name, updated_at) \
             VALUES ('proj', 'METRO', '2026-06-12 10:00:00')",
            [],
        )
        .unwrap();
        let c = serde_json::json!({
            "data": { "tombstones": [{
                "table_name": "clients", "sync_key": "METRO", "deleted_at": "2026-06-13 10:00:00"
            }]}
        });
        merge_incoming_data(&mut conn, &c.to_string()).expect("merge client tombstone");
        let gone: i64 = conn
            .query_row("SELECT count(*) FROM clients WHERE name = 'METRO'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(gone, 0, "tombstone klienta usuwa wpis");
        let detached: Option<String> = conn
            .query_row("SELECT client_name FROM projects WHERE name = 'proj'", [], |r| r.get(0))
            .unwrap();
        assert!(detached.is_none(), "usuniety klient odpina sie od projektu");
    }

    #[test]
    fn checksum_detects_client_name_divergence() {
        // Dwa peery identyczne poza client_name MUSZA sie roznic w checksumie,
        // inaczej protokol uzna je za zsynchronizowane na zawsze (cichy rozjazd).
        let a = open_test_db();
        let b = open_test_db();
        for c in [&a, &b] {
            c.execute(
                "INSERT INTO projects (name, color, status, updated_at) \
                 VALUES ('P', '#111111', 'active', '2026-06-01 10:00:00')",
                [],
            )
            .unwrap();
        }
        a.execute("UPDATE projects SET client_name = 'METRO' WHERE name = 'P'", [])
            .unwrap();
        let ha = crate::lan_common::compute_table_hash(&a, "projects");
        let hb = crate::lan_common::compute_table_hash(&b, "projects");
        assert_ne!(ha, hb, "rozjazd client_name musi byc widoczny w checksumie");
    }

    #[test]
    fn lan_sync_simulator_master_delete_wins_over_stale_slave_row() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::new();

            sim.slave
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('deleted-on-master.exe', 'Deleted On Master', '2026-04-19 08:00:00')",
                    [],
                )
                .unwrap();
            sim.master
                .execute(
                    "INSERT INTO tombstones (table_name, sync_key, deleted_at)
                     VALUES ('applications', 'deleted-on-master.exe', '2026-04-22 12:00:00')",
                    [],
                )
                .unwrap();

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            for conn in [&sim.master, &sim.slave] {
                assert!(
                    conn.query_row(
                        "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                        [],
                        |_| Ok(()),
                    )
                    .is_err(),
                    "stale row must stay deleted after convergence"
                );
            }
        }
    }

    #[test]
    fn full_master_snapshot_converges_and_keeps_local_deletes() {
        use crate::lan_server::build_full_snapshot_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed(&master, "M");
        seed(&slave, "S");

        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at)
                 VALUES ('deleted-on-master.exe', 'Deleted On Master', '2026-04-19 08:00:00')",
                [],
            )
            .unwrap();
        let deleted_app_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        slave
            .execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at)
                 VALUES (?1, '2026-04-19 08:00:00', '2026-04-19 08:10:00', 600, '2026-04-19', 1.0, '2026-04-19 08:00:00')",
                [deleted_app_id],
            )
            .unwrap();

        master
            .execute(
                "INSERT INTO tombstones (table_name, sync_key, deleted_at)
                 VALUES ('applications', 'deleted-on-master.exe', '2026-04-22 12:00:00')",
                [],
            )
            .unwrap();

        let slave_export = build_full_snapshot_public(&slave).expect("slave full snapshot");
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");

        assert!(
            master
                .query_row(
                    "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                    [],
                    |_| Ok(()),
                )
                .is_err(),
            "master must not resurrect a row covered by a newer local tombstone"
        );

        let master_export = build_full_snapshot_public(&master).expect("master final snapshot");
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        assert_eq!(user_data_snapshot(&master), user_data_snapshot(&slave));
        assert!(
            slave
                .query_row(
                    "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                    [],
                    |_| Ok(()),
                )
                .is_err(),
            "slave must receive master's deletion in the final convergence snapshot"
        );
    }

    /// Both peers share the same application name (e.g. Chrome on both
    /// machines) but with DIFFERENT local IDs — typical real-world state.
    /// Merge resolves by `executable_name`, but each side has its own
    /// sessions tied to the local app row. The roundtrip must preserve
    /// all sessions from both sides.
    fn seed_with_shared_app(conn: &rusqlite::Connection, prefix: &str) {
        let ts = "2026-04-20 10:00:00";

        for i in 1..=2 {
            conn.execute(
                "INSERT INTO projects (name, color, updated_at) VALUES (?1, '#abcdef', ?2)",
                rusqlite::params![format!("{}-proj-{}", prefix, i), ts],
            )
            .unwrap();
        }

        // Shared app: both sides have "chrome.exe" but with their own local id.
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
             VALUES ('chrome.exe', 'Chrome', NULL, ?1)",
            rusqlite::params![ts],
        )
        .unwrap();
        // Side-specific app
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
             VALUES (?1, ?2, NULL, ?3)",
            rusqlite::params![
                format!("{}-only.exe", prefix),
                format!("{} Only", prefix),
                ts
            ],
        )
        .unwrap();

        let chrome_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let only_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name LIKE ?1",
                [format!("{}-only.exe", prefix)],
                |row| row.get(0),
            )
            .unwrap();

        // 5 sessions on shared chrome.exe with start_times that differ by side
        for i in 1..=5 {
            conn.execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                 rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2026-04-20', 1.0, ?4)",
                rusqlite::params![
                    chrome_id,
                    format!("2026-04-20 1{}:00:00 {}", i, prefix),
                    format!("2026-04-20 1{}:10:00 {}", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }
        // 3 sessions on side-only app
        for i in 1..=3 {
            conn.execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                 rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 300, '2026-04-20', 1.0, ?4)",
                rusqlite::params![
                    only_id,
                    format!("2026-04-20 1{}:30:00 {}only", i, prefix),
                    format!("2026-04-20 1{}:35:00 {}only", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }
    }

    #[test]
    #[ignore]
    fn diagnostic_sync_roundtrip_with_shared_app() {
        use crate::lan_server::build_delta_for_pull_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed_with_shared_app(&master, "M");
        seed_with_shared_app(&slave, "S");

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}", m_pre);
        eprintln!("PRE  slave : {:?}", s_pre);

        let slave_export = build_delta_for_pull_public(&slave, "1970-01-01 00:00:00")
            .expect("slave export");
        merge_incoming_data(&mut master, &slave_export).expect("master merge");

        let master_export = build_delta_for_pull_public(&master, "1970-01-01 00:00:00")
            .expect("master export");
        merge_incoming_data(&mut slave, &master_export).expect("slave merge");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        // Expected: 4 projects (M-proj-1, M-proj-2, S-proj-1, S-proj-2)
        // 3 apps   (chrome.exe shared, M-only.exe, S-only.exe)
        // 16 sessions (5 chrome + 3 only on each side; start_times differ → no collision)
        let total_proj = 4;
        let total_apps = 3;
        let total_sess = 16;
        eprintln!("EXPECTED both sides: projects={} apps={} sessions={}", total_proj, total_apps, total_sess);

        assert_eq!(m_post.projects, total_proj, "MASTER projects: {} (expected {})", m_post.projects, total_proj);
        assert_eq!(s_post.projects, total_proj, "SLAVE  projects: {} (expected {})", s_post.projects, total_proj);
        assert_eq!(m_post.apps, total_apps, "MASTER apps: {} (expected {})", m_post.apps, total_apps);
        assert_eq!(s_post.apps, total_apps, "SLAVE  apps: {} (expected {})", s_post.apps, total_apps);
        assert_eq!(m_post.sessions, total_sess, "MASTER sessions: {} (expected {})", m_post.sessions, total_sess);
        assert_eq!(s_post.sessions, total_sess, "SLAVE  sessions: {} (expected {})", s_post.sessions, total_sess);
    }

    #[test]
    #[ignore]
    fn diagnostic_sync_roundtrip_does_not_lose_records() {
        use crate::lan_server::build_delta_for_pull_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed(&master, "M");
        seed(&slave, "S");

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}", m_pre);
        eprintln!("PRE  slave : {:?}", s_pre);

        // Step 6 in protocol: master pulls slave (slave exports its own data).
        let slave_export = build_delta_for_pull_public(&slave, "1970-01-01 00:00:00")
            .expect("slave export");
        // Step 9: master merges slave's data.
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");

        let m_after_pull = counts(&master);
        eprintln!("MID  master: {:?}  (after merging slave)", m_after_pull);

        // Step 11: master builds merged export and uploads to slave.
        let master_export = build_delta_for_pull_public(&master, "1970-01-01 00:00:00")
            .expect("master export");
        // Step 12 (slave side): slave merges merged data from master.
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        let total_proj = m_pre.projects + s_pre.projects;
        let total_apps = m_pre.apps + s_pre.apps;
        let total_sess = m_pre.sessions + s_pre.sessions;
        let total_man = m_pre.manual + s_pre.manual;
        eprintln!(
            "EXPECTED both sides: projects={} apps={} sessions={} manual={}",
            total_proj, total_apps, total_sess, total_man
        );

        assert_eq!(m_post.projects, total_proj, "MASTER projects: {} (expected {})", m_post.projects, total_proj);
        assert_eq!(s_post.projects, total_proj, "SLAVE  projects: {} (expected {})", s_post.projects, total_proj);
        assert_eq!(m_post.apps, total_apps, "MASTER apps: {} (expected {})", m_post.apps, total_apps);
        assert_eq!(s_post.apps, total_apps, "SLAVE  apps: {} (expected {})", s_post.apps, total_apps);
        assert_eq!(m_post.sessions, total_sess, "MASTER sessions: {} (expected {})", m_post.sessions, total_sess);
        assert_eq!(s_post.sessions, total_sess, "SLAVE  sessions: {} (expected {})", s_post.sessions, total_sess);
        assert_eq!(m_post.manual, total_man, "MASTER manual: {} (expected {})", m_post.manual, total_man);
        assert_eq!(s_post.manual, total_man, "SLAVE  manual: {} (expected {})", s_post.manual, total_man);
    }

    /// Full/convergence sync must propagate deletions. If master has a newer
    /// tombstone for a sync_key and slave still has an older live row, the
    /// deletion wins and both sides converge to the deleted state.
    #[test]
    #[ignore]
    fn diagnostic_full_sync_does_not_lose_records_when_tombstones_present() {
        use crate::lan_server::build_full_snapshot_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        // Master: chrome.exe (active) + 5 sessions, plus a historical tombstone
        // for "old-app.exe" that never existed on slave.
        master
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('chrome.exe', 'Chrome', '2024-01-01 00:00:00')",
                [],
            )
            .unwrap();
        let m_chrome_id: i64 = master
            .query_row(
                "SELECT id FROM applications WHERE executable_name='chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for i in 1..=5 {
            master
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2024-01-01', 1.0, '2024-01-01 00:00:00')",
                    rusqlite::params![
                        m_chrome_id,
                        format!("2024-01-01 0{}:00:00 M", i),
                        format!("2024-01-01 0{}:10:00 M", i),
                    ],
                )
                .unwrap();
        }
        master
            .execute(
                "INSERT INTO tombstones (table_name, sync_key, deleted_at) \
                 VALUES ('applications', 'old-app.exe', '2025-06-01 00:00:00')",
                [],
            )
            .unwrap();

        // Slave: has BOTH chrome.exe AND old-app.exe locally, plus its own sessions.
        // chrome.exe.updated_at is older than master's record (no tombstone, just
        // older). old-app.exe is OLDER than master's tombstone — pre-fix this
        // means master's tombstone wins and slave loses old-app.exe + sessions.
        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('chrome.exe', 'Chrome', '2023-01-01 00:00:00')",
                [],
            )
            .unwrap();
        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('old-app.exe', 'Old App', '2023-01-01 00:00:00')",
                [],
            )
            .unwrap();
        let s_chrome_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name='chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let s_old_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name='old-app.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for i in 1..=5 {
            slave
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2023-01-01', 1.0, '2023-01-01 00:00:00')",
                    rusqlite::params![
                        s_chrome_id,
                        format!("2023-01-01 0{}:00:00 S", i),
                        format!("2023-01-01 0{}:10:00 S", i),
                    ],
                )
                .unwrap();
        }
        for i in 1..=3 {
            slave
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2023-02-01', 1.0, '2023-02-01 00:00:00')",
                    rusqlite::params![
                        s_old_id,
                        format!("2023-02-01 0{}:00:00 S", i),
                        format!("2023-02-01 0{}:10:00 S", i),
                    ],
                )
                .unwrap();
        }

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}  (1 active app, 5 sessions, 1 tombstone for old-app.exe)", m_pre);
        eprintln!("PRE  slave : {:?}  (2 apps incl. old-app.exe, 8 sessions)", s_pre);

        // Master flow (full): pulls slave's full snapshot, merges, then exports
        // its final convergence snapshot to slave.
        let slave_export = build_full_snapshot_public(&slave).expect("slave full snapshot");
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");
        let master_export = build_full_snapshot_public(&master).expect("master full snapshot");
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        // Both sides should converge to chrome.exe only. old-app.exe is older
        // than master's tombstone, so the delete propagates and its 3 sessions
        // disappear on both sides.
        assert_eq!(m_post.apps, 1, "MASTER should keep only chrome.exe");
        assert_eq!(s_post.apps, 1, "SLAVE should keep only chrome.exe");
        assert_eq!(m_post.sessions, 10, "MASTER sessions {} (expected 10)", m_post.sessions);
        assert_eq!(s_post.sessions, 10, "SLAVE  sessions {} (expected 10)", s_post.sessions);
    }

    #[test]
    fn application_tombstone_spares_app_with_fresh_sessions() {
        let mut conn = open_test_db();

        // Application with a stale updated_at (never modified)...
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, updated_at)
             VALUES ('revived.exe', 'Revived', '2025-01-01 00:00:00')",
            [],
        )
        .unwrap();
        let app_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'revived.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // ...but with a FRESH session (newer than the peer's tombstone):
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at)
             VALUES (?1, '2026-06-01 10:00:00', '2026-06-01 11:00:00', 3600, '2026-06-01', 1.0, '2026-06-01 11:00:00')",
            [app_id],
        )
        .unwrap();

        // Peer sends an old application tombstone (deleted long ago,
        // replayed via full sync):
        let payload = serde_json::json!({
            "data": {
                "tombstones": [{
                    "table_name": "applications",
                    "sync_key": "revived.exe",
                    "record_id": 99,
                    "deleted_at": "2026-01-15 12:00:00"
                }]
            }
        })
        .to_string();

        merge_incoming_data(&mut conn, &payload).expect("merge");

        let app_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM applications WHERE executable_name = 'revived.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE app_id = ?1", [app_id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(app_count, 1, "app with fresh sessions must not be deleted by a stale tombstone");
        assert_eq!(session_count, 1, "tombstone cascade must not delete fresh sessions");
    }

    /// Production DBs have AFTER DELETE tombstone triggers (the unit-test
    /// schema does not). Applying a peer tombstone must not MINT fresh
    /// tombstones via those triggers — that re-amplifies deletions across
    /// devices with deleted_at=now, defeating the updated_at guards.
    #[test]
    fn applying_tombstones_does_not_mint_fresh_tombstones() {
        let mut conn = open_test_db();
        // Install the production triggers on the test schema:
        conn.execute(crate::tombstone_triggers::SESSIONS_TOMBSTONE_TRIGGER_SQL, []).unwrap();
        conn.execute(crate::tombstone_triggers::APPLICATIONS_TOMBSTONE_TRIGGER_SQL, []).unwrap();
        conn.execute(crate::tombstone_triggers::PROJECTS_TOMBSTONE_TRIGGER_SQL, []).unwrap();
        conn.execute(crate::tombstone_triggers::MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL, []).unwrap();

        // Fully stale app with two stale sessions — peer tombstone will
        // legitimately delete them all:
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, updated_at)
             VALUES ('stale.exe', 'Stale', '2025-01-01 00:00:00')",
            [],
        )
        .unwrap();
        let app_id: i64 = conn
            .query_row("SELECT id FROM applications WHERE executable_name = 'stale.exe'", [], |row| row.get(0))
            .unwrap();
        for (s, e) in [("2025-01-01 10:00:00", "2025-01-01 11:00:00"), ("2025-01-02 10:00:00", "2025-01-02 11:00:00")] {
            conn.execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at)
                 VALUES (?1, ?2, ?3, 3600, '2025-01-01', 1.0, '2025-01-01 11:00:00')",
                rusqlite::params![app_id, s, e],
            )
            .unwrap();
        }

        let payload = serde_json::json!({
            "data": {
                "tombstones": [{
                    "table_name": "applications",
                    "sync_key": "stale.exe",
                    "record_id": 99,
                    "deleted_at": "2026-01-15 12:00:00"
                }]
            }
        })
        .to_string();

        merge_incoming_data(&mut conn, &payload).expect("merge");

        // App + sessions deleted (legitimate)...
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions WHERE app_id = ?1", [app_id], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 0, "stale sessions are deleted by the cascade");
        // ...but the ONLY tombstone present is the peer's original one:
        let total_tombstones: i64 = conn
            .query_row("SELECT COUNT(*) FROM tombstones", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            total_tombstones, 1,
            "merge must not mint fresh tombstones via triggers (found trigger-minted extras)"
        );
        let kept_deleted_at: String = conn
            .query_row("SELECT deleted_at FROM tombstones", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kept_deleted_at, "2026-01-15 12:00:00", "the recorded tombstone keeps the peer's original deleted_at");
        // Triggers must be restored after merge:
        let trigger_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN (
                    'trg_sessions_tombstone','trg_applications_tombstone',
                    'trg_projects_tombstone','trg_manual_sessions_tombstone')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(trigger_count, 4, "tombstone triggers must be restored after merge");
    }

    /// verify_merge_integrity deletes FK-orphaned sessions as post-merge
    /// housekeeping — with triggers present that DELETE would mint legacy
    /// numeric-sync_key tombstones replaying against unrelated app_ids on
    /// peers. The schema here declares the FK so PRAGMA foreign_key_check
    /// reports the orphan (open_test_db has no FK clauses).
    #[test]
    fn orphan_cleanup_in_verify_does_not_mint_tombstones() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL UNIQUE,
                 merged_into TEXT,
                 merged_at TEXT
             );
             CREATE TABLE applications (
                 id INTEGER PRIMARY KEY,
                 executable_name TEXT NOT NULL UNIQUE,
                 project_id INTEGER,
                 updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
             );
             CREATE TABLE sessions (
                 id INTEGER PRIMARY KEY,
                 app_id INTEGER NOT NULL REFERENCES applications(id),
                 start_time TEXT NOT NULL,
                 end_time TEXT NOT NULL,
                 duration_seconds INTEGER NOT NULL,
                 date TEXT NOT NULL,
                 project_id INTEGER,
                 project_name TEXT,
                 updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
             );
             CREATE TABLE manual_sessions (
                 id INTEGER PRIMARY KEY,
                 project_id INTEGER NOT NULL DEFAULT 0,
                 start_time TEXT,
                 title TEXT
             );
             CREATE TABLE clients (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL UNIQUE,
                 updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
             );
             CREATE TABLE tombstones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 table_name TEXT NOT NULL,
                 record_id INTEGER,
                 deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 sync_key TEXT
             );",
        )
        .expect("schema");
        for sql in crate::tombstone_triggers::CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
            conn.execute(sql, []).expect("trigger");
        }
        // Orphan session: app_id 999 has no applications row. Disable FK
        // enforcement so the insert succeeds while foreign_key_check still
        // reports the violation (mirrors how orphans arise in production):
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (999, '2026-06-01 10:00:00', '2026-06-01 11:00:00', 3600, '2026-06-01')",
            [],
        )
        .unwrap();

        verify_merge_integrity(&conn).expect("verify");

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 0, "orphaned session is cleaned up");
        let tombstone_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tombstones", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            tombstone_count, 0,
            "orphan cleanup is housekeeping — it must not mint tombstones"
        );
        let trigger_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN (
                    'trg_sessions_tombstone','trg_applications_tombstone',
                    'trg_projects_tombstone','trg_manual_sessions_tombstone')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(trigger_count, 4, "tombstone triggers must be restored after cleanup");
    }

    #[test]
    fn application_tombstone_still_deletes_fully_stale_app() {
        let mut conn = open_test_db();

        conn.execute(
            "INSERT INTO applications (executable_name, display_name, updated_at)
             VALUES ('stale.exe', 'Stale', '2025-01-01 00:00:00')",
            [],
        )
        .unwrap();
        let app_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'stale.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // Session OLDER than the tombstone — deletion is legitimate:
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at)
             VALUES (?1, '2025-01-01 10:00:00', '2025-01-01 11:00:00', 3600, '2025-01-01', 1.0, '2025-01-01 11:00:00')",
            [app_id],
        )
        .unwrap();

        let payload = serde_json::json!({
            "data": {
                "tombstones": [{
                    "table_name": "applications",
                    "sync_key": "stale.exe",
                    "record_id": 99,
                    "deleted_at": "2026-01-15 12:00:00"
                }]
            }
        })
        .to_string();

        merge_incoming_data(&mut conn, &payload).expect("merge");

        let app_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM applications WHERE executable_name = 'stale.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(app_count, 0, "fully stale app is still deleted by the tombstone");
    }

    #[test]
    fn merge_keeps_unassigned_manual_session_sentinel_zero() {
        // Regresja: peer z nieprzypisaną sesją manualną (sentinel project_id = 0).
        // manual_sessions.project_id jest NOT NULL — nierozwiązany id MUSI zmapować
        // się na 0, nie NULL, inaczej cały merge pada (NOT NULL constraint) i robi restore.
        let mut master = open_test_db();
        let slave = open_test_db();
        slave
            .execute(
                "INSERT INTO manual_sessions \
                 (title, session_type, project_id, start_time, end_time, duration_seconds, date, created_at, updated_at) \
                 VALUES ('Unassigned task', 'work', 0, '2026-04-21 09:00:00', '2026-04-21 09:30:00', 1800, '2026-04-21', '2026-04-21 09:00:00', '2026-04-21 09:00:00')",
                [],
            )
            .unwrap();

        let export = build_full_export(&slave).expect("export slave");
        merge_incoming_data(&mut master, &export)
            .expect("merge nie może paść na nieprzypisanej sesji manualnej");

        let pid: i64 = master
            .query_row(
                "SELECT project_id FROM manual_sessions WHERE title = 'Unassigned task'",
                [],
                |r| r.get(0),
            )
            .expect("sesja manualna obecna na masterze");
        assert_eq!(pid, 0, "nieprzypisana sesja manualna zachowuje sentinel 0");
    }

    #[test]
    fn merge_normalizes_tombstone_deleted_at() {
        let mut conn = open_test_db();
        let archive = serde_json::json!({
            "data": {
                "tombstones": [
                    { "table_name": "sessions",
                      "sync_key": "x.exe|2026-04-20 10:00:00",
                      "deleted_at": "2026-04-20T10:00:00+02:00" }
                ]
            }
        })
        .to_string();
        merge_incoming_data(&mut conn, &archive).expect("merge");
        let stored: String = conn
            .query_row(
                "SELECT deleted_at FROM tombstones WHERE table_name = 'sessions'",
                [],
                |r| r.get(0),
            )
            .expect("tombstone zapisany");
        assert_eq!(stored, "2026-04-20 08:00:00", "RFC3339 +02:00 → kanoniczny UTC");
    }

    // ── Testy charakteryzacyjne: merge per encja (pre-ekstrakcja) ──
    //
    // Celem jest utrwalenie AKTUALNEGO zachowania merge_incoming_data dla każdego
    // typu encji, zanim zostanie wydzielona do wspólnego kratka. Testy muszą
    // przechodzić ZAWSZE przeciwko bieżącemu kodowi produkcyjnemu.
    // Każde odstępstwo od oczekiwań jest opisane komentarzem // CHARACTERIZATION:.

    #[test]
    fn merge_roundtrip_applications_lww() {
        // Tworzy master z aplikacją foo.exe, eksportuje, scala do świeżego slave.
        // Następnie testuje ścieżkę LWW (Last-Writer-Wins) dla display_name.

        let t1 = "2026-06-20 10:00:00";

        let master = open_test_db();
        master
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('foo.exe', 'Foo', ?1)",
                rusqlite::params![t1],
            )
            .unwrap();

        let export = build_full_export(&master).expect("export master");

        // ── INSERT path: aplikacja nowa na slave ──
        let mut slave = open_test_db();
        merge_incoming_data(&mut slave, &export).expect("merge into slave");

        let display_name: String = slave
            .query_row(
                "SELECT display_name FROM applications WHERE executable_name = 'foo.exe'",
                [],
                |r| r.get(0),
            )
            .expect("aplikacja powinna byc obecna na slave");
        assert_eq!(display_name, "Foo", "display_name musi dojechac przez INSERT path");

        // ── UPDATE/LWW path: lokalny rekord starszy niz remote → remote wygrywa ──
        // Ustaw lokalny updated_at wcześniejszy niż T1 (master).
        slave
            .execute(
                "UPDATE applications SET display_name = 'OldFoo', updated_at = '2026-06-19 10:00:00' \
                 WHERE executable_name = 'foo.exe'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge into slave");

        let display_name2: String = slave
            .query_row(
                "SELECT display_name FROM applications WHERE executable_name = 'foo.exe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: gdy remote.updated_at > local.updated_at, UPDATE applications
        // SET display_name = remote.display_name (linia ~894 sync_common.rs). Nowszy peer wygrywa.
        assert_eq!(
            display_name2, "Foo",
            "LWW: nowszy peer (master) nadpisuje display_name starszego slave"
        );

        // ── Reverse LWW: lokalny rekord NOWSZY niż remote → local wygrywa ──
        slave
            .execute(
                "UPDATE applications SET display_name = 'LocalNewer', updated_at = '2026-06-21 10:00:00' \
                 WHERE executable_name = 'foo.exe'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge reverse");

        let display_name3: String = slave
            .query_row(
                "SELECT display_name FROM applications WHERE executable_name = 'foo.exe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: gdy local.updated_at > remote.updated_at, merge POMIJA UPDATE
        // (branch Some(_) z warunkiem `normalize_ts(updated_at) > normalize_ts(local)`).
        // Lokalny rekord nowszy wygrywa — nie jest nadpisany.
        assert_eq!(
            display_name3, "LocalNewer",
            "LWW: lokalny rekord nowszy niz remote nie jest nadpisywany"
        );
    }

    #[test]
    fn merge_roundtrip_sessions_lww() {
        // Tworzy master z aplikacją i sesją, eksportuje, scala do świeżego slave.
        // Testuje INSERT path (komentarz musi dojechac) i UPDATE/LWW (comment).

        let t1 = "2026-06-20 10:00:00";

        let master = open_test_db();
        master
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('bar.exe', 'Bar', ?1)",
                rusqlite::params![t1],
            )
            .unwrap();
        let app_id: i64 = master
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'bar.exe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        master
            .execute(
                "INSERT INTO sessions \
                 (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, comment, updated_at) \
                 VALUES (?1, '2026-06-20 09:00:00', '2026-06-20 09:30:00', 1800, '2026-06-20', 1.0, 'hello', ?2)",
                rusqlite::params![app_id, t1],
            )
            .unwrap();

        let export = build_full_export(&master).expect("export master");

        // ── INSERT path: sesja nowa na slave ──
        let mut slave = open_test_db();
        merge_incoming_data(&mut slave, &export).expect("merge into slave");

        // Na slave aplikacja musi być wstawiona (przez merge apps), potem sesja.
        let comment: Option<String> = slave
            .query_row(
                "SELECT s.comment FROM sessions s \
                 JOIN applications a ON a.id = s.app_id \
                 WHERE a.executable_name = 'bar.exe' AND s.start_time = '2026-06-20 09:00:00'",
                [],
                |r| r.get(0),
            )
            .expect("sesja powinna byc obecna na slave");
        // CHARACTERIZATION: comment musi dojechać przez INSERT path.
        assert_eq!(comment.as_deref(), Some("hello"), "comment sesji musi dojechac przez INSERT path");

        // ── UPDATE/LWW: lokalny rekord STARSZY niz remote → remote wygrywa ──
        slave
            .execute(
                "UPDATE sessions SET comment = 'old-comment', updated_at = '2026-06-19 10:00:00' \
                 WHERE start_time = '2026-06-20 09:00:00'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge into slave");

        let comment2: Option<String> = slave
            .query_row(
                "SELECT s.comment FROM sessions s \
                 JOIN applications a ON a.id = s.app_id \
                 WHERE a.executable_name = 'bar.exe' AND s.start_time = '2026-06-20 09:00:00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: UPDATE sessions SET comment = remote.comment gdy remote > local.
        assert_eq!(
            comment2.as_deref(),
            Some("hello"),
            "LWW: nowszy peer (master) nadpisuje comment starszego slave"
        );

        // ── Reverse LWW: lokalny NOWSZY niz remote → local wygrywa ──
        slave
            .execute(
                "UPDATE sessions SET comment = 'local-fresh', updated_at = '2026-06-21 10:00:00' \
                 WHERE start_time = '2026-06-20 09:00:00'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge reverse");

        let comment3: Option<String> = slave
            .query_row(
                "SELECT s.comment FROM sessions s \
                 JOIN applications a ON a.id = s.app_id \
                 WHERE a.executable_name = 'bar.exe' AND s.start_time = '2026-06-20 09:00:00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: gdy local.updated_at > remote.updated_at, merge POMIJA UPDATE sesji.
        assert_eq!(
            comment3.as_deref(),
            Some("local-fresh"),
            "LWW: lokalny rekord sesji nowszy niz remote nie jest nadpisywany"
        );
    }

    #[test]
    fn merge_roundtrip_manual_sessions_lww() {
        // Tworzy master z projektem i sesją manualną, eksportuje do slave.
        // Testuje INSERT path (duration_seconds musi dojechac) i UPDATE/LWW.

        let t1 = "2026-06-20 10:00:00";

        let master = open_test_db();
        master
            .execute(
                "INSERT INTO projects (name, color, updated_at) VALUES ('TestProject', '#aabbcc', ?1)",
                rusqlite::params![t1],
            )
            .unwrap();
        let proj_id: i64 = master
            .query_row(
                "SELECT id FROM projects WHERE name = 'TestProject'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        master
            .execute(
                "INSERT INTO manual_sessions \
                 (title, session_type, project_id, start_time, end_time, duration_seconds, date, created_at, updated_at) \
                 VALUES ('MyTask', 'work', ?1, '2026-06-20 08:00:00', '2026-06-20 09:00:00', 3600, '2026-06-20', ?2, ?2)",
                rusqlite::params![proj_id, t1],
            )
            .unwrap();

        let export = build_full_export(&master).expect("export master");

        // ── INSERT path: sesja manualna nowa na slave ──
        let mut slave = open_test_db();
        merge_incoming_data(&mut slave, &export).expect("merge into slave");

        let duration: i64 = slave
            .query_row(
                "SELECT duration_seconds FROM manual_sessions WHERE title = 'MyTask' AND start_time = '2026-06-20 08:00:00'",
                [],
                |r| r.get(0),
            )
            .expect("sesja manualna powinna byc obecna na slave");
        // CHARACTERIZATION: duration_seconds (i cały rekord) musi dojechać przez INSERT path.
        assert_eq!(duration, 3600, "duration_seconds sesji manualnej musi dojechac przez INSERT path");

        // Weryfikacja project_id: projekt 'TestProject' jest na masterze i eksportowany,
        // merge slave musi wstawić projekt (przez merge projects) i rozwiązać ID.
        // CHARACTERIZATION: project_id na slave jest > 0 (projekt był eksportowany i wstawiony).
        let slave_pid: i64 = slave
            .query_row(
                "SELECT project_id FROM manual_sessions WHERE title = 'MyTask'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(slave_pid > 0, "project_id sesji manualnej musi byc rozwiazany na slave (projekt przyszedl w eksporcie)");

        // ── UPDATE/LWW: lokalny rekord STARSZY niz remote → remote wygrywa ──
        slave
            .execute(
                "UPDATE manual_sessions SET duration_seconds = 999, end_time = '2026-06-20 08:16:39', \
                 updated_at = '2026-06-19 10:00:00' \
                 WHERE title = 'MyTask' AND start_time = '2026-06-20 08:00:00'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge into slave");

        let duration2: i64 = slave
            .query_row(
                "SELECT duration_seconds FROM manual_sessions WHERE title = 'MyTask' AND start_time = '2026-06-20 08:00:00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: UPDATE manual_sessions SET duration_seconds = remote gdy remote > local.
        assert_eq!(
            duration2, 3600,
            "LWW: nowszy peer (master) nadpisuje duration_seconds starszego slave"
        );

        // ── Reverse LWW: lokalny NOWSZY niz remote → local wygrywa ──
        slave
            .execute(
                "UPDATE manual_sessions SET duration_seconds = 7200, end_time = '2026-06-20 10:00:00', \
                 updated_at = '2026-06-21 10:00:00' \
                 WHERE title = 'MyTask' AND start_time = '2026-06-20 08:00:00'",
                [],
            )
            .unwrap();

        merge_incoming_data(&mut slave, &export).expect("re-merge reverse");

        let duration3: i64 = slave
            .query_row(
                "SELECT duration_seconds FROM manual_sessions WHERE title = 'MyTask' AND start_time = '2026-06-20 08:00:00'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // CHARACTERIZATION: gdy local.updated_at > remote.updated_at, merge POMIJA UPDATE sesji manualnej.
        assert_eq!(
            duration3, 7200,
            "LWW: lokalny rekord sesji manualnej nowszy niz remote nie jest nadpisywany"
        );
    }
}
