// macOS tray — menu bar icon via `tray-icon` crate + ręczna pompka
// zdarzeń NSApplication (bez dodatkowej zależności na `tao`/`winit`).
// Uruchamiane z głównego wątku (MainThreadMarker::new() panikuje inaczej).

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSEventMask};
use objc2_foundation::{MainThreadMarker, NSDate, NSDefaultRunLoopMode};
use rusqlite::OptionalExtension;
use timeflow_shared::session_settings;
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

use crate::i18n::{self, TrayText};
use crate::lan_server::LanSyncState;
use crate::platform::tray_common::TrayExitAction;
use crate::sync_trigger;
use crate::APP_NAME;

const PUMP_INTERVAL_SECS: f64 = 0.1;
const TRAY_STATE_INTERVAL: Duration = Duration::from_secs(1);
const TRAY_ATTENTION_REFRESH_INTERVAL: Duration = Duration::from_secs(15);

/// Logo TIMEFLOW osadzone w binarce (PNG 128×128 — macOS skaluje do
/// 22×22 statusbara, na Retinie używa pełnej rozdzielczości).
const TRAY_ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/tray_icon.png"
));

const TRAY_ICON_ATTENTION_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/tray_icon_attention.png"
));

const TRAY_ICON_SYNC_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/tray_icon_sync.png"
));

