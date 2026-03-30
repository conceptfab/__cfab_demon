// TimeFlow Demon - Windows tray daemon with application monitor
#![windows_subsystem = "windows"]

use std::process::Command;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

mod activity;
mod config;
mod foreground_hook;
mod i18n;
mod lan_common;
mod lan_discovery;
mod lan_server;
mod lan_sync_orchestrator;
mod sync_common;
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
pub const VERSION: &str = env!("TIMEFLOW_VERSION");

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

    // Start tray icon event loop (pass sync_state for sync icon)
    let tray_action = tray::run(stop_signal.clone(), Some(sync_state.clone()));

    // After tray closes — cleanly stop all threads
    stop_signal.store(true, Ordering::SeqCst);
    // Wake tracker so it exits without waiting for poll timeout
    foreground_signal.notify();
    let _ = monitor_handle.join();
    let _ = hook_handle.join();
    let _ = discovery_handle.join();
    let _ = lan_server_handle.join();

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

/// Initialize file logging in the directory next to the exe.
fn init_logging() {
    use std::fs;

    let log_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("timeflow_demon.log")))
        .unwrap_or_else(|| std::path::PathBuf::from("timeflow_demon.log"));

    // Truncate log file if > 1 MB
    if log_path.exists() {
        if let Ok(meta) = fs::metadata(&log_path) {
            if meta.len() > 1_000_000 {
                let _ = fs::OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(&log_path);
            }
        }
    }

    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path);

    if let Ok(file) = file {
        let _ = log::set_boxed_logger(Box::new(FileLogger {
            writer: std::sync::Mutex::new(std::io::BufWriter::new(file)),
        }));
        log::set_max_level(log::LevelFilter::Info);
    }
}

/// Minimal file logger with buffering
struct FileLogger {
    writer: std::sync::Mutex<std::io::BufWriter<std::fs::File>>,
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
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
