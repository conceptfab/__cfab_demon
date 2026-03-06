// System tray module - tray icon with context menu

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use native_windows_gui as nwg;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::i18n::{self, Lang, TrayText};
use crate::APP_NAME;
const ASSIGNMENT_SIGNAL_FILE: &str = "assignment_attention.txt";

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

#[cfg(windows)]
fn no_console(cmd: &mut std::process::Command) {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_console(_cmd: &mut std::process::Command) {}

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

fn build_tray_tip(lang: Lang) -> String {
    let attention = load_assignment_attention_count();
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

/// Initializes and runs the tray icon event loop.
/// `stop_signal` — set to true on shutdown.
/// Returns whether the user requested a restart.
pub fn run(stop_signal: Arc<AtomicBool>) -> TrayExitAction {
    nwg::init().expect("Failed to initialize NWG");

    let initial_lang = i18n::load_language();

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

    let tip = build_tray_tip(initial_lang);

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
        .text(&format!("{} v{}", APP_NAME, crate::VERSION.trim()))
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
        .text(initial_lang.t(TrayText::Close))
        .parent(&menu)
        .build(&mut menu_exit)
        .expect("Failed to create Exit menu item");

    let mut menu_restart = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text(initial_lang.t(TrayText::Restart))
        .parent(&menu)
        .build(&mut menu_restart)
        .expect("Failed to create Restart menu item");

    let mut menu_dashboard = nwg::MenuItem::default();
    nwg::MenuItem::builder()
        .text(initial_lang.t(TrayText::OpenDashboard))
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

    let current_lang: Rc<std::cell::Cell<Lang>> = Rc::new(std::cell::Cell::new(initial_lang));
    let lang_clone = current_lang.clone();

    let menu_exit = Rc::new(RefCell::new(menu_exit));
    let menu_restart = Rc::new(RefCell::new(menu_restart));
    let menu_dashboard = Rc::new(RefCell::new(menu_dashboard));
    let menu_exit_clone = menu_exit.clone();
    let menu_restart_clone = menu_restart.clone();
    let menu_dashboard_clone = menu_dashboard.clone();

    let stop_clone = stop_signal.clone();
    let action = Arc::new(Mutex::new(TrayExitAction::Exit));
    let action_clone = action.clone();

    let handler =
        nwg::full_bind_event_handler(&window_handle, move |evt, _evt_data, handle| match evt {
            nwg::Event::OnContextMenu => {
                if handle == tray_handle {
                    let lang = lang_clone.get();
                    let refreshed_tip = build_tray_tip(lang);
                    tray_clone.borrow_mut().set_tip(&refreshed_tip);
                    let (x, y) = nwg::GlobalCursor::position();
                    menu_clone.popup(x, y);
                }
            }

            nwg::Event::OnTimerTick => {
                if handle == tip_timer_handle {
                    let new_lang = i18n::load_language();
                    let old_lang = lang_clone.get();
                    if new_lang != old_lang {
                        lang_clone.set(new_lang);
                        set_menu_item_text(
                            &menu_exit_clone.borrow(),
                            new_lang.t(TrayText::Close),
                        );
                        set_menu_item_text(
                            &menu_restart_clone.borrow(),
                            new_lang.t(TrayText::Restart),
                        );
                        set_menu_item_text(
                            &menu_dashboard_clone.borrow(),
                            new_lang.t(TrayText::OpenDashboard),
                        );
                    }

                    let lang = lang_clone.get();
                    let attention = load_assignment_attention_count();
                    let refreshed_tip = build_tray_tip(lang);

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
                    launch_dashboard(lang_clone.get());
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
    let mut cmd = std::process::Command::new("tasklist");
    no_console(&mut cmd);
    let output = match cmd.args(["/FO", "CSV", "/NH"]).output() {
        Ok(o) => o,
        Err(e) => {
            log::warn!("Failed to run tasklist for dashboard detection: {}", e);
            return false;
        }
    };

    if !output.status.success() {
        log::warn!(
            "tasklist failed while checking dashboard process: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return false;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    stdout.contains("\"timeflow-dashboard.exe\"")
        || stdout.contains("\"timeflow.exe\"")
        || stdout.contains("\"timeflow_dashboard.exe\"")
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
        show_error_message(lang.t(TrayText::DashboardNotFound));
    }
}

fn show_error_message(msg: &str) {
    use std::ptr;
    let lang_obj = crate::i18n::load_language();
    let title_text = lang_obj.t(crate::i18n::TrayText::DemonErrorTitle).to_string();
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
