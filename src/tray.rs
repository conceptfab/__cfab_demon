// System tray module - tray icon with context menu

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use native_windows_gui as nwg;
use rusqlite::OptionalExtension;
use timeflow_shared::session_settings;

use crate::i18n::{self, Lang, TrayText};
use crate::win_process_snapshot::{collect_process_entries, no_console};
use crate::APP_NAME;

const TRAY_DOUBLE_CLICK_WINDOW: Duration = Duration::from_millis(500);
const TRAY_ATTENTION_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

/// Zmienia tekst menu item przez WinAPI (NWG nie ma set_text na MenuItem).
fn set_menu_item_text(item: &nwg::MenuItem, text: &str) {
    if let Some((hmenu, id)) = item.handle.hmenu_item() {
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            winapi::um::winuser::ModifyMenuW(
                hmenu,
                id,
                winapi::um::winuser::MF_BYCOMMAND | winapi::um::winuser::MF_STRING,
                id as usize,
                wide.as_ptr(),
            );
        }
    }
}

/// Tray loop exit action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayExitAction {
    Exit,
    Restart,
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
            Ok(c) => {
                state.conn = Some(c);
            }
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
    match state.conn.as_ref() {
        Some(conn) => Ok(conn),
        None => Err("Dashboard DB connection is unavailable".into()),
    }
}

fn refresh_attention_state(state: &RefCell<AttentionState>, force: bool) -> i64 {
    let now = Instant::now();
    let should_refresh = {
        let snapshot = state.borrow();
        force || now.duration_since(snapshot.last_refresh) >= TRAY_ATTENTION_REFRESH_INTERVAL
    };

    if !should_refresh {
        return state.borrow().count;
    }

    let mut snapshot = state.borrow_mut();
    snapshot.last_refresh = now;

    let result = match ensure_conn(&mut snapshot) {
        Ok(conn) => query_unassigned_attention_count(conn),
        Err(_) => Ok(0),
    };

    match result {
        Ok(count) => {
            snapshot.count = count;
        }
        Err(error) => {
            log::warn!("Failed to refresh tray attention count: {}", error);
            snapshot.conn = None;
        }
    }
    snapshot.count
}

