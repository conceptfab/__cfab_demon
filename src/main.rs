// TimeFlow Demon - Windows tray daemon with application monitor
#![windows_subsystem = "windows"]

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::process::Command;

mod config;
mod monitor;
mod single_instance;
mod storage;
mod tracker;
mod tray;

/// Application name — single constant used everywhere
pub const APP_NAME: &str = "TIMEFLOW Demon";
pub const VERSION: &str = include_str!("../VERSION");

fn main() {
    // Handle command-line arguments (fast path, no logging needed)
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--version" || arg == "-v") {
        println!("{}", VERSION);
        return;
    }

    // Initialize file logging for actual daemon run
    init_logging();
    log::info!("{} - starting...", APP_NAME);
    log::logger().flush();

    // Application directories — created once at startup
    if let Err(e) = config::ensure_app_dirs() {
        log::warn!("Failed to create application directories: {}", e);
    }

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

    // Monitor thread control signal
    let stop_signal = Arc::new(AtomicBool::new(false));

    // Start monitoring thread
    let monitor_handle = tracker::start(stop_signal.clone());

    // Start tray icon event loop
    let tray_action = tray::run(stop_signal.clone());

    // After tray closes — cleanly stop monitor thread
    stop_signal.store(true, Ordering::SeqCst);
    let _ = monitor_handle.join();

    log::info!("{} - stopped", APP_NAME);
    log::logger().flush();

    if matches!(tray_action, tray::TrayExitAction::Restart) {
        if let Ok(exe) = std::env::current_exe() {
            match Command::new(exe).spawn() {
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
                let _ = fs::remove_file(&log_path);
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
            let _ = writeln!(guard, "[{}] [{}] {}: {}", ts, record.level(), record.target(), record.args());
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

