use std::io::{Read, Seek, SeekFrom};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use timeflow_shared::{session_settings, version_compat};

use super::helpers::{no_console, timeflow_data_dir, DAEMON_AUTOSTART_LNK, DAEMON_EXE_NAME};
use super::types::DaemonStatus;
use crate::commands::sql_fragments::ACTIVE_SESSION_FILTER_S;
use crate::db;

mod control;
mod status;

pub use control::*;
pub use status::*;

const DAEMON_VERSION_CACHE_TTL: Duration = Duration::from_secs(300);
const DAEMON_PROCESS_CACHE_TTL: Duration = Duration::from_secs(45);

#[derive(Clone)]
struct DaemonVersionCacheEntry {
    exe_path: std::path::PathBuf,
    version: String,
    cached_at: Instant,
}

#[derive(Clone, Copy)]
struct DaemonProcessCacheEntry {
    running: bool,
    pid: Option<u32>,
    cached_at: Instant,
}

fn daemon_version_cache() -> &'static Mutex<Option<DaemonVersionCacheEntry>> {
    static DAEMON_VERSION_CACHE: OnceLock<Mutex<Option<DaemonVersionCacheEntry>>> = OnceLock::new();
    DAEMON_VERSION_CACHE.get_or_init(|| Mutex::new(None))
}

fn daemon_process_cache() -> &'static Mutex<Option<DaemonProcessCacheEntry>> {
    static DAEMON_PROCESS_CACHE: OnceLock<Mutex<Option<DaemonProcessCacheEntry>>> = OnceLock::new();
    DAEMON_PROCESS_CACHE.get_or_init(|| Mutex::new(None))
}

fn read_cached_daemon_version(exe: &std::path::Path) -> Option<String> {
    let guard = daemon_version_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = guard.as_ref()?;
    if entry.exe_path != exe || entry.cached_at.elapsed() > DAEMON_VERSION_CACHE_TTL {
        return None;
    }
    Some(entry.version.clone())
}

fn store_cached_daemon_version(exe: &std::path::Path, version: &str) {
    let mut guard = daemon_version_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(DaemonVersionCacheEntry {
        exe_path: exe.to_path_buf(),
        version: version.to_string(),
        cached_at: Instant::now(),
    });
}

fn read_cached_daemon_process_status() -> Option<(bool, Option<u32>)> {
    let guard = daemon_process_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = guard.as_ref()?;
    if entry.cached_at.elapsed() > DAEMON_PROCESS_CACHE_TTL {
        return None;
    }
    Some((entry.running, entry.pid))
}

fn store_cached_daemon_process_status(running: bool, pid: Option<u32>) {
    let mut guard = daemon_process_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(DaemonProcessCacheEntry {
        running,
        pid,
        cached_at: Instant::now(),
    });
}

pub(super) fn clear_cached_daemon_process_status() {
    let mut guard = daemon_process_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = None;
}

fn load_daemon_version(exe: &std::path::Path) -> Option<String> {
    if let Some(version) = read_cached_daemon_version(exe) {
        return Some(version);
    }

    let mut v_cmd = Command::new(exe);
    no_console(&mut v_cmd);
    let output = v_cmd.arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return None;
    }

    store_cached_daemon_version(exe, &version);
    Some(version)
}

pub(super) fn find_daemon_exe() -> Result<std::path::PathBuf, String> {
    // Look next to the dashboard executable first
    if let Ok(self_exe) = std::env::current_exe() {
        if let Some(dir) = self_exe.parent() {
            let candidate = dir.join(DAEMON_EXE_NAME);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // Check dist/ relative to APPDATA data dir
    let data_dir = timeflow_data_dir()?;
    if let Ok(content) = std::fs::read_to_string(data_dir.join("daemon_path.txt")) {
        let p = std::path::PathBuf::from(content.trim());
        if p.exists() {
            return Ok(p);
        }
    }
    // Fallback: search near current executable without hardcoded dev paths
    if let Ok(self_exe) = std::env::current_exe() {
        for ancestor in self_exe.ancestors().take(5) {
            let direct = ancestor.join(DAEMON_EXE_NAME);
            if direct.exists() {
                return Ok(direct);
            }
            let dist = ancestor.join("dist").join(DAEMON_EXE_NAME);
            if dist.exists() {
                return Ok(dist);
            }
        }
    }
    Err("Cannot find timeflow-demon.exe".to_string())
}

pub(super) fn daemon_log_path() -> Result<std::path::PathBuf, String> {
    let exe = find_daemon_exe()?;
    Ok(exe
        .parent()
        .ok_or_else(|| "Cannot determine parent directory of daemon exe".to_string())?
        .join("timeflow_demon.log"))
}

pub(super) fn startup_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup"))
}

pub(super) fn read_last_n_lines(path: &std::path::Path, n: usize) -> Result<String, String> {
    if n == 0 {
        return Ok(String::new());
    }

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();
    if file_len == 0 {
        return Ok(String::new());
    }

    const CHUNK_SIZE: u64 = 8192;
    let mut pos = file_len;
    let mut newline_count = 0usize;
    let mut chunks: Vec<Vec<u8>> = Vec::new();

    while pos > 0 && newline_count <= n {
        let read_size = std::cmp::min(CHUNK_SIZE, pos) as usize;
        pos -= read_size as u64;
        file.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;

        let mut chunk = vec![0u8; read_size];
        file.read_exact(&mut chunk).map_err(|e| e.to_string())?;
        newline_count += chunk.iter().filter(|&&b| b == b'\n').count();
        chunks.push(chunk);
    }

    let total_size: usize = chunks.iter().map(|c| c.len()).sum();
    let mut data = Vec::with_capacity(total_size);
    for chunk in chunks.into_iter().rev() {
        data.extend_from_slice(&chunk);
    }

    let text = String::from_utf8_lossy(&data);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].join("\n"))
}

