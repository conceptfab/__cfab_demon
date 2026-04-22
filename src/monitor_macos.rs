// macOS-specific implementacja modułu `monitor`.
// Faza 3: prawdziwe API do idle time (CGEventSource), foreground
// (NSWorkspace.frontmostApplication) oraz CPU per aplikacja (sysinfo,
// z sumowaniem po drzewie procesów).
// WMI i tytuł okna przez AX API to osobny temat — tytuł okna zostaje pusty
// do czasu dodania obsługi Accessibility (wymaga zgody użytkownika).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::activity::ActivityType;

// ── Typy (zgodne z Windows wariantem) ───────────────────────────────────

#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
}

/// Struktura symetryczna z Windows wariantem (`monitor::PidCacheEntry`),
/// żeby tracker mógł być cross-platform bez cfg-switchy na poziomie pól.
/// Na macOS większość pól nie jest obecnie czytana (klasyfikacja dzieje się
/// w `get_foreground_info` bez powrotu do cache), stąd `allow(dead_code)`.
#[derive(Debug, Clone)]
#[allow(dead_code)]
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

/// Pola przechowywane dla kompatybilności typu z Windows variant'em
/// `monitor::CpuSnapshot`. Tracker konsumuje tylko zwracany `cpu_fraction`
/// z `measure_cpu_for_app`; snapshot leży w pamięci jako opaque marker.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CpuSnapshot {
    /// Sumaryczny `accumulated_cpu_time` (ms) po całym drzewie procesów.
    pub total_time: u64,
    pub measured_at: Instant,
}

pub type CpuState = HashMap<String, CpuSnapshot>;

pub struct ProcessSnapshot {
    pub tree: HashMap<u32, Vec<u32>>,
    pub exe_pids: HashMap<String, Vec<u32>>,
}

// ── Cross-platform logika (niezależna od OS) ────────────────────────────

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

pub fn warm_path_detection_wmi() {
    // WMI nie istnieje na macOS — no-op.
}

// ── Idle time (CoreGraphics FFI) ────────────────────────────────────────

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(
        source_state_id: i32,
        event_type: u32,
    ) -> f64;
}

const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: i32 = 1;
/// CGEventType = 0xFFFFFFFF ≡ „any input event" (mysz, klawiatura, trackpad).
const K_CG_ANY_INPUT_EVENT_TYPE: u32 = !0u32;

/// Bezczynność użytkownika w milisekundach (liczone od ostatniego klawisza / ruchu).
pub fn get_idle_time_ms() -> u64 {
    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(
            K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE,
            K_CG_ANY_INPUT_EVENT_TYPE,
        )
    };
    if seconds.is_nan() || seconds < 0.0 {
        return 0;
    }
    (seconds * 1000.0) as u64
}

// ── Foreground application (NSWorkspace) ────────────────────────────────

pub fn get_foreground_info(pid_cache: &mut PidCache) -> Option<ProcessInfo> {
    use objc2_app_kit::NSWorkspace;

    // SAFETY: NSWorkspace.sharedWorkspace() można wołać z dowolnego wątku.
    // Retained<NSRunningApplication> zarządza refcountem automatycznie.
    let (pid, localized_name, bundle_id) = unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        let pid = app.processIdentifier() as u32;
        let localized = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let bundle = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_default();
        (pid, localized, bundle)
    };

    if pid == 0 {
        return None;
    }

    // exe_name używa localizedName (lowercase) dla symetrii z Windows — mapa
    // klasyfikacji została rozszerzona o macOS aliases. Jeśli nie ma nazwy,
    // fallback do bundle id albo "unknown".
    let exe_name = if !localized_name.is_empty() {
        localized_name.to_lowercase()
    } else if !bundle_id.is_empty() {
        bundle_id.to_lowercase()
    } else {
        "unknown".to_string()
    };

    let now = Instant::now();
    let activity_type = classify_activity_type(&exe_name);

    // Prosta rewalidacja cache: utrzymuj entry per pid żeby tracker mógł robić
    // evict_old_pid_cache. Nie sprawdzamy creation_time (na macOS nie jest
    // potrzebne do detekcji PID reuse — zrobi to nowy NSRunningApplication).
    let entry = pid_cache.entry(pid).or_insert_with(|| PidCacheEntry {
        exe_name: exe_name.clone(),
        creation_time: 0,
        created_at: now,
        last_accessed_at: now,
        last_alive_check: now,
        detected_path: None,
        activity_type,
        path_detection_attempted: true, // AX/detected_path poza zakresem Fazy 3
    });
    entry.last_accessed_at = now;
    entry.last_alive_check = now;

    Some(ProcessInfo {
        exe_name,
        pid,
        window_title: String::new(), // Faza 3.1: AX API wymaga Accessibility permission
        detected_path: None,
        activity_type,
    })
}

// ── Process snapshot (reuse cross-platform layer) ───────────────────────

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

// ── CPU measurement ─────────────────────────────────────────────────────
//
// Używamy sysinfo `Process::cpu_usage()` zwracającego procent zużycia pojedynczego
// rdzenia. Sysinfo wymaga dwóch refreshy z odstępem czasowym, żeby podać sensowną
// wartość — pierwszy pomiar po starcie trackera zwróci 0, kolejne już poprawnie.
// Stan System trzymamy w globalnym Mutex, bo musi przeżyć między wywołaniami.

static SYSINFO_STATE: Mutex<Option<System>> = Mutex::new(None);

fn collect_descendants(
    tree: &HashMap<u32, Vec<u32>>,
    root: u32,
    result: &mut Vec<u32>,
    visited: &mut std::collections::HashSet<u32>,
) {
    if !visited.insert(root) {
        return;
    }
    if let Some(children) = tree.get(&root) {
        for &child in children {
            result.push(child);
            collect_descendants(tree, child, result, visited);
        }
    }
}

pub fn measure_cpu_for_app(
    exe_name: &str,
    _prev: Option<&CpuSnapshot>,
    proc_snap: &ProcessSnapshot,
) -> (f64, CpuSnapshot) {
    let root_pids = proc_snap
        .exe_pids
        .get(exe_name)
        .cloned()
        .unwrap_or_default();

    let mut all_pids = root_pids.clone();
    let mut visited: std::collections::HashSet<u32> = root_pids.iter().copied().collect();
    for &root in &root_pids {
        if let Some(children) = proc_snap.tree.get(&root) {
            for &child in children {
                all_pids.push(child);
                collect_descendants(&proc_snap.tree, child, &mut all_pids, &mut visited);
            }
        }
    }
    all_pids.sort_unstable();
    all_pids.dedup();

    let now = Instant::now();
    let cpu_fraction: f64 = if all_pids.is_empty() {
        0.0
    } else if let Ok(mut guard) = SYSINFO_STATE.lock() {
        let sys = guard.get_or_insert_with(System::new);
        let pids_vec: Vec<Pid> = all_pids.iter().map(|p| Pid::from_u32(*p)).collect();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids_vec),
            ProcessRefreshKind::new().with_cpu(),
        );
        all_pids
            .iter()
            .filter_map(|pid| sys.process(Pid::from_u32(*pid)))
            .map(|p| p.cpu_usage() as f64 / 100.0)
            .sum()
    } else {
        0.0
    };

    let snapshot = CpuSnapshot {
        // Pseudo-licznik tylko dla kompatybilności typu — tracker
        // używa `cpu_fraction`, nie `total_time`.
        total_time: (cpu_fraction * 1_000_000.0) as u64,
        measured_at: now,
    };

    (cpu_fraction, snapshot)
}
