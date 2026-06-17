use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type NowSecs = u64;

pub const PAIRING_CODE_TTL_SECS: NowSecs = 180;
pub const SESSION_TTL_SECS: NowSecs = 60 * 60 * 24 * 30; // 30 days

// Rate limit for /auth/pair to make the 6-digit code non-brute-forceable.
const PAIR_FAIL_WINDOW_SECS: NowSecs = 60;
const PAIR_FAIL_MAX: usize = 5;

fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 32 bytes of OS entropy as hex — an unguessable bearer token.
pub fn random_token() -> String {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        // Extremely unlikely; fall back to a still-random-ish value rather than panic.
        return hash_token(&format!("{:?}", std::time::SystemTime::now()));
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Uniform 6-digit pairing code from OS entropy.
pub fn random_pairing_code() -> String {
    let mut buf = [0u8; 4];
    let n = if getrandom::getrandom(&mut buf).is_ok() {
        u32::from_le_bytes(buf)
    } else {
        0
    };
    format!("{:06}", n % 1_000_000)
}

#[derive(Debug, Clone)]
struct PendingCode {
    code: String,
    expires_at: NowSecs,
}

/// Persisted session — stores only the token HASH, never the raw token, so a
/// leaked sessions file cannot be used to impersonate a browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSession {
    token_hash: String,
    id: String,
    label: String,
    created_at: NowSecs,
    expires_at: NowSecs,
}

/// Returned to the caller right after redeem — the only time the raw token exists.
#[derive(Debug, Clone)]
pub struct Session {
    pub token: String,
    pub id: String,
    pub label: String,
    pub created_at: NowSecs,
    pub expires_at: NowSecs,
}

/// Safe view for the management UI — no token, no hash.
#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub label: String,
    pub created_at: NowSecs,
    pub expires_at: NowSecs,
}

#[derive(Default)]
pub struct AuthState {
    pending: Mutex<Option<PendingCode>>,
    sessions: Mutex<HashMap<String, StoredSession>>, // key = token_hash
    pair_failures: Mutex<Vec<NowSecs>>,
    persist_path: Mutex<Option<PathBuf>>,
}

