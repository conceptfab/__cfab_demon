//! Shared utilities for LAN sync modules (server, orchestrator, discovery).

use crate::config;
use std::sync::Mutex;

static SYNC_LOG_MUTEX: Mutex<()> = Mutex::new(());

/// Deterministic FNV-1a 64-bit hash (same result across processes/machines).
fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

/// Read device_id from config dir; create if missing. Fallback to machine name.
pub fn get_device_id() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return get_machine_name(),
    };
    let path = dir.join("device_id.txt");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    // Generate and persist a unique device ID
    let machine = get_machine_name();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let id = format!("{}-{:x}-{:x}", machine, ts, pid);
    let _ = std::fs::write(&path, &id);
    id
}

/// Get machine name from COMPUTERNAME env var.
pub fn get_machine_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
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
    let log_settings = config::load_log_settings();
    let max_bytes = (log_settings.max_log_size_kb as u64) * 1024;
    // Rotate if exceeds max size
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > max_bytes {
            let keep_bytes = (max_bytes / 2) as usize;
            if let Ok(content) = std::fs::read_to_string(&path) {
                let start = content.len().saturating_sub(keep_bytes);
                let start = content[start..].find('\n').map(|i| start + i + 1).unwrap_or(start);
                let _ = std::fs::write(&path, &content[start..]);
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
    rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open dashboard DB: {}", e))
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
    format!("{:016x}", fnv1a_64(concat.as_bytes()))
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
    format!("{:016x}", fnv1a_64(input.as_bytes()))
}
