// macOS stub dla modułu `monitor`. W Fazie 1 zapewnia wyłącznie
// wymagane public API (typy + funkcje), żeby tracker kompilował się na Macu.
// Faktyczna detekcja foreground + CPU + idle time to zadanie Fazy 3.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::activity::ActivityType;

// ── Typy identyczne z wersją Windows (tylko cross-platform pola) ────────

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
}

#[derive(Debug, Clone)]
pub struct PidCacheEntry {
    pub exe_name: String,
    pub creation_time: u64,
    pub created_at: Instant,
    pub last_accessed_at: Instant,
    pub last_alive_check: Instant,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
    pub path_detection_attempted: bool,
}

pub type PidCache = HashMap<u32, PidCacheEntry>;

#[derive(Debug, Clone)]
pub struct CpuSnapshot {
    pub total_time: u64,
    pub measured_at: Instant,
}

pub type CpuState = HashMap<String, CpuSnapshot>;

pub struct ProcessSnapshot {
    pub tree: HashMap<u32, Vec<u32>>,
    pub exe_pids: HashMap<String, Vec<u32>>,
}

// ── Cross-platform logika ───────────────────────────────────────────────

pub fn classify_activity_type(exe_name: &str) -> Option<ActivityType> {
    timeflow_shared::activity_classification::classify_activity_type(exe_name, None)
}

pub fn extract_file_from_title(title: &str) -> String {
    let separators = [" — ", " | "];
    for sep in separators {
        if let Some(pos) = title.rfind(sep) {
            let left = title[..pos].trim();
            if !left.is_empty() {
                return left.to_string();
            }
        }
    }
    if let Some(pos) = title.rfind(" - ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }
    if let Some(pos) = title.find(" @ ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }
    title.trim().to_string()
}

pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, entry| now.duration_since(entry.last_accessed_at) < max_age);
}

// ── Stuby platformowe (Faza 1: no-op; Faza 3: prawdziwe API macOS) ─────

pub fn get_foreground_info(_pid_cache: &mut PidCache) -> Option<ProcessInfo> {
    // Faza 3: NSWorkspace.frontmostApplication + AX API dla tytułu okna.
    None
}

pub fn get_idle_time_ms() -> u64 {
    // Faza 3: CGEventSourceSecondsSinceLastEventType. Na razie "zawsze aktywny".
    0
}

pub fn warm_path_detection_wmi() {
    // WMI nie istnieje na macOS — no-op.
}

pub fn build_process_snapshot() -> ProcessSnapshot {
    let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut exe_pids: HashMap<String, Vec<u32>> = HashMap::new();

    if let Some(entries) = crate::platform::process_snapshot::collect_process_entries() {
        for entry in entries {
            tree.entry(entry.parent_process_id)
                .or_default()
                .push(entry.process_id);
            exe_pids
                .entry(entry.exe_name)
                .or_default()
                .push(entry.process_id);
        }
    }

    ProcessSnapshot { tree, exe_pids }
}

pub fn measure_cpu_for_app(
    _exe_name: &str,
    _prev: Option<&CpuSnapshot>,
    _proc_snap: &ProcessSnapshot,
) -> (f64, CpuSnapshot) {
    // Faza 3: sysinfo::Process::cpu_usage() z agregacją po drzewie.
    (
        0.0,
        CpuSnapshot {
            total_time: 0,
            measured_at: Instant::now(),
        },
    )
}
