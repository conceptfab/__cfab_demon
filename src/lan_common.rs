//! Shared utilities for LAN sync modules (server, orchestrator, discovery).

use crate::config;
use std::sync::Mutex;
use std::time::Instant;

// Lock ordering: SYNC_LOG_MUTEX → LOG_SETTINGS_CACHE (never reverse).
// SYNC_LOG_MUTEX is the outer lock, LOG_SETTINGS_CACHE is only acquired inside sync_log().
static SYNC_LOG_MUTEX: Mutex<()> = Mutex::new(());
static LOG_SETTINGS_CACHE: Mutex<Option<(Instant, u64)>> = Mutex::new(None);
const LOG_SETTINGS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

/// Deterministic 128-bit hash using SHA-256 (truncated to 128 bits).
/// Stable across Rust compiler versions, unlike DefaultHasher.
fn hash_128(data: &[u8]) -> u128 {
    use sha2::{Sha256, Digest};
    let result = Sha256::digest(data);
    // Take first 16 bytes (128 bits) of the 32-byte SHA-256 digest
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&result[..16]);
    u128::from_be_bytes(bytes)
}

/// Read device_id from config dir; create if missing.
///
/// CRITICAL: regenerates ONLY when the file does not exist (ErrorKind::NotFound)
/// or is verifiably empty. Any other read error (permission denied, AV lock,
/// transient I/O fault) returns the ephemeral machine name as fallback and
/// DOES NOT touch the file — otherwise a transient glitch would rotate the
/// device_id and silently invalidate every paired peer on the other side.
pub fn get_device_id() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("CRITICAL: config_dir() failed in get_device_id: {}", e);
            return get_machine_name();
        }
    };
    let path = dir.join("device_id.txt");

    match std::fs::read_to_string(&path) {
        Ok(id) => {
            let trimmed = id.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
            log::warn!("device_id.txt exists but is empty — regenerating");
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::info!("device_id.txt not found — generating new device id");
        }
        Err(e) => {
            log::error!(
                "CRITICAL: cannot read device_id.txt ({}): {} — refusing to regenerate, returning machine name as ephemeral fallback",
                path.display(), e
            );
            return get_machine_name();
        }
    }

    // Generate and persist a unique device ID (atomic write)
    let machine = get_machine_name();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let id = format!("{}-{:x}-{:x}", machine, ts, pid);

    let tmp = path.with_extension("txt.tmp");
    if let Err(e) = std::fs::write(&tmp, &id) {
        log::error!("CRITICAL: failed to write device_id.txt.tmp: {}", e);
        return id;
    }
    if let Err(e) = std::fs::rename(&tmp, &path) {
        log::error!("CRITICAL: failed to rename device_id.txt.tmp -> device_id.txt: {}", e);
        let _ = std::fs::remove_file(&tmp);
        return id;
    }
    log::info!("Generated new device id (atomic write): {}", id);
    id
}

/// Get machine name: COMPUTERNAME (Windows) / HOSTNAME env, falling back to
/// the `hostname` command on Unix (macOS does not set either env var).
pub fn get_machine_name() -> String {
    for var in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(name) = std::env::var(var) {
            if !name.trim().is_empty() {
                return name.trim().to_string();
            }
        }
    }
    #[cfg(unix)]
    {
        if let Ok(out) = std::process::Command::new("hostname").output() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    "unknown".to_string()
}

/// Append timestamped line to logs/lan_sync.log (max size from log settings).
/// Protected by SYNC_LOG_MUTEX to prevent corrupted lines from concurrent writes.
pub fn sync_log(msg: &str) {
    log::info!("{}", msg);

    let _guard = match SYNC_LOG_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return, // poisoned mutex — skip log write
    };

    let path = match config::logs_dir() {
        Ok(d) => d.join("lan_sync.log"),
        Err(_) => {
            // Fallback to legacy location
            if let Ok(dir) = config::config_dir() {
                dir.join("lan_sync.log")
            } else {
                return;
            }
        }
    };
    let max_bytes = {
        let cached = LOG_SETTINGS_CACHE.lock().ok().and_then(|g| {
            g.as_ref().and_then(|(ts, val)| {
                if ts.elapsed() < LOG_SETTINGS_CACHE_TTL { Some(*val) } else { None }
            })
        });
        match cached {
            Some(v) => v,
            None => {
                let settings = config::load_log_settings();
                let v = (settings.max_log_size_kb as u64) * 1024;
                if let Ok(mut g) = LOG_SETTINGS_CACHE.lock() {
                    *g = Some((Instant::now(), v));
                }
                v
            }
        }
    };
    // Rotate if exceeds max size — write to temp file + rename for atomicity
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > max_bytes {
            let keep_bytes = (max_bytes / 2) as usize;
            if let Ok(content) = std::fs::read_to_string(&path) {
                let start = content.len().saturating_sub(keep_bytes);
                let start = content[start..].find('\n').map(|i| start + i + 1).unwrap_or(start);
                let tmp = format!("{}.tmp", path.display());
                if std::fs::write(&tmp, &content[start..]).is_ok() {
                    let _ = std::fs::rename(&tmp, &path);
                }
            }
        }
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}

