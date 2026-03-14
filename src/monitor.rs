// Moduł monitora procesów — ultra-lekkie odpytywanie WinAPI
// Tylko GetForegroundWindow + PID → exe_name cache

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use winapi::shared::minwindef::{DWORD, FILETIME};
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{GetProcessTimes, OpenProcess};
use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

use crate::activity::ActivityType;
use crate::process_utils::collect_process_entries;

thread_local! {
    // WMI/COM objects are apartment-threaded on Windows, so each polling thread
    // keeps its own connection instead of sharing one across threads.
    static WMI_CONN_CACHE: std::cell::RefCell<Option<wmi::WMIConnection>> =
        std::cell::RefCell::new(None);
}

/// Cache PID -> metadata used for PID reuse validation and detected path hints.
#[derive(Debug, Clone)]
pub struct PidCacheEntry {
    pub exe_name: String,
    pub creation_time: u64,
    pub cached_at: Instant,
    pub last_alive_check: Instant,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
    pub path_detection_attempted: bool,
}

pub type PidCache = HashMap<u32, PidCacheEntry>;

const PID_LIVENESS_REVALIDATION_INTERVAL: Duration = Duration::from_secs(180);
// Keep WMI IN(...) queries small enough to stay responsive on busy systems.
const WMI_PATH_LOOKUP_BATCH_LIMIT: usize = 16;

/// Informacja o aktywnym procesie
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
}

/// Gets the creation time of a process as u64. Returns None if unable to fetch.
fn get_process_creation_time(pid: u32) -> Option<u64> {
    unsafe {
        let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();

        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        CloseHandle(handle);

        if ok != 0 {
            Some(filetime_to_u64(&creation))
        } else {
            None
        }
    }
}

/// Checks if a process with a specific PID is still alive AND has the same creation time (protects against PID reuse).
fn process_still_alive(pid: u32, expected_creation_time: u64) -> bool {
    if let Some(current_creation_time) = get_process_creation_time(pid) {
        current_creation_time == expected_creation_time
    } else {
        false
    }
}

fn ensure_pid_cache_entry(pid: u32, pid_cache: &mut PidCache, now: Instant) -> Option<()> {
    let mut needs_refresh = false;

    if let Some(entry) = pid_cache.get_mut(&pid) {
        if now.duration_since(entry.last_alive_check) >= PID_LIVENESS_REVALIDATION_INTERVAL {
            if process_still_alive(pid, entry.creation_time) {
                entry.last_alive_check = now;
            } else {
                needs_refresh = true;
            }
        }

        if !needs_refresh {
            entry.cached_at = now;
            return Some(());
        }
    }

    if needs_refresh {
        pid_cache.remove(&pid);
    }

    let (exe_name, creation_time) = get_exe_name_and_creation_time(pid)?;
    let activity_type = classify_activity_type(&exe_name);
    pid_cache.insert(
        pid,
        PidCacheEntry {
            exe_name,
            creation_time,
            cached_at: now,
            last_alive_check: now,
            detected_path: None,
            activity_type,
            path_detection_attempted: false,
        },
    );
    Some(())
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
        hydrate_detected_paths_for_pending_pids(pid_cache);

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

fn should_detect_path_for_activity(activity_type: Option<ActivityType>) -> bool {
    matches!(
        activity_type,
        Some(ActivityType::Coding) | Some(ActivityType::Design)
    )
}

fn collect_pending_detected_path_pids(pid_cache: &PidCache) -> Vec<u32> {
    let mut pids: Vec<u32> = pid_cache
        .iter()
        .filter_map(|(&pid, entry)| {
            if entry.detected_path.is_none()
                && !entry.path_detection_attempted
                && should_detect_path_for_activity(entry.activity_type)
            {
                Some(pid)
            } else {
                None
            }
        })
        .collect();
    pids.sort_unstable_by(|left, right| {
        let left_cached_at = pid_cache
            .get(left)
            .map(|entry| entry.cached_at)
            .unwrap_or_else(Instant::now);
        let right_cached_at = pid_cache
            .get(right)
            .map(|entry| entry.cached_at)
            .unwrap_or_else(Instant::now);
        right_cached_at
            .cmp(&left_cached_at)
            .then_with(|| left.cmp(right))
    });
    pids.truncate(WMI_PATH_LOOKUP_BATCH_LIMIT);
    pids
}

fn hydrate_detected_paths_for_pending_pids(pid_cache: &mut PidCache) {
    let pending_pids = collect_pending_detected_path_pids(pid_cache);
    if pending_pids.is_empty() {
        return;
    }

    let command_lines = match get_process_command_lines_wmi(&pending_pids) {
        Ok(lines) => lines,
        Err(()) => return,
    };

    for pid in pending_pids {
        if let Some(entry) = pid_cache.get_mut(&pid) {
            entry.path_detection_attempted = true;
            entry.detected_path = command_lines
                .get(&pid)
                .and_then(|command_line| extract_path_from_command_line(command_line));
        }
    }
}

fn build_wmi_process_command_line_query(pids: &[u32]) -> Option<String> {
    let mut unique_pids = Vec::new();
    let mut seen = HashSet::new();

    for pid in pids.iter().copied().filter(|pid| *pid > 0) {
        if seen.insert(pid) {
            unique_pids.push(pid);
        }
    }

    if unique_pids.is_empty() {
        return None;
    }

    let pid_list = unique_pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!(
        "SELECT ProcessId, CommandLine FROM Win32_Process WHERE ProcessId IN ({})",
        pid_list
    ))
}

