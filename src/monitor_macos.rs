// macOS-specific implementacja modułu `monitor`.
// Faza 3: prawdziwe API do idle time (CGEventSource), foreground
// (NSWorkspace.frontmostApplication) oraz CPU per aplikacja (sysinfo,
// z sumowaniem po drzewie procesów).
// WMI i pełne AX API to osobny temat — podstawowy tytuł okna pobieramy przez
// CGWindowListCopyWindowInfo bez proszenia użytkownika o Accessibility.

use std::collections::HashMap;
use std::os::raw::{c_int, c_void};
use std::time::{Duration, Instant};

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

/// Minimalny cache PID używany przez tracker do okresowej ewikcji wpisów.
#[derive(Debug, Clone)]
pub struct PidCacheEntry {
    pub last_accessed_at: Instant,
}

pub type PidCache = HashMap<u32, PidCacheEntry>;

/// Poprzedni stan CPU per aplikacja (suma user+system z ostatniego ticku).
#[derive(Debug, Clone)]
pub struct CpuSnapshot {
    /// Sumaryczny `accumulated_cpu_time` (ns) po całym drzewie procesów.
    pub total_time: u64,
    pub measured_at: Instant,
}

pub type CpuState = HashMap<String, CpuSnapshot>;

pub struct ProcessSnapshot {
    pub tree: HashMap<u32, Vec<u32>>,
    pub exe_pids: HashMap<String, Vec<u32>>,
}

// ── Cross-platform logika (niezależna od OS) ────────────────────────────

pub use crate::title_parser::{classify_activity_type, extract_file_from_title};

pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, entry| now.duration_since(entry.last_accessed_at) < max_age);
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

    // Utrzymuj entry per pid, żeby tracker mógł robić evict_old_pid_cache.
    let entry = pid_cache.entry(pid).or_insert_with(|| PidCacheEntry {
        last_accessed_at: now,
    });
    entry.last_accessed_at = now;

    let window_title =
        crate::platform::window_title::frontmost_window_title(pid as i32).unwrap_or_default();

    Some(ProcessInfo {
        exe_name,
        pid,
        window_title,
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
// Używamy libproc `proc_pidinfo(PROC_PIDTASKINFO)`, bo sysinfo 0.31 nie wystawia
// na macOS publicznego accumulated_cpu_time(). Liczymy deltę sumarycznego czasu
// CPU drzewa procesów względem poprzedniego snapshotu, analogicznie do Windows.

const PROC_PIDTASKINFO: c_int = 4;

#[repr(C)]
#[derive(Default)]
struct ProcTaskInfo {
    pti_virtual_size: u64,
    pti_resident_size: u64,
    pti_total_user: u64,
    pti_total_system: u64,
    pti_threads_user: u64,
    pti_threads_system: u64,
    pti_policy: i32,
    pti_faults: i32,
    pti_pageins: i32,
    pti_cow_faults: i32,
    pti_messages_sent: i32,
    pti_messages_received: i32,
    pti_syscalls_mach: i32,
    pti_syscalls_unix: i32,
    pti_csw: i32,
    pti_threadnum: i32,
    pti_numrunning: i32,
    pti_priority: i32,
}

#[link(name = "proc")]
extern "C" {
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
}

use crate::title_parser::collect_descendants;

fn cpu_time_for_pid(pid: u32) -> Option<u64> {
    let mut info = ProcTaskInfo::default();
    let size = std::mem::size_of::<ProcTaskInfo>() as c_int;
    let read = unsafe {
        proc_pidinfo(
            pid as c_int,
            PROC_PIDTASKINFO,
            0,
            (&mut info as *mut ProcTaskInfo).cast::<c_void>(),
            size,
        )
    };

    if read == size {
        Some(info.pti_total_user.saturating_add(info.pti_total_system))
    } else {
        None
    }
}

fn sum_cpu_times(pids: &[u32]) -> u64 {
    pids.iter().filter_map(|pid| cpu_time_for_pid(*pid)).sum()
}

fn cpu_fraction_since(prev: Option<&CpuSnapshot>, total_time: u64, now: Instant) -> f64 {
    let Some(prev) = prev else {
        return 0.0;
    };
    let wall_elapsed = now.duration_since(prev.measured_at).as_secs_f64();
    if wall_elapsed <= 0.0 || total_time < prev.total_time {
        return 0.0;
    }

    let delta_cpu_secs = (total_time - prev.total_time) as f64 / 1_000_000_000.0;
    delta_cpu_secs / wall_elapsed
}

pub fn measure_cpu_for_app(
    exe_name: &str,
    prev: Option<&CpuSnapshot>,
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
    let total_time = sum_cpu_times(&all_pids);

    let snapshot = CpuSnapshot {
        total_time,
        measured_at: now,
    };
    let cpu_fraction = cpu_fraction_since(prev, total_time, now);

    (cpu_fraction, snapshot)
}

#[cfg(test)]
mod tests {
    use super::{cpu_fraction_since, CpuSnapshot};
    use std::time::{Duration, Instant};

    #[test]
    fn cpu_fraction_uses_delta_from_previous_snapshot() {
        let now = Instant::now();
        let prev = CpuSnapshot {
            total_time: 1_000_000_000,
            measured_at: now - Duration::from_secs(2),
        };

        let fraction = cpu_fraction_since(Some(&prev), 2_000_000_000, now);

        assert!((fraction - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn cpu_fraction_is_zero_for_first_or_reset_snapshot() {
        let now = Instant::now();
        let prev = CpuSnapshot {
            total_time: 2_000_000_000,
            measured_at: now - Duration::from_secs(1),
        };

        assert_eq!(cpu_fraction_since(None, 3_000_000_000, now), 0.0);
        assert_eq!(cpu_fraction_since(Some(&prev), 1_000_000_000, now), 0.0);
    }
}
