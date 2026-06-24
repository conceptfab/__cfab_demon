//! Koordynacja online sync przez async-delta + transport plików na FTP/SFTP.
//!
//! Model (zgodny z intencją: serwer = TYLKO komunikacja, dane = na FTP):
//!  - PUSH: eksport lokalnej bazy → szyfrowanie E2E **kluczem grupy**
//!    (`encryption_key`; serwer go nie zna) → rejestracja paczki na serwerze
//!    (`/api/sync/async/push`) → odszyfrowanie wydanych przez serwer creds FTP
//!    (`sync_master_key`) → upload bloba na storage-backend (np. „hostido").
//!  - PULL: `/api/sync/async/pending` → `/credentials` → download z FTP →
//!    deszyfracja kluczem grupy → merge → `/ack` (serwer sprząta katalog).
//!
//! Dwa różne sekrety: `encryption_key` szyfruje DANE (serwer ślepy),
//! `sync_master_key` (= serwerowy SYNC_ENCRYPTION_KEY) odszyfrowuje tylko KOPERTĘ
//! creds. `fileEncryptionKey` z creds jest IGNOROWANY — pliki trzymamy w E2E grupy.
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
    stop: &AtomicBool,
) -> Result<AsyncPushResp, String> {
    let body = serde_json::to_string(&AsyncPushReq {
        device_id: &s.device_id,
        group_id: &s.group_id,
        base_marker_hash: base_marker,
        new_marker_hash: new_marker,
        file_size_bytes: size,
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

    // 1. Eksport + szyfrowanie E2E kluczem grupy (serwer treści nie zobaczy).
    sync_state.set_progress(2, "exporting", "upload");
    let export_json = {
        let conn = lan_common::open_dashboard_db()?;
        sync_common::build_full_export(&conn)?
    };
    let blob = crate::sync_encryption::encrypt_with_passphrase(export_json.as_bytes(), &s.encryption_key)?;
    let blob_len = blob.len() as u64;

    // 2. Rejestracja paczki na serwerze (koordynacja, wydaje creds FTP).
    sync_state.set_progress(5, "registering", "upload");
    let resp = async_push(s, base_marker, new_marker, blob_len, stop_signal)?;
    let creds_wrap = resp
        .storage_credentials
        .ok_or("async push: serwer nie zwrócił storageCredentials")?;
    let creds = crate::sync_encryption::decrypt_credentials(&creds_wrap.encrypted, &resp.package_id, &s.sync_master_key)?;

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
        return Ok(false);
    }

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
        let creds = crate::sync_encryption::decrypt_credentials(&creds_wrap.encrypted, &pkg.id, &s.sync_master_key)?;

        // Download bloba z FTP (przerywalny).
        sync_state.set_progress(6, "downloading", "download");
        let target = ftp_target_from_creds(&creds)?;
        let remote_path = format!("{}{}", creds.upload_path, BLOB_FILENAME);
        let rp = remote_path.clone();
        let blob = run_cancellable(stop_signal, move || online_ftp_transport::download_bytes(&target, &rp))?;

        // Deszyfracja E2E kluczem grupy → string eksportu dla merge.
        let export_json = {
            let pt = crate::sync_encryption::decrypt_with_passphrase(&blob, &s.encryption_key)?;
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
}
