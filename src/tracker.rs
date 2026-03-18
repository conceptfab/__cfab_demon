// Tracker module — background monitoring thread
// Wakes every 10s, checks foreground window + CPU usage, aggregates data.
// Saves to JSON every 5 minutes. Minimal CPU/RAM footprint.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, Timelike};
use timeflow_shared::version_compat;

use crate::activity::ActivityType;
use crate::config;
use crate::foreground_hook::ForegroundSignal;
use crate::monitor::{self, CpuState, PidCache};
use crate::storage::{self, AppDailyData, FileEntry, Session};

fn rebuild_file_index_cache(
    daily_data: &storage::DailyData,
) -> HashMap<String, HashMap<String, usize>> {
    let mut cache: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for (exe_name, app_data) in &daily_data.apps {
        let file_map = cache.entry(exe_name.clone()).or_insert_with(HashMap::new);
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
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    let lang_obj = crate::i18n::load_language();
                    let msg = lang_obj
                        .t(crate::i18n::TrayText::VersionMismatchTemplate)
                        .replacen("{}", demon_version, 1)
                        .replacen("{}", v_dash, 1);
                    log::error!("{}", msg);

                    // Display warning without blocking the monitoring loop.
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
                }
            } else {
                // Reset flag if versions become compatible again (e.g. after update)
                WARNING_SHOWN.store(false, Ordering::SeqCst);
            }
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

/// Starts the monitor thread. Returns a JoinHandle.
/// `stop_signal` — set to true to stop the thread.
/// `foreground_signal` — optional event from SetWinEventHook for instant wake on window change.
pub fn start(
    stop_signal: Arc<AtomicBool>,
    foreground_signal: Option<Arc<ForegroundSignal>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        log::info!("Monitor thread started");
        run_loop(stop_signal, foreground_signal);
        log::info!("Monitor thread stopped");
    })
}

fn push_title_history(history: &mut Vec<String>, window_title: &str) {
    let normalized = storage::sanitize_title_history_entry(window_title);
    if normalized.is_empty() {
        return;
    }
    if history.iter().any(|entry| entry == &normalized) {
        return;
    }
    history.push(normalized);
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

fn run_loop(stop_signal: Arc<AtomicBool>, foreground_signal: Option<Arc<ForegroundSignal>>) {
    let mut pid_cache: PidCache = HashMap::new();
    monitor::warm_path_detection_wmi();
    let mut cfg = config::load();
    let mut monitored: HashSet<String> = config::monitored_exe_names(&cfg);
    let mut tracking_enabled = !monitored.is_empty();
    if !tracking_enabled {
        log::warn!("No monitored applications configured - tracking paused");
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
    let mut cache_evict_interval = Duration::from_secs(iv.cache_evict_secs);
    let mut cache_max_age = Duration::from_secs(iv.cache_max_age_secs);
    let mut session_gap = Duration::from_secs(iv.session_gap_secs);
    let mut config_reload_interval = Duration::from_secs(iv.config_reload_secs);
    let mut cpu_thresh = iv.cpu_threshold;

    // Idle threshold: 2 minutes without keyboard/mouse input
    const IDLE_THRESHOLD_MS: u64 = 120_000;

    loop {
        // Check stop signal
        if stop_signal.load(Ordering::Relaxed) {
            // Final save before exiting
            let _ = storage::save_daily(&mut daily_data);
            break;
        }

        // Check for date change (midnight)
        let today = Local::now().date_naive();
        if today != current_date {
            log::info!("Date changed: {} → {}", current_date, today);
            let _ = storage::save_daily(&mut daily_data);
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
            monitored = config::monitored_exe_names(&cfg);
            tracking_enabled = !monitored.is_empty();
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
        let max_elapsed = poll_interval.saturating_mul(3);
        let actual_elapsed = now.duration_since(last_tracking_tick).min(max_elapsed);
        last_tracking_tick = now;

        // Poll foreground window
        let foreground_exe = monitor::get_foreground_info(&mut pid_cache).and_then(|info| {
            log::debug!(
                "Detected window: {} (PID: {}) [{}] path={:?} type={:?}",
                info.exe_name,
                info.pid,
                info.window_title,
                info.detected_path,
                info.activity_type
            );
            if tracking_enabled && monitored.contains(&info.exe_name) {
                Some(info)
            } else {
                None
            }
        });

        // Collect application names active in foreground this tick
        let mut recorded_this_tick: HashSet<String> = HashSet::new();

        // Idle detection: skip foreground recording when user is idle (no kb/mouse input)
        let idle_ms = monitor::get_idle_time_ms();
        let is_idle = idle_ms >= IDLE_THRESHOLD_MS;

        // Foreground tracking (skip when idle — don't count time without user input)
        if !is_idle {
            if let Some(ref info) = foreground_exe {
                let file_name = monitor::extract_file_from_title(&info.window_title);
                record_app_activity(
                    ActivityContext {
                        exe_name: &info.exe_name,
                        file_name: &file_name,
                        window_title: &info.window_title,
                        detected_path: info.detected_path.as_deref(),
                        activity_type: info.activity_type,
                        elapsed: actual_elapsed,
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
            log::debug!("User idle for {}ms, skipping foreground recording", idle_ms);
        }

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
            let proc_snap = match process_snapshot_cache.as_ref() {
                Some(snap) => snap,
                None => continue,
            };

            for exe_name in &monitored {
                if recorded_this_tick.contains(exe_name) {
                    // Already counted by foreground — just update CPU snapshot
                    let (_, snapshot) =
                        monitor::measure_cpu_for_app(exe_name, cpu_state.get(exe_name), &proc_snap);
                    cpu_state.insert(exe_name.clone(), snapshot);
                    continue;
                }

                let prev = cpu_state.get(exe_name);
                let had_prev = prev.is_some();
                let (cpu_fraction, snapshot) =
                    monitor::measure_cpu_for_app(exe_name, prev, &proc_snap);
                cpu_state.insert(exe_name.clone(), snapshot);

                if had_prev && cpu_fraction > cpu_thresh {
                    log::debug!(
                        "CPU background activity: {} → {:.1}% (threshold: {:.1}%)",
                        exe_name,
                        cpu_fraction * 100.0,
                        cpu_thresh * 100.0,
                    );
                    let background_activity_type = monitor::classify_activity_type(exe_name);
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

        // Periodic save
        if last_save.elapsed() >= save_interval {
            if let Err(e) = storage::save_daily(&mut daily_data) {
                log::error!("Error saving daily data: {}", e);
                log::logger().flush();
            }
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
            let remain = poll_interval - elapsed_since_tick;
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
        compute_session_duration_seconds, record_app_activity, session_start_time_for_elapsed,
        should_refresh_background_process_snapshot, ActivityContext,
        BACKGROUND_PROCESS_SNAPSHOT_INTERVAL,
    };
    use crate::activity::ActivityType;
    use crate::config::Config;
    use crate::storage::{DailyData, DailySummary};
    use chrono::{Local, TimeZone, Timelike};
    use std::collections::HashMap;
    use std::time::{Duration, Instant};
    use timeflow_shared::monitored_app::MonitoredApp;

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
    fn same_named_files_with_different_paths_are_tracked_separately() {
        let cfg = Config {
            apps: vec![MonitoredApp {
                exe_name: "code.exe".to_string(),
                display_name: "Code".to_string(),
                added_at: "2026-03-12T00:00:00Z".to_string(),
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
}