/// Open the dashboard SQLite DB in read-write mode.
///
/// SAFETY: Uses `SQLITE_OPEN_NO_MUTEX` (multi-thread mode) for performance.
/// Each thread must use its own `Connection` — never share a connection across threads.
pub fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    if !db_path.exists() {
        return Err("Dashboard DB not found".to_string());
    }
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open dashboard DB: {}", e))?;
    // The daemon is a SECOND writer to this DB (the dashboard pool is the other).
    // busy_timeout makes the daemon WAIT on write contention (e.g. a UI edit during
    // sync) instead of immediately getting SQLITE_BUSY and aborting the merge.
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout for dashboard DB: {}", e))?;
    // IMPORTANT: keep foreign_keys OFF here. The merge path (sync_common::merge_incoming_data,
    // tombstone application) manages FK references MANUALLY — e.g. it sets
    // manual_sessions.project_id to the sentinel 0 before deleting a project. With FK
    // enforcement ON, that sentinel write fails and the project delete would instead
    // CASCADE-delete manual_sessions (ON DELETE CASCADE) — silent data loss. The merge
    // unit tests assert this by running with `PRAGMA foreign_keys = OFF`. OFF is also the
    // SQLite default; we set it explicitly to stay immune to a future default change.
    conn.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("Failed to set pragmas for dashboard DB: {}", e))?;
    Ok(conn)
}

/// Open the dashboard SQLite DB in read-only mode.
pub fn open_dashboard_db_readonly() -> Result<rusqlite::Connection, String> {
    config::open_dashboard_db_readonly().map_err(|e| e.to_string())
}

/// Compute a hash for a table's content using DefaultHasher.
pub fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    let sql = match table {
        "projects" => {
            "SELECT COALESCE(group_concat(name || '|' || updated_at, ';'), '') \
             FROM (SELECT name, updated_at FROM projects ORDER BY name)"
        }
        "applications" => {
            "SELECT COALESCE(group_concat(executable_name || '|' || updated_at, ';'), '') \
             FROM (SELECT executable_name, updated_at FROM applications ORDER BY executable_name)"
        }
        "sessions" => {
            "SELECT COALESCE(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'), '') \
             FROM (SELECT a.executable_name AS app_name, s.start_time, s.updated_at \
                   FROM sessions s JOIN applications a ON s.app_id = a.id \
                   ORDER BY a.executable_name, s.start_time)"
        }
        "manual_sessions" => {
            "SELECT COALESCE(group_concat(title || '|' || start_time || '|' || updated_at, ';'), '') \
             FROM (SELECT title, start_time, updated_at FROM manual_sessions ORDER BY title, start_time)"
        }
        _ => return String::new(),
    };
    let concat: String = conn
        .query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|_| String::new());
    format!("{:032x}", hash_128(concat.as_bytes()))
}

/// Compute hashes for all 4 sync tables, concatenated.
pub fn compute_tables_hash_string(conn: &rusqlite::Connection) -> String {
    let tables = ["projects", "applications", "sessions", "manual_sessions"];
    let mut combined = String::new();
    for table in &tables {
        combined.push_str(&compute_table_hash(conn, table));
    }
    combined
}

/// Generate a marker hash from tables_hash + timestamp + device_id.
pub fn generate_marker_hash(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    let input = format!("{}{}{}", tables_hash, timestamp, device_id);
    format!("{:032x}", hash_128(input.as_bytes()))
}

/// Najlepszy adres IPv4 LAN (interfejs wyjściowy), fallback None.
pub fn primary_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    if ip.is_loopback() { None } else { Some(ip.to_string()) }
}

#[cfg(test)]
mod tests {
    use super::get_machine_name;

    #[test]
    fn machine_name_resolves_on_unix() {
        // On Windows COMPUTERNAME is always set; on Unix the function must
        // fall back to `hostname` instead of returning the "unknown" stub.
        #[cfg(unix)]
        assert_ne!(get_machine_name(), "unknown");
        let name = get_machine_name();
        assert!(!name.trim().is_empty());
    }
}