fn get_process_command_lines_wmi(pids: &[u32]) -> Result<HashMap<u32, String>, ()> {
    #[derive(serde::Deserialize, Debug)]
    struct Win32ProcessCommandLineRow {
        #[serde(rename = "ProcessId")]
        process_id: u32,
        #[serde(rename = "CommandLine")]
        command_line: Option<String>,
    }

    let query = build_wmi_process_command_line_query(pids).ok_or(())?;
    WMI_CONN_CACHE.with(|cache| {
        let mut cached_conn = cache.borrow_mut();
        if cached_conn.is_none() {
            let com = wmi::COMLibrary::new().map_err(|_| ())?;
            let conn = wmi::WMIConnection::new(com.into()).map_err(|_| ())?;
            *cached_conn = Some(conn);
        }

        let query_result: Result<Vec<Win32ProcessCommandLineRow>, _> = {
            let conn = cached_conn.as_ref().ok_or(())?;
            conn.raw_query(&query)
        };

        match query_result {
            Ok(rows) => {
                let mut command_lines = HashMap::new();
                for row in rows {
                    if let Some(command_line) =
                        row.command_line.filter(|value| !value.trim().is_empty())
                    {
                        command_lines.insert(row.process_id, command_line);
                    }
                }
                Ok(command_lines)
            }
            Err(_) => {
                // Reset cached connection; next call will reinitialize COM/WMI.
                *cached_conn = None;
                Err(())
            }
        }
    })
}

fn split_command_line_tokens(command_line: &str) -> Vec<String> {
    if let Some(tokens) = split_command_line_tokens_winapi(command_line) {
        return tokens;
    }
    split_command_line_tokens_fallback(command_line)
}

fn split_command_line_tokens_winapi(command_line: &str) -> Option<Vec<String>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::CommandLineToArgvW;
    use winapi::um::winbase::LocalFree;

    unsafe {
        let wide: Vec<u16> = OsStr::new(command_line)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut argc: i32 = 0;
        let argv = CommandLineToArgvW(wide.as_ptr(), &mut argc);
        if argv.is_null() || argc <= 0 {
            if !argv.is_null() {
                LocalFree(argv as *mut _);
            }
            return None;
        }

        let mut tokens = Vec::with_capacity(argc as usize);
        for i in 0..argc {
            let arg_ptr = *argv.add(i as usize);
            if arg_ptr.is_null() {
                continue;
            }
            let mut len = 0usize;
            while *arg_ptr.add(len) != 0 {
                len += 1;
            }
            tokens.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                arg_ptr, len,
            )));
        }
        LocalFree(argv as *mut _);
        Some(tokens)
    }
}

