use std::io::{Read, Seek, SeekFrom};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[path = "../../../../shared/session_settings.rs"]
mod session_settings;
#[path = "../../../../shared/version_compat.rs"]
mod version_compat;

use super::helpers::{
    no_console, run_app_blocking, timeflow_data_dir, DAEMON_AUTOSTART_LNK, DAEMON_EXE_NAME,
};
use super::types::DaemonStatus;
use crate::db;
const DAEMON_VERSION_CACHE_TTL: Duration = Duration::from_secs(300);

#[derive(Clone)]
struct DaemonVersionCacheEntry {
    exe_path: std::path::PathBuf,
    version: String,
    cached_at: Instant,
}

fn daemon_version_cache() -> &'static Mutex<Option<DaemonVersionCacheEntry>> {
    static DAEMON_VERSION_CACHE: OnceLock<Mutex<Option<DaemonVersionCacheEntry>>> = OnceLock::new();
    DAEMON_VERSION_CACHE.get_or_init(|| Mutex::new(None))
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

fn find_daemon_exe() -> Result<std::path::PathBuf, String> {
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

fn daemon_log_path() -> Result<std::path::PathBuf, String> {
    let exe = find_daemon_exe()?;
    Ok(exe
        .parent()
        .ok_or_else(|| "Cannot determine parent directory of daemon exe".to_string())?
        .join("timeflow_demon.log"))
}

fn startup_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup"))
}

fn read_last_n_lines(path: &std::path::Path, n: usize) -> Result<String, String> {
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
        "SELECT
            COUNT(*) as unassigned_sessions,
            COUNT(DISTINCT s.app_id) as unassigned_apps
         FROM sessions s
         WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
           AND s.project_id IS NULL
           AND s.duration_seconds >= ?1",
        [min_duration_sec],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )
    .unwrap_or((0, 0))
}

fn load_persisted_session_min_duration() -> i64 {
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

#[tauri::command]
pub async fn get_daemon_status(
    app: AppHandle,
    min_duration: Option<i64>,
) -> Result<DaemonStatus, String> {
    run_app_blocking(app, move |app| {
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

        let exe_path = find_daemon_exe()
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        let autostart = startup_dir()
            .map(|d| d.join(DAEMON_AUTOSTART_LNK).exists())
            .unwrap_or(false);
        let min_dur = min_duration.unwrap_or_else(load_persisted_session_min_duration);
        let (unassigned_sessions, unassigned_apps) = query_unassigned_counts(&app, min_dur);

        let daemon_version = find_daemon_exe()
            .ok()
            .and_then(|exe| load_daemon_version(&exe));

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
    })
    .await
}

#[tauri::command]
pub async fn get_daemon_logs(tail_lines: Option<usize>) -> Result<String, String> {
    let log_path = daemon_log_path()?;
    if !log_path.exists() {
        return Ok(String::new());
    }
    let n = tail_lines.unwrap_or(100).clamp(1, 5000);
    read_last_n_lines(&log_path, n)
}

#[tauri::command]
pub async fn get_autostart_enabled() -> Result<bool, String> {
    let dir = startup_dir()?;
    Ok(dir.join(DAEMON_AUTOSTART_LNK).exists())
}

#[tauri::command]
pub async fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let dir = startup_dir()?;
    let lnk_path = dir.join(DAEMON_AUTOSTART_LNK);

    if enabled {
        let exe = find_daemon_exe()?;
        let ps_script = format!(
            "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('{}'); $sc.TargetPath = '{}'; $sc.Save()",
            lnk_path.to_string_lossy().replace('\'', "''"),
            exe.to_string_lossy().replace('\'', "''")
        );
        let mut cmd = Command::new("powershell");
        no_console(&mut cmd);
        let output = cmd
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Failed to create shortcut: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    } else if lnk_path.exists() {
        std::fs::remove_file(&lnk_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn start_daemon() -> Result<(), String> {
    let exe = find_daemon_exe()?;
    let mut cmd = Command::new(&exe);
    no_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("Failed to start daemon: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn stop_daemon() -> Result<(), String> {
    let mut cmd = Command::new("taskkill");
    no_console(&mut cmd);
    let output = cmd
        .args(["/F", "/T", "/IM", DAEMON_EXE_NAME])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("not found") {
            return Err(format!("Failed to stop daemon: {}", stderr));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn restart_daemon() -> Result<(), String> {
    let mut kill_cmd = Command::new("taskkill");
    no_console(&mut kill_cmd);
    let _ = kill_cmd.args(["/F", "/T", "/IM", DAEMON_EXE_NAME]).output();
    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    let exe = find_daemon_exe()?;
    let mut start_cmd = Command::new(&exe);
    no_console(&mut start_cmd);
    start_cmd
        .spawn()
        .map_err(|e| format!("Failed to start daemon: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn persist_language_for_daemon(code: String) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let lang_file = base_dir.join("language.json");
    let normalized = if code.to_lowercase().starts_with("pl") {
        "pl"
    } else {
        "en"
    };
    let content = format!("{{\"code\":\"{}\"}}", normalized);
    std::fs::write(&lang_file, content).map_err(|e| format!("Failed to write language.json: {}", e))
}

#[tauri::command]
pub async fn persist_session_settings_for_daemon(
    min_session_duration_seconds: i64,
) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let settings = session_settings::SharedSessionSettings {
        min_session_duration_seconds,
    };
    session_settings::write_session_settings(&base_dir, &settings)
}
