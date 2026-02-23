// System tray module - tray icon with context menu

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use native_windows_gui as nwg;

use crate::APP_NAME;
const ASSIGNMENT_SIGNAL_FILE: &str = "assignment_attention.txt";

/// Tray loop exit action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayExitAction {
    Exit,
    Restart,
}

fn load_assignment_attention_count() -> i64 {
    let path = match crate::config::config_dir() {
        Ok(dir) => dir.join(ASSIGNMENT_SIGNAL_FILE),
        Err(_) => return 0,
    };
    let raw = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(_) => return 0,
    };
    raw.trim()
        .parse::<i64>()
        .ok()
        .filter(|v| *v > 0)
        .unwrap_or(0)
}

fn build_tray_tip() -> String {
    let attention = load_assignment_attention_count();
    if attention > 0 {
        format!("{} * - {} unassigned session(s)", APP_NAME, attention)
    } else {
        format!("{} - running in background", APP_NAME)
    }
}

/// Initializes and runs the tray icon event loop.
/// `stop_signal` — set to true on shutdown.
/// Returns whether the user requested a restart.
pub fn run(stop_signal: Arc<AtomicBool>) -> TrayExitAction {
    nwg::init().expect("Failed to initialize NWG");

    let mut window = nwg::MessageWindow::default();
    nwg::MessageWindow::builder()
        .build(&mut window)
        .expect("Failed to create MessageWindow");

    let embed = nwg::EmbedResource::load(None).expect("Failed to load exe resources");
    let icon = embed
        .icon_str("APP_ICON", None)
        .expect("APP_ICON not found in resources");
    
    let icon_attention = embed
        .icon_str("APP_ICON_ATTENTION", None)
        .unwrap_or_else(|| {
            embed
                .icon_str("APP_ICON", None)
                .expect("APP_ICON not found in resources")
        });

    let tip = build_tray_tip();

    let mut tray_obj = nwg::TrayNotification::default();
    nwg::TrayNotification::builder()
        .parent(&window)
        .icon(Some(&icon))
        .tip(Some(&tip))
        .build(&mut tray_obj)
        .expect("Failed to create tray icon");
    let tray = Rc::new(RefCell::new(tray_obj));

    let mut tip_refresh_timer = nwg::AnimationTimer::default();
    nwg::AnimationTimer::builder()
        .parent(&window)
        .interval(Duration::from_secs(5))
        .active(true)
        .build(&mut tip_refresh_timer)
        .expect("Failed to create tray tip refresh timer");

    let mut menu = nwg::Menu::default();
    nwg::Menu::builder()
        .popup(true)
        .parent(&window)
        .build(&mut menu)
        .expect("Failed to create menu");

    let mut menu_version = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text(&format!("{} v{}", APP_NAME, crate::VERSION))
        .disabled(true)
        .parent(&menu)
        .build(&mut menu_version)
        .expect("Failed to create Version menu item");

    let mut menu_sep = nwg::MenuSeparator::default();
    nwg::MenuSeparator::builder()
        .parent(&menu)
        .build(&mut menu_sep)
        .expect("Failed to create separator");

    let mut menu_exit = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text("Exit")
        .parent(&menu)
        .build(&mut menu_exit)
        .expect("Failed to create Exit menu item");

    let mut menu_restart = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text("Restart")
        .parent(&menu)
        .build(&mut menu_restart)
        .expect("Failed to create Restart menu item");

    let mut menu_dashboard = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text("Launch Dashboard")
        .parent(&menu)
        .build(&mut menu_dashboard)
        .expect("Failed to create Launch Dashboard menu item");

    let window_handle = window.handle;
    let tray_handle = tray.borrow().handle;
    let exit_handle = menu_exit.handle;
    let restart_handle = menu_restart.handle;
    let dashboard_handle = menu_dashboard.handle;
    let tip_timer_handle = tip_refresh_timer.handle.clone();
    let menu = Rc::new(menu);
    let menu_clone = menu.clone();
    let tray_clone = tray.clone();

    let stop_clone = stop_signal.clone();
    let action = Arc::new(Mutex::new(TrayExitAction::Exit));
    let action_clone = action.clone();

    let handler =
        nwg::full_bind_event_handler(&window_handle, move |evt, _evt_data, handle| match evt {
            nwg::Event::OnContextMenu => {
                if handle == tray_handle {
                    let refreshed_tip = build_tray_tip();
                    tray_clone.borrow_mut().set_tip(&refreshed_tip);
                    let (x, y) = nwg::GlobalCursor::position();
                    menu_clone.popup(x, y);
                }
            }

            nwg::Event::OnTimerTick => {
                if handle == tip_timer_handle {
                    let attention = load_assignment_attention_count();
                    let refreshed_tip = build_tray_tip();
                    
                    let tray = tray_clone.borrow_mut();
                    tray.set_tip(&refreshed_tip);
                    
                    if attention > 0 {
                        tray.set_icon(&icon_attention);
                    } else {
                        tray.set_icon(&icon);
                    }
                }
            }

            nwg::Event::OnMenuItemSelected => {
                if handle == exit_handle {
                    log::info!("Shutting down daemon");
                    stop_clone.store(true, Ordering::SeqCst);
                    nwg::stop_thread_dispatch();
                } else if handle == restart_handle {
                    log::info!("Restarting daemon from tray menu");
                    if let Ok(mut a) = action_clone.lock() {
                        *a = TrayExitAction::Restart;
                    }
                    stop_clone.store(true, Ordering::SeqCst);
                    nwg::stop_thread_dispatch();
                } else if handle == dashboard_handle {
                    log::info!("Launching Dashboard from tray menu");
                    launch_dashboard();
                }
            }

            _ => {}
        });

    log::info!("Daemon started - tray icon active");

    nwg::dispatch_thread_events();

    // Hide tray icon before exiting
    tray.borrow().set_visibility(false);

    nwg::unbind_event_handler(&handler);
    log::info!("Daemon stopped");

    // Return the requested exit action (Exit / Restart).
    action.lock().map(|a| *a).unwrap_or(TrayExitAction::Exit)
}

fn is_dashboard_running() -> bool {
    use sysinfo::{System, ProcessRefreshKind, RefreshKind};
    let s = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::new()),
    );
    s.processes().values().any(|p| {
        let name = p.name().to_lowercase();
        (name == "timeflow"
            || name.contains("timeflow-dashboard")
            || name.contains("timeflow_dashboard")
            || name.contains("timeflowdashboard"))
            && !name.contains("timeflow-demon")
    })
}

fn launch_dashboard() {
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
        match Command::new(path).spawn() {
            Ok(_) => log::info!("Dashboard started: {:?}", path),
            Err(e) => log::error!("Error starting Dashboard: {}", e),
        }
    } else {
        log::error!("Dashboard exe not found in {:?}", daemon_dir);
        show_error_message("Dashboard not found (timeflow-dashboard.exe).\nMake sure it is located in the same folder as timeflow-demon.exe.");
    }
}

fn show_error_message(msg: &str) {
    use std::ptr;
    let title: Vec<u16> = "TimeFlow Demon"
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

