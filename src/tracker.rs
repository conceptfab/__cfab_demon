// Moduł tracker — wątek monitorujący w tle
// Budzi się co 10s, sprawdza foreground window + CPU usage w tle, agreguje dane.
// Zapis do JSON co 5 minut. Absolutne minimum CPU/RAM.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use chrono::Local;

use crate::config;
use crate::monitor::{self, CpuState, PidCache};
use crate::storage::{self, AppDailyData, FileEntry, Session};

fn write_heartbeat() {
    if let Ok(dir) = config::config_dir() {
        let heartbeat = dir.join("heartbeat.txt");
        let _ = fs::write(heartbeat, Local::now().to_rfc3339());
    }
}

fn check_version_compatibility(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> Option<(i32, i32, i32)> {
        let parts: Vec<&str> = v.split('.').collect();
        if parts.len() != 3 { return None; }
        Some((parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?))
    };
    match (parse(v1), parse(v2)) {
        (Some((maj1, min1, rel1)), Some((maj2, min2, rel2))) => {
            if maj1 != maj2 || min1 != min2 { return false; }
            (rel1 - rel2).abs() <= 3
        }
        _ => false,
    }
}

static WARNING_SHOWN: AtomicBool = AtomicBool::new(false);

fn check_dashboard_compatibility() {
    if let Ok(dir) = config::config_dir() {
        let path = dir.join("dashboard_version.txt");
        if let Ok(v_dash) = fs::read_to_string(&path) {
            let v_dash = v_dash.trim();
            if !check_version_compatibility(crate::VERSION, v_dash) {
                if !WARNING_SHOWN.load(Ordering::SeqCst) {
                    WARNING_SHOWN.store(true, Ordering::SeqCst);
                    let msg = format!(
                        "Niezgodność wersji!\nDemon: {}\nDashboard: {}\n\nDuet może nie działać poprawnie.",
                        crate::VERSION, v_dash
                    );
                    log::error!("{}", msg);
                    
                    // Show message box (non-blocking if possible, but here it's fine since it's a separate thread)
                    unsafe {
                        use std::ptr;
                        let title: Vec<u16> = "TimeFlow - Błąd wersji".encode_utf16().chain(std::iter::once(0)).collect();
                        let text: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
                        winapi::um::winuser::MessageBoxW(
                            ptr::null_mut(),
                            text.as_ptr(),
                            title.as_ptr(),
                            winapi::um::winuser::MB_OK | winapi::um::winuser::MB_ICONWARNING | winapi::um::winuser::MB_TOPMOST,
                        );
                    }
                }
            } else {
                // Reset flag if versions become compatible again (e.g. after update)
                WARNING_SHOWN.store(false, Ordering::SeqCst);
            }
        }
    }
}

/// Uruchamia wątek monitora. Zwraca JoinHandle.
/// `stop_signal` — ustaw na true, aby zatrzymać wątek.
pub fn start(
    stop_signal: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        log::info!("Wątek monitora uruchomiony");
        run_loop(stop_signal);
        log::info!("Wątek monitora zatrzymany");
    })
}

/// Rejestruje aktywność aplikacji (dodaje czas, aktualizuje sesje i pliki).
fn record_app_activity(
    exe_name: &str,
    file_name: &str,
    poll_interval: Duration,
    session_gap: Duration,
    cfg: &config::Config,
    daily_data: &mut storage::DailyData,
    active_sessions: &mut HashMap<String, Instant>,
    file_index_cache: &mut HashMap<String, HashMap<String, usize>>,
) {
    let now_str = Local::now().to_rfc3339();

    let app_data = daily_data
        .apps
        .entry(exe_name.to_string())
        .or_insert_with(|| AppDailyData {
            display_name: config::display_name_for(cfg, exe_name),
            total_seconds: 0,
            total_time_formatted: String::new(),
            sessions: Vec::new(),
            files: Vec::new(),
        });

    app_data.total_seconds += poll_interval.as_secs();

    // Zarządzaj sesjami
    let last_active = active_sessions.get(exe_name).copied();
    let now_instant = Instant::now();

    match last_active {
        Some(last) if now_instant.duration_since(last) < session_gap => {
            if let Some(session) = app_data.sessions.last_mut() {
                session.end = now_str.clone();
                session.duration_seconds += poll_interval.as_secs();
            }
        }
        _ => {
            app_data.sessions.push(Session {
                start: now_str.clone(),
                end: now_str.clone(),
                duration_seconds: poll_interval.as_secs(),
            });
        }
    }
    active_sessions.insert(exe_name.to_string(), now_instant);

    // Aktualizuj pliki
    if !file_name.is_empty() {
        let app_file_index = file_index_cache.entry(exe_name.to_string()).or_default();

        if let Some(&idx) = app_file_index.get(file_name) {
            if let Some(file_entry) = app_data.files.get_mut(idx) {
                file_entry.total_seconds += poll_interval.as_secs();
                file_entry.last_seen = now_str;
            }
        } else {
            let new_idx = app_data.files.len();
            app_data.files.push(FileEntry {
                name: file_name.to_string(),
                total_seconds: poll_interval.as_secs(),
                first_seen: now_str.clone(),
                last_seen: now_str,
            });
            app_file_index.insert(file_name.to_string(), new_idx);
        }
    }
}

