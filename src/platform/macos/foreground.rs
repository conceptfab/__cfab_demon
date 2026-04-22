// macOS foreground watcher — w Fazie 1 stub: zwraca sygnał który nigdy nie
// notyfikuje. Tracker zadziała w trybie polling-only dokładnie tak samo,
// jak na Windows w przypadku niepowodzenia SetWinEventHook.
// Właściwa implementacja (NSWorkspace notifications) — Faza 3.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::platform::foreground_signal::ForegroundSignal;

pub fn start(stop_signal: Arc<AtomicBool>) -> (Arc<ForegroundSignal>, thread::JoinHandle<()>) {
    let signal = Arc::new(ForegroundSignal::new());

    let handle = thread::spawn(move || {
        log::info!(
            "Foreground watcher: macOS stub aktywny (polling-only, bez event notifications)"
        );
        while !stop_signal.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
        }
        log::info!("Foreground watcher: macOS stub zatrzymany");
    });

    (signal, handle)
}
