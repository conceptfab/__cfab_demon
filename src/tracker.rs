// Tracker module — background monitoring thread
// Wakes every 10s, checks foreground window + CPU usage, aggregates data.
// Saves to JSON every 5 minutes. Minimal CPU/RAM footprint.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use chrono::{DateTime, Local, Timelike};
use timeflow_shared::version_compat;

use crate::activity::ActivityType;
use crate::config;
use crate::platform::foreground_signal::ForegroundSignal;
use crate::monitor::{self, CpuState, PidCache};
use crate::storage::{self, AppDailyData, FileEntry, Session};

fn rebuild_file_index_cache(
    daily_data: &storage::DailyData,
) -> HashMap<String, HashMap<String, usize>> {
    let mut cache: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for (exe_name, app_data) in &daily_data.apps {
        let file_map = cache.entry(exe_name.clone()).or_default();
        for (idx, file_entry) in app_data.files.iter().enumerate() {
            if let Some(cache_key) = build_file_cache_key(
                &file_entry.name,
                file_entry.detected_path.as_deref(),
                &file_entry.window_title,
            ) {
                file_map.insert(cache_key, idx);
            }
        }
    }
    cache
}

const CACHE_PREFIX_PATH: &str = "path:";
const CACHE_PREFIX_TITLE: &str = "title:";
const CACHE_PREFIX_NAME: &str = "name:";

fn build_file_cache_key(
    file_name: &str,
    detected_path: Option<&str>,
    window_title: &str,
) -> Option<String> {
    // Cache keys must match storage-normalized records loaded after restart,
    // even though raw values stay untouched in memory until save.
    let normalized_file_name = storage::sanitize_file_entry_name(file_name);
    if normalized_file_name.is_empty() {
        return None;
    }

    let normalized_detected_path = detected_path
        .map(storage::sanitize_detected_path)
        .filter(|path| !path.is_empty());
    let normalized_window_title = storage::sanitize_window_title(window_title);

    if let Some(path) = normalized_detected_path {
        return Some(format!("{CACHE_PREFIX_PATH}{path}"));
    }

    if !normalized_window_title.is_empty() {
        return Some(format!(
            "{CACHE_PREFIX_TITLE}{normalized_file_name}\n{normalized_window_title}"
        ));
    }

    Some(format!("{CACHE_PREFIX_NAME}{normalized_file_name}"))
}

fn write_heartbeat() {
    if let Ok(dir) = config::config_dir() {
        let heartbeat = dir.join("heartbeat.txt");
        let _ = fs::write(heartbeat, Local::now().to_rfc3339());
    }
}

fn wall_delta_since(last: SystemTime, now: SystemTime) -> Duration {
    now.duration_since(last).unwrap_or(Duration::ZERO)
}

static WARNING_SHOWN: AtomicBool = AtomicBool::new(false);
const BACKGROUND_PROCESS_SNAPSHOT_INTERVAL: Duration = Duration::from_secs(30);

fn check_dashboard_compatibility() {
    if let Ok(dir) = config::config_dir() {
        let path = dir.join("dashboard_version.txt");
        if let Ok(v_dash) = fs::read_to_string(&path) {
            let v_dash = v_dash.trim();
            let demon_version = crate::VERSION.trim();
            if !version_compat::check_version_compatibility(demon_version, v_dash) {
                if WARNING_SHOWN
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
                    .is_ok()
                {
                    let lang_obj = crate::i18n::load_language();
                    let msg = lang_obj
                        .t(crate::i18n::TrayText::VersionMismatchTemplate)
                        .replacen("{}", demon_version, 1)
                        .replacen("{}", v_dash, 1);
                    log::error!("{}", msg);

                    // Display warning without blocking the monitoring loop.
                    // Nativeowy dialog tylko na Windows; na innych platformach
                    // zostaje log::error! powyżej.
                    #[cfg(windows)]
                    std::thread::spawn(move || unsafe {
                        use std::ptr;
                        let title_text = lang_obj
                            .t(crate::i18n::TrayText::VersionErrorTitle)
                            .to_string();
                        let title: Vec<u16> = title_text
                            .encode_utf16()
                            .chain(std::iter::once(0))
                            .collect();
                        let text: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
                        winapi::um::winuser::MessageBoxW(
                            ptr::null_mut(),
                            text.as_ptr(),
                            title.as_ptr(),
                            winapi::um::winuser::MB_OK
                                | winapi::um::winuser::MB_ICONWARNING
                                | winapi::um::winuser::MB_TOPMOST,
                        );
                    });
                    #[cfg(not(windows))]
                    {
                        let _ = lang_obj;
                        let _ = msg;
                    }
                }
            } else {
                // Reset flag if versions become compatible again (e.g. after update)
                WARNING_SHOWN.store(false, Ordering::SeqCst);
            }
        } else {
            // File missing (dashboard not installed/uninstalled) — reset so warning
            // can trigger again if dashboard reappears with incompatible version
            WARNING_SHOWN.store(false, Ordering::SeqCst);
        }
    }
}

fn should_refresh_background_process_snapshot(last_refresh: Option<Instant>, now: Instant) -> bool {
    match last_refresh {
        None => true,
        Some(last_refresh) => {
            now.duration_since(last_refresh) >= BACKGROUND_PROCESS_SNAPSHOT_INTERVAL
        }
    }
}

