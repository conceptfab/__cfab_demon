#![allow(dead_code)]

pub mod backup;
pub mod config;
pub mod protocol;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// Sesja klienta MCP (Claude Code / Claude Desktop / Codex). Tworzona przy
/// `initialize`, usuwana przy DELETE /mcp lub po czasie bezczynności.
/// `backup_path` jest pusty dopóki sesja niczego nie zapisała — backup jest
/// leniwy i powstaje dopiero przy pierwszym narzędziu zapisującym.
#[derive(Debug, Clone, Serialize)]
pub struct McpSessionInfo {
    pub id: String,
    pub client_name: String,
    pub created_at: u64,
    pub last_seen: u64,
    pub backup_path: String,
}

/// 15 minut bezczynności. Licznik „Aktywne sesje" ma pokazywać realnie żywych
/// klientów, a nie wszystko, co kiedykolwiek zrobiło `initialize`.
const SESSION_IDLE_TTL_SECS: u64 = 900;

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

    /// Usuwa sesje bezczynne dłużej niż TTL. Tanie — wołane z każdego żądania.
    pub fn gc(&self, now: u64) {
        let mut map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        map.retain(|id, s| {
            let alive = now.saturating_sub(s.last_seen) < SESSION_IDLE_TTL_SECS;
            if !alive {
                log::info!("[mcp] reaping idle session {id}");
            }
            alive
        });
    }

    /// Aktualizuje `last_seen`; zwraca false gdy sesja nieznana/wygasła.
    pub fn touch(&self, id: &str, now: u64) -> bool {
        self.gc(now);
        let mut map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        match map.get_mut(id) {
            Some(s) => {
                s.last_seen = now;
                true
            }
            None => false,
        }
    }

    /// Jak `touch`, ale nieznaną sesję rejestruje na nowo. Klient trzymający
    /// połączenie godzinami potrafi wysłać `tools/call` bez ponownego
    /// `initialize`; odmowa wywracała wtedy całą rozmowę, a token i tak jest
    /// weryfikowany osobno przy każdym żądaniu.
    pub fn touch_or_revive(&self, id: &str, now: u64) {
        if self.touch(id, now) {
            return;
        }
        log::info!("[mcp] reviving unknown session {id}");
        self.insert(McpSessionInfo {
            id: id.to_string(),
            client_name: "mcp-client".to_string(),
            created_at: now,
            last_seen: now,
            backup_path: String::new(),
        });
    }

    /// Czy sesja ma już zrobiony backup (pierwszy zapis jej nie wymaga ponownie).
    pub fn backup_done(&self, id: &str) -> bool {
        self.sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .get(id)
            .map(|s| !s.backup_path.is_empty())
            .unwrap_or(false)
    }

    pub fn mark_backup(&self, id: &str, path: &str) {
        if let Some(s) = self
            .sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .get_mut(id)
        {
            s.backup_path = path.to_string();
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
    fn revive_registers_unknown_session_instead_of_dropping_it() {
        let s = McpSessions::default();
        s.touch_or_revive("ghost", 500);
        assert_eq!(s.active_count(500), 1);
        assert!(s.touch("ghost", 501));
    }

    #[test]
    fn gc_reaps_only_idle_sessions() {
        let s = McpSessions::default();
        s.insert(info("fresh", SESSION_IDLE_TTL_SECS));
        s.insert(info("stale", 0));
        s.gc(SESSION_IDLE_TTL_SECS + 1);
        let ids: Vec<String> = s
            .list(SESSION_IDLE_TTL_SECS + 1)
            .into_iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(ids, vec!["fresh".to_string()]);
    }

    #[test]
    fn backup_is_marked_once_per_session() {
        let s = McpSessions::default();
        s.insert(info("a", 10));
        assert!(!s.backup_done("a"));
        s.mark_backup("a", "C:/backups/x.db");
        assert!(s.backup_done("a"));
        assert_eq!(s.list(10)[0].backup_path, "C:/backups/x.db");
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
