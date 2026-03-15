// Moduł monitora procesów — ultra-lekkie odpytywanie WinAPI
// Tylko GetForegroundWindow + PID → exe_name cache

mod pid_cache;
mod wmi_detection;

use std::collections::HashMap;
use std::time::Instant;

use winapi::shared::minwindef::{DWORD, FILETIME};
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{GetProcessTimes, OpenProcess};
use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

use crate::activity::ActivityType;
use crate::process_utils::collect_process_entries;

use pid_cache::ensure_pid_cache_entry;
#[cfg(test)]
use pid_cache::PidCacheEntry;
pub use pid_cache::{evict_old_pid_cache, PidCache};
#[cfg(test)]
use wmi_detection::{
    build_wmi_process_command_line_query, collect_pending_detected_path_pids,
    extract_path_from_command_line,
};
use wmi_detection::{hydrate_detected_paths_for_pending_pids, should_detect_path_for_activity};

/// Informacja o aktywnym procesie
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
}

/// Sprawdza czy string zawiera znak zastępczy U+FFFD (nieprawidłowe UTF-16).
fn has_utf16_replacement_char(s: &str) -> bool {
    s.contains('\u{FFFD}')
}

fn decode_window_title(title_buf: &[u16], title_len: i32) -> String {
    if title_len <= 0 {
        return String::new();
    }

    let s = String::from_utf16_lossy(&title_buf[..title_len as usize]);
    if has_utf16_replacement_char(&s) {
        log::debug!("Tytuł okna zawiera nieprawidłowe sekwencje UTF-16: {:?}", s);
    }
    s
}

/// Pobiera informację o aktualnie aktywnym oknie (foreground).
/// Koszt: 3 wywołania WinAPI + HashMap lookup.
/// `pid_cache` mapuje PID → (exe_name, timestamp) — przy hicie walidujemy czy proces żyje.
pub fn get_foreground_info(pid_cache: &mut PidCache) -> Option<ProcessInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        // PID z okna
        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        // Tytuł okna
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let window_title = decode_window_title(&title_buf, title_len);

        let now = Instant::now();

        ensure_pid_cache_entry(pid, pid_cache, now)?;
        let should_hydrate_detected_path = pid_cache.get(&pid).is_some_and(|entry| {
            entry.detected_path.is_none()
                && !entry.path_detection_attempted
                && should_detect_path_for_activity(entry.activity_type)
        });
        if should_hydrate_detected_path {
            hydrate_detected_paths_for_pending_pids(pid_cache);
        }

        let entry = pid_cache.get(&pid)?;
        let exe_name = entry.exe_name.clone();
        let detected_path = entry.detected_path.clone();
        let activity_type = entry.activity_type;

        Some(ProcessInfo {
            exe_name,
            pid,
            window_title,
            detected_path,
            activity_type,
        })
    }
}

pub fn warm_path_detection_wmi() {
    wmi_detection::warm_wmi_connection();
}

/// Retrieves the exe name and process creation time from PID.
fn get_exe_name_and_creation_time(pid: u32) -> Option<(String, u64)> {
    use winapi::um::winbase::QueryFullProcessImageNameW;

    unsafe {
        let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);

        if handle.is_null() {
            log::warn!(
                "OpenProcess error for PID {}: {}",
                pid,
                winapi::um::errhandlingapi::GetLastError()
            );
            return None;
        }

        let mut buf = [0u16; 1024];
        let mut size = buf.len() as DWORD;
        let res = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);

        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let times_ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);

        CloseHandle(handle);

        if res == 0 || times_ok == 0 {
            log::warn!(
                "QueryFullProcessImageNameW or GetProcessTimes error for PID {}: {}",
                pid,
                winapi::um::errhandlingapi::GetLastError()
            );
            return None;
        }

        let full_path = String::from_utf16_lossy(&buf[..size as usize]);
        let exe_name = full_path
            .rsplit('\\')
            .next()
            .unwrap_or(&full_path)
            .to_lowercase();

        let creation_time = filetime_to_u64(&creation);

        Some((exe_name, creation_time))
    }
}

/// Lightweight app category used by the tracker to tag file activities.
/// Delegates to the shared classification map; supports config overrides.
pub fn classify_activity_type(exe_name: &str) -> Option<ActivityType> {
    timeflow_shared::activity_classification::classify_activity_type(exe_name, None)
}