/// Decides whether a monitored app's CPU usage in the background should be
/// recorded as activity this tick.
///
/// `is_idle` — no keyboard/mouse input for the idle threshold. Background CPU
/// from a non-present user (e.g. a multi-hour render after they walked away) is
/// not real work and must not accrue time.
/// `had_prev` — a previous CPU snapshot exists, so `cpu_fraction` is a valid
/// delta (the first measurement after a reset reports 0 and is meaningless).
fn should_record_background_cpu(
    is_idle: bool,
    had_prev: bool,
    cpu_fraction: f64,
    cpu_thresh: f64,
) -> bool {
    !is_idle && had_prev && cpu_fraction > cpu_thresh
}

fn is_db_frozen(sync_state: Option<&Arc<crate::lan_server::LanSyncState>>) -> bool {
    sync_state.is_some_and(|s| s.db_frozen.load(Ordering::Acquire))
}

fn save_daily_if_unfrozen(
    store: &mut storage::DailyStore,
    daily_data: &mut storage::DailyData,
    sync_state: Option<&Arc<crate::lan_server::LanSyncState>>,
    context: &str,
) -> bool {
    if is_db_frozen(sync_state) {
        log::debug!("Skipping {} save — database frozen for sync", context);
        return false;
    }

    if let Err(e) = store.save(daily_data) {
        log::error!("Error saving daily data during {}: {}", context, e);
        log::logger().flush();
    }
    true
}

fn should_flush_skipped_save(
    sync_state: Option<&Arc<crate::lan_server::LanSyncState>>,
    save_skipped_while_frozen: bool,
) -> bool {
    save_skipped_while_frozen && !is_db_frozen(sync_state)
}

fn close_sessions_on_idle_transition(
    is_idle: bool,
    was_idle: bool,
    active_sessions: &mut HashMap<String, Instant>,
) -> bool {
    if is_idle && !was_idle && !active_sessions.is_empty() {
        active_sessions.clear();
        true
    } else {
        false
    }
}

/// Starts the monitor thread. Returns a JoinHandle.
/// `stop_signal` — set to true to stop the thread.
/// `foreground_signal` — optional event from SetWinEventHook for instant wake on window change.
/// `sync_state` — shared LAN sync state; tracker skips saves when `db_frozen` is true.
pub fn start(
    stop_signal: Arc<AtomicBool>,
    foreground_signal: Option<Arc<ForegroundSignal>>,
    sync_state: Option<Arc<crate::lan_server::LanSyncState>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        log::info!("Monitor thread started");
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_loop(stop_signal, foreground_signal, sync_state);
        })) {
            Ok(()) => log::info!("Monitor thread stopped"),
            Err(_) => log::error!("Monitor thread PANICKED (see panic log above)"),
        }
        log::logger().flush();
    })
}

const MAX_TITLE_HISTORY_LEN: usize = 12;

fn push_title_history(history: &mut Vec<String>, window_title: &str) {
    let normalized = storage::sanitize_title_history_entry(window_title);
    if normalized.is_empty() {
        return;
    }
    if history.iter().any(|entry| entry == &normalized) {
        return;
    }
    if history.len() >= MAX_TITLE_HISTORY_LEN {
        history.remove(0);
    }
    history.push(normalized);
}

/// Splits a tick's elapsed time between the previous foreground app and the
/// current one when a foreground switch happened mid-tick.
///
/// `since_switch` is `now - switch_time` when a switch fell strictly inside the
/// tick, otherwise `None`. Returns `(prev_elapsed, current_elapsed)` such that
/// `prev_elapsed + current_elapsed == actual_elapsed`: the leaving app keeps the
/// time up to the switch, the entering app gets the remainder.
fn split_switch_elapsed(
    actual_elapsed: Duration,
    since_switch: Option<Duration>,
) -> (Duration, Duration) {
    match since_switch {
        Some(since) => {
            let current = since.min(actual_elapsed);
            let prev = actual_elapsed - current;
            (prev, current)
        }
        None => (Duration::ZERO, actual_elapsed),
    }
}

fn aligned_local_now() -> DateTime<Local> {
    let now = Local::now();
    now.with_nanosecond(0).unwrap_or(now)
}

fn session_start_time_for_elapsed(now: DateTime<Local>, elapsed: Duration) -> DateTime<Local> {
    now - chrono::Duration::seconds(elapsed.as_secs().min(i64::MAX as u64) as i64)
}

fn compute_session_duration_seconds(
    session_start: &str,
    session_end: DateTime<Local>,
    fallback_seconds: u64,
) -> u64 {
    DateTime::parse_from_rfc3339(session_start)
        .ok()
        .and_then(|start| {
            session_end
                .signed_duration_since(start.with_timezone(&Local))
                .to_std()
                .ok()
        })
        .map(|duration| duration.as_secs())
        .unwrap_or(fallback_seconds)
}

fn update_file_entry(
    file_entry: &mut FileEntry,
    elapsed_seconds: u64,
    now_str: &str,
    window_title: &str,
    detected_path: Option<&str>,
    activity_type: Option<&str>,
) {
    file_entry.total_seconds += elapsed_seconds;
    file_entry.last_seen = now_str.to_string();
    file_entry.activity_spans = crate::daily_store::extend_activity_spans(
        &file_entry.activity_spans,
        now_str,
        now_str,
    );

    // Keep the latest title because it carries the richest AI context.
    if !window_title.is_empty() {
        file_entry.window_title = window_title.to_string();
        push_title_history(&mut file_entry.title_history, window_title);
    }
    if let Some(path) = detected_path {
        file_entry.detected_path = Some(path.to_string());
    }
    if let Some(kind) = activity_type {
        file_entry.activity_type = Some(kind.to_string());
    }
}