fn run_loop(stop_signal: Arc<AtomicBool>) {
    let mut pid_cache: PidCache = HashMap::new();
    let mut cfg = config::load();
    let mut monitored: HashSet<String> = config::monitored_exe_names(&cfg);
    let mut monitor_all = monitored.is_empty();
    if monitor_all {
        log::warn!("Brak monitorowanych aplikacji w configu - przejście w tryb monitorowania wszystkich okien");
    }
    let iv = config::intervals(&cfg);

    let mut daily_data = storage::load_today();
    let mut current_date = Local::now().date_naive();

    let mut last_save = Instant::now();
    let mut last_cache_evict = Instant::now();
    let mut last_config_reload = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut last_tracking_tick = Instant::now();
    write_heartbeat();

    // Stan aktywnej sesji per aplikacja
    let mut active_sessions: HashMap<String, Instant> = HashMap::new();
    // Indeks nazw plików per aplikacja -> pozycja w wektorze files
    let mut file_index_cache: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for (exe_name, app_data) in &daily_data.apps {
        let file_map = file_index_cache.entry(exe_name.clone()).or_insert_with(HashMap::new);
        for (idx, file_entry) in app_data.files.iter().enumerate() {
            file_map.insert(file_entry.name.clone(), idx);
        }
    }
    // Stan CPU per aplikacja (dla detekcji aktywności w tle)
    let mut cpu_state: CpuState = HashMap::new();

    let mut poll_interval = Duration::from_secs(iv.poll_secs);
    let mut save_interval = Duration::from_secs(iv.save_secs);
    let mut cache_evict_interval = Duration::from_secs(iv.cache_evict_secs);
    let mut cache_max_age = Duration::from_secs(iv.cache_max_age_secs);
    let mut session_gap = Duration::from_secs(iv.session_gap_secs);
    let mut config_reload_interval = Duration::from_secs(iv.config_reload_secs);
    let mut cpu_thresh = iv.cpu_threshold;

    loop {
        // Sprawdź sygnał zatrzymania
        if stop_signal.load(Ordering::Relaxed) {
            // Końcowy zapis przed wyjściem
            let _ = storage::save_daily(&mut daily_data);
            break;
        }

        // Sprawdź zmianę daty (północ)
        let today = Local::now().date_naive();
        if today != current_date {
            log::info!("Zmiana daty: {} → {}", current_date, today);
            let _ = storage::save_daily(&mut daily_data);
            daily_data = storage::load_daily(today);
            current_date = today;
            active_sessions.clear();
            file_index_cache.clear();
            for (exe_name, app_data) in &daily_data.apps {
                let file_map = file_index_cache.entry(exe_name.clone()).or_insert_with(HashMap::new);
                for (idx, file_entry) in app_data.files.iter().enumerate() {
                    file_map.insert(file_entry.name.clone(), idx);
                }
            }
            cpu_state.clear();
        }

        // Przeładuj konfigurację (dashboard może ją zmienić)
        if last_config_reload.elapsed() >= config_reload_interval {
            cfg = config::load();
            check_dashboard_compatibility(); // Added check
            monitored = config::monitored_exe_names(&cfg);
            monitor_all = monitored.is_empty();
            let iv = config::intervals(&cfg);
            last_config_reload = Instant::now();
            poll_interval = Duration::from_secs(iv.poll_secs);
            save_interval = Duration::from_secs(iv.save_secs);
            cache_evict_interval = Duration::from_secs(iv.cache_evict_secs);
            cache_max_age = Duration::from_secs(iv.cache_max_age_secs);
            session_gap = Duration::from_secs(iv.session_gap_secs);
            config_reload_interval = Duration::from_secs(iv.config_reload_secs);
            cpu_thresh = iv.cpu_threshold;
        }

        // Oblicz rzeczywisty czas jaki minął od ostatniego odpytania (D-9, D-11)
        let now = Instant::now();
        let actual_elapsed = now.duration_since(last_tracking_tick);
        last_tracking_tick = now;

        // Odpytaj foreground window
        let foreground_exe = monitor::get_foreground_info(&mut pid_cache).and_then(|info| {
            log::debug!("Wykryto okno: {} (PID: {}) [{}]", info.exe_name, info.pid, info.window_title);
            if monitor_all || monitored.contains(&info.exe_name) {
                Some(info)
            } else {
                None
            }
        });

        // Zbierz nazwy aplikacji aktywnych na foreground w tym ticku
        let mut recorded_this_tick: HashSet<String> = HashSet::new();

        // Foreground tracking (jak dotychczas)
        if let Some(ref info) = foreground_exe {
            let file_name = monitor::extract_file_from_title(&info.window_title);
            record_app_activity(
                &info.exe_name,
                &file_name,
                actual_elapsed,
                session_gap,
                &cfg,
                &mut daily_data,
                &mut active_sessions,
                &mut file_index_cache,
            );
            recorded_this_tick.insert(info.exe_name.clone());
        }

        // CPU-based background tracking (dla monitorowanych aplikacji NIE na foreground)
        // Build process snapshot once per tick (instead of 2N snapshots for N apps)
        if !monitor_all {
            let proc_snap = monitor::build_process_snapshot();

            for exe_name in &monitored {
                if recorded_this_tick.contains(exe_name) {
                    // Już zliczona przez foreground — tylko aktualizuj snapshot CPU
                    let (_, snapshot) = monitor::measure_cpu_for_app(exe_name, cpu_state.get(exe_name), &proc_snap);
                    cpu_state.insert(exe_name.clone(), snapshot);
                    continue;
                }

                let prev = cpu_state.get(exe_name);
                let had_prev = prev.is_some();
                let (cpu_fraction, snapshot) = monitor::measure_cpu_for_app(exe_name, prev, &proc_snap);
                cpu_state.insert(exe_name.clone(), snapshot);

                if had_prev && cpu_fraction > cpu_thresh {
                    log::debug!(
                        "CPU aktywność w tle: {} → {:.1}% (próg: {:.1}%)",
                        exe_name,
                        cpu_fraction * 100.0,
                        cpu_thresh * 100.0,
                    );
                    // Rejestruj aktywność bez nazwy pliku (nie znamy tytułu okna w tle)
                    record_app_activity(
                        exe_name,
                        "(background)",
                        actual_elapsed,
                        session_gap,
                        &cfg,
                        &mut daily_data,
                        &mut active_sessions,
                        &mut file_index_cache,
                    );
                }
            }
        }

        // Heartbeat dla zewnętrznej diagnostyki "żywego" demona.
        // Używamy minimum z poll_interval i 30s
        let heartbeat_interval = std::cmp::min(poll_interval, Duration::from_secs(30));
        if last_heartbeat.elapsed() >= heartbeat_interval {
            write_heartbeat();
            last_heartbeat = Instant::now();
        }

        // Zapis okresowy
        if last_save.elapsed() >= save_interval {
            if let Err(e) = storage::save_daily(&mut daily_data) {
                log::error!("Error saving daily data: {}", e);
                log::logger().flush();
            }
            last_save = Instant::now();
        }

        // Ewikcja starych wpisów cache PID
        if last_cache_evict.elapsed() >= cache_evict_interval {
            monitor::evict_old_pid_cache(&mut pid_cache, cache_max_age);
            last_cache_evict = Instant::now();
        }

        // Śpij z wczesnym sprawdzeniem sygnału zatrzymania (D-10)
        // Check time remaining to the next scheduled tick
        let elapsed_since_tick = last_tracking_tick.elapsed();
        if elapsed_since_tick < poll_interval {
            let remain = poll_interval - elapsed_since_tick;
            let sleep_chunks = (remain.as_secs_f32().ceil() as u32).max(1);
            
            for _ in 0..sleep_chunks {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(Duration::from_secs(1).min(remain));
            }
        }
    }
}
