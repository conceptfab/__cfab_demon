use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use crate::online_sync::server_post;
use crate::lan_server::LanSyncState;
use crate::{config, sync_common, lan_common};

/// Ile razy ponowić push po koliz­ji CAS (stale_revision) zanim się poddamy.
const MAX_PUSH_RETRY: u32 = 3;

/// Stan widziany przez klienta przed decyzją.
#[derive(Debug, Clone)]
pub struct SyncView {
    pub client_revision: i64,
    pub server_revision: i64,
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

// ── Archive ↔ snapshot bridge (E2E-encrypted) ──
//
// `build_full_export(&conn)` zwraca STRING JSON-obiektu eksportu
// (table_hashes/exported_at/device_id/data{projects,...}).
// `merge_incoming_data(conn, slave_data)` parsuje DOKŁADNIE ten string.
//
// E2E: zamiast wysyłać eksport plaintextem, szyfrujemy jego bajty hasłem
// (`encryption_key`) i pakujemy szyfrogram (base64, nonce-prefixed) w kopertę:
//   archive = { "data": { "e2e": 1, "alg": "aes-256-gcm", "ct": "<base64>" } }
// Serwer trzyma `archive` jako `{ data: object }` verbatim i gzipuje całość —
// `data` traktuje nieprzezroczyście, więc widzi tylko szyfrogram. Przy pull
// odwracamy: czytamy `archive.data.ct` → base64-decode → decrypt → string eksportu,
// który `merge_incoming_data` przyjmuje bez zmian. Round-trip jest symetryczny.
//
// Uwaga (zbieżność): AES-GCM używa losowego nonce, więc ten sam eksport zaszyfrowany
// dwa razy daje różny szyfrogram → serwerowa detekcja no-op po SHA nigdy nie zadziała.
// To OK: KLIENT zbiega przez `compute_tables_hash_string_conn` (treść odszyfrowanej
// bazy) i pushuje tylko gdy lokalnie „dirty". Tu nie dodajemy determinizmu.

const ENVELOPE_ALG: &str = "aes-256-gcm";

/// Szyfruje string eksportu (`build_full_export`) hasłem i owija w kopertę E2E:
/// `archive = { "data": { "e2e": 1, "alg": "aes-256-gcm", "ct": "<base64 szyfrogramu>" } }`.
fn wrap_snapshot_to_archive(
    export_json: &str,
    encryption_key: &str,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    let ciphertext =
        crate::sync_encryption::encrypt_with_passphrase(export_json.as_bytes(), encryption_key)?;
    let ct_b64 = base64::engine::general_purpose::STANDARD.encode(&ciphertext);
    Ok(serde_json::json!({
        "data": { "e2e": 1, "alg": ENVELOPE_ALG, "ct": ct_b64 }
    }))
}

/// Odwraca `wrap_snapshot_to_archive`: czyta kopertę E2E z `archive.data`,
/// base64-dekoduje `ct`, deszyfruje hasłem i zwraca string eksportu gotowy dla
/// `merge_incoming_data`. Waliduje marker `e2e`; przy złej kopercie lub błędzie
/// deszyfracji zwraca czytelny Err (nigdy panic, nigdy „cichy śmieć").
fn unwrap_archive_to_snapshot(
    archive: &serde_json::Value,
    encryption_key: &str,
) -> Result<String, String> {
    use base64::Engine;
    let data = archive
        .get("data")
        .ok_or("unwrap: archive nie ma pola 'data'")?;
    let e2e = data.get("e2e").and_then(|v| v.as_i64());
    if e2e != Some(1) {
        return Err("unwrap: koperta nie jest E2E (brak/zły marker 'e2e')".into());
    }
    let ct_b64 = data
        .get("ct")
        .and_then(|v| v.as_str())
        .ok_or("unwrap: koperta E2E nie ma pola 'ct'")?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(ct_b64)
        .map_err(|e| format!("unwrap: base64 ct: {e}"))?;
    let plaintext =
        crate::sync_encryption::decrypt_with_passphrase(&ciphertext, encryption_key)?;
    String::from_utf8(plaintext).map_err(|e| format!("unwrap: UTF-8 eksportu: {e}"))
}

// ── Store-and-forward sync loop ──

/// Wspólny test przerwania przebiegu: użytkownik anulował (`request_cancel`) LUB
/// demon się zamyka (`stop_signal`). Sprawdzany na grubych granicach kroków
/// (start, przed merge, przed każdą próbą push) — bez busy-pollingu.
fn should_abort(stop_signal: &AtomicBool) -> bool {
    crate::online_sync::is_cancel_requested()
        || stop_signal.load(std::sync::atomic::Ordering::SeqCst)
}

/// Publiczne wejście store-and-forward online synca. Wywoływane przez trigger.
/// Panic-safe (guarded_then_cleanup); zawsze odmraża bazę i resetuje progress na końcu.
pub fn run_store_forward_sync(
    settings: config::OnlineSyncSettings,
    sync_state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
) {
    crate::online_sync::clear_cancel();
    sync_state.set_sync_type("online");
    let sync_state_cleanup = Arc::clone(&sync_state);
    crate::lan_sync_orchestrator::guarded_then_cleanup(
        std::panic::AssertUnwindSafe(|| {
            match execute_store_forward(&settings, &sync_state, &stop_signal) {
                Ok(()) => {
                    config::save_online_sync_completed();
                    true
                }
                Err(e) => {
                    lan_common::sync_log(&format!("[store-forward] błąd: {e}"));
                    config::record_online_sync_failure();
                    false
                }
            }
        }),
        move |_ok| {
            sync_state_cleanup.unfreeze();
            sync_state_cleanup.reset_progress();
        },
    );
}

/// Pojedynczy przebieg: decyzja → pull+merge i/lub push (z CAS retry).
fn execute_store_forward(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
) -> Result<(), String> {
    let server = &settings.server_url;
    let token = &settings.auth_token;
    // Serwer rozwiązuje userId z device-tokena; wysyłanie body userId tylko grozi
    // 403 "Body userId does not match device owner", więc wysyłamy pusty string.
    let user = "";
    let device = &settings.device_id;

    // E2E wymaga klucza — bez niego nie umiemy zaszyfrować pushu ani odszyfrować
    // pulla. Fail loud PRZED jakąkolwiek siecią; nie ma cichego fallbacku do plaintextu.
    if settings.encryption_key.is_empty() {
        return Err("brak klucza szyfrowania (encryption_key) — online sync wymaga klucza".into());
    }

    // (a) Granica startu — przerwij zanim w ogóle uderzymy w sieć/bazę.
    if should_abort(stop_signal) {
        lan_common::sync_log("[store-forward] przerwano (cancel/stop)");
        return Ok(());
    }

    let local_hash = {
        let conn = lan_common::open_dashboard_db()?;
        sync_common::compute_tables_hash_string_conn(&conn)
    };
    let client_rev = config::load_online_sync_revision();
    let last_synced = config::load_online_sync_synced_hash();
    let local_dirty = last_synced.as_deref() != Some(local_hash.as_str());

    sync_state.set_progress(1, "checking", "idle");
    let status = fetch_status(server, token, user, device, client_rev, &local_hash)?;
    if should_abort(stop_signal) {
        lan_common::sync_log("[store-forward] przerwano (cancel/stop)");
        return Ok(());
    }
    let view = SyncView {
        client_revision: client_rev,
        server_revision: status.server_revision,
        local_dirty,
    };
    match decide(&view) {
        SyncDecision::Idle => {
            sync_state.set_progress(13, "completed", "idle");
            Ok(())
        }
        SyncDecision::Pull => {
            do_pull_merge(settings, sync_state, stop_signal)?;
            Ok(())
        }
        SyncDecision::Push => {
            do_push(settings, sync_state, client_rev, stop_signal)?;
            Ok(())
        }
        SyncDecision::PullThenPush => {
            do_pull_merge(settings, sync_state, stop_signal)?;
            // Po merge rewizja serwera została zapisana — bierzemy ją jako CAS base.
            let new_base = config::load_online_sync_revision();
            do_push(settings, sync_state, new_base, stop_signal)?;
            Ok(())
        }
    }
}

/// Pobierz snapshot z serwera i zmerguj lokalnie.
/// FAZA 1: krótki freeze() tylko wokół samego lokalnego merge (Task 12 go usunie
/// na rzecz merge nieblokującego). Sieć (pull) jest poza freeze.
fn do_pull_merge(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
) -> Result<(), String> {
    let server = &settings.server_url;
    let token = &settings.auth_token;
    // Serwer rozwiązuje userId z device-tokena; wysyłanie body userId tylko grozi
    // 403 "Body userId does not match device owner", więc wysyłamy pusty string.
    let user = "";
    let device = &settings.device_id;
    let client_rev = config::load_online_sync_revision();

    sync_state.set_progress(5, "pulling", "download");
    let pull = pull_snapshot(server, token, user, device, client_rev)?;
    if !pull.has_update {
        crate::lan_common::sync_log("[store-forward] pull: serwer nie ma nowszych danych (brak update)");
        return Ok(());
    }
    let archive = pull.archive.ok_or("pull: hasUpdate ale brak archive")?;
    let server_rev = pull.revision.ok_or("pull: brak revision")?;
    let slave_data = unwrap_archive_to_snapshot(&archive, &settings.encryption_key)?;

    // (b) Granica przed merge — przerwij zanim ruszymy lokalną bazę (freeze+merge).
    if should_abort(stop_signal) {
        lan_common::sync_log("[store-forward] przerwano (cancel/stop)");
        return Ok(());
    }

    sync_state.freeze();
    let merge_res = (|| -> Result<String, String> {
        let mut conn = lan_common::open_dashboard_db()?;
        sync_common::backup_database_typed(&conn, "online")?;
        sync_common::merge_incoming_data(&mut conn, &slave_data)?;
        sync_common::verify_merge_integrity(&conn)?;
        Ok(sync_common::compute_tables_hash_string_conn(&conn))
    })();
    sync_state.unfreeze();
    let merged_hash = merge_res?;

    config::save_online_sync_revision(server_rev);
    config::save_online_sync_synced_hash(&merged_hash);
    sync_state.set_progress(13, "completed", "local");
    Ok(())
}

/// Wyeksportuj lokalną bazę i wypchnij na serwer z CAS (knownServerRevision).
/// Przy kolizji `stale_revision` robimy pull+merge i ponawiamy push (do MAX_PUSH_RETRY).
fn do_push(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    base_rev: i64,
    stop_signal: &AtomicBool,
) -> Result<(), String> {
    let server = &settings.server_url;
    let token = &settings.auth_token;
    // Serwer rozwiązuje userId z device-tokena; wysyłanie body userId tylko grozi
    // 403 "Body userId does not match device owner", więc wysyłamy pusty string.
    let user = "";
    let device = &settings.device_id;

    let mut base = base_rev;
    for attempt in 0..MAX_PUSH_RETRY {
        // (c) Granica każdej próby CAS — przerwij przed kolejnym eksportem+push.
        if should_abort(stop_signal) {
            lan_common::sync_log("[store-forward] przerwano (cancel/stop)");
            return Ok(());
        }
        sync_state.set_progress(11, "pushing", "upload");
        let export_json = {
            let conn = lan_common::open_dashboard_db()?;
            sync_common::build_full_export(&conn)?
        };
        let archive = wrap_snapshot_to_archive(&export_json, &settings.encryption_key)?;
        let known = if base == 0 { None } else { Some(base) };
        let resp = push_snapshot(server, token, user, device, known, archive)?;
        if resp.accepted || resp.no_op {
            config::save_online_sync_revision(resp.revision);
            let conn = lan_common::open_dashboard_db()?;
            config::save_online_sync_synced_hash(
                &sync_common::compute_tables_hash_string_conn(&conn),
            );
            sync_state.set_progress(13, "completed", "upload");
            return Ok(());
        }
        if resp.reason == "stale_revision" {
            lan_common::sync_log(&format!(
                "[store-forward] push stale (próba {}), pull+merge i retry",
                attempt + 1
            ));
            do_pull_merge(settings, sync_state, stop_signal)?;
            base = config::load_online_sync_revision();
            continue;
        }
        return Err(format!("push odrzucony: {}", resp.reason));
    }
    Err("push: przekroczono limit retry CAS".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(cr: i64, sr: i64, dirty: bool) -> SyncView {
        SyncView { client_revision: cr, server_revision: sr, local_dirty: dirty }
    }
    #[test] fn idle_when_in_sync_and_clean() { assert_eq!(decide(&v(5,5,false)), SyncDecision::Idle); }
    #[test] fn push_when_clean_behind_false_but_dirty() { assert_eq!(decide(&v(5,5,true)), SyncDecision::Push); }
    #[test] fn pull_when_behind_and_clean() { assert_eq!(decide(&v(4,5,false)), SyncDecision::Pull); }
    #[test] fn pull_then_push_when_behind_and_dirty() { assert_eq!(decide(&v(4,5,true)), SyncDecision::PullThenPush); }

    const E2E_TEST_VECTOR: &str = "tf-e2e-archive-vector";

    /// Reprezentatywny kształt build_full_export.
    const SAMPLE_EXPORT: &str = r#"{"table_hashes":{"projects":"abc"},"exported_at":"2026-06-24 10:00:00","device_id":"dev-1","data":{"projects":[{"id":1,"name":"P"}],"applications":[],"sessions":[],"manual_sessions":[],"tombstones":[],"clients":[],"assignment_feedback":[],"assignment_auto_runs":[]}}"#;

    /// E2E round-trip: wrap (szyfruje) → unwrap (deszyfruje) tym samym kluczem musi
    /// oddać DOKŁADNIE ten sam obiekt eksportu, który merge przyjmuje 1:1.
    /// Koperta zawiera tylko szyfrogram — nie surowy eksport.
    #[test]
    fn archive_round_trip_is_identity_encrypted() {
        let archive = wrap_snapshot_to_archive(SAMPLE_EXPORT, E2E_TEST_VECTOR).expect("wrap");

        // Serwerowy kontrakt: { data: <object> }; koperta E2E w środku.
        let data = archive.get("data").expect("archive musi mieć pole 'data'");
        assert_eq!(data.get("e2e").and_then(|v| v.as_i64()), Some(1), "marker e2e=1");
        assert_eq!(data.get("alg").and_then(|v| v.as_str()), Some("aes-256-gcm"));
        let ct = data.get("ct").and_then(|v| v.as_str()).expect("ct base64 obecne");
        // Serwer nie może odczytać eksportu: szyfrogram nie zawiera plaintextu.
        assert!(!ct.contains("projects"), "ct musi być szyfrogramem, nie plaintextem");

        let restored = unwrap_archive_to_snapshot(&archive, E2E_TEST_VECTOR).expect("unwrap");
        let a: serde_json::Value = serde_json::from_str(SAMPLE_EXPORT).unwrap();
        let b: serde_json::Value = serde_json::from_str(&restored).unwrap();
        assert_eq!(a, b, "round-trip wrap→unwrap musi zachować eksport bit w bit");
    }

    /// AES-GCM ma losowy nonce → ten sam eksport daje dwa różne szyfrogramy.
    /// (Świadome: zbieżność po stronie KLIENTA, nie po SHA serwera.)
    #[test]
    fn wrap_produces_distinct_ciphertext_each_call() {
        let a = wrap_snapshot_to_archive(SAMPLE_EXPORT, E2E_TEST_VECTOR).unwrap();
        let b = wrap_snapshot_to_archive(SAMPLE_EXPORT, E2E_TEST_VECTOR).unwrap();
        let ct_a = a["data"]["ct"].as_str().unwrap();
        let ct_b = b["data"]["ct"].as_str().unwrap();
        assert_ne!(ct_a, ct_b, "losowy nonce → różny szyfrogram per push");
    }

    /// Zły klucz → Err (autentykacja GCM), nigdy panic ani śmieci psujące merge.
    #[test]
    fn unwrap_with_wrong_key_returns_err() {
        let archive = wrap_snapshot_to_archive(SAMPLE_EXPORT, E2E_TEST_VECTOR).expect("wrap");
        let r = unwrap_archive_to_snapshot(&archive, "zly-klucz");
        assert!(r.is_err(), "zły klucz musi dać Err");
    }

    #[test]
    fn unwrap_rejects_archive_without_data() {
        let bad = serde_json::json!({ "version": "1" });
        assert!(unwrap_archive_to_snapshot(&bad, E2E_TEST_VECTOR).is_err());
    }

    /// Brak koperty E2E (ani markera, ani ct) → czytelny Err, nie panic.
    #[test]
    fn unwrap_rejects_non_e2e_envelope() {
        // Stary kształt plaintext { data: <export> } — bez markera e2e.
        let legacy = serde_json::json!({ "data": { "projects": [] } });
        assert!(unwrap_archive_to_snapshot(&legacy, E2E_TEST_VECTOR).is_err(),
            "koperta bez markera e2e musi być odrzucona");

        // Marker jest, ale brak ct.
        let no_ct = serde_json::json!({ "data": { "e2e": 1, "alg": "aes-256-gcm" } });
        assert!(unwrap_archive_to_snapshot(&no_ct, E2E_TEST_VECTOR).is_err(),
            "koperta E2E bez 'ct' musi dać Err");
    }
}