fn build_new_file_entry(
    file_name: &str,
    elapsed_seconds: u64,
    now_str: &str,
    window_title: &str,
    detected_path: Option<&str>,
    activity_type: Option<&str>,
) -> FileEntry {
    let mut title_history = Vec::new();
    push_title_history(&mut title_history, window_title);

    FileEntry {
        name: file_name.to_string(),
        total_seconds: elapsed_seconds,
        first_seen: now_str.to_string(),
        last_seen: now_str.to_string(),
        window_title: window_title.to_string(),
        detected_path: detected_path.map(str::to_string),
        title_history,
        activity_type: activity_type.map(str::to_string),
        activity_spans: vec![(now_str.to_string(), now_str.to_string())],
    }
}

struct ActivityContext<'a> {
    exe_name: &'a str,
    file_name: &'a str,
    window_title: &'a str,
    detected_path: Option<&'a str>,
    activity_type: Option<ActivityType>,
    elapsed: Duration,
    session_gap: Duration,
}

/// Records application activity (adds time, updates sessions and files).
fn record_app_activity(
    activity: ActivityContext<'_>,
    cfg: &config::Config,
    daily_data: &mut storage::DailyData,
    active_sessions: &mut HashMap<String, Instant>,
    file_index_cache: &mut HashMap<String, HashMap<String, usize>>,
) {
    let ActivityContext {
        exe_name,
        file_name,
        window_title,
        detected_path,
        activity_type,
        elapsed,
        session_gap,
    } = activity;
    let now = aligned_local_now();
    let now_str = now.to_rfc3339();
    let elapsed_seconds = elapsed.as_secs();
    let normalized_activity_type = activity_type.map(ActivityType::as_str);
    let trimmed_file_name = file_name.trim();
    let trimmed_window_title = window_title.trim();
    let trimmed_detected_path = detected_path
        .map(str::trim)
        .filter(|value| !value.is_empty());

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

    app_data.total_seconds += elapsed_seconds;

    // Manage sessions
    let last_active = active_sessions.get(exe_name).copied();
    let now_instant = Instant::now();

    match last_active {
        Some(last) if now_instant.duration_since(last) < session_gap => {
            if let Some(session) = app_data.sessions.last_mut() {
                session.end = now_str.clone();
                session.duration_seconds = compute_session_duration_seconds(
                    &session.start,
                    now,
                    session.duration_seconds.saturating_add(elapsed_seconds),
                );
            }
        }
        _ => {
            let session_start = session_start_time_for_elapsed(now, elapsed).to_rfc3339();
            app_data.sessions.push(Session {
                start: session_start,
                end: now_str.clone(),
                duration_seconds: elapsed_seconds,
            });
        }
    }
    active_sessions.insert(exe_name.to_string(), now_instant);

    // Update files
    if !trimmed_file_name.is_empty() {
        let app_file_index = file_index_cache.entry(exe_name.to_string()).or_default();
        let Some(file_cache_key) = build_file_cache_key(
            trimmed_file_name,
            trimmed_detected_path,
            trimmed_window_title,
        ) else {
            return;
        };

        // Primary lookup by full cache key; fallback by normalized name
        // to avoid duplicates when window_title changes (e.g. "[modified]").
        let matched_idx = app_file_index.get(&file_cache_key).copied().or_else(|| {
            // Fallback: find existing entry with the same normalized name
            // (only when the primary key is title-based, i.e. no detected_path).
            if file_cache_key.starts_with(CACHE_PREFIX_TITLE)
                || file_cache_key.starts_with(CACHE_PREFIX_NAME)
            {
                // Pre-normalize once to avoid re-allocating per candidate.
                let needle = storage::sanitize_file_entry_name(trimmed_file_name);
                // Guard: only match entries without a detected_path to avoid
                // merging different files that share the same base name.
                app_data
                    .files
                    .iter()
                    .position(|f| f.detected_path.is_none() && f.name == needle)
            } else {
                None
            }
        });

        if let Some(idx) = matched_idx {
            // Ensure current cache key maps to this entry so subsequent
            // ticks hit the primary lookup instead of the fallback scan.
            app_file_index.entry(file_cache_key.clone()).or_insert(idx);

            if let Some(file_entry) = app_data.files.get_mut(idx) {
                update_file_entry(
                    file_entry,
                    elapsed_seconds,
                    &now_str,
                    trimmed_window_title,
                    trimmed_detected_path,
                    normalized_activity_type,
                );
                if let Some(updated_cache_key) = build_file_cache_key(
                    &file_entry.name,
                    file_entry.detected_path.as_deref(),
                    &file_entry.window_title,
                ) {
                    if updated_cache_key != file_cache_key {
                        app_file_index.remove(&file_cache_key);
                    }
                    app_file_index.insert(updated_cache_key, idx);
                }
            }
        } else {
            let new_idx = app_data.files.len();
            app_data.files.push(build_new_file_entry(
                trimmed_file_name,
                elapsed_seconds,
                &now_str,
                trimmed_window_title,
                trimmed_detected_path,
                normalized_activity_type,
            ));
            app_file_index.insert(file_cache_key, new_idx);
        }
    }
}

/// Zwraca kanoniczny (skonfigurowany) exe_name dla procesu foreground albo None.
/// Kolejność: dokładny exe_name (Windows basename / macOS localizedName),
/// potem bundle_id (macOS — odporny na lokalizację nazwy i rozjazd nazwy binarki).
fn resolve_monitored_exe(
    info: &monitor::ProcessInfo,
    matchers: &config::MonitoredMatchers,
) -> Option<String> {
    if matchers.exe_names.contains(&info.exe_name) {
        return Some(info.exe_name.clone());
    }
    info.bundle_id
        .as_deref()
        .and_then(|bundle| matchers.bundle_to_exe.get(bundle))
        .cloned()
}