fn query_unassigned_counts(app: &AppHandle, min_duration_sec: i64) -> (i64, i64) {
    let conn = match db::get_connection(app) {
        Ok(conn) => conn,
        Err(e) => {
            log::warn!("Failed to open dashboard DB for daemon status: {}", e);
            return (0, 0);
        }
    };

    conn.query_row(
        &format!(
            "SELECT
                COUNT(*) as unassigned_sessions,
                COUNT(DISTINCT s.app_id) as unassigned_apps
             FROM sessions s
             WHERE {ACTIVE_SESSION_FILTER_S}
               AND s.project_id IS NULL
               AND s.duration_seconds >= ?1"
        ),
        [min_duration_sec],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )
    .unwrap_or((0, 0))
}

fn query_daemon_process_status() -> Result<(bool, Option<u32>), String> {
    let mut cmd = Command::new("tasklist");
    no_console(&mut cmd);
    let output = cmd
        .args([
            "/FI",
            &format!("IMAGENAME eq {}", DAEMON_EXE_NAME),
            "/FO",
            "CSV",
            "/NH",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut running = false;
    let mut pid = None;

    for line in stdout.lines() {
        if line.contains(DAEMON_EXE_NAME) {
            running = true;
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 2 {
                pid = parts[1].trim_matches('"').parse::<u32>().ok();
            }
            break;
        }
    }

    Ok((running, pid))
}

fn load_daemon_process_status(use_cache: bool) -> Result<(bool, Option<u32>), String> {
    if use_cache {
        if let Some(status) = read_cached_daemon_process_status() {
            return Ok(status);
        }
    }

    let status = query_daemon_process_status()?;
    store_cached_daemon_process_status(status.0, status.1);
    Ok(status)
}

pub(super) fn build_daemon_status(
    app: &AppHandle,
    min_duration: Option<i64>,
    use_cached_process: bool,
    include_assignment_counts: bool,
) -> Result<DaemonStatus, String> {
    let (running, pid) = load_daemon_process_status(use_cached_process)?;
    let daemon_exe = find_daemon_exe().ok();
    let exe_path = daemon_exe.as_ref().map(|p| p.to_string_lossy().to_string());
    let autostart = startup_dir()
        .map(|d| d.join(DAEMON_AUTOSTART_LNK).exists())
        .unwrap_or(false);

    let (unassigned_sessions, unassigned_apps) = if include_assignment_counts {
        let min_dur = min_duration.unwrap_or_else(load_persisted_session_min_duration);
        query_unassigned_counts(app, min_dur)
    } else {
        (0, 0)
    };

    let daemon_version = daemon_exe.as_ref().and_then(|exe| load_daemon_version(exe));

    let is_compatible = if let Some(ref dv) = daemon_version {
        version_compat::check_version_compatibility(dv, crate::VERSION.trim())
    } else {
        true
    };

    Ok(DaemonStatus {
        running,
        pid,
        exe_path,
        autostart,
        needs_assignment: unassigned_sessions > 0,
        unassigned_sessions,
        unassigned_apps,
        version: daemon_version,
        dashboard_version: crate::VERSION.trim().to_string(),
        is_compatible,
    })
}

pub(super) fn load_persisted_session_min_duration() -> i64 {
    let base_dir = match timeflow_data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            log::warn!(
                "Failed to resolve TIMEFLOW dir for session settings: {}",
                error
            );
            return session_settings::DEFAULT_MIN_SESSION_DURATION_SECONDS;
        }
    };

    session_settings::read_session_settings(&base_dir).min_session_duration_seconds
}