fn build_tray_tip(lang: Lang, attention: i64) -> String {
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

/// Groups all tray-related state into a single struct to reduce Rc/RefCell clones.
struct TrayState {
    tray: RefCell<nwg::TrayNotification>,
    menu: nwg::Menu,
    menu_exit: RefCell<nwg::MenuItem>,
    menu_restart: RefCell<nwg::MenuItem>,
    menu_dashboard: RefCell<nwg::MenuItem>,
    menu_sync_status: RefCell<nwg::MenuItem>,
    icon: nwg::Icon,
    icon_attention: nwg::Icon,
    icon_sync: Option<nwg::Icon>,
    sync_state: Option<Arc<crate::lan_server::LanSyncState>>,
    current_lang: Cell<Lang>,
    attention_state: RefCell<AttentionState>,
    last_tray_click: Cell<Option<Instant>>,
    action: Cell<TrayExitAction>,
    // Stored handles for comparisons in the event handler
    tray_handle: nwg::ControlHandle,
    tip_timer_handle: nwg::ControlHandle,
    exit_handle: nwg::ControlHandle,
    restart_handle: nwg::ControlHandle,
    dashboard_handle: nwg::ControlHandle,
}

impl TrayState {
    fn is_syncing(&self) -> bool {
        self.sync_state.as_ref().map_or(false, |s| {
            s.sync_in_progress.load(Ordering::Relaxed)
        })
    }

    fn update_tray_appearance(&self, tray: &nwg::TrayNotification, attention: i64, lang: Lang) {
        if self.is_syncing() {
            tray.set_tip(&format!("{} - LAN Sync...", APP_NAME));
            if let Some(ref icon_sync) = self.icon_sync {
                tray.set_icon(icon_sync);
            }
        } else {
            tray.set_tip(&build_tray_tip(lang, attention));
            if attention > 0 {
                tray.set_icon(&self.icon_attention);
            } else {
                tray.set_icon(&self.icon);
            }
        }
    }

    fn handle_context_menu(&self, handle: nwg::ControlHandle) {
        if handle == self.tray_handle {
            let lang = self.current_lang.get();
            let attention = refresh_attention_state(&self.attention_state, true);
            // Scope the borrow so it's released before popup() — popup() runs
            // a nested message loop where timer ticks can fire and also borrow tray.
            {
                let tray = self.tray.borrow_mut();
                self.update_tray_appearance(&tray, attention, lang);
            }
            let (x, y) = nwg::GlobalCursor::position();
            self.menu.popup(x, y);
        }
    }

    fn handle_mouse_press(&self, handle: nwg::ControlHandle, btn: nwg::MousePressEvent) {
        if handle == self.tray_handle {
            if btn == nwg::MousePressEvent::MousePressLeftUp {
                let now = Instant::now();
                let is_double_click = self
                    .last_tray_click
                    .get()
                    .map(|last| now.duration_since(last) < TRAY_DOUBLE_CLICK_WINDOW)
                    .unwrap_or(false);

                if is_double_click {
                    log::info!("Tray icon double-clicked, launching Dashboard");
                    launch_dashboard(self.current_lang.get());
                    self.last_tray_click.set(None);
                } else {
                    self.last_tray_click.set(Some(now));
                }
            }
        }
    }

    fn handle_timer_tick(&self, handle: nwg::ControlHandle) {
        if handle == self.tip_timer_handle {
            let new_lang = i18n::load_language();
            let old_lang = self.current_lang.get();
            if new_lang != old_lang {
                self.current_lang.set(new_lang);
                set_menu_item_text(&self.menu_exit.borrow(), new_lang.t(TrayText::Close));
                set_menu_item_text(&self.menu_restart.borrow(), new_lang.t(TrayText::Restart));
                set_menu_item_text(
                    &self.menu_dashboard.borrow(),
                    new_lang.t(TrayText::OpenDashboard),
                );
            }

            let lang = self.current_lang.get();
            let attention = refresh_attention_state(&self.attention_state, false);
            let tray = self.tray.borrow_mut();
            self.update_tray_appearance(&tray, attention, lang);

            // Update sync status menu item
            if let Some(ref state) = self.sync_state {
                let role = state.get_role();
                let syncing = state.sync_in_progress.load(Ordering::Relaxed);
                let frozen = state.db_frozen.load(Ordering::Relaxed);
                let status = if syncing {
                    format!("Sync: {} (frozen={})", role, frozen)
                } else {
                    format!("Sync: {}", role)
                };
                set_menu_item_text(&self.menu_sync_status.borrow(), &status);
            }
        }
    }

    fn handle_menu_item(&self, handle: nwg::ControlHandle, stop_signal: &Arc<AtomicBool>) {
        if handle == self.exit_handle {
            log::info!("Shutting down daemon");
            stop_signal.store(true, Ordering::SeqCst);
            nwg::stop_thread_dispatch();
        } else if handle == self.restart_handle {
            log::info!("Restarting daemon from tray menu");
            self.action.set(TrayExitAction::Restart);
            stop_signal.store(true, Ordering::SeqCst);
            nwg::stop_thread_dispatch();
        } else if handle == self.dashboard_handle {
            log::info!("Launching Dashboard from tray menu");
            launch_dashboard(self.current_lang.get());
        }
    }
}

/// Initializes and runs the tray icon event loop.
/// `stop_signal` — set to true on shutdown.
/// Returns whether the user requested a restart.
pub fn run(stop_signal: Arc<AtomicBool>, sync_state: Option<Arc<crate::lan_server::LanSyncState>>) -> TrayExitAction {
    if let Err(e) = nwg::init() {
        log::error!("Failed to initialize NWG (headless/no-GUI?): {e}");
        return TrayExitAction::Exit;
    }

    let initial_lang = i18n::load_language();

    let mut window = nwg::MessageWindow::default();
    if let Err(e) = nwg::MessageWindow::builder().build(&mut window) {
        log::error!("Failed to create MessageWindow: {e}");
        return TrayExitAction::Exit;
    }

    let embed = match nwg::EmbedResource::load(None) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to load exe resources for tray icon: {e}");
            return TrayExitAction::Exit;
        }
    };
    let icon = match embed.icon_str("APP_ICON", None) {
        Some(i) => i,
        None => {
            log::error!("APP_ICON not found in resources");
            return TrayExitAction::Exit;
        }
    };

    let icon_attention = embed
        .icon_str("APP_ICON_ATTENTION", None)
        .or_else(|| embed.icon_str("APP_ICON", None))
        .unwrap_or_else(|| {
            log::warn!("No attention icon found, reloading APP_ICON as fallback");
            nwg::EmbedResource::load(None)
                .ok()
                .and_then(|e| e.icon_str("APP_ICON", None))
                .expect("APP_ICON must exist (loaded successfully earlier)")
        });

    let icon_sync = embed.icon_str("APP_ICON_SYNC", None);
    if icon_sync.is_none() {
        log::warn!("APP_ICON_SYNC not found in resources — sync icon unavailable");
    }

    let (initial_conn, initial_attention) = match crate::config::open_dashboard_db_readonly() {
        Ok(conn) => {
            let count = query_unassigned_attention_count(&conn).unwrap_or_else(|error| {
                log::warn!("Failed to load initial tray attention count: {}", error);
                0
            });
            (Some(conn), count)
        }
        Err(error) => {
            log::warn!(
                "Failed to open dashboard DB for initial tray count: {}",
                error
            );
            (None, 0)
        }
    };
    let tip = build_tray_tip(initial_lang, initial_attention);

    macro_rules! try_build {
        ($builder:expr, $target:expr, $label:literal) => {
            if let Err(e) = $builder.build($target) {
                log::error!("Failed to create {}: {e}", $label);
                return TrayExitAction::Exit;
            }
        };
    }

    let mut tray_obj = nwg::TrayNotification::default();
    try_build!(
        nwg::TrayNotification::builder()
            .parent(&window)
            .icon(Some(&icon))
            .tip(Some(&tip)),
        &mut tray_obj,
        "tray icon"
    );
    if initial_attention > 0 {
        tray_obj.set_icon(&icon_attention);
    }
    let tray_handle = tray_obj.handle;

    let mut tip_refresh_timer = nwg::AnimationTimer::default();
    try_build!(
        nwg::AnimationTimer::builder()
            .parent(&window)
            .interval(Duration::from_secs(5))
            .active(true),
        &mut tip_refresh_timer,
        "tray tip refresh timer"
    );
    let tip_timer_handle = tip_refresh_timer.handle.clone();

    let mut menu = nwg::Menu::default();
    try_build!(
        nwg::Menu::builder().popup(true).parent(&window),
        &mut menu,
        "menu"
    );

    let mut menu_version = nwg::MenuItem::default();
    try_build!(
        nwg::MenuItem::builder()
            .text(&format!("{} v{}", APP_NAME, crate::VERSION.trim()))
            .disabled(true)
            .parent(&menu),
        &mut menu_version,
        "Version menu item"
    );

    let mut menu_sync_status = nwg::MenuItem::default();
    try_build!(
        nwg::MenuItem::builder()
            .text("Sync: idle")
            .disabled(true)
            .parent(&menu),
        &mut menu_sync_status,
        "Sync status menu item"
    );

    let mut menu_sep = nwg::MenuSeparator::default();
    try_build!(
        nwg::MenuSeparator::builder().parent(&menu),
        &mut menu_sep,
        "separator"
    );

    let mut menu_exit = nwg::MenuItem::default();
    try_build!(
        nwg::MenuItem::builder()
            .text(initial_lang.t(TrayText::Close))
            .parent(&menu),
        &mut menu_exit,
        "Exit menu item"
    );
    let exit_handle = menu_exit.handle;

    let mut menu_restart = nwg::MenuItem::default();
    try_build!(
        nwg::MenuItem::builder()
            .text(initial_lang.t(TrayText::Restart))
            .parent(&menu),
        &mut menu_restart,
        "Restart menu item"
    );
    let restart_handle = menu_restart.handle;

    let mut menu_dashboard = nwg::MenuItem::default();
    try_build!(
        nwg::MenuItem::builder()
            .text(initial_lang.t(TrayText::OpenDashboard))
            .parent(&menu),
        &mut menu_dashboard,
        "Launch Dashboard menu item"
    );
    let dashboard_handle = menu_dashboard.handle;

    let window_handle = window.handle;

    let state = Rc::new(TrayState {
        tray: RefCell::new(tray_obj),
        menu,
        menu_exit: RefCell::new(menu_exit),
        menu_restart: RefCell::new(menu_restart),
        menu_dashboard: RefCell::new(menu_dashboard),
        menu_sync_status: RefCell::new(menu_sync_status),
        icon,
        icon_attention,
        icon_sync,
        sync_state,
        current_lang: Cell::new(initial_lang),
        attention_state: RefCell::new(AttentionState {
            count: initial_attention,
            last_refresh: Instant::now(),
            conn: initial_conn,
        }),
        last_tray_click: Cell::new(None),
        action: Cell::new(TrayExitAction::Exit),
        tray_handle,
        tip_timer_handle,
        exit_handle,
        restart_handle,
        dashboard_handle,
    });

    let state_clone = state.clone();
    let stop_clone = stop_signal.clone();

    let handler =
        nwg::full_bind_event_handler(&window_handle, move |evt, _evt_data, handle| match evt {
            nwg::Event::OnContextMenu => state_clone.handle_context_menu(handle),
            nwg::Event::OnMousePress(btn) => state_clone.handle_mouse_press(handle, btn),
            nwg::Event::OnTimerTick => state_clone.handle_timer_tick(handle),
            nwg::Event::OnMenuItemSelected => state_clone.handle_menu_item(handle, &stop_clone),
            _ => {}
        });

    log::info!("Daemon started - tray icon active");

    nwg::dispatch_thread_events();

    // Hide tray icon before exiting
    state.tray.borrow().set_visibility(false);

    nwg::unbind_event_handler(&handler);
    log::info!("Daemon stopped");

    // Return the requested exit action (Exit / Restart).
    state.action.get()
}