fn run_loop(stop_signal: Arc<AtomicBool>, foreground_signal: Option<Arc<ForegroundSignal>>, sync_state: Option<Arc<crate::lan_server::LanSyncState>>) {
    let mut pid_cache: PidCache = HashMap::new();
    #[cfg(windows)]
    monitor::warm_path_detection_wmi();
    let mut cfg = config::load();
    let mut matchers = config::monitored_matchers(&cfg);
    let mut tracking_enabled = !matchers.exe_names.is_empty();
    if !tracking_enabled {
        log::warn!("No monitored applications configured - tracking paused");
    }
    let iv = config::intervals(&cfg);

    let mut daily_data = storage::load_today();
    let mut current_date = Local::now().date_naive();
    let mut daily_store = match storage::DailyStore::open() {
        Ok(store) => store,
        Err(e) => {
            log::error!("Failed to open DailyStore: {} — monitor thread aborting", e);
            return;
        }
    };

    let mut save_skipped_while_frozen = false;
    let mut last_cache_evict = Instant::now();
    let mut last_config_reload = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut last_tracking_tick = Instant::now();
    // Wall-clock twin of last_tracking_tick. Used to detect system sleep:
    // Instant is uptime-based (stops during sleep on macOS/Windows), but
    // SystemTime keeps advancing in UTC. A large wall-vs-uptime delta means
    // the OS suspended us and no activity should be credited for that gap.
    let mut last_tracking_tick_wall = SystemTime::now();
    write_heartbeat();

    // Active session state per application
    let mut active_sessions: HashMap<String, Instant> = HashMap::new();
    // File name index per application -> position in files vector
    let mut file_index_cache = rebuild_file_index_cache(&daily_data);
    // CPU state per application (for background activity detection)
    let mut cpu_state: CpuState = HashMap::new();
    let mut process_snapshot_cache: Option<monitor::ProcessSnapshot> = None;
    let mut last_process_snapshot_refresh: Option<Instant> = None;

    let mut poll_interval = Duration::from_secs(iv.poll_secs);
    let mut save_interval = Duration::from_secs(iv.save_secs);
    let mut last_save = Instant::now() - save_interval.saturating_sub(Duration::from_secs(30));
    let mut cache_evict_interval = Duration::from_secs(iv.cache_evict_secs);
    let mut cache_max_age = Duration::from_secs(iv.cache_max_age_secs);
    let mut session_gap = Duration::from_secs(iv.session_gap_secs);
    let mut config_reload_interval = Duration::from_secs(iv.config_reload_secs);
    let mut cpu_thresh = iv.cpu_threshold;

    // Idle threshold: 2 minutes without keyboard/mouse input
    const IDLE_THRESHOLD_MS: u64 = 120_000;
    let mut was_idle = false;
    // Foreground app seen on the previous tick. Used to credit the app the user
    // was leaving for the pre-switch slice of a tick (see split_switch_elapsed).
    let mut last_foreground: Option<monitor::ProcessInfo> = None;

    loop {
        // Check stop signal
        if stop_signal.load(Ordering::Relaxed) {
            // Final save before exiting
            save_daily_if_unfrozen(&mut daily_store, &mut daily_data, sync_state.as_ref(), "shutdown");
            break;
        }

        // Check for date change (midnight)
        let today = Local::now().date_naive();
        if today != current_date {
            log::info!("Date changed: {} → {}", current_date, today);
            save_skipped_while_frozen =
                !save_daily_if_unfrozen(&mut daily_store, &mut daily_data, sync_state.as_ref(), "date change");
            daily_data = storage::load_daily(today);
            current_date = today;
            active_sessions.clear();
            file_index_cache = rebuild_file_index_cache(&daily_data);
            cpu_state.clear();
        }

        // Reload configuration (dashboard may have changed it)
        if last_config_reload.elapsed() >= config_reload_interval {
            cfg = config::load();
            check_dashboard_compatibility(); // Added check
            matchers = config::monitored_matchers(&cfg);
            tracking_enabled = !matchers.exe_names.is_empty();
            let iv = config::intervals(&cfg);
            last_config_reload = Instant::now();
            poll_interval = Duration::from_secs(iv.poll_secs);
            save_interval = Duration::from_secs(iv.save_secs);
            cache_evict_interval = Duration::from_secs(iv.cache_evict_secs);
            cache_max_age = Duration::from_secs(iv.cache_max_age_secs);
            session_gap = Duration::from_secs(iv.session_gap_secs);
            config_reload_interval = Duration::from_secs(iv.config_reload_secs);
            cpu_thresh = iv.cpu_threshold;
            process_snapshot_cache = None;
            last_process_snapshot_refresh = None;
        }

        // Calculate actual elapsed time since last poll (D-9, D-11)
        let now = Instant::now();
        let now_wall = SystemTime::now();

        // System sleep detection: Instant (uptime clock) freezes during
        // macOS/Windows sleep, but wall clock advances. If wall delta exceeds
        // uptime delta by SLEEP_DETECTION_THRESHOLD, the box was asleep —
        // discard this tick, close active sessions, flush state, force
        // idle→active transition so next real input opens a fresh session.
        const SLEEP_DETECTION_THRESHOLD: Duration = Duration::from_secs(30);
        let uptime_delta = now.duration_since(last_tracking_tick);
        let wall_delta = wall_delta_since(last_tracking_tick_wall, now_wall);
        let sleep_gap = wall_delta.saturating_sub(uptime_delta);
        if sleep_gap > SLEEP_DETECTION_THRESHOLD {
            log::info!(
                "System sleep detected: wall={}s uptime={}s gap={}s — pausing tracker, closing sessions",
                wall_delta.as_secs(),
                uptime_delta.as_secs(),
                sleep_gap.as_secs(),
            );
            if let Some(ref signal) = foreground_signal {
                let _ = signal.take_last_switch_time();
            }
            if save_daily_if_unfrozen(&mut daily_store, &mut daily_data, sync_state.as_ref(), "sleep detection") {
                last_save = Instant::now();
                save_skipped_while_frozen = false;
            } else {
                save_skipped_while_frozen = true;
            }
            if let Err(e) = daily_store.reopen() {
                log::warn!("DailyStore reopen after sleep failed: {}", e);
            }
            active_sessions.clear();
            was_idle = true;
            last_tracking_tick = now;
            last_tracking_tick_wall = now_wall;
            continue;
        }

        let max_elapsed = poll_interval.saturating_mul(3);
        let actual_elapsed = now.duration_since(last_tracking_tick).min(max_elapsed);

        // Drain foreground switch timestamps for time-splitting. If a switch
        // happened mid-tick, the app that was in foreground BEFORE the switch is
        // credited for last_tick→switch and the app in foreground now is
        // credited for switch→now. Without splitting both ways, the pre-switch
        // slice was dropped entirely and the post-switch slice floored to ~0s,
        // which lost most of the time on days with frequent window switching.
        let last_switch_time = foreground_signal
            .as_ref()
            .and_then(|s| s.take_last_switch_time());
        let since_switch = last_switch_time.and_then(|last_switch| {
            // Only count switches that fall strictly inside this tick.
            if last_switch > last_tracking_tick && last_switch < now {
                Some(now.duration_since(last_switch))
            } else {
                None
            }
        });
        let (prev_elapsed, current_elapsed) = split_switch_elapsed(actual_elapsed, since_switch);

        last_tracking_tick = now;
        last_tracking_tick_wall = now_wall;

        // Poll foreground window
        let foreground_exe = monitor::get_foreground_info(&mut pid_cache).and_then(|mut info| {
            log::debug!(
                "Detected window: {} (PID: {}) [{}] path={:?} type={:?}",
                info.exe_name,
                info.pid,
                info.window_title,
                info.detected_path,
                info.activity_type
            );
            if !tracking_enabled {
                return None;
            }
            let canonical = resolve_monitored_exe(&info, &matchers)?;
            // Kanonizacja: zapis zawsze pod skonfigurowanym exe_name, więc
            // display_name_for() i agregaty działają niezależnie od ścieżki dopasowania.
            info.exe_name = canonical;
            Some(info)
        });

        // Collect application names active in foreground this tick
        let mut recorded_this_tick: HashSet<String> = HashSet::new();

        // Idle detection: skip foreground recording when user is idle (no kb/mouse input)
        let idle_ms = monitor::get_idle_time_ms();
        let is_idle = idle_ms >= IDLE_THRESHOLD_MS;
        let was_idle_before_tick = was_idle;

        // Foreground tracking (skip when idle — don't count time without user input)
        if !is_idle {
            // Credit the app that was in foreground before a mid-tick switch for
            // the pre-switch slice (last_tick→switch). Skipped right after an
            // idle period, where that slice fell during idle and isn't ours.
            if !was_idle_before_tick && prev_elapsed > Duration::ZERO {
                if let Some(prev_info) = last_foreground.as_ref() {
                    let prev_file = monitor::extract_file_from_title(&prev_info.window_title);
                    record_app_activity(
                        ActivityContext {
                            exe_name: &prev_info.exe_name,
                            file_name: &prev_file,
                            window_title: &prev_info.window_title,
                            detected_path: prev_info.detected_path.as_deref(),
                            activity_type: prev_info.activity_type,
                            elapsed: prev_elapsed,
                            session_gap,
                        },
                        &cfg,
                        &mut daily_data,
                        &mut active_sessions,
                        &mut file_index_cache,
                    );
                    recorded_this_tick.insert(prev_info.exe_name.clone());
                }
            }

            // Credit the current foreground app for the post-switch slice. On an
            // idle→active transition idle_ms is ~0 so the split can't estimate
            // the active portion; use the full tick as the first active period.
            let current_for_activity = if was_idle_before_tick {
                log::debug!(
                    "Idle→active transition: recording full {}ms tick",
                    actual_elapsed.as_millis()
                );
                actual_elapsed.max(Duration::from_secs(1))
            } else {
                current_elapsed
            };
            if let Some(ref info) = foreground_exe {
                let file_name = monitor::extract_file_from_title(&info.window_title);
                record_app_activity(
                    ActivityContext {
                        exe_name: &info.exe_name,
                        file_name: &file_name,
                        window_title: &info.window_title,
                        detected_path: info.detected_path.as_deref(),
                        activity_type: info.activity_type,
                        elapsed: current_for_activity,
                        session_gap,
                    },
                    &cfg,
                    &mut daily_data,
                    &mut active_sessions,
                    &mut file_index_cache,
                );
                recorded_this_tick.insert(info.exe_name.clone());
            }
        } else {
            // On transition into idle, forget active sessions so that the
            // next active tick opens a fresh session instead of extending
            // the pre-idle one across the idle gap (Task 19).
            let active_before_clear = active_sessions.len();
            if close_sessions_on_idle_transition(is_idle, was_idle_before_tick, &mut active_sessions) {
                log::info!(
                    "Idle transition ({}ms ≥ {}ms): closing {} active session(s)",
                    idle_ms,
                    IDLE_THRESHOLD_MS,
                    active_before_clear
                );
            }
            log::debug!("User idle for {}ms, skipping foreground recording", idle_ms);
        }
        // Remember the current foreground app for the next tick's pre-switch
        // credit. Cleared while idle so a pre-idle app isn't credited later.
        last_foreground = if is_idle { None } else { foreground_exe.clone() };
        was_idle = is_idle;

        // CPU-based background tracking (for monitored apps NOT in foreground)
        // Build process snapshot at most every 30s for background apps.
        // Foreground tracking uses GetForegroundWindow/PID cache and does not need this snapshot.
        if tracking_enabled {
            let snapshot_now = Instant::now();
            if should_refresh_background_process_snapshot(
                last_process_snapshot_refresh,
                snapshot_now,
            ) {
                process_snapshot_cache = Some(monitor::build_process_snapshot());
                last_process_snapshot_refresh = Some(snapshot_now);
            }
            let empty_snapshot = monitor::ProcessSnapshot {
                tree: std::collections::HashMap::new(),
                exe_pids: std::collections::HashMap::new(),
                pid_paths: Vec::new(),
            };
            let proc_snap = match process_snapshot_cache.as_ref() {
                Some(snap) => snap,
                None => {
                    log::warn!("process_snapshot_cache is None — skipping background tracking this tick");
                    &empty_snapshot
                }
            };

            for exe_name in &matchers.exe_names {
                let app_path = matchers.app_paths.get(exe_name).map(String::as_str);
                if recorded_this_tick.contains(exe_name) {
                    // Already counted by foreground — just update CPU snapshot
                    let (_, snapshot) = monitor::measure_cpu_for_app(
                        exe_name,
                        app_path,
                        cpu_state.get(exe_name),
                        proc_snap,
                    );
                    cpu_state.insert(exe_name.clone(), snapshot);
                    continue;
                }

                let prev = cpu_state.get(exe_name);
                let had_prev = prev.is_some();
                let (cpu_fraction, snapshot) =
                    monitor::measure_cpu_for_app(exe_name, app_path, prev, proc_snap);
                cpu_state.insert(exe_name.clone(), snapshot);

                // Gate background-CPU recording on user presence: a monitored app
                // pegging CPU while the user is idle (e.g. a multi-hour render with
                // nobody at the machine) is NOT real activity. The CPU snapshot is
                // still updated above every tick, so the first active tick after the
                // user returns has a valid delta and produces no spike.
                if should_record_background_cpu(is_idle, had_prev, cpu_fraction, cpu_thresh) {
                    log::debug!(
                        "CPU background activity: {} → {:.1}% (threshold: {:.1}%)",
                        exe_name,
                        cpu_fraction * 100.0,
                        cpu_thresh * 100.0,
                    );
                    let background_activity_type = timeflow_shared::activity_classification::classify_activity_type(exe_name, None);
                    // Record activity without file name (window title unknown in background)
                    record_app_activity(
                        ActivityContext {
                            exe_name,
                            file_name: "(background)",
                            window_title: "",
                            detected_path: None,
                            activity_type: background_activity_type,
                            elapsed: actual_elapsed,
                            session_gap,
                        },
                        &cfg,
                        &mut daily_data,
                        &mut active_sessions,
                        &mut file_index_cache,
                    );
                }
            }
        }

        // Heartbeat for external diagnostics of a "live" daemon.
        // Use minimum of poll_interval and 30s
        let heartbeat_interval = std::cmp::min(poll_interval, Duration::from_secs(30));
        if last_heartbeat.elapsed() >= heartbeat_interval {
            write_heartbeat();
            last_heartbeat = Instant::now();
        }

        // Periodic save (skip while database is frozen for LAN sync)
        if last_save.elapsed() >= save_interval {
            if save_daily_if_unfrozen(&mut daily_store, &mut daily_data, sync_state.as_ref(), "periodic") {
                save_skipped_while_frozen = false;
                last_save = Instant::now();
            } else {
                save_skipped_while_frozen = true;
            }
        } else if should_flush_skipped_save(sync_state.as_ref(), save_skipped_while_frozen) {
            log::info!("Database unfrozen — saving skipped data now");
            save_daily_if_unfrozen(&mut daily_store, &mut daily_data, sync_state.as_ref(), "post-unfreeze");
            save_skipped_while_frozen = false;
            last_save = Instant::now();
        }

        // Evict old PID cache entries
        if last_cache_evict.elapsed() >= cache_evict_interval {
            monitor::evict_old_pid_cache(&mut pid_cache, cache_max_age);
            last_cache_evict = Instant::now();
        }

        // Wait for next tick — either woken by foreground hook or timeout
        let elapsed_since_tick = last_tracking_tick.elapsed();
        if elapsed_since_tick < poll_interval {
            let remain = poll_interval.saturating_sub(elapsed_since_tick);
            if let Some(ref signal) = foreground_signal {
                // Event-driven: wake immediately on foreground window change
                if signal.wait_timeout(remain) {
                    log::debug!("Woken early by foreground change event");
                }
            } else {
                // Fallback: chunked sleep with stop signal check
                let sleep_chunks = (remain.as_secs_f32().ceil() as u32).max(1);
                for _ in 0..sleep_chunks {
                    if stop_signal.load(Ordering::Relaxed) {
                        break;
                    }
                    let remaining_now = poll_interval.saturating_sub(last_tracking_tick.elapsed());
                    if remaining_now.is_zero() {
                        break;
                    }
                    thread::sleep(Duration::from_secs(1).min(remaining_now));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        close_sessions_on_idle_transition, compute_session_duration_seconds, record_app_activity,
        resolve_monitored_exe, session_start_time_for_elapsed, should_flush_skipped_save,
        should_record_background_cpu, should_refresh_background_process_snapshot,
        split_switch_elapsed, wall_delta_since,
        ActivityContext, BACKGROUND_PROCESS_SNAPSHOT_INTERVAL,
    };
    use crate::activity::ActivityType;
    use crate::config::Config;
    use crate::lan_server::LanSyncState;
    use crate::storage::{DailyData, DailySummary};
    use chrono::{Local, TimeZone, Timelike};
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime};
    use timeflow_shared::monitored_app::MonitoredApp;

    #[test]
    fn resolve_monitored_exe_prefers_exe_name_then_bundle() {
        let cfg = crate::config::Config {
            apps: vec![timeflow_shared::monitored_app::MonitoredApp {
                exe_name: "antigravity ide".to_string(),
                display_name: "Antigravity IDE".to_string(),
                added_at: String::new(),
                bundle_id: Some("com.google.antigravity-ide".to_string()),
                app_path: None,
            }],
            intervals: Default::default(),
        };
        let matchers = crate::config::monitored_matchers(&cfg);

        // 1) trafienie po exe_name (localizedName)
        let by_name = crate::monitor::ProcessInfo {
            exe_name: "antigravity ide".to_string(),
            pid: 1,
            window_title: String::new(),
            detected_path: None,
            activity_type: None,
            bundle_id: None,
        };
        assert_eq!(
            resolve_monitored_exe(&by_name, &matchers).as_deref(),
            Some("antigravity ide")
        );

        // 2) localizedName inny (np. zlokalizowany), ale bundle_id pasuje → kanoniczny exe_name
        let by_bundle = crate::monitor::ProcessInfo {
            exe_name: "antygrawitacja ide".to_string(),
            pid: 2,
            window_title: String::new(),
            detected_path: None,
            activity_type: None,
            bundle_id: Some("com.google.antigravity-ide".to_string()),
        };
        assert_eq!(
            resolve_monitored_exe(&by_bundle, &matchers).as_deref(),
            Some("antigravity ide")
        );

        // 3) nic nie pasuje
        let miss = crate::monitor::ProcessInfo {
            exe_name: "finder".to_string(),
            pid: 3,
            window_title: String::new(),
            detected_path: None,
            activity_type: None,
            bundle_id: Some("com.apple.finder".to_string()),
        };
        assert_eq!(resolve_monitored_exe(&miss, &matchers), None);
    }

    #[test]
    fn refreshes_background_process_snapshot_when_never_built() {
        let now = Instant::now();
        assert!(should_refresh_background_process_snapshot(None, now));
    }

    #[test]
    fn refreshes_background_process_snapshot_after_interval_elapsed() {
        let now = Instant::now();
        assert!(!should_refresh_background_process_snapshot(
            Some(now - Duration::from_secs(5)),
            now,
        ));
        assert!(should_refresh_background_process_snapshot(
            Some(now - BACKGROUND_PROCESS_SNAPSHOT_INTERVAL),
            now,
        ));
    }

    #[test]
    fn background_cpu_skipped_while_user_idle() {
        // A render pegging the CPU while the user is away must NOT accrue time,
        // even far above threshold.
        assert!(!should_record_background_cpu(true, true, 0.99, 0.05));
        assert!(!should_record_background_cpu(true, true, 1.0, 0.05));
    }

    #[test]
    fn background_cpu_recorded_when_user_present_and_above_threshold() {
        assert!(should_record_background_cpu(false, true, 0.06, 0.05));
        assert!(should_record_background_cpu(false, true, 0.99, 0.05));
    }

    #[test]
    fn background_cpu_skipped_below_threshold_or_without_prior_snapshot() {
        // At/under threshold → not activity.
        assert!(!should_record_background_cpu(false, true, 0.05, 0.05));
        assert!(!should_record_background_cpu(false, true, 0.01, 0.05));
        // No previous snapshot → cpu_fraction is meaningless (reports 0).
        assert!(!should_record_background_cpu(false, false, 0.99, 0.05));
    }

    #[test]
    fn session_start_time_matches_elapsed_seconds() {
        let now = Local
            .with_ymd_and_hms(2026, 3, 11, 12, 0, 30)
            .single()
            .expect("valid datetime")
            .with_nanosecond(0)
            .expect("zero nanos");
        let start = session_start_time_for_elapsed(now, Duration::from_secs(15));
        assert_eq!(now.signed_duration_since(start).num_seconds(), 15);
    }

    #[test]
    fn session_duration_uses_same_bounds_as_stored_timestamps() {
        let end = Local
            .with_ymd_and_hms(2026, 3, 11, 12, 5, 0)
            .single()
            .expect("valid datetime")
            .with_nanosecond(0)
            .expect("zero nanos");
        let duration = compute_session_duration_seconds("2026-03-11T12:00:15+01:00", end, 0);
        assert_eq!(duration, 285);
    }

    #[test]
    fn split_no_switch_credits_current_fully() {
        let (prev, current) = split_switch_elapsed(Duration::from_secs(10), None);
        assert_eq!(prev, Duration::ZERO);
        assert_eq!(current, Duration::from_secs(10));
    }

    #[test]
    fn split_switch_just_before_now_credits_leaving_app() {
        // Event-driven wake: the switch lands a few ms before `now` within a 3s
        // tick. Regression guard — previously the leaving app got nothing and
        // the entering app floored to 0s, losing the whole 3s.
        let (prev, current) =
            split_switch_elapsed(Duration::from_secs(3), Some(Duration::from_millis(5)));
        assert_eq!(current, Duration::from_millis(5));
        assert_eq!(prev, Duration::from_millis(2995));
    }

    #[test]
    fn split_midtick_switch_divides_elapsed() {
        let (prev, current) =
            split_switch_elapsed(Duration::from_secs(10), Some(Duration::from_secs(4)));
        assert_eq!(prev, Duration::from_secs(6));
        assert_eq!(current, Duration::from_secs(4));
    }

    #[test]
    fn split_clamps_since_switch_to_elapsed() {
        // A switch offset larger than the (capped) elapsed must not underflow.
        let (prev, current) =
            split_switch_elapsed(Duration::from_secs(10), Some(Duration::from_secs(15)));
        assert_eq!(prev, Duration::ZERO);
        assert_eq!(current, Duration::from_secs(10));
    }

    #[test]
    fn wall_delta_uses_system_time_duration() {
        let last = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let now = last + Duration::from_secs(5);

        assert_eq!(wall_delta_since(last, now), Duration::from_secs(5));
    }

    #[test]
    fn skipped_save_flushes_only_after_db_unfreeze() {
        let sync_state = Arc::new(LanSyncState::new());
        sync_state.freeze();

        assert!(!should_flush_skipped_save(Some(&sync_state), false));
        assert!(!should_flush_skipped_save(Some(&sync_state), true));

        sync_state.unfreeze();

        assert!(should_flush_skipped_save(Some(&sync_state), true));
    }

    #[test]
    fn same_named_files_with_different_paths_are_tracked_separately() {
        let cfg = Config {
            apps: vec![MonitoredApp {
                exe_name: "code.exe".to_string(),
                display_name: "Code".to_string(),
                added_at: "2026-03-12T00:00:00Z".to_string(),
                bundle_id: None,
                app_path: None,
            }],
            intervals: Default::default(),
        };
        let mut daily_data = DailyData {
            date: "2026-03-12".to_string(),
            generated_at: "2026-03-12T00:00:00Z".to_string(),
            apps: HashMap::new(),
            summary: DailySummary {
                total_app_seconds: 0,
                total_app_formatted: String::new(),
                apps_active_count: 0,
            },
        };
        let mut active_sessions = HashMap::new();
        let mut file_index_cache = HashMap::new();

        record_app_activity(
            ActivityContext {
                exe_name: "code.exe",
                file_name: "index.ts",
                window_title: "repo-a - index.ts",
                detected_path: Some("C:\\repo-a\\src\\index.ts"),
                activity_type: Some(ActivityType::Coding),
                elapsed: Duration::from_secs(10),
                session_gap: Duration::from_secs(120),
            },
            &cfg,
            &mut daily_data,
            &mut active_sessions,
            &mut file_index_cache,
        );
        record_app_activity(
            ActivityContext {
                exe_name: "code.exe",
                file_name: "index.ts",
                window_title: "repo-b - index.ts",
                detected_path: Some("C:\\repo-b\\src\\index.ts"),
                activity_type: Some(ActivityType::Coding),
                elapsed: Duration::from_secs(15),
                session_gap: Duration::from_secs(120),
            },
            &cfg,
            &mut daily_data,
            &mut active_sessions,
            &mut file_index_cache,
        );

        let files = &daily_data.apps.get("code.exe").expect("app tracked").files;
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "index.ts");
        assert_eq!(files[1].name, "index.ts");
        assert_eq!(
            files[0].detected_path.as_deref(),
            Some("C:\\repo-a\\src\\index.ts")
        );
        assert_eq!(
            files[1].detected_path.as_deref(),
            Some("C:\\repo-b\\src\\index.ts")
        );
        assert_eq!(
            files
                .iter()
                .map(|file| file.total_seconds)
                .collect::<Vec<_>>(),
            vec![10, 15]
        );
    }

    #[test]
    fn idle_transition_closes_session_before_next_activity() {
        let cfg = Config {
            apps: vec![MonitoredApp {
                exe_name: "code.exe".to_string(),
                display_name: "Code".to_string(),
                added_at: "2026-03-12T00:00:00Z".to_string(),
                bundle_id: None,
                app_path: None,
            }],
            intervals: Default::default(),
        };
        let mut daily_data = DailyData {
            date: "2026-03-12".to_string(),
            generated_at: "2026-03-12T00:00:00Z".to_string(),
            apps: HashMap::new(),
            summary: DailySummary {
                total_app_seconds: 0,
                total_app_formatted: String::new(),
                apps_active_count: 0,
            },
        };
        let mut active_sessions = HashMap::new();
        let mut file_index_cache = HashMap::new();
        let session_gap = Duration::from_secs(5 * 60);

        record_app_activity(
            ActivityContext {
                exe_name: "code.exe",
                file_name: "main.rs",
                window_title: "TIMEFLOW - main.rs",
                detected_path: Some("/repo/src/main.rs"),
                activity_type: Some(ActivityType::Coding),
                elapsed: Duration::from_secs(5 * 60),
                session_gap,
            },
            &cfg,
            &mut daily_data,
            &mut active_sessions,
            &mut file_index_cache,
        );

        assert!(close_sessions_on_idle_transition(
            true,
            false,
            &mut active_sessions
        ));

        record_app_activity(
            ActivityContext {
                exe_name: "code.exe",
                file_name: "main.rs",
                window_title: "TIMEFLOW - main.rs",
                detected_path: Some("/repo/src/main.rs"),
                activity_type: Some(ActivityType::Coding),
                elapsed: Duration::from_secs(5 * 60),
                session_gap,
            },
            &cfg,
            &mut daily_data,
            &mut active_sessions,
            &mut file_index_cache,
        );

        let sessions = &daily_data.apps.get("code.exe").expect("app tracked").sessions;
        assert_eq!(sessions.len(), 2);
        assert_eq!(
            sessions
                .iter()
                .map(|session| session.duration_seconds)
                .collect::<Vec<_>>(),
            vec![300, 300]
        );
    }
}