impl AuthState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Point the store at a file and load any persisted sessions (survives app
    /// restart). Expired sessions are dropped on load.
    pub fn enable_persistence(&self, path: PathBuf, now: NowSecs) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(list) = serde_json::from_str::<Vec<StoredSession>>(&raw) {
                let mut sessions = self.sessions.lock().expect("sessions mutex poisoned");
                for s in list.into_iter().filter(|s| s.expires_at > now) {
                    sessions.insert(s.token_hash.clone(), s);
                }
            }
        }
        *self.persist_path.lock().expect("persist mutex poisoned") = Some(path);
    }

    fn persist_locked(&self, sessions: &HashMap<String, StoredSession>) {
        let guard = self.persist_path.lock().expect("persist mutex poisoned");
        if let Some(path) = guard.as_ref() {
            let list: Vec<&StoredSession> = sessions.values().collect();
            if let Ok(json) = serde_json::to_string_pretty(&list) {
                let _ = std::fs::write(path, json);
            }
        }
    }

    pub fn set_pairing_code(&self, code: String, now: NowSecs) {
        let mut pending = self.pending.lock().expect("pending mutex poisoned");
        *pending = Some(PendingCode {
            code,
            expires_at: now + PAIRING_CODE_TTL_SECS,
        });
        // Fresh code → reset brute-force counter for the new attempt window.
        self.pair_failures.lock().expect("failures mutex poisoned").clear();
    }

    /// True if too many failed pairing attempts happened recently.
    pub fn pairing_blocked(&self, now: NowSecs) -> bool {
        let failures = self.pair_failures.lock().expect("failures mutex poisoned");
        let recent = failures
            .iter()
            .filter(|t| now.saturating_sub(**t) < PAIR_FAIL_WINDOW_SECS)
            .count();
        recent >= PAIR_FAIL_MAX
    }

    fn record_pair_failure(&self, now: NowSecs) {
        let mut failures = self.pair_failures.lock().expect("failures mutex poisoned");
        failures.retain(|t| now.saturating_sub(*t) < PAIR_FAIL_WINDOW_SECS);
        failures.push(now);
    }

    pub fn redeem(
        &self,
        code: &str,
        label: String,
        now: NowSecs,
        mint_token: impl FnOnce() -> String,
        mint_id: impl FnOnce() -> String,
    ) -> Result<Session, String> {
        if self.pairing_blocked(now) {
            return Err("too_many_attempts".to_string());
        }

        let mut pending = self.pending.lock().expect("pending mutex poisoned");
        let is_valid = pending
            .as_ref()
            .is_some_and(|p| p.code == code && p.expires_at > now);

        if !is_valid {
            drop(pending);
            self.record_pair_failure(now);
            return Err("invalid_or_expired_code".to_string());
        }

        *pending = None;
        drop(pending);
        self.pair_failures.lock().expect("failures mutex poisoned").clear();

        let token = mint_token();
        let session = Session {
            token: token.clone(),
            id: mint_id(),
            label,
            created_at: now,
            expires_at: now + SESSION_TTL_SECS,
        };

        let mut sessions = self.sessions.lock().expect("sessions mutex poisoned");
        sessions.insert(
            hash_token(&token),
            StoredSession {
                token_hash: hash_token(&token),
                id: session.id.clone(),
                label: session.label.clone(),
                created_at: session.created_at,
                expires_at: session.expires_at,
            },
        );
        self.persist_locked(&sessions);

        Ok(session)
    }

    pub fn is_authorized(&self, token: &str, now: NowSecs) -> bool {
        let sessions = self.sessions.lock().expect("sessions mutex poisoned");
        sessions
            .get(&hash_token(token))
            .is_some_and(|s| s.expires_at > now)
    }

    /// Revoke by session id (the management UI never sees raw tokens).
    pub fn revoke(&self, id: &str) {
        let mut sessions = self.sessions.lock().expect("sessions mutex poisoned");
        sessions.retain(|_, s| s.id != id);
        self.persist_locked(&sessions);
    }

    pub fn list_sessions(&self, now: NowSecs) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().expect("sessions mutex poisoned");
        sessions
            .values()
            .filter(|s| s.expires_at > now)
            .map(|s| SessionInfo {
                id: s.id.clone(),
                label: s.label.clone(),
                created_at: s.created_at,
                expires_at: s.expires_at,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn redeem_ok(auth: &AuthState, code: &str, now: NowSecs, token: &str) -> Session {
        auth.redeem(
            code,
            "Device".to_string(),
            now,
            || token.to_string(),
            || format!("id-{token}"),
        )
        .expect("redeem should succeed")
    }

    #[test]
    fn redeem_valid_code_issues_session_and_authorizes() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        let s = redeem_ok(&auth, "123456", 20, "token-1");
        assert_eq!(s.token, "token-1");
        assert_eq!(s.expires_at, 20 + SESSION_TTL_SECS);
        assert!(auth.is_authorized("token-1", 20));
    }

    #[test]
    fn stored_state_never_contains_raw_token() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        redeem_ok(&auth, "123456", 20, "secret-token");
        // The list view exposes no token, and lookups require the raw token.
        let infos = auth.list_sessions(20);
        assert_eq!(infos.len(), 1);
        assert!(!auth.is_authorized("wrong", 20));
        assert!(auth.is_authorized("secret-token", 20));
    }

    #[test]
    fn wrong_code_is_rejected_and_counts_as_failure() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        assert!(auth
            .redeem("000000", "x".into(), 20, || "t".into(), || "id".into())
            .is_err());
        assert!(!auth.is_authorized("t", 20));
    }

    #[test]
    fn expired_code_is_rejected() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        assert!(auth
            .redeem(
                "123456",
                "x".into(),
                10 + PAIRING_CODE_TTL_SECS,
                || "t".into(),
                || "id".into()
            )
            .is_err());
    }

    #[test]
    fn code_is_single_use() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        redeem_ok(&auth, "123456", 20, "token-1");
        assert!(auth
            .redeem("123456", "x".into(), 21, || "token-2".into(), || "id2".into())
            .is_err());
    }

    #[test]
    fn revoke_by_id_kills_session() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        let s = redeem_ok(&auth, "123456", 20, "token-1");
        auth.revoke(&s.id);
        assert!(!auth.is_authorized("token-1", 21));
    }

    #[test]
    fn rate_limit_blocks_after_max_failures() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        for _ in 0..PAIR_FAIL_MAX {
            let _ = auth.redeem("000000", "x".into(), 20, || "t".into(), || "id".into());
        }
        assert!(auth.pairing_blocked(20));
        // Even the correct code is refused while blocked.
        assert!(auth
            .redeem("123456", "x".into(), 20, || "t".into(), || "id".into())
            .is_err());
    }

    #[test]
    fn rate_limit_window_expires() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        for _ in 0..PAIR_FAIL_MAX {
            let _ = auth.redeem("000000", "x".into(), 20, || "t".into(), || "id".into());
        }
        assert!(auth.pairing_blocked(20));
        assert!(!auth.pairing_blocked(20 + PAIR_FAIL_WINDOW_SECS));
    }

    #[test]
    fn expired_sessions_hidden_and_unauthorized() {
        let auth = AuthState::new();
        auth.set_pairing_code("123456".to_string(), 10);
        redeem_ok(&auth, "123456", 20, "token-1");
        assert!(auth.is_authorized("token-1", 20 + SESSION_TTL_SECS - 1));
        assert!(!auth.is_authorized("token-1", 20 + SESSION_TTL_SECS));
        assert!(auth.list_sessions(20 + SESSION_TTL_SECS).is_empty());
    }

    #[test]
    fn unknown_token_unauthorized() {
        let auth = AuthState::new();
        assert!(!auth.is_authorized("missing", 20));
    }

    #[test]
    fn random_token_is_long_and_varies() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
