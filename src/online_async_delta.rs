//! Koordynacja online sync przez async-delta + transport plików na FTP/SFTP.
//!
//! Model (zgodny z intencją: serwer = TYLKO komunikacja, dane = na FTP):
//!  - PUSH: eksport lokalnej bazy → szyfrowanie E2E **kluczem grupy**
//!    (`encryption_key`; serwer go nie zna) → rejestracja paczki na serwerze
//!    (`/api/sync/async/push`) → odszyfrowanie wydanych przez serwer creds FTP
//!    (tym SAMYM kluczem grupy) → upload bloba na storage-backend (np. „hostido").
//!  - PULL: `/api/sync/async/pending` → `/credentials` → download z FTP →
//!    deszyfracja kluczem grupy → merge → `/ack` (serwer sprząta katalog).
//!
//! ZERO ręcznych sekretów: `encryption_key` (auto-wyprowadzany z grupy licencji)
//! służy do WSZYSTKIEGO — szyfruje DANE (serwer ślepy) i odszyfrowuje KOPERTĘ creds
//! FTP (serwer szyfruje creds tym samym kluczem grupy). `fileEncryptionKey` z creds
//! jest IGNOROWANY — pliki trzymamy w E2E grupy. User nie wkleja żadnego klucza.
//!
//! Wszystkie żądania HTTP i transfery FTP idą przez `run_cancellable`, więc Cancel
//! przerywa też długi upload/download, nie tylko granice kroków.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::config::{self, OnlineSyncSettings};
use crate::lan_server::LanSyncState;
use crate::online_ftp_transport::{self, FtpTarget};
use crate::online_sync::{run_cancellable, server_post_cancellable};
use crate::{lan_common, sync_common};

/// Nazwa pliku bloba w katalogu `slave-upload/` paczki (zgodnie ze starym
/// transportem). Obie strony znają konwencję, bo dzielą ten kod.
const BLOB_FILENAME: &str = "delta.enc";

// ── Kontrakt serwera (session-contracts.ts) ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AsyncPushReq<'a> {
    device_id: &'a str,
    group_id: &'a str,
    base_marker_hash: Option<&'a str>,
    new_marker_hash: &'a str,
    file_size_bytes: u64,
    /// Schemat klucza tej paczki. Domyślnie v1; v2 = dane E2E z passphrase.
    key_scheme: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_salt: Option<&'a str>,
}

/// `storageCredentials: { encrypted: EncryptedCredentials }` (lub null).
#[derive(Deserialize)]
struct StorageCredsWrapper {
    encrypted: crate::sync_encryption::EncryptedCredentials,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsyncPushResp {
    package_id: String,
    storage_credentials: Option<StorageCredsWrapper>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AsyncPendingReq<'a> {
    device_id: &'a str,
    group_id: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsyncPackage {
    id: String,
    #[serde(default)]
    new_marker_hash: String,
    /// Schemat klucza, którym zaszyfrowano `delta.enc` tej paczki. Domyślnie v1
    /// (kompatybilność ze starym serwerem, który tego pola nie zwraca).
    #[serde(default = "default_key_scheme_owned")]
    key_scheme: String,
}

fn default_key_scheme_owned() -> String {
    "v1-groupid".to_string()
}

/// Wybiera klucz DANYCH (do `delta.enc`) wg schematu paczki:
/// - "v2-passphrase" → `data_encryption_key` (PBKDF2 z passphrase; serwer go nie zna),
/// - inaczej (v1) → `encryption_key` (klucz grupy z groupId).
/// Koperta creds FTP jest ZAWSZE odszyfrowywana `encryption_key` (v1) — serwer
/// szyfruje ją tym kluczem — niezależnie od schematu danych.
fn data_key_for_scheme<'a>(s: &'a OnlineSyncSettings, scheme: &str) -> Result<&'a str, String> {
    if scheme == "v2-passphrase" {
        if s.data_encryption_key.is_empty() {
            return Err(
                "paczka v2-passphrase wymaga data_encryption_key — urządzenie niezmigrowane do E2E v2".into(),
            );
        }
        Ok(&s.data_encryption_key)
    } else {
        Ok(&s.encryption_key)
    }
}