fn is_dashboard_running() -> bool {
    let Some(entries) = collect_process_entries() else {
        log::warn!("Failed to create process snapshot for dashboard detection");
        return false;
    };

    entries.into_iter().any(|entry| {
        matches!(
            entry.exe_name.as_str(),
            "timeflow-dashboard.exe" | "timeflow.exe" | "timeflow_dashboard.exe"
        )
    })
}

fn launch_dashboard(lang: Lang) {
    use std::process::Command;

    if is_dashboard_running() {
        log::info!("Dashboard is already running");
        return;
    }

    let daemon_exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(e) => {
            log::error!("Failed to determine exe path: {}", e);
            return;
        }
    };

    let daemon_dir = match daemon_exe.parent() {
        Some(dir) => dir,
        None => {
            log::error!("Failed to determine exe directory");
            return;
        }
    };

    // Dashboard exe names (Tauri productName -> TimeFlow, Cargo -> timeflow-dashboard)
    let exe_names = [
        "timeflow-dashboard.exe",
        "TimeFlow.exe",
        "timeflow_dashboard.exe",
    ];

    let mut possible_paths = Vec::new();
    for name in &exe_names {
        possible_paths.push(daemon_dir.join(name));
    }
    // Development location
    for name in &exe_names {
        possible_paths.push(
            daemon_dir
                .join("dashboard")
                .join("src-tauri")
                .join("target")
                .join("release")
                .join(name),
        );
    }

    let dashboard_exe = possible_paths.iter().find(|p| p.exists());

    if let Some(path) = dashboard_exe {
        let mut cmd = Command::new(path);
        no_console(&mut cmd);
        match cmd.spawn() {
            Ok(_) => log::info!("Dashboard started: {:?}", path),
            Err(e) => log::error!("Error starting Dashboard: {}", e),
        }
    } else {
        log::error!("Dashboard exe not found in {:?}", daemon_dir);
        show_error_message(lang, lang.t(TrayText::DashboardNotFound));
    }
}

fn show_error_message(lang: Lang, msg: &str) {
    use std::ptr;
    let title_text = lang.t(crate::i18n::TrayText::DemonErrorTitle).to_string();
    let title: Vec<u16> = title_text
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let text: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        winapi::um::winuser::MessageBoxW(
            ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            winapi::um::winuser::MB_OK | winapi::um::winuser::MB_ICONWARNING,
        );
    }
}
