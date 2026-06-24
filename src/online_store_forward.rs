use serde::{Deserialize, Serialize};
use crate::online_sync::server_post;

/// Stan widziany przez klienta przed decyzją.
#[derive(Debug, Clone)]
pub struct SyncView {
    pub client_revision: i64,
    pub server_revision: i64,
    pub local_hash: String,
    pub server_hash: Option<String>,
    /// czy lokalna baza ma niezsynchronizowane zmiany (local_hash != hash z ostatniego sync)
    pub local_dirty: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncDecision {
    Idle,
    Pull,            // serwer ma nowszą rewizję — pobierz + merge
    Push,            // mamy lokalne zmiany do wypchnięcia
    PullThenPush,    // jesteśmy w tyle i mamy lokalne zmiany — najpierw pull+merge, potem push unii
}

/// Czysta decyzja, bez sieci. Reguły:
/// - server_revision > client_revision => musimy pull (i jeśli local_dirty, potem push).
/// - server_revision == client_revision && local_dirty => push.
/// - inaczej => idle.
pub fn decide(view: &SyncView) -> SyncDecision {
    if view.server_revision > view.client_revision {
        if view.local_dirty { SyncDecision::PullThenPush } else { SyncDecision::Pull }
    } else if view.local_dirty {
        SyncDecision::Push
    } else {
        SyncDecision::Idle
    }
}

// ── Direct-sync HTTP types + wrappers ──

#[derive(Serialize)]
struct StatusReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "clientRevision")] client_revision: i64,
    #[serde(rename = "clientHash")] client_hash: &'a str,
}
#[derive(Deserialize)]
pub struct StatusResp {
    #[serde(rename = "serverRevision")] pub server_revision: i64,
    #[serde(rename = "serverHash")] pub server_hash: Option<String>,
}

#[derive(Serialize)]
struct PushReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "knownServerRevision")] known_server_revision: Option<i64>,
    archive: serde_json::Value,
}
#[derive(Deserialize)]
pub struct PushResp {
    pub accepted: bool,
    #[serde(rename = "noOp", default)] pub no_op: bool,
    pub revision: i64,
    #[serde(default)] pub reason: String,
}

#[derive(Serialize)]
struct PullReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "clientRevision")] client_revision: i64,
}
#[derive(Deserialize)]
pub struct PullResp {
    #[serde(rename = "hasUpdate")] pub has_update: bool,
    pub revision: Option<i64>,
    #[serde(rename = "payloadSha256")] pub payload_sha256: Option<String>,
    pub archive: Option<serde_json::Value>,
}

pub(crate) fn fetch_status(server: &str, token: &str, user: &str, device: &str,
                           client_rev: i64, client_hash: &str) -> Result<StatusResp, String> {
    let body = serde_json::to_string(&StatusReq {
        user_id: user, device_id: device, client_revision: client_rev, client_hash,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/status", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("status parse: {e}"))
}

pub(crate) fn push_snapshot(server: &str, token: &str, user: &str, device: &str,
                            known_rev: Option<i64>, archive: serde_json::Value) -> Result<PushResp, String> {
    let body = serde_json::to_string(&PushReq {
        user_id: user, device_id: device, known_server_revision: known_rev, archive,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/push", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("push parse: {e}"))
}

pub(crate) fn pull_snapshot(server: &str, token: &str, user: &str, device: &str,
                            client_rev: i64) -> Result<PullResp, String> {
    let body = serde_json::to_string(&PullReq {
        user_id: user, device_id: device, client_revision: client_rev,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/delta-pull", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("pull parse: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(cr: i64, sr: i64, dirty: bool) -> SyncView {
        SyncView { client_revision: cr, server_revision: sr,
            local_hash: "h".into(), server_hash: Some("s".into()), local_dirty: dirty }
    }
    #[test] fn idle_when_in_sync_and_clean() { assert_eq!(decide(&v(5,5,false)), SyncDecision::Idle); }
    #[test] fn push_when_clean_behind_false_but_dirty() { assert_eq!(decide(&v(5,5,true)), SyncDecision::Push); }
    #[test] fn pull_when_behind_and_clean() { assert_eq!(decide(&v(4,5,false)), SyncDecision::Pull); }
    #[test] fn pull_then_push_when_behind_and_dirty() { assert_eq!(decide(&v(4,5,true)), SyncDecision::PullThenPush); }
}
