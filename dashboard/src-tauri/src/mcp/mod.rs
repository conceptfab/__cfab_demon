#![allow(dead_code)]

pub mod backup;
pub mod config;
pub mod protocol;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// Sesja klienta MCP (Claude Code / Codex). Tworzona przy `initialize`,
/// usuwana przy DELETE /mcp lub po 24h nieaktywności (prune).
#[derive(Debug, Clone, Serialize)]
pub struct McpSessionInfo {
    pub id: String,
    pub client_name: String,
    pub created_at: u64,
    pub last_seen: u64,
    pub backup_path: String,
}

const SESSION_IDLE_TTL_SECS: u64 = 60 * 60 * 24;

#[derive(Default)]
pub struct McpSessions {
    sessions: Mutex<HashMap<String, McpSessionInfo>>,
}

impl McpSessions {
    pub fn insert(&self, info: McpSessionInfo) {
        self.sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .insert(info.id.clone(), info);
    }

    /// Aktualizuje last_seen; zwraca false gdy sesja nieznana/wygasła.
    pub fn touch(&self, id: &str, now: u64) -> bool {
        let mut map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        map.retain(|_, s| now.saturating_sub(s.last_seen) < SESSION_IDLE_TTL_SECS);
        match map.get_mut(id) {
            Some(s) => {
                s.last_seen = now;
                true
            }
            None => false,
        }
    }

    pub fn remove(&self, id: &str) {
        self.sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .remove(id);
    }

    pub fn list(&self, now: u64) -> Vec<McpSessionInfo> {
        let map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        map.values()
            .filter(|s| now.saturating_sub(s.last_seen) < SESSION_IDLE_TTL_SECS)
            .cloned()
            .collect()
    }

    pub fn active_count(&self, now: u64) -> usize {
        self.list(now).len()
    }
}

static SESSIONS: OnceLock<McpSessions> = OnceLock::new();

pub fn sessions() -> &'static McpSessions {
    SESSIONS.get_or_init(McpSessions::default)
}

#[derive(Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub read_write: bool,
    pub port: u16,
    pub active_sessions: usize,
    pub token: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, last_seen: u64) -> McpSessionInfo {
        McpSessionInfo {
            id: id.to_string(),
            client_name: "test".to_string(),
            created_at: last_seen,
            last_seen,
            backup_path: String::new(),
        }
    }

    #[test]
    fn touch_known_session_updates_and_returns_true() {
        let s = McpSessions::default();
        s.insert(info("a", 100));
        assert!(s.touch("a", 200));
        assert_eq!(s.list(200)[0].last_seen, 200);
    }

    #[test]
    fn touch_unknown_or_expired_returns_false() {
        let s = McpSessions::default();
        assert!(!s.touch("missing", 100));
        s.insert(info("old", 0));
        assert!(!s.touch("old", SESSION_IDLE_TTL_SECS + 1));
    }

    #[test]
    fn remove_and_count() {
        let s = McpSessions::default();
        s.insert(info("a", 10));
        s.insert(info("b", 10));
        assert_eq!(s.active_count(10), 2);
        s.remove("a");
        assert_eq!(s.active_count(10), 1);
    }
}
