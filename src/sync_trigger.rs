// Cross-platform logika uruchamiania synchronizacji z menu tray.
// Wspólne dla Windows (native-windows-gui tray) i macOS (tray-icon).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::lan_server::LanSyncState;

/// Uruchamia odpowiednią ścieżkę synchronizacji (online lub LAN) w nowym wątku.
/// Pełni guard `sync_in_progress` — kolejne wywołania podczas trwającej sync
/// są ignorowane.
pub fn trigger_sync(sync_state: Arc<LanSyncState>, force: bool) {
    if sync_state
        .sync_in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        return;
    }

    // Online sync ma priorytet (jeśli skonfigurowany).
    // Store-and-forward nie rozróżnia trybów ani force-full — zawsze ta sama ścieżka
    // (force dotyczy tylko fallbacku LAN poniżej).
    let online_settings = crate::config::load_online_sync_settings();
    if online_settings.enabled
        && !online_settings.server_url.is_empty()
        && !online_settings.auth_token.is_empty()
    {
        let state = sync_state.clone();
        std::thread::spawn(move || {
            // store-and-forward sam zarządza sync_in_progress (unfreeze() w cleanup)
            crate::online_store_forward::run_store_forward_sync(
                online_settings,
                state,
                Arc::new(AtomicBool::new(false)),
            );
        });
        return;
    }

    // Fallback: LAN sync (pierwszy znaleziony peer)
    let lan_settings = crate::config::load_lan_sync_settings();
    if lan_settings.enabled {
        let state = sync_state.clone();
        std::thread::spawn(move || {
            match crate::lan_discovery::find_first_peer() {
                Some(peer) => {
                    state.set_role("master");
                    let stop = Arc::new(AtomicBool::new(false));
                    let handle = crate::lan_sync_orchestrator::run_sync_as_master_with_options(
                        peer, state, stop, force,
                    );
                    let _ = handle.join();
                }
                None => {
                    log::warn!("No LAN peer found for tray-triggered sync");
                    state.sync_in_progress.store(false, Ordering::SeqCst);
                }
            }
        });
        return;
    }

    // Nic nie skonfigurowane — zwolnij flag bezpośrednio (bez SyncGuard)
    sync_state.sync_in_progress.store(false, Ordering::SeqCst);
}
