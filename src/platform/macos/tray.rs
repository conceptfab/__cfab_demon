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

use crate::i18n::{self, TrayText};
use crate::lan_server::LanSyncState;
use crate::platform::tray_common::TrayExitAction;
use crate::sync_trigger;
use crate::APP_NAME;

const PUMP_INTERVAL_SECS: f64 = 0.15;

/// Logo TIMEFLOW osadzone w binarce (PNG 128×128 — macOS skaluje do
/// 22×22 statusbara, na Retinie używa pełnej rozdzielczości).
const TRAY_ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/tray_icon.png"
));

/// Wczytuje ikonę tray z osadzonego PNG i dekoduje do RGBA. Jeśli dekodowanie
/// zawiedzie, zwraca prosty niebieski kwadrat jako fallback — daemon nie może
/// wystartować bez ikony, ale nie chcemy brakiem logo blokować produkcji.
fn build_icon() -> Icon {
    match decode_png_rgba(TRAY_ICON_PNG) {
        Ok((rgba, w, h)) => {
            Icon::from_rgba(rgba, w, h).expect("Failed to build tray icon from RGBA")
        }
        Err(e) => {
            log::warn!("Tray icon PNG decode failed ({e}) — fallback to 18×18 blue square");
            fallback_icon()
        }
    }
}

fn decode_png_rgba(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let decoder = png::Decoder::new(bytes);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());

    // Normalizacja do RGBA8 — tray-icon wymaga 4 kanałów.
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for chunk in buf.chunks_exact(3) {
                out.extend_from_slice(chunk);
                out.push(255);
            }
            out
        }
        png::ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for chunk in buf.chunks_exact(2) {
                out.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]);
            }
            out
        }
        png::ColorType::Grayscale => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for &g in &buf {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            out
        }
        other => return Err(format!("unsupported PNG color type: {:?}", other)),
    };
    Ok((rgba, info.width, info.height))
}

fn fallback_icon() -> Icon {
    const SIZE: usize = 18;
    let mut rgba = Vec::with_capacity(SIZE * SIZE * 4);
    for _ in 0..SIZE * SIZE {
        rgba.extend_from_slice(&[31, 81, 255, 255]);
    }
    Icon::from_rgba(rgba, SIZE as u32, SIZE as u32).expect("fallback icon must build")
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
    let lang = i18n::load_language();
    let menu = Menu::new();
    let version_item = MenuItem::new(
        format!("{} v{}", APP_NAME, crate::VERSION.trim()),
        false,
        None,
    );
    let dashboard_item = MenuItem::new(lang.t(TrayText::OpenDashboard), true, None);
    let sync_delta_item = MenuItem::new(lang.t(TrayText::SyncDelta), true, None);
    let sync_force_item = MenuItem::new(lang.t(TrayText::SyncForceFull), true, None);
    let restart_item = MenuItem::new(lang.t(TrayText::Restart), true, None);
    let exit_item = MenuItem::new(lang.t(TrayText::Close), true, None);

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

/// Sprawdza czy dashboard już żyje (żeby nie startować drugiej instancji
/// — Tauri i tak pozwoliłby, ale tworzyłby duplikat okna).
fn is_dashboard_running() -> bool {
    let Some(entries) = crate::platform::process_snapshot::collect_process_entries() else {
        return false;
    };
    entries.into_iter().any(|e| {
        matches!(
            e.exe_name.as_str(),
            "timeflow-dashboard" | "timeflow" | "timeflow-dashboard.exe"
        )
    })
}

/// Uruchamia dashboard TIMEFLOW. Strategia fallbackowa:
/// 1. `open -b com.timeflow.dashboard` — najpewniejsze, działa gdy `.app`
///    jest gdziekolwiek zarejestrowany w LaunchServices (typowo po pierwszym
///    otwarciu lub po przeciągnięciu do /Applications).
/// 2. `open /path/to/TIMEFLOW.app` — ścieżkowo, dla dev-buildów obok daemona
///    (dist/TIMEFLOW.app) albo w /Applications.
fn launch_dashboard() {
    use std::path::PathBuf;
    use std::process::Command;

    if is_dashboard_running() {
        log::info!("Dashboard already running — skipping launch");
        return;
    }

    const BUNDLE_ID: &str = "com.timeflow.dashboard";

    // 1) Bundle ID via LaunchServices
    match Command::new("open").args(["-b", BUNDLE_ID]).output() {
        Ok(out) if out.status.success() => {
            log::info!("Dashboard launched via bundle id {BUNDLE_ID}");
            return;
        }
        Ok(out) => log::debug!(
            "open -b {BUNDLE_ID} zakończył się kodem {:?}, próbuję ścieżkowo",
            out.status.code()
        ),
        Err(e) => log::debug!("open -b failed ({e}), próbuję ścieżkowo"),
    }

    // 2) Szukanie .app obok daemona i w /Applications
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("TIMEFLOW.app"));
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("dist").join("TIMEFLOW.app"));
                candidates.push(parent.join("TIMEFLOW.app"));
            }
        }
        // Gdy daemon leci z "TIMEFLOW Demon.app/Contents/MacOS/timeflow-demon",
        // siostrzane TIMEFLOW.app leży o 3 poziomy wyżej (katalog zawierający
        // bundle daemona). Szukamy pierwszego przodka z rozszerzeniem ".app"
        // i bierzemy jego parent jako baza.
        if let Some(app_dir) = exe
            .ancestors()
            .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        {
            if let Some(sibling_base) = app_dir.parent() {
                candidates.push(sibling_base.join("TIMEFLOW.app"));
            }
        }
    }
    candidates.push(PathBuf::from("/Applications/TIMEFLOW.app"));

    for cand in &candidates {
        if cand.exists() {
            match Command::new("open").arg(cand).output() {
                Ok(out) if out.status.success() => {
                    log::info!("Dashboard launched from path: {}", cand.display());
                    return;
                }
                Ok(out) => log::warn!(
                    "open {} zakończył się kodem {:?}",
                    cand.display(),
                    out.status.code()
                ),
                Err(e) => log::warn!("open {} failed: {e}", cand.display()),
            }
        }
    }

    log::error!(
        "Dashboard launch nieudany — aplikacja TIMEFLOW.app nie znaleziona. \
         Sprawdź candidates: {:?}",
        candidates
    );
}
