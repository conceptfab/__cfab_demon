// Cfab Demon - aplikacja tray daemon dla Windows z monitorem aplikacji
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

/// Nazwa aplikacji — jedna stała używana wszędzie
pub const APP_NAME: &str = "Cfab Demon";

fn main() {
    // Inicjalizacja logowania do pliku
    init_logging();
    log::info!("{} - uruchamianie...", APP_NAME);

    // Katalogi aplikacji — tworzone raz przy starcie
    if let Err(e) = config::ensure_app_dirs() {
        log::warn!("Nie można utworzyć katalogów aplikacji: {}", e);
    }

    // Blokada pojedynczej instancji
    let _guard = match single_instance::try_acquire() {
        Ok(guard) => guard,
        Err(msg) => {
            log::warn!("{}", msg);
            log::logger().flush();
            show_already_running_message(&msg);
            return;
        }
    };

    // Sygnał sterujący wątkiem monitora
    let stop_signal = Arc::new(AtomicBool::new(false));

    // Uruchomienie wątku monitorującego
    let monitor_handle = tracker::start(stop_signal.clone());

    // Uruchomienie pętli zdarzeń z ikoną w tray
    let tray_action = tray::run(stop_signal.clone());

    // Po zamknięciu tray — czyste zatrzymanie wątku monitora
    stop_signal.store(true, Ordering::SeqCst);
    let _ = monitor_handle.join();

    log::info!("{} - zakończony", APP_NAME);
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

/// Inicjalizuje logowanie do pliku w katalogu obok exe.
fn init_logging() {
    use std::fs;

    let log_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("cfab_demon.log")))
        .unwrap_or_else(|| std::path::PathBuf::from("cfab_demon.log"));

    // Obcinamy plik logów jeśli > 1 MB
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

/// Minimalny logger do pliku z buforowaniem
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
