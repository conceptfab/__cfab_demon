// macOS tray stub — Faza 1.
// W Fazie 3 zostanie zastąpione implementacją na bazie crate `tray-icon`
// z NSStatusItem w tle. Stub pozostaje blokujący, bo daemon czeka na
// zakończenie pętli tray jako sygnał do shutdownu.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::platform::tray_common::TrayExitAction;

pub fn run(
    stop_signal: Arc<AtomicBool>,
    _sync_state: Option<Arc<crate::lan_server::LanSyncState>>,
) -> TrayExitAction {
    log::warn!(
        "Tray: macOS stub aktywny — bez ikony w menu bar. \
         Wyjście przez stop_signal (np. SIGINT / kill)."
    );

    // Loop czeka na zewnętrzne ustawienie stop_signal (SIGINT, inny wątek).
    while !stop_signal.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(500));
    }

    TrayExitAction::Exit
}
