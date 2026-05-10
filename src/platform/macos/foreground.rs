// macOS foreground watcher.
// Główna ścieżka używa NSWorkspaceDidActivateApplicationNotification, a polling
// frontmostApplication() zostaje jako 2-sekundowy fallback bezpieczeństwa.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use objc2::rc::Retained;
use objc2_app_kit::{NSWorkspace, NSWorkspaceDidActivateApplicationNotification};
use objc2_foundation::{NSNotification, NSObject};

use crate::platform::foreground_signal::ForegroundSignal;

const FALLBACK_POLL_INTERVAL: Duration = Duration::from_secs(2);

pub fn start(stop_signal: Arc<AtomicBool>) -> (Arc<ForegroundSignal>, thread::JoinHandle<()>) {
    let signal = Arc::new(ForegroundSignal::new());
    let signal_clone = signal.clone();

    let handle = thread::spawn(move || {
        log::info!(
            "Foreground watcher: macOS NSWorkspace notifications + fallback polling ({} ms)",
            FALLBACK_POLL_INTERVAL.as_millis()
        );
        let mut last_pid: Option<i32> = None;
        let observer = install_workspace_observer(signal_clone.clone());

        while !stop_signal.load(Ordering::Relaxed) {
            let current_pid = current_frontmost_pid();
            if current_pid.is_some() && current_pid != last_pid {
                signal_clone.notify();
                last_pid = current_pid;
            }

            thread::sleep(FALLBACK_POLL_INTERVAL);
        }

        if let Some(observer) = observer {
            remove_workspace_observer(&observer);
        }
        log::info!("Foreground watcher: macOS zatrzymany");
    });

    (signal, handle)
}

fn current_frontmost_pid() -> Option<i32> {
    // SAFETY: NSWorkspace.sharedWorkspace() + frontmostApplication() można
    // wołać z dowolnego wątku. Retained automatycznie obsługuje refcount.
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        workspace
            .frontmostApplication()
            .map(|app| app.processIdentifier())
    }
}

fn install_workspace_observer(signal: Arc<ForegroundSignal>) -> Option<Retained<NSObject>> {
    // SAFETY: observer jest rejestrowany w NSWorkspace notificationCenter.
    // Zwrócony token trzymamy do końca wątku i usuwamy go przed wyjściem.
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let notification_center = workspace.notificationCenter();
        let block = block2::RcBlock::new(move |_notification: std::ptr::NonNull<NSNotification>| {
            signal.notify();
        });
        Some(notification_center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidActivateApplicationNotification),
            None,
            None,
            &block,
        ))
    }
}

fn remove_workspace_observer(observer: &NSObject) {
    // SAFETY: token pochodzi z addObserverForName_object_queue_usingBlock.
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        workspace.notificationCenter().removeObserver(observer);
    }
}
