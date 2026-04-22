// macOS tray — menu bar icon via `tray-icon` crate + ręczna pompka
// zdarzeń NSApplication (bez dodatkowej zależności na `tao`/`winit`).
// Uruchamiane z głównego wątku (MainThreadMarker::new() panikuje inaczej).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use objc2::rc::Retained;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSEventMask};
use objc2_foundation::{MainThreadMarker, NSDate, NSDefaultRunLoopMode};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

use crate::lan_server::LanSyncState;
use crate::platform::tray_common::TrayExitAction;
use crate::sync_trigger;
use crate::APP_NAME;

const PUMP_INTERVAL_SECS: f64 = 0.15;

/// Prosta ikona menu bar — 18×18 RGBA z niebieskim kwadratem i literą "T".
/// Wystarczająca dla Fazy 3; docelowo wczytanie .icns/.png z assetów.
fn build_icon() -> Icon {
    const SIZE: usize = 18;
    let mut rgba = Vec::with_capacity(SIZE * SIZE * 4);
    for y in 0..SIZE {
        for x in 0..SIZE {
            // Ramka T: górny pasek + środkowa pionowa kolumna
            let is_t = (y >= 2 && y <= 4)
                || (x >= SIZE / 2 - 1 && x <= SIZE / 2 + 1 && y >= 2 && y <= SIZE - 3);
            if is_t {
                rgba.extend_from_slice(&[255, 255, 255, 255]); // biała litera
            } else {
                rgba.extend_from_slice(&[31, 81, 255, 255]); // niebieskie tło
            }
        }
    }
    Icon::from_rgba(rgba, SIZE as u32, SIZE as u32)
        .expect("Failed to build tray icon from RGBA")
}

pub fn run(
    stop_signal: Arc<AtomicBool>,
    sync_state: Option<Arc<LanSyncState>>,
) -> TrayExitAction {
    let Some(mtm) = MainThreadMarker::new() else {
        log::error!("Tray: macOS tray musi być uruchamiany z głównego wątku");
        return TrayExitAction::Exit;
    };

    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    // Menu
    let menu = Menu::new();
    let version_item = MenuItem::new(
        format!("{} v{}", APP_NAME, crate::VERSION.trim()),
        false,
        None,
    );
    let dashboard_item = MenuItem::new("Open Dashboard", true, None);
    let sync_delta_item = MenuItem::new("Sync Now (delta)", true, None);
    let sync_force_item = MenuItem::new("Force Full Sync", true, None);
    let restart_item = MenuItem::new("Restart", true, None);
    let exit_item = MenuItem::new("Quit TIMEFLOW Demon", true, None);

    let _ = menu.append(&version_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&dashboard_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&sync_delta_item);
    let _ = menu.append(&sync_force_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&restart_item);
    let _ = menu.append(&exit_item);

    let tray_icon = match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(APP_NAME)
        .with_icon(build_icon())
        .build()
    {
        Ok(t) => t,
        Err(e) => {
            log::error!("Tray: nie udało się utworzyć ikony menu bar: {e}");
            return TrayExitAction::Exit;
        }
    };

    // NSApp musi skończyć finishLaunching zanim zacznie się pompka zdarzeń.
    unsafe { app.finishLaunching() };
    log::info!("Daemon started - tray icon active (macOS menu bar)");

    let dashboard_id = dashboard_item.id().clone();
    let sync_delta_id = sync_delta_item.id().clone();
    let sync_force_id = sync_force_item.id().clone();
    let restart_id = restart_item.id().clone();
    let exit_id = exit_item.id().clone();

    let menu_rx = MenuEvent::receiver();
    let mut action = TrayExitAction::Exit;
    let default_mode: &objc2_foundation::NSRunLoopMode = unsafe { NSDefaultRunLoopMode };

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Obsłuż zdarzenia menu (non-blocking)
        while let Ok(ev) = menu_rx.try_recv() {
            if ev.id == dashboard_id {
                launch_dashboard();
            } else if ev.id == sync_delta_id {
                if let Some(state) = sync_state.clone() {
                    sync_trigger::trigger_sync(state, false);
                }
            } else if ev.id == sync_force_id {
                if let Some(state) = sync_state.clone() {
                    sync_trigger::trigger_sync(state, true);
                }
            } else if ev.id == restart_id {
                log::info!("Restart requested from tray menu");
                action = TrayExitAction::Restart;
                stop_signal.store(true, Ordering::SeqCst);
                break;
            } else if ev.id == exit_id {
                log::info!("Exit requested from tray menu");
                stop_signal.store(true, Ordering::SeqCst);
                break;
            }
        }

        // Pompka NSApp — blokuje do PUMP_INTERVAL_SECS lub dopóki nie ma eventu.
        pump_ns_app(&app, default_mode);
    }

    log::info!("Daemon tray loop exited");
    drop(tray_icon);
    action
}

fn pump_ns_app(app: &NSApplication, mode: &objc2_foundation::NSRunLoopMode) {
    unsafe {
        let until = NSDate::dateWithTimeIntervalSinceNow(PUMP_INTERVAL_SECS);
        let event: Option<Retained<objc2_app_kit::NSEvent>> = app
            .nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&until),
                mode,
                true,
            );
        if let Some(evt) = event {
            app.sendEvent(&evt);
            app.updateWindows();
        }
    }
}

fn launch_dashboard() {
    // Faza 4: prawdziwe uruchomienie aplikacji dashboard (np. `open -a TIMEFLOW Dashboard`
    // lub bezpośrednia ścieżka do `.app`). Na razie log + best-effort `open` po nazwie.
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-a").arg("TIMEFLOW Dashboard");
    match cmd.spawn() {
        Ok(_) => log::info!("Dashboard launch: `open -a \"TIMEFLOW Dashboard\"` wystrzelone"),
        Err(e) => {
            log::warn!(
                "Dashboard launch nieudany ({e}); zainstaluj aplikację Dashboard \
                 w /Applications albo uruchom ręcznie."
            );
            // ignorujemy — dev environment nie ma zbudowanej aplikacji
            let _ = std::time::Duration::from_millis(0);
        }
    }
}
