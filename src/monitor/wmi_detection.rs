use std::collections::{HashMap, HashSet};

use crate::activity::ActivityType;

use super::pid_cache::PidCache;

thread_local! {
    // WMI/COM objects are apartment-threaded on Windows, so each polling thread
    // keeps its own connection instead of sharing one across threads.
    static WMI_CONN_CACHE: std::cell::RefCell<Option<wmi::WMIConnection>> =
        std::cell::RefCell::new(None);
}

// Keep WMI IN(...) queries small enough to stay responsive on busy systems.
const WMI_PATH_LOOKUP_BATCH_LIMIT: usize = 16;

pub(crate) fn warm_wmi_connection() {
    let _ = with_wmi_connection::<()>(|_| Ok(()));
}

pub(crate) fn should_detect_path_for_activity(activity_type: Option<ActivityType>) -> bool {
    matches!(
        activity_type,
        Some(ActivityType::Coding) | Some(ActivityType::Design)
    )
}

pub(crate) fn collect_pending_detected_path_pids(pid_cache: &PidCache) -> Vec<u32> {
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
            .unwrap_or_else(std::time::Instant::now);
        let right_cached_at = pid_cache
            .get(right)
            .map(|entry| entry.cached_at)
            .unwrap_or_else(std::time::Instant::now);
        right_cached_at
            .cmp(&left_cached_at)
            .then_with(|| left.cmp(right))
    });
    pids.truncate(WMI_PATH_LOOKUP_BATCH_LIMIT);
    pids
}

pub(crate) fn hydrate_detected_paths_for_pending_pids(pid_cache: &mut PidCache) {
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

pub fn build_wmi_process_command_line_query(pids: &[u32]) -> Option<String> {
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

fn with_wmi_connection<T>(op: impl FnOnce(&wmi::WMIConnection) -> Result<T, ()>) -> Result<T, ()> {
    WMI_CONN_CACHE.with(|cache| {
        let mut cached_conn = cache.borrow_mut();
        if cached_conn.is_none() {
            let com = wmi::COMLibrary::new().map_err(|_| ())?;
            let conn = wmi::WMIConnection::new(com.into()).map_err(|_| ())?;
            *cached_conn = Some(conn);
        }

        let result = {
            let conn = cached_conn.as_ref().ok_or(())?;
            op(conn)
        };

        if result.is_err() {
            *cached_conn = None;
        }
        result
    })
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
    with_wmi_connection(|conn| {
        let query_result: Result<Vec<Win32ProcessCommandLineRow>, _> = conn.raw_query(&query);
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
            Err(_) => Err(()),
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

pub fn extract_path_from_command_line(command_line: &str) -> Option<String> {
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