#[derive(Deserialize)]
struct AsyncPendingResp {
    packages: Vec<AsyncPackage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AsyncByPackageReq<'a> {
    device_id: &'a str,
    package_id: &'a str,
}

#[derive(Deserialize)]
struct AsyncCredsResp {
    #[serde(rename = "storageCredentials")]
    storage_credentials: Option<StorageCredsWrapper>,
}

// ── Pomocnicze ──

fn should_abort(stop_signal: &AtomicBool) -> bool {
    crate::online_sync::is_cancel_requested() || stop_signal.load(Ordering::SeqCst)
}

fn short(id: &str) -> &str {
    &id[..id.len().min(8)]
}

/// Buduje cel FTP z odszyfrowanych creds. Serwer (bug w `getConnectionInfo`)
/// zawsze zwraca `protocol:"sftp"` i nie podaje flagi `secure`, więc rozróżniamy
/// po porcie: 22 = prawdziwy SFTP (nieobsługiwany w tej wersji), inaczej FTP/FTPS
/// z auto-detekcją TLS.
fn ftp_target_from_creds(creds: &crate::sync_encryption::SftpCredentials) -> Result<FtpTarget, String> {
    // Po fixie serwera: protocol "ftp" + `secure`. Stary serwer (bug): "sftp" dla
    // FTP na porcie 21. Prawdziwy SFTP to "sftp" + port 22 — nieobsługiwany tu.
    if creds.protocol == "sftp" && creds.port == 22 {
        return Err("backend SFTP (port 22) — ta wersja obsługuje tylko FTP/FTPS".into());
    }
    // `secure` honorujemy tylko gdy serwer realnie powiedział "ftp"; przy starym
    // "sftp" dla FTP zostawiamy None → auto-detekcja FTPS→plain.
    let secure = if creds.protocol == "ftp" { creds.secure } else { None };
    Ok(FtpTarget {
        host: creds.host.clone(),
        port: creds.port,
        username: creds.username.clone(),
        password: creds.password.clone(),
        secure,
    })
}

// ── HTTP (przez cancellable POST) ──

fn async_push(
    s: &OnlineSyncSettings,
    base_marker: Option<&str>,
    new_marker: &str,
    size: u64,
    key_scheme: &str,
    key_salt: Option<&str>,
    stop: &AtomicBool,
) -> Result<AsyncPushResp, String> {
    let body = serde_json::to_string(&AsyncPushReq {
        device_id: &s.device_id,
        group_id: &s.group_id,
        base_marker_hash: base_marker,
        new_marker_hash: new_marker,
        file_size_bytes: size,
        key_scheme,
        key_salt,
    })
    .map_err(|e| e.to_string())?;
    let raw = server_post_cancellable(&s.server_url, "/api/sync/async/push", &s.auth_token, &body, stop)?;
    serde_json::from_str(&raw).map_err(|e| format!("async push parse: {e}"))
}

fn async_pending(s: &OnlineSyncSettings, stop: &AtomicBool) -> Result<AsyncPendingResp, String> {
    let body = serde_json::to_string(&AsyncPendingReq {
        device_id: &s.device_id,
        group_id: &s.group_id,
    })
    .map_err(|e| e.to_string())?;
    let raw = server_post_cancellable(&s.server_url, "/api/sync/async/pending", &s.auth_token, &body, stop)?;
    serde_json::from_str(&raw).map_err(|e| format!("async pending parse: {e}"))
}

fn async_credentials(s: &OnlineSyncSettings, package_id: &str, stop: &AtomicBool) -> Result<AsyncCredsResp, String> {
    let body = serde_json::to_string(&AsyncByPackageReq {
        device_id: &s.device_id,
        package_id,
    })
    .map_err(|e| e.to_string())?;
    let raw = server_post_cancellable(&s.server_url, "/api/sync/async/credentials", &s.auth_token, &body, stop)?;
    serde_json::from_str(&raw).map_err(|e| format!("async credentials parse: {e}"))
}