/// Wczytuje ikonę tray z osadzonego PNG i dekoduje do RGBA. Jeśli dekodowanie
/// zawiedzie, zwraca prosty niebieski kwadrat jako fallback — daemon nie może
/// wystartować bez ikony, ale nie chcemy brakiem logo blokować produkcji.
fn build_icon() -> Result<Icon, String> {
    match decode_png_rgba(TRAY_ICON_PNG) {
        Ok((rgba, w, h)) => Icon::from_rgba(rgba, w, h)
            .map_err(|e| format!("failed to build tray icon from RGBA: {e}")),
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

fn fallback_icon() -> Result<Icon, String> {
    // Minimalny fallback — używany tylko gdy główny PNG nie może być zdekodowany.
    const SIZE: usize = 18;
    let rgba = vec![31u8, 81, 255, 255].repeat(SIZE * SIZE);
    Icon::from_rgba(rgba, SIZE as u32, SIZE as u32)
        .map_err(|e| format!("failed to build fallback tray icon: {e}"))
}

fn build_attention_icon() -> Result<Icon, String> {
    match decode_png_rgba(TRAY_ICON_ATTENTION_PNG) {
        Ok((rgba, w, h)) => Icon::from_rgba(rgba, w, h)
            .map_err(|e| format!("failed to build attention tray icon from RGBA: {e}")),
        Err(e) => {
            log::warn!("Attention tray icon PNG decode failed ({e}) — fallback to main icon");
            build_icon()
        }
    }
}

fn build_sync_icon() -> Result<Icon, String> {
    match decode_png_rgba(TRAY_ICON_SYNC_PNG) {
        Ok((rgba, w, h)) => Icon::from_rgba(rgba, w, h)
            .map_err(|e| format!("failed to build sync tray icon from RGBA: {e}")),
        Err(e) => {
            log::warn!("Sync tray icon PNG decode failed ({e}) — fallback to main icon");
            build_icon()
        }
    }
}

struct AttentionState {
    count: i64,
    last_refresh: Instant,
    conn: Option<rusqlite::Connection>,
}

fn query_unassigned_attention_count(conn: &rusqlite::Connection) -> Result<i64, String> {
    let base_dir = crate::config::config_dir().map_err(|e| e.to_string())?;
    let min_duration_sec =
        session_settings::read_session_settings(&base_dir).min_session_duration_seconds;

    let table_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions' LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to check sessions table in dashboard DB: {}", e))?
        .is_some();
    if !table_exists {
        return Ok(0);
    }

    conn.query_row(
        "SELECT COUNT(*)
         FROM sessions s
         WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
           AND s.project_id IS NULL
           AND s.duration_seconds >= ?1",
        [min_duration_sec],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| format!("Failed to query unassigned sessions for tray: {}", e))
}

fn ensure_conn(state: &mut AttentionState) -> Result<&rusqlite::Connection, String> {
    if state.conn.is_none() {
        match crate::config::open_dashboard_db_readonly() {
            Ok(c) => state.conn = Some(c),
            Err(error) => {
                if let Ok(db_path) = crate::config::dashboard_db_path() {
                    if !db_path.exists() {
                        return Err("DB not found yet".into());
                    }
                }
                return Err(format!("Failed to open dashboard DB for tray: {}", error));
            }
        }
    }
    state
        .conn
        .as_ref()
        .ok_or_else(|| "Dashboard DB connection is unavailable".into())
}

fn refresh_attention_state(state: &mut AttentionState, force: bool) -> i64 {
    let now = Instant::now();
    if !force && now.duration_since(state.last_refresh) < TRAY_ATTENTION_REFRESH_INTERVAL {
        return state.count;
    }
    state.last_refresh = now;

    let result = match ensure_conn(state) {
        Ok(conn) => query_unassigned_attention_count(conn),
        Err(_) => Ok(0),
    };

    match result {
        Ok(count) => state.count = count,
        Err(error) => {
            log::warn!("Failed to refresh tray attention count: {}", error);
            state.conn = None;
        }
    }
    state.count
}

fn build_tray_tip(lang: i18n::Lang, attention: i64) -> String {
    if attention > 0 {
        format!(
            "{} * - {} {}",
            APP_NAME,
            attention,
            lang.t(TrayText::UnassignedSessions)
        )
    } else {
        format!("{} - {}", APP_NAME, lang.t(TrayText::RunningInBackground))
    }
}

fn is_syncing(sync_state: Option<&Arc<LanSyncState>>) -> bool {
    sync_state.is_some_and(|state| {
        if state.sync_in_progress.load(Ordering::Relaxed) {
            return true;
        }
        let progress = state.get_progress();
        progress.phase != "idle" && progress.step > 0
    })
}

fn update_tray_appearance(
    tray_icon: &tray_icon::TrayIcon,
    icon: &Icon,
    icon_attention: &Icon,
    icon_sync: &Icon,
    attention: i64,
    lang: i18n::Lang,
    sync_state: Option<&Arc<LanSyncState>>,
) {
    if is_syncing(sync_state) {
        let _ = tray_icon.set_tooltip(Some(format!(
            "{} - {}",
            APP_NAME,
            lang.t(TrayText::LanSyncInProgress)
        )));
        let _ = tray_icon.set_icon(Some(icon_sync.clone()));
    } else {
        let _ = tray_icon.set_tooltip(Some(build_tray_tip(lang, attention)));
        let next_icon = if attention > 0 { icon_attention } else { icon };
        let _ = tray_icon.set_icon(Some(next_icon.clone()));
    }
}

fn update_sync_menu(
    sync_status_item: &MenuItem,
    sync_delta_item: &MenuItem,
    sync_force_item: &MenuItem,
    sync_state: Option<&Arc<LanSyncState>>,
    lang: i18n::Lang,
) {
    let Some(state) = sync_state else {
        sync_status_item.set_text(format!("{}: {}", lang.t(TrayText::SyncStatusPrefix), "n/a"));
        sync_delta_item.set_enabled(false);
        sync_force_item.set_enabled(false);
        return;
    };

    let role = state.get_role();
    let syncing = state.sync_in_progress.load(Ordering::Relaxed);
    let frozen = state.db_frozen.load(Ordering::Acquire);
    let prefix = lang.t(TrayText::SyncStatusPrefix);
    let status = if syncing {
        let frozen_label = lang.t(TrayText::SyncFrozenSuffix);
        format!("{}: {} ({}={})", prefix, role, frozen_label, frozen)
    } else {
        format!("{}: {}", prefix, role)
    };
    sync_status_item.set_text(status);
    sync_delta_item.set_enabled(!syncing);
    sync_force_item.set_enabled(!syncing);
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
    let sync_status_item = MenuItem::new(
        format!("{}: {}", lang.t(TrayText::SyncStatusPrefix), "n/a"),
        false,
        None,
    );
    let sync_delta_item = MenuItem::new(lang.t(TrayText::SyncDelta), true, None);
    let sync_force_item = MenuItem::new(lang.t(TrayText::SyncForceFull), true, None);
    let restart_item = MenuItem::new(lang.t(TrayText::Restart), true, None);
    let exit_item = MenuItem::new(lang.t(TrayText::Close), true, None);

    let _ = menu.append(&version_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&dashboard_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&sync_status_item);
    let _ = menu.append(&sync_delta_item);
    let _ = menu.append(&sync_force_item);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&restart_item);
    let _ = menu.append(&exit_item);

    let icon = match build_icon() {
        Ok(icon) => icon,
        Err(e) => {
            log::error!("Tray: nie udało się przygotować ikony menu bar: {e}");
            return TrayExitAction::Exit;
        }
    };
    let icon_attention = build_attention_icon().unwrap_or_else(|_| icon.clone());
    let icon_sync = build_sync_icon().unwrap_or_else(|_| icon.clone());

    let tray_icon = match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(APP_NAME)
        .with_icon(icon.clone())
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
    let lang_state = Cell::new(lang);
    let mut attention_state = AttentionState {
        count: 0,
        last_refresh: Instant::now() - TRAY_ATTENTION_REFRESH_INTERVAL,
        conn: None,
    };
    let mut was_syncing = false;

    let menu_rx = MenuEvent::receiver();
    let mut action = TrayExitAction::Exit;
    let default_mode: &objc2_foundation::NSRunLoopMode = unsafe { NSDefaultRunLoopMode };
    // Drogie operacje (I/O, macOS API) — odświeżane 1×/s, nie co tick.
    let mut last_state_update = Instant::now() - TRAY_STATE_INTERVAL;

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        let now = Instant::now();
        if now.duration_since(last_state_update) >= TRAY_STATE_INTERVAL {
            last_state_update = now;

            let new_lang = i18n::load_language();
            let old_lang = lang_state.get();
            if new_lang != old_lang {
                lang_state.set(new_lang);
                dashboard_item.set_text(new_lang.t(TrayText::OpenDashboard));
                sync_delta_item.set_text(new_lang.t(TrayText::SyncDelta));
                sync_force_item.set_text(new_lang.t(TrayText::SyncForceFull));
                restart_item.set_text(new_lang.t(TrayText::Restart));
                exit_item.set_text(new_lang.t(TrayText::Close));
            }

            let lang = lang_state.get();
            let attention = refresh_attention_state(&mut attention_state, false);
            update_tray_appearance(
                &tray_icon,
                &icon,
                &icon_attention,
                &icon_sync,
                attention,
                lang,
                sync_state.as_ref(),
            );
            update_sync_menu(
                &sync_status_item,
                &sync_delta_item,
                &sync_force_item,
                sync_state.as_ref(),
                lang,
            );

            if let Some(ref state) = sync_state {
                let currently_syncing = is_syncing(Some(state));
                if was_syncing && !currently_syncing {
                    if state.secs_since_last_sync() < 10 {
                        let progress = state.get_progress();
                        if progress.phase == "not_needed" {
                            log::info!("Tray: {}", lang.t(TrayText::SyncNotNeeded));
                        } else {
                            log::info!("Tray: {}", lang.t(TrayText::SyncCompleted));
                        }
                    } else {
                        log::warn!("Tray: {}", lang.t(TrayText::SyncFailed));
                    }
                }
                was_syncing = currently_syncing;
            }
        }

        // Zdarzenia menu sprawdzane co tick (100ms) — szybka reakcja na kliknięcia.
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

        pump_ns_app(&app, default_mode);
    }

    log::info!("Daemon tray loop exited");
    drop(tray_icon);
    action
}

fn pump_ns_app(app: &NSApplication, mode: &objc2_foundation::NSRunLoopMode) {
    unsafe {
        // Drenuj kolejkę NSEvent nieblokująco. Data w przeszłości powoduje
        // natychmiastowy powrót gdy brak eventów — w przeciwieństwie do
        // blokującego wait, który "kradł" eventy myszy zanim tray_target
        // (NSView w NSStatusBarButton) mógł je odebrać przez NSRunLoop.
        // runMode_beforeDate NIE przetwarza kolejki NSEvent — dlatego
        // mouseDown: na tray_target nigdy nie docierał.
        let past = NSDate::dateWithTimeIntervalSinceNow(-1.0);
        loop {
            let event = app.nextEventMatchingMask_untilDate_inMode_dequeue(
                NSEventMask::Any,
                Some(&past),
                mode,
                true,
            );
            match event {
                Some(evt) => {
                    app.sendEvent(&evt);
                    app.updateWindows();
                }
                None => break,
            }
        }
    }
    std::thread::sleep(Duration::from_secs_f64(PUMP_INTERVAL_SECS));
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