fn split_command_line_tokens_fallback(command_line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in command_line.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn normalize_path_candidate(raw: &str) -> Option<String> {
    let token = raw.trim().trim_matches('"').trim();
    if token.is_empty() {
        return None;
    }
    if token.starts_with("http://")
        || token.starts_with("https://")
        || token.starts_with("vscode://")
        || token.starts_with("mailto:")
    {
        return None;
    }
    let candidate = token
        .trim_end_matches(',')
        .trim_end_matches(';')
        .trim_end_matches('"')
        .trim();
    if candidate.is_empty() {
        return None;
    }

    let looks_like_abs_drive = candidate.len() >= 3
        && candidate.as_bytes()[1] == b':'
        && matches!(candidate.as_bytes()[2], b'\\' | b'/');
    let looks_like_unc = candidate.starts_with("\\\\") || candidate.starts_with("//");
    let looks_like_relative = candidate.starts_with(".\\")
        || candidate.starts_with("./")
        || candidate.starts_with("..\\")
        || candidate.starts_with("../");

    if !(looks_like_abs_drive || looks_like_unc || looks_like_relative) {
        return None;
    }

    let lower = candidate.to_lowercase();
    if lower.ends_with(".exe")
        || lower.ends_with(".dll")
        || lower.ends_with(".lnk")
        || lower.ends_with(".tmp")
    {
        return None;
    }

    Some(candidate.to_string())
}

fn is_probably_file_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());
    let Some(ext) = extension else {
        return false;
    };
    !matches!(ext.as_str(), "cache" | "log" | "ini" | "json")
}

fn extract_path_from_command_line(command_line: &str) -> Option<String> {
    let tokens = split_command_line_tokens(command_line);
    if tokens.len() <= 1 {
        return None;
    }

    let mut fallback_path: Option<String> = None;
    for token in tokens.iter().skip(1) {
        if token.starts_with('-') && !token.contains(':') {
            continue;
        }

        let direct_candidate = normalize_path_candidate(token);
        let eq_candidate = token
            .split_once('=')
            .and_then(|(_, rhs)| normalize_path_candidate(rhs));
        let candidate = direct_candidate.or(eq_candidate);
        let Some(path) = candidate else {
            continue;
        };

        if is_probably_file_path(&path) {
            return Some(path);
        }
        if fallback_path.is_none() {
            fallback_path = Some(path);
        }
    }

    fallback_path
}

/// Lightweight app category used by the tracker to tag file activities.
pub fn classify_activity_type(exe_name: &str) -> Option<ActivityType> {
    let exe = exe_name.to_lowercase();

    if matches!(
        exe.as_str(),
        "code.exe"
            | "code-insiders.exe"
            | "cursor.exe"
            | "idea64.exe"
            | "pycharm64.exe"
            | "webstorm64.exe"
            | "clion64.exe"
            | "rider64.exe"
            | "devenv.exe"
            | "notepad++.exe"
            | "vim.exe"
            | "nvim.exe"
    ) {
        return Some(ActivityType::Coding);
    }

    if matches!(
        exe.as_str(),
        "chrome.exe"
            | "msedge.exe"
            | "firefox.exe"
            | "brave.exe"
            | "opera.exe"
            | "opera_gx.exe"
            | "vivaldi.exe"
            | "arc.exe"
    ) {
        return Some(ActivityType::Browsing);
    }

    if matches!(
        exe.as_str(),
        "figma.exe"
            | "photoshop.exe"
            | "illustrator.exe"
            | "blender.exe"
            | "gimp-2.10.exe"
            | "inkscape.exe"
            | "adobexd.exe"
    ) {
        return Some(ActivityType::Design);
    }

    None
}

/// Ewiktuje wpisy cache starsze niż `max_age` (zamiast czyścić wszystko).
/// Zmniejsza serię wywołań OpenProcess po wyczyszczeniu.
pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: std::time::Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, entry| now.duration_since(entry.cached_at) < max_age);
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
