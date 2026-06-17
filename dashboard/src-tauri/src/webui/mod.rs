#![allow(dead_code)]

pub mod auth;
pub mod config;
pub mod rpc;
pub mod rpc_generated;
pub mod server;

use std::sync::{Arc, OnceLock};

use crate::webui::auth::AuthState;

static AUTH: OnceLock<Arc<AuthState>> = OnceLock::new();

pub fn auth() -> Arc<AuthState> {
    AUTH.get_or_init(|| {
        let state = AuthState::new();
        // Persist sessions so logins survive app restarts (stores token hashes).
        if let Ok(dir) = crate::commands::helpers::timeflow_data_dir() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            state.enable_persistence(dir.join("webui_sessions.json"), now);
        }
        Arc::new(state)
    })
    .clone()
}

#[derive(serde::Serialize)]
pub struct WebServerStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub lan_exposure: bool,
}

pub fn start_if_enabled(app: &tauri::AppHandle) {
    let cfg = config::load();
    if !cfg.enabled {
        log::info!("[webui] disabled in config");
        return;
    }
    if let Err(e) = server::spawn(app.clone(), auth(), cfg.port, cfg.lan_exposure) {
        log::error!("[webui] failed to start: {e}");
    }
}

/// Start serwera w trybie bez okna. Respektuje flagę `enabled` z ustawień:
/// jeśli Web Server jest wyłączony, serwer NIE startuje (zwraca `false`), nawet
/// gdy proces odpalono z `--headless`. Po starcie zapisuje status hosta, by demon
/// mógł wykryć stan i zatrzymać proces. Zwraca `true`, gdy serwer nasłuchuje.
pub fn start_headless(app: &tauri::AppHandle) -> bool {
    let cfg = config::load();
    if !cfg.enabled {
        log::warn!(
            "[webui] headless requested but Web Server is disabled in settings — \
             not starting. Enable it in Settings > Web Server, then relaunch."
        );
        return false;
    }
    match server::spawn(app.clone(), auth(), cfg.port, cfg.lan_exposure) {
        Ok(()) => {
            log::info!("[webui] headless mode active on port {}", cfg.port);
            if let Ok(dir) = crate::commands::helpers::timeflow_data_dir() {
                let started_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let host = timeflow_shared::webui_host::WebUiHost {
                    pid: std::process::id(),
                    port: cfg.port,
                    started_at,
                };
                if let Err(e) = timeflow_shared::webui_host::write(&dir, &host) {
                    log::warn!("[webui] failed to write host status: {e}");
                }
            }
            true
        }
        Err(e) => {
            log::error!("[webui] headless start failed: {e}");
            false
        }
    }
}