/// Parsuje tytuł okna i wyciąga nazwę pliku/projektu.
/// Heurystyka: bierze pierwszą część przed separatorem (` - `, ` — `, ` | `).
/// Przykłady:
///   "main.rs - timeflow_demon - Visual Studio Code" → "main.rs - timeflow_demon"
///   "projekt.psd @ 100% (RGB/8)" → "projekt.psd"
///   "Blender" → "Blender"
pub fn extract_file_from_title(title: &str) -> String {
    // Priority: " — " and " | " (checked via rfind) take precedence over " - ".
    // For "file.py - projekt | VS Code", rfind(" | ") matches first → result is "file.py - projekt".
    // This is intentional: " - " is last because it often appears inside file paths / project names.
    let separators = [" — ", " | "];

    for sep in separators {
        if let Some(pos) = title.rfind(sep) {
            let left = title[..pos].trim();
            if !left.is_empty() {
                return left.to_string();
            }
        }
    }

    // Dla " - " — specjalne traktowanie: bierzemy wszystko oprócz ostatniego segmentu
    // "main.rs - timeflow_demon - Visual Studio Code" → "main.rs - timeflow_demon"
    if let Some(pos) = title.rfind(" - ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    // Dla " @ " — bierzemy lewą część
    if let Some(pos) = title.find(" @ ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    title.trim().to_string()
}

// ── Idle detection ────────────────────────────────────────────

/// Zwraca czas bezczynności użytkownika (brak klawiatury/myszy) w milisekundach.
/// Używa WinAPI `GetLastInputInfo`.
pub fn get_idle_time_ms() -> u64 {
    use winapi::um::sysinfoapi::GetTickCount64;
    use winapi::um::winuser::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut lii: LASTINPUTINFO = std::mem::zeroed();
        lii.cbSize = std::mem::size_of::<LASTINPUTINFO>() as u32;

        if GetLastInputInfo(&mut lii) == 0 {
            return 0; // Fallback: zakładaj aktywność
        }

        let now = GetTickCount64();
        now.saturating_sub(u64::from(lii.dwTime))
    }
}

// ── CPU tracking ──────────────────────────────────────────────

/// Konwertuje FILETIME (100-ns intervals od 1601) na u64.
fn filetime_to_u64(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

/// Poprzedni stan CPU per aplikacja (suma kernel+user z ostatniego ticku).
#[derive(Debug, Clone)]
pub struct CpuSnapshot {
    /// Suma (kernel + user) w 100-ns jednostkach dla całego drzewa procesów.
    pub total_time: u64,
    /// Instant pomiaru (wall clock).
    pub measured_at: Instant,
}

/// Tracker CPU dla wielu aplikacji.
pub type CpuState = HashMap<String, CpuSnapshot>;

/// Snapshot of all processes: (parent→children tree, exe_name→PIDs map).
/// Built once per tick and reused across all monitored apps.
pub struct ProcessSnapshot {
    pub tree: HashMap<u32, Vec<u32>>,
    pub exe_pids: HashMap<String, Vec<u32>>,
}

/// Takes a single CreateToolhelp32Snapshot and builds both the parent→children
/// tree and the exe_name→PIDs map at once (replaces separate build_process_tree
/// + find_pids_by_exe which each created their own snapshot).
pub fn build_process_snapshot() -> ProcessSnapshot {
    let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut exe_pids: HashMap<String, Vec<u32>> = HashMap::new();
    let Some(entries) = collect_process_entries() else {
        return ProcessSnapshot { tree, exe_pids };
    };

    for entry in entries {
        tree.entry(entry.parent_process_id)
            .or_default()
            .push(entry.process_id);
        exe_pids
            .entry(entry.exe_name)
            .or_default()
            .push(entry.process_id);
    }

    ProcessSnapshot { tree, exe_pids }
}

/// Recursively collects all descendant PIDs.
fn collect_descendants(
    tree: &HashMap<u32, Vec<u32>>,
    root: u32,
    result: &mut Vec<u32>,
    visited: &mut std::collections::HashSet<u32>,
) {
    if !visited.insert(root) {
        return; // Cycle detected or already visited
    }
    if let Some(children) = tree.get(&root) {
        for &child in children {
            result.push(child);
            collect_descendants(tree, child, result, visited);
        }
    }
}

/// Pobiera sumaryczny czas CPU (kernel + user) dla zbioru PIDów.
/// Zwraca sumę w 100-ns jednostkach.
fn sum_cpu_times(pids: &[u32]) -> u64 {
    let mut total: u64 = 0;
    unsafe {
        for &pid in pids {
            let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                continue;
            }

            let mut creation: FILETIME = std::mem::zeroed();
            let mut exit: FILETIME = std::mem::zeroed();
            let mut kernel: FILETIME = std::mem::zeroed();
            let mut user: FILETIME = std::mem::zeroed();

            if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
                total += filetime_to_u64(&kernel) + filetime_to_u64(&user);
            }
            CloseHandle(handle);
        }
    }
    total
}

/// Pobiera aktualne zużycie CPU dla drzewa procesów danej aplikacji.
/// Zwraca (cpu_fraction, nowy snapshot).
/// cpu_fraction = ułamek jednego rdzenia (0.0 - N.0) zużyty od ostatniego pomiaru.
/// Accepts a pre-built ProcessSnapshot to avoid redundant system calls.
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
    let mut visited = std::collections::HashSet::new();
    for &root in &root_pids {
        visited.insert(root);
    }
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

    let cpu_fraction = if let Some(prev) = prev {
        let wall_elapsed = now.duration_since(prev.measured_at).as_secs_f64();
        if wall_elapsed > 0.0 && total_time >= prev.total_time {
            let delta_cpu_secs = (total_time - prev.total_time) as f64 / 10_000_000.0;
            delta_cpu_secs / wall_elapsed
        } else {
            0.0
        }
    } else {
        0.0 // Pierwszy pomiar — brak delty
    };

    (cpu_fraction, snapshot)
}

