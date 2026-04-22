// macOS foreground watcher.
// Strategia: lekki polling (250 ms) `NSWorkspace.frontmostApplication()` —
// przy zmianie PID aktywnej aplikacji budzimy trackera przez ForegroundSignal.
// To daje UX zbliżony do Windowsowego SetWinEventHook bez utrzymywania własnego
// NSRunLoop i observera Obj-C. Koszt: 1 lekkie wywołanie AppKit co 250 ms.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use objc2_app_kit::NSWorkspace;

use crate::platform::foreground_signal::ForegroundSignal;

const POLL_INTERVAL: Duration = Duration::from_millis(250);

pub fn start(stop_signal: Arc<AtomicBool>) -> (Arc<ForegroundSignal>, thread::JoinHandle<()>) {
    let signal = Arc::new(ForegroundSignal::new());
    let signal_clone = signal.clone();

    let handle = thread::spawn(move || {
        log::info!(
            "Foreground watcher: macOS polling mode ({} ms)",
            POLL_INTERVAL.as_millis()
        );
        let mut last_pid: Option<i32> = None;

        while !stop_signal.load(Ordering::Relaxed) {
            // SAFETY: NSWorkspace.sharedWorkspace() + frontmostApplication()
            // można wołać z dowolnego wątku. Retained automatyczny refcount.
            let current_pid = unsafe {
                let workspace = NSWorkspace::sharedWorkspace();
                workspace
                    .frontmostApplication()
                    .map(|app| app.processIdentifier())
            };

            if current_pid.is_some() && current_pid != last_pid {
                signal_clone.notify();
                last_pid = current_pid;
            }

            thread::sleep(POLL_INTERVAL);
        }

        log::info!("Foreground watcher: macOS zatrzymany");
    });

    (signal, handle)
}
