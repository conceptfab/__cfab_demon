// TimeFlow Demon - Windows tray daemon with application monitor
#![windows_subsystem = "windows"]

use std::process::Command;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

struct SyncGuard(Arc<lan_server::LanSyncState>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.sync_in_progress.store(false, Ordering::SeqCst);
        log::info!("SyncGuard dropped — sync_in_progress reset to false");
    }
}

mod activity;
mod config;
mod firewall;
mod foreground_hook;
mod i18n;
mod lan_common;
mod lan_discovery;
mod lan_server;
mod lan_sync_orchestrator;
mod sync_common;
mod sync_encryption;
mod sftp_client;
mod online_sync;
mod monitor;
mod single_instance;
mod storage;
mod tracker;
mod tray;
mod win_process_snapshot;
use crate::win_process_snapshot::no_console;
pub use timeflow_shared::daily_store;

/// Application name — single constant used everywhere
pub const APP_NAME: &str = "TIMEFLOW Demon";
pub const VERSION: &str = match option_env!("TIMEFLOW_VERSION") {
    Some(v) => v,
    None => "dev",
};

fn main() {
    // Handle command-line arguments (fast path, no logging needed)
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        println!("{}", VERSION.trim());
        return;
    }

    // Initialize file logging for actual daemon run
    init_logging();
    install_panic_hook();
    log::info!("{} - starting...", APP_NAME);
    log::logger().flush();

    // Single instance lock
    let _guard = match single_instance::try_acquire() {
        Ok(guard) => guard,
        Err(msg) => {
            log::warn!("{}", msg);
            log::logger().flush();
            show_already_running_message(&msg);
            return;
        }
    };

    // Application directories — created once at startup.
    if let Err(e) = config::ensure_app_dirs() {
        log::warn!("Failed to create application directories: {}", e);
    }

    // Ensure Windows Firewall allows LAN discovery and sync traffic
    firewall::ensure_firewall_rules();

    // Monitor thread control signal
    let stop_signal = Arc::new(AtomicBool::new(false));

    // Start event-driven foreground detection (SetWinEventHook)
    let (foreground_signal, hook_handle) = foreground_hook::start(stop_signal.clone());

    // Shared LAN sync state (role, freeze, markers)
    let sync_state = Arc::new(lan_server::LanSyncState::new());

    // Start monitoring thread with foreground signal for instant wake
    // Pass sync_state so tracker skips saves when db_frozen is true
    let monitor_handle = tracker::start(
        stop_signal.clone(),
        Some(foreground_signal.clone()),
        Some(sync_state.clone()),
    );

    // Start LAN discovery thread (UDP broadcast for peer-to-peer sync)
    let discovery_handle = lan_discovery::start(stop_signal.clone(), Some(sync_state.clone()));

    // Start LAN HTTP server (sync endpoints — works even without dashboard)
    let lan_server_handle = lan_server::start(stop_signal.clone(), sync_state.clone());

    // Optionally trigger online sync on startup
    {
        let online_settings = config::load_online_sync_settings();
        if !(online_settings.enabled && online_settings.auto_sync_on_startup
            && !online_settings.server_url.is_empty() && !online_settings.auth_token.is_empty())
        {
            log::info!(
                "Online sync skipped: enabled={}, auto_sync_on_startup={}, has_server_url={}, has_auth_token={}",
                online_settings.enabled,
                online_settings.auto_sync_on_startup,
                !online_settings.server_url.is_empty(),
                !online_settings.auth_token.is_empty(),
            );
        }
        if online_settings.enabled && online_settings.auto_sync_on_startup
            && !online_settings.server_url.is_empty() && !online_settings.auth_token.is_empty()
        {
            let sync_state_clone = sync_state.clone();
            let stop_signal_clone = stop_signal.clone();
            std::thread::spawn(move || {
                // Wait 10 seconds for daemon to fully start up
                std::thread::sleep(std::time::Duration::from_secs(10));
                if stop_signal_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                if sync_state_clone.sync_in_progress.compare_exchange(
                    false, true,
                    std::sync::atomic::Ordering::SeqCst,
                    std::sync::atomic::Ordering::Relaxed,
                ).is_ok() {
                    let _guard = SyncGuard(sync_state_clone.clone());
                    log::info!("Auto-starting online sync on startup (mode: {})", online_settings.sync_mode);
                    match online_settings.sync_mode.as_str() {
                        "async" if !online_settings.group_id.is_empty() => {
                            let group_id = online_settings.group_id.clone();
                            online_sync::run_async_delta_sync(online_settings, sync_state_clone, &group_id);
                        }
                        _ => {
                            online_sync::run_online_sync(online_settings, sync_state_clone, stop_signal_clone);
                        }
                    }
                    // _guard drops here, resets flag
                }
            });
        }
    }

    // Start tray icon event loop (pass sync_state for sync icon)
    let tray_action = tray::run(stop_signal.clone(), Some(sync_state.clone()));

    // After tray closes — cleanly stop all threads
    stop_signal.store(true, Ordering::SeqCst);
    // Wake tracker so it exits without waiting for poll timeout
    foreground_signal.notify();
    if monitor_handle.join().is_err() {
        log::error!("Monitor thread panicked");
    }
    if hook_handle.join().is_err() {
        log::error!("Foreground hook thread panicked");
    }
    if discovery_handle.join().is_err() {
        log::error!("LAN discovery thread panicked");
    }
    if lan_server_handle.join().is_err() {
        log::error!("LAN server thread panicked");
    }

    log::info!("{} - stopped", APP_NAME);
    log::logger().flush();

    if matches!(tray_action, tray::TrayExitAction::Restart) {
        drop(_guard);
        if let Ok(exe) = std::env::current_exe() {
            let mut cmd = Command::new(exe);
            no_console(&mut cmd);
            match cmd.spawn() {
                Ok(_) => log::info!("{} - started new instance (restart)", APP_NAME),
                Err(e) => log::error!("{} - failed to start new instance: {}", APP_NAME, e),
            }
        }
        log::logger().flush();
    }
}