#[cfg(test)]
mod tests {
    use super::{
        build_wmi_process_command_line_query, classify_activity_type,
        collect_pending_detected_path_pids, decode_window_title, extract_file_from_title,
        extract_path_from_command_line, PidCache, PidCacheEntry,
    };
    use crate::activity::ActivityType;
    use std::time::Instant;

    fn sample_pid_cache_entry(
        activity_type: Option<ActivityType>,
        detected_path: Option<&str>,
        path_detection_attempted: bool,
        cache_age_secs: u64,
    ) -> PidCacheEntry {
        let now = Instant::now();
        PidCacheEntry {
            exe_name: "code.exe".to_string(),
            creation_time: 123,
            cached_at: now - std::time::Duration::from_secs(cache_age_secs),
            last_alive_check: now,
            detected_path: detected_path.map(str::to_string),
            activity_type,
            path_detection_attempted,
        }
    }

    #[test]
    fn extract_file_single_separator() {
        assert_eq!(
            extract_file_from_title("main.rs - timeflow_demon - Visual Studio Code"),
            "main.rs - timeflow_demon"
        );
    }

    #[test]
    fn extract_file_at_separator() {
        assert_eq!(
            extract_file_from_title("projekt.psd @ 100% (RGB/8)"),
            "projekt.psd"
        );
    }

    #[test]
    fn extract_file_no_separator() {
        assert_eq!(extract_file_from_title("Blender"), "Blender");
    }

    #[test]
    fn extract_file_pipe_separator() {
        assert_eq!(extract_file_from_title("file.py | VS Code"), "file.py");
    }

    #[test]
    fn extract_file_mixed_separators() {
        // " - " ma pierwszeństwo przed " | " przy rfind — bierzemy lewą część przed ostatnim " - "
        assert_eq!(
            extract_file_from_title("file.py - projekt | VS Code"),
            "file.py - projekt"
        );
    }

    #[test]
    fn extract_file_empty_after_trim() {
        assert_eq!(extract_file_from_title("   "), "");
    }

    #[test]
    fn extract_file_em_dash() {
        assert_eq!(extract_file_from_title("dokument — Edytor"), "dokument");
    }

    #[test]
    fn decode_window_title_allows_empty_title() {
        let empty: [u16; 0] = [];
        assert_eq!(decode_window_title(&empty, 0), "");
    }

    #[test]
    fn extracts_detected_path_from_command_line() {
        let cmd = r#""C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe" "C:\work\timeflow\src\main.rs""#;
        assert_eq!(
            extract_path_from_command_line(cmd).as_deref(),
            Some(r"C:\work\timeflow\src\main.rs")
        );
    }

    #[test]
    fn builds_batched_wmi_query_with_unique_pids() {
        let query = build_wmi_process_command_line_query(&[42, 7, 42, 0]).unwrap();
        assert_eq!(
            query,
            "SELECT ProcessId, CommandLine FROM Win32_Process WHERE ProcessId IN (42, 7)"
        );
    }

    #[test]
    fn collects_only_pending_detected_path_pids_for_relevant_apps() {
        let mut pid_cache: PidCache = PidCache::new();
        pid_cache.insert(
            11,
            sample_pid_cache_entry(Some(ActivityType::Coding), None, false, 1),
        );
        pid_cache.insert(
            12,
            sample_pid_cache_entry(Some(ActivityType::Design), None, false, 5),
        );
        pid_cache.insert(
            13,
            sample_pid_cache_entry(
                Some(ActivityType::Coding),
                Some(r"C:\work\done.rs"),
                true,
                3,
            ),
        );
        pid_cache.insert(
            14,
            sample_pid_cache_entry(Some(ActivityType::Browsing), None, false, 2),
        );
        pid_cache.insert(
            15,
            sample_pid_cache_entry(Some(ActivityType::Coding), None, true, 4),
        );

        let pending = collect_pending_detected_path_pids(&pid_cache);
        assert_eq!(pending, vec![11, 12]);
    }

    #[test]
    fn classify_activity_type_for_known_apps() {
        assert_eq!(
            classify_activity_type("code.exe"),
            Some(ActivityType::Coding)
        );
        assert_eq!(
            classify_activity_type("chrome.exe"),
            Some(ActivityType::Browsing)
        );
        assert_eq!(
            classify_activity_type("blender.exe"),
            Some(ActivityType::Design)
        );
        assert_eq!(classify_activity_type("unknown.exe"), None);
    }
}
