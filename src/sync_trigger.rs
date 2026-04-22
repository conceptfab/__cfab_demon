// Cross-platform logika uruchamiania synchronizacji z menu tray.
// Wspólne dla Windows (native-windows-gui tray) i macOS (tray-icon).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::lan_server::{LanSyncState, SyncGuard};

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

    // Online sync ma priorytet (jeśli skonfigurowany)
    let online_settings = crate::config::load_online_sync_settings();
    if online_settings.enabled
        && !online_settings.server_url.is_empty()
        && !online_settings.auth_token.is_empty()
    {
        let state = sync_state.clone();
        std::thread::spawn(move || {
            // online_sync sam zarządza sync_in_progress (bez SyncGuard)
            if force {
                crate::online_sync::run_online_sync_forced(
                    online_settings,
                    state.clone(),
                    force,
                    Arc::new(AtomicBool::new(false)),
                );
            } else {
                match online_settings.sync_mode.as_str() {
                    "async" if !online_settings.group_id.is_empty() => {
                        let gid = online_settings.group_id.clone();
                        crate::online_sync::run_async_delta_sync(
                            online_settings,
                            state.clone(),
                            &gid,
                            Arc::new(AtomicBool::new(false)),
                        );
                    }
                    _ => {
                        crate::online_sync::run_online_sync(
                            online_settings,
                            state,
                            Arc::new(AtomicBool::new(false)),
                        );
                    }
                }
            }
        });
        return;
    }

    // Fallback: LAN sync (pierwszy znaleziony peer)
    let lan_settings = crate::config::load_lan_sync_settings();
    if lan_settings.enabled {
        let state = sync_state.clone();
        std::thread::spawn(move || {
            let _guard = SyncGuard(state.clone());
            match crate::lan_discovery::find_first_peer() {
                Some(peer) => {
                    state.set_role("master");
                    let stop = Arc::new(AtomicBool::new(false));
                    crate::lan_sync_orchestrator::run_sync_as_master_with_options(
                        peer, state, stop, force,
                    );
                }
                None => {
                    log::warn!("No LAN peer found for tray-triggered sync");
                }
            }
        });
        return;
    }

    // Nic nie skonfigurowane — zwolnij flag bezpośrednio (bez SyncGuard)
    sync_state.sync_in_progress.store(false, Ordering::SeqCst);
}