fn show_already_running_message(msg: &str) {
    let title: Vec<u16> = APP_NAME.encode_utf16().chain(std::iter::once(0)).collect();
    let text: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        winapi::um::winuser::MessageBoxW(
            ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            winapi::um::winuser::MB_OK | winapi::um::winuser::MB_ICONINFORMATION,
        );
    }
}

/// Install panic hook so panics are logged to file instead of being swallowed
/// by #![windows_subsystem = "windows"].
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        log::error!("PANIC at {}: {}", location, payload);
        log::logger().flush();
    }));
}

/// Initialize file logging to %APPDATA%/TimeFlow/logs/daemon.log.
/// Falls back to exe directory if config_dir is unavailable.
fn init_logging() {
    use std::fs;

    let log_settings = config::load_log_settings();
    let max_bytes = (log_settings.max_log_size_kb as u64) * 1024;
    let level = parse_log_level(&log_settings.daemon_level);

    let log_path = config::logs_dir()
        .map(|d| d.join("daemon.log"))
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("timeflow_demon.log")))
                .unwrap_or_else(|| std::path::PathBuf::from("timeflow_demon.log"))
        });

    // Ensure logs directory exists
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Truncate log file if > max size
    if log_path.exists() {
        if let Ok(meta) = fs::metadata(&log_path) {
            if meta.len() > max_bytes {
                let _ = fs::OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(&log_path);
            }
        }
    }

    let file = match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            // Cannot open log file — write diagnostic to a fallback location
            let fallback = log_path.with_extension("err");
            let _ = fs::write(&fallback, format!("Failed to open {}: {}\n", log_path.display(), e));
            return;
        }
    };

    let logger = Box::new(FileLogger {
        writer: std::sync::Mutex::new(std::io::BufWriter::new(file)),
        level,
    });

    if let Err(e) = log::set_boxed_logger(logger) {
        let fallback = log_path.with_extension("err");
        let _ = fs::write(&fallback, format!("set_boxed_logger failed: {}\n", e));
        return;
    }
    log::set_max_level(level);
}

fn parse_log_level(s: &str) -> log::LevelFilter {
    match s.to_lowercase().as_str() {
        "trace" => log::LevelFilter::Trace,
        "debug" => log::LevelFilter::Debug,
        "info" => log::LevelFilter::Info,
        "warn" => log::LevelFilter::Warn,
        "error" => log::LevelFilter::Error,
        "off" => log::LevelFilter::Off,
        _ => log::LevelFilter::Info,
    }
}

/// Minimal file logger with buffering
struct FileLogger {
    writer: std::sync::Mutex<std::io::BufWriter<std::fs::File>>,
    level: log::LevelFilter,
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            // Recover from poison — logging should never silently stop
            let mut guard = match self.writer.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            use std::io::Write;
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(
                guard,
                "[{}] [{}] {}: {}",
                ts,
                record.level(),
                record.target(),
                record.args()
            );
            if record.level() <= log::Level::Warn {
                let _ = guard.flush();
            }
        }
    }

    fn flush(&self) {
        let mut guard = match self.writer.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        use std::io::Write;
        let _ = guard.flush();
    }
}