fn async_ack(s: &OnlineSyncSettings, package_id: &str, stop: &AtomicBool) -> Result<(), String> {
    let body = serde_json::to_string(&AsyncByPackageReq {
        device_id: &s.device_id,
        package_id,
    })
    .map_err(|e| e.to_string())?;
    server_post_cancellable(&s.server_url, "/api/sync/async/ack", &s.auth_token, &body, stop).map(|_| ())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentCleanupItem {
    package_id: String,
    #[allow(dead_code)]
    storage_path: String,
}

#[derive(Deserialize)]
struct SentCleanupResp {
    packages: Vec<SentCleanupItem>,
}

fn async_sent_cleanup(s: &OnlineSyncSettings, stop: &AtomicBool) -> Result<SentCleanupResp, String> {
    let body = serde_json::to_string(&AsyncPendingReq {
        device_id: &s.device_id,
        group_id: &s.group_id,
    })
    .map_err(|e| e.to_string())?;
    let raw = server_post_cancellable(&s.server_url, "/api/sync/async/sent-cleanup", &s.auth_token, &body, stop)?;
    serde_json::from_str(&raw).map_err(|e| format!("sent-cleanup parse: {e}"))
}

// ── Publiczne wejścia ──

/// PUSH: publikuje bieżący stan lokalny jako paczkę async (E2E kluczem grupy) na
/// FTP. `new_marker` = aktualny hash treści, `base_marker` = ostatni zsynchronizowany.
pub fn push(
    s: &OnlineSyncSettings,
    sync_state: &LanSyncState,
    new_marker: &str,
    base_marker: Option<&str>,
    stop_signal: &AtomicBool,
) -> Result<(), String> {
    if s.group_id.is_empty() {
        return Err("async push: brak group_id w ustawieniach".into());
    }

    // 1. Eksport + szyfrowanie E2E kluczem DANYCH wg schematu tego urządzenia.
    //    v1: klucz grupy (encryption_key); v2: data_encryption_key (passphrase).
    sync_state.set_progress(2, "exporting", "upload");
    let export_json = {
        let conn = lan_common::open_dashboard_db()?;
        sync_common::build_full_export(&conn)?
    };
    let push_scheme = if s.key_scheme.is_empty() { "v1-groupid" } else { s.key_scheme.as_str() };
    let data_key = data_key_for_scheme(s, push_scheme)?;
    let blob = crate::sync_encryption::encrypt_with_passphrase(export_json.as_bytes(), data_key)?;
    let blob_len = blob.len() as u64;

    // 2. Rejestracja paczki na serwerze (koordynacja, wydaje creds FTP).
    //    Deklarujemy schemat klucza; keySalt (deterministyczny z groupId) tylko dla v2.
    sync_state.set_progress(5, "registering", "upload");
    let key_salt_owned: Option<String> = if push_scheme == "v2-passphrase" {
        Some(format!("timeflow-online-sync-e2e-v2|{}", s.group_id.trim()))
    } else {
        None
    };
    let resp = async_push(
        s,
        base_marker,
        new_marker,
        blob_len,
        push_scheme,
        key_salt_owned.as_deref(),
        stop_signal,
    )?;
    let creds_wrap = resp
        .storage_credentials
        .ok_or("async push: serwer nie zwrócił storageCredentials")?;
    // Creds odszyfrowujemy kluczem GRUPY (encryption_key, v1) — serwer szyfruje je
    // tym samym kluczem grupy, NIEZALEŻNIE od schematu danych. Zero ręcznych sekretów.
    let creds = crate::sync_encryption::decrypt_credentials(&creds_wrap.encrypted, &resp.package_id, &s.encryption_key)?;

    // 3. Upload bloba na FTP (przerywalny — porzucany w locie na Cancel).
    sync_state.set_progress(8, "uploading", "upload");
    let target = ftp_target_from_creds(&creds)?;
    let remote_path = format!("{}{}", creds.upload_path, BLOB_FILENAME);
    let rp = remote_path.clone();
    run_cancellable(stop_signal, move || online_ftp_transport::upload_bytes(&target, &rp, &blob))?;

    config::save_online_sync_synced_hash(new_marker);
    sync_state.set_progress(13, "completed", "upload");
    lan_common::sync_log(&format!(
        "[async-push] opublikowano pkg {} ({} B na FTP)",
        short(&resp.package_id),
        blob_len
    ));
    Ok(())
}

/// PULL: pobiera i scala wszystkie pending paczki innych urządzeń grupy.
/// Zwraca `true`, jeśli cokolwiek zastosowano (warto wtedy rozważyć push unii).
pub fn pull_pending(s: &OnlineSyncSettings, sync_state: &LanSyncState, stop_signal: &AtomicBool) -> Result<bool, String> {
    if s.group_id.is_empty() {
        return Err("async pull: brak group_id w ustawieniach".into());
    }

    sync_state.set_progress(3, "checking", "download");
    let pending = async_pending(s, stop_signal)?;
    if pending.packages.is_empty() {
        lan_common::sync_log(
            "[async-pull] pending: 0 paczek (serwer nic nie zwrócił dla tej grupy/urządzenia — sprawdź group_id i czy druga maszyna pushowała)",
        );
        return Ok(false);
    }
    lan_common::sync_log(&format!(
        "[async-pull] pending: {} paczek do pobrania",
        pending.packages.len()
    ));

    let mut applied = false;
    for pkg in pending.packages {
        if should_abort(stop_signal) {
            lan_common::sync_log("[async-pull] przerwano (cancel/stop)");
            return Ok(applied);
        }

        // Creds do pobrania tej paczki.
        let creds_resp = async_credentials(s, &pkg.id, stop_signal)?;
        let creds_wrap = match creds_resp.storage_credentials {
            Some(w) => w,
            None => {
                lan_common::sync_log(&format!("[async-pull] brak creds dla pkg {} — pomijam", short(&pkg.id)));
                continue;
            }
        };
        let creds = crate::sync_encryption::decrypt_credentials(&creds_wrap.encrypted, &pkg.id, &s.encryption_key)?;

        // Download bloba z FTP (przerywalny).
        sync_state.set_progress(6, "downloading", "download");
        let target = ftp_target_from_creds(&creds)?;
        let remote_path = format!("{}{}", creds.upload_path, BLOB_FILENAME);
        let rp = remote_path.clone();
        let blob = run_cancellable(stop_signal, move || online_ftp_transport::download_bytes(&target, &rp))?;

        // Deszyfracja E2E kluczem DANYCH wg schematu paczki (v1: klucz grupy,
        // v2: data_encryption_key) → string eksportu dla merge.
        let data_key = data_key_for_scheme(s, &pkg.key_scheme)?;
        let export_json = {
            let pt = crate::sync_encryption::decrypt_with_passphrase(&blob, data_key)?;
            String::from_utf8(pt).map_err(|e| format!("async-pull: UTF-8 eksportu: {e}"))?
        };

        // Granica przed merge — przerwij zanim ruszymy lokalną bazę.
        if should_abort(stop_signal) {
            lan_common::sync_log("[async-pull] przerwano (cancel/stop)");
            return Ok(applied);
        }

        sync_state.set_progress(10, "merging", "local");
        sync_state.freeze();
        let merge_res = (|| -> Result<String, String> {
            let mut conn = lan_common::open_dashboard_db()?;
            sync_common::backup_database_typed(&conn, "online")?;
            sync_common::merge_incoming_data(&mut conn, &export_json)?;
            sync_common::verify_merge_integrity(&conn)?;
            Ok(sync_common::compute_tables_hash_string_conn(&conn))
        })();
        sync_state.unfreeze();
        let merged_hash = merge_res?;

        config::save_online_sync_synced_hash(&merged_hash);
        // Multi-receiver: ODBIORCA NIE kasuje pliku — inne urządzenia grupy mogą go
        // jeszcze potrzebować. Plik kasuje NADAWCA, gdy paczka jest delivered/expired
        // (patrz cleanup_own_uploads). Ack po udanym imporcie.
        async_ack(s, &pkg.id, stop_signal)?;
        applied = true;
        lan_common::sync_log(&format!(
            "[async-pull] zastosowano pkg {} (marker {})",
            short(&pkg.id),
            short(&pkg.new_marker_hash)
        ));
    }
    sync_state.set_progress(13, "completed", "local");
    Ok(applied)
}

/// NADAWCA sprząta swoje paczki, które serwer oznaczył delivered/expired:
/// pobiera creds, kasuje plik+katalogi z FTP (delete_file_and_dirs → log USUNIĘCIE). Best-effort —
/// błąd nie wywraca synca (pliki i tak mają TTL). Domyka inwariant
/// client-owns-deletion BEZ łamania multi-receiver (odbiorcy już go nie kasują).
pub fn cleanup_own_uploads(s: &OnlineSyncSettings, stop_signal: &AtomicBool) -> Result<(), String> {
    if s.group_id.is_empty() {
        return Ok(());
    }
    let list = match async_sent_cleanup(s, stop_signal) {
        Ok(l) => l,
        Err(e) => {
            lan_common::sync_log(&format!("[async-cleanup] pominięto (błąd listy): {e}"));
            return Ok(());
        }
    };
    if list.packages.is_empty() {
        return Ok(());
    }
    for item in list.packages {
        if should_abort(stop_signal) {
            return Ok(());
        }
        let creds_resp = match async_credentials(s, &item.package_id, stop_signal) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let Some(creds_wrap) = creds_resp.storage_credentials else { continue };
        let creds = match crate::sync_encryption::decrypt_credentials(
            &creds_wrap.encrypted, &item.package_id, &s.encryption_key,
        ) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let target = match ftp_target_from_creds(&creds) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let remote_path = format!("{}{}", creds.upload_path, BLOB_FILENAME);
        // Kasujemy plik ORAZ puste katalogi paczki (slave-upload + async/<id>),
        // inaczej na FTP zostają puste katalogi UUID (spam).
        let dirs = online_ftp_transport::package_dirs_from_blob_path(&remote_path);
        let _ = online_ftp_transport::delete_file_and_dirs(&target, &remote_path, &dirs);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ftp_target_from_creds — port 22 odrzucany (SFTP nieobsługiwany), port 21
    // mapuje na auto-detekcję TLS (secure=None).
    fn creds_full(port: u16, protocol: &str, secure: Option<bool>) -> crate::sync_encryption::SftpCredentials {
        crate::sync_encryption::SftpCredentials {
            host: "host372606.hostido.net.pl".into(),
            port,
            protocol: protocol.into(),
            username: "u".into(),
            password: "p".into(),
            upload_path: "/async/pkg/slave-upload/".into(),
            download_path: "/async/pkg/master-merged/".into(),
            secure,
            file_encryption_key: "ignored".into(),
        }
    }

    // Prawdziwy SFTP (protocol "sftp" + port 22) — nieobsługiwany.
    #[test]
    fn sftp_port_rejected() {
        assert!(ftp_target_from_creds(&creds_full(22, "sftp", None)).is_err());
    }

    // Stary serwer: FTP zgłaszany jako "sftp" na porcie 21 → auto-detekcja (None).
    #[test]
    fn legacy_sftp_label_on_ftp_port_autodetects() {
        let t = ftp_target_from_creds(&creds_full(21, "sftp", None)).expect("ftp ok");
        assert_eq!(t.port, 21);
        assert_eq!(t.secure, None);
    }

    // Naprawiony serwer: protocol "ftp" + secure honorowane wprost.
    #[test]
    fn fixed_server_ftp_honors_secure() {
        let t = ftp_target_from_creds(&creds_full(21, "ftp", Some(true))).expect("ftp ok");
        assert_eq!(t.secure, Some(true));
        let t2 = ftp_target_from_creds(&creds_full(21, "ftp", Some(false))).expect("ftp ok");
        assert_eq!(t2.secure, Some(false));
    }

    #[test]
    fn short_truncates_to_8() {
        assert_eq!(short("0123456789"), "01234567");
        assert_eq!(short("abc"), "abc");
    }

    #[test]
    fn parses_sent_cleanup_response() {
        let raw = r#"{"ok":true,"packages":[{"packageId":"p1","storagePath":"/async/p1"}]}"#;
        let resp: SentCleanupResp = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.packages.len(), 1);
        assert_eq!(resp.packages[0].package_id, "p1");
    }

    fn settings_with_keys(encryption_key: &str, data_key: &str) -> OnlineSyncSettings {
        let mut s = OnlineSyncSettings::default();
        s.encryption_key = encryption_key.into();
        s.data_encryption_key = data_key.into();
        s
    }

    // AsyncPackage bez pola keyScheme (stary serwer) → domyślnie v1.
    #[test]
    fn async_package_defaults_key_scheme_v1() {
        let raw = r#"{"id":"p1","newMarkerHash":"abc"}"#;
        let pkg: AsyncPackage = serde_json::from_str(raw).unwrap();
        assert_eq!(pkg.key_scheme, "v1-groupid");
    }

    // AsyncPackage z jawnym keyScheme v2.
    #[test]
    fn async_package_reads_key_scheme_v2() {
        let raw = r#"{"id":"p1","newMarkerHash":"abc","keyScheme":"v2-passphrase"}"#;
        let pkg: AsyncPackage = serde_json::from_str(raw).unwrap();
        assert_eq!(pkg.key_scheme, "v2-passphrase");
    }

    // v1 → klucz danych = encryption_key (klucz grupy).
    #[test]
    fn data_key_v1_uses_group_key() {
        let s = settings_with_keys("group-key-v1", "data-key-v2");
        assert_eq!(data_key_for_scheme(&s, "v1-groupid").unwrap(), "group-key-v1");
    }

    // v2 → klucz danych = data_encryption_key (passphrase).
    #[test]
    fn data_key_v2_uses_data_key() {
        let s = settings_with_keys("group-key-v1", "data-key-v2");
        assert_eq!(data_key_for_scheme(&s, "v2-passphrase").unwrap(), "data-key-v2");
    }

    // v2 bez data_encryption_key → Err (urządzenie niezmigrowane), nie ciche v1.
    #[test]
    fn data_key_v2_without_data_key_errors() {
        let s = settings_with_keys("group-key-v1", "");
        assert!(data_key_for_scheme(&s, "v2-passphrase").is_err());
    }

    // Round-trip: dane zaszyfrowane kluczem v2 odszyfrowują się kluczem v2, nie v1.
    #[test]
    fn v2_data_roundtrips_only_with_v2_key() {
        let s = settings_with_keys("group-key-v1", "pbkdf2-hex-data-key");
        let plaintext = b"{\"export\":true}";
        let v2_key = data_key_for_scheme(&s, "v2-passphrase").unwrap();
        let blob = crate::sync_encryption::encrypt_with_passphrase(plaintext, v2_key).unwrap();
        // v2 key decrypts
        let dec = crate::sync_encryption::decrypt_with_passphrase(&blob, v2_key).unwrap();
        assert_eq!(dec, plaintext);
        // v1 key does NOT
        let v1_key = data_key_for_scheme(&s, "v1-groupid").unwrap();
        assert!(crate::sync_encryption::decrypt_with_passphrase(&blob, v1_key).is_err());
    }
}
