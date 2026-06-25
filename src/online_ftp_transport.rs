//! Transport plików online sync na FTP/FTPS (suppaftp v9 + rustls-ring).
//!
//! Demon uploaduje/pobiera ZASZYFROWANE bajty (E2E kluczem grupy — patrz
//! `online_async_delta`) na storage-backend wskazany przez serwer (np. hostido).
//! Serwer wydaje tylko creds; treści danych nie widzi. Obsługa: plain FTP oraz
//! explicit FTPS (AUTH TLS — suppaftp sam ustawia PBSZ(0)/PROT P). Tryb pasywny
//! domyślnie (suppaftp). Gdy `secure == None` — auto-detekcja: próba FTPS, a przy
//! porażce TLS fallback do plain (serwer mówi tylko `protocol:"sftp"` bez flagi
//! `secure`, więc demon musi sobie poradzić bez tej informacji).

use std::io::Cursor;
use std::net::ToSocketAddrs;
use std::sync::Arc;
use std::time::Duration;

use suppaftp::rustls::{ClientConfig, RootCertStore};
use suppaftp::types::FileType;
use suppaftp::{RustlsConnector, RustlsFtpStream};

use crate::lan_common::sync_log;

/// Limit rozmiaru pliku — backend „hostido" deklaruje 100 MB. Walidujemy po obu
/// stronach (upload przed wysyłką, download po pobraniu), żeby nie zatkać łącza
/// ani nie wczytać niespodziewanie wielkiego bloba do RAM.
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// Parametry połączenia z backendem FTP (z odszyfrowanych `storageCredentials`).
pub struct FtpTarget {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    /// `Some(true)` = wymuś FTPS, `Some(false)` = plain, `None` = auto-detekcja.
    pub secure: Option<bool>,
}

fn resolve_addr(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("DNS {host}:{port}: {e}"))?
        .next()
        .ok_or_else(|| format!("Brak adresu dla {host}:{port}"))
}

fn rustls_client_config() -> Arc<ClientConfig> {
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    Arc::new(
        ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

/// Łączy i loguje. `want_tls` decyduje o explicit FTPS (AUTH TLS).
fn connect_login(target: &FtpTarget, want_tls: bool) -> Result<RustlsFtpStream, String> {
    let addr = resolve_addr(&target.host, target.port)?;
    let mut ftp = RustlsFtpStream::connect_timeout(addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("FTP connect {}:{}: {e}", target.host, target.port))?;
    if want_tls {
        ftp = ftp
            .into_secure(RustlsConnector::from(rustls_client_config()), &target.host)
            .map_err(|e| format!("FTPS AUTH TLS {}: {e}", target.host))?;
    }
    ftp.login(&target.username, &target.password)
        .map_err(|e| format!("FTP login ({}): {e}", target.username))?;
    ftp.transfer_type(FileType::Binary)
        .map_err(|e| format!("FTP set binary mode {}: {e}", target.host))?;
    Ok(ftp)
}

/// Otwiera sesję wg `secure`: wymuszone TLS/plain, albo auto (FTPS→fallback plain).
fn connect(target: &FtpTarget) -> Result<RustlsFtpStream, String> {
    match target.secure {
        Some(true) => connect_login(target, true),
        Some(false) => connect_login(target, false),
        None => connect_login(target, true).or_else(|tls_err| {
            sync_log(&format!("[ftp] FTPS nieudane ({tls_err}) — próba plain FTP"));
            connect_login(target, false)
        }),
    }
}

/// Czysta decyzja po próbie SIZE: Ok(true)=zweryfikowane, Ok(false)=OK bez
/// weryfikacji (SIZE niedostępne), Err=niepełny zapis (rozmiar nie zgadza się).
fn classify_upload_confirm(local_len: usize, size: Result<usize, String>) -> Result<bool, String> {
    match size {
        Ok(remote_len) if remote_len == local_len => Ok(true),
        Ok(remote_len) => Err(format!(
            "rozmiar po zapisie {remote_len} B ≠ wysłane {local_len} B (niepełny zapis)"
        )),
        Err(_) => Ok(false),
    }
}

/// Upload bajtów pod `remote_path` (pełna ścieżka, np.
/// `/.../{packageId}/slave-upload/delta.enc`). Katalog tworzy serwer przy
/// `async/push`, więc nie robimy mkdir. Zawsze zamyka połączenie (`quit`).
pub fn upload_bytes(target: &FtpTarget, remote_path: &str, data: &[u8]) -> Result<(), String> {
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "Plik {} B przekracza limit backendu {} B",
            data.len(),
            MAX_FILE_BYTES
        ));
    }
    let local_len = data.len();
    let mut ftp = connect(target)?;
    let mut cursor = Cursor::new(data);
    if let Err(e) = ftp.put_file(remote_path, &mut cursor) {
        let _ = ftp.quit();
        let msg = format!("FTP upload {remote_path}: {e}");
        sync_log(&format!("[ftp] UMIESZCZENIE BŁĄD: {msg}"));
        return Err(msg);
    }
    let confirm = ftp.size(remote_path).map_err(|e| e.to_string());
    let _ = ftp.quit();
    let size_unavailable_reason = confirm.as_ref().err().cloned();
    match classify_upload_confirm(local_len, confirm) {
        Ok(true) => {
            sync_log(&format!("[ftp] UMIESZCZENIE OK: {remote_path} ({local_len} B potwierdzone na FTP)"));
            Ok(())
        }
        Ok(false) => {
            let reason = size_unavailable_reason.unwrap_or_else(|| "brak".into());
            sync_log(&format!("[ftp] UMIESZCZENIE OK (bez weryfikacji SIZE): {remote_path} ({local_len} B wysłane) — SIZE: {reason}"));
            Ok(())
        }
        Err(msg) => {
            sync_log(&format!("[ftp] UMIESZCZENIE NIEPEŁNE: FTP upload {remote_path}: {msg}"));
            Err(format!("FTP upload {remote_path}: {msg}"))
        }
    }
}

/// Pobiera bajty z `remote_path`. Waliduje limit rozmiaru po pobraniu.
pub fn download_bytes(target: &FtpTarget, remote_path: &str) -> Result<Vec<u8>, String> {
    let mut ftp = connect(target)?;
    let res = ftp
        .retr_as_buffer(remote_path)
        .map(|cur| cur.into_inner())
        .map_err(|e| format!("FTP download {remote_path}: {e}"));
    let _ = ftp.quit();
    let data = match res {
        Ok(d) => d,
        Err(e) => {
            sync_log(&format!("[ftp] ODCZYT BŁĄD: {e}"));
            return Err(e);
        }
    };
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "Pobrany plik {} B przekracza limit {} B",
            data.len(),
            MAX_FILE_BYTES
        ));
    }
    // Czytelne potwierdzenie ODCZYTU.
    sync_log(&format!(
        "[ftp] ODCZYT OK: {remote_path} ({} B pobrane z FTP)",
        data.len()
    ));
    Ok(data)
}

/// Usuwa zdalny plik z FTP i loguje czytelne potwierdzenie. Wywoływane przez
/// KLIENTA po udanym imporcie — domyka cykl umieszczenie→odczyt→usunięcie i trzyma
/// zasadę „serwer nie dotyka danych" (kasuje odbiorca, nie serwer).
/// Usuwa plik bloba ORAZ puste katalogi paczki (slave-upload + async/<id>) jedną
/// sesją FTP. Bez tego `delete_file` zostawiał dziesiątki pustych katalogów UUID
/// na FTP (spam). `dirs` to ścieżki katalogów do usunięcia po pliku, od
/// najgłębszego do najpłytszego. rmdir best-effort: katalog może nie być pusty
/// (inny plik) — wtedy log i kontynuacja, nie błąd całości.
pub fn delete_file_and_dirs(
    target: &FtpTarget,
    remote_path: &str,
    dirs: &[String],
) -> Result<(), String> {
    let mut ftp = connect(target)?;
    let res = ftp
        .rm(remote_path)
        .map_err(|e| format!("FTP delete {remote_path}: {e}"));
    match &res {
        Ok(()) => sync_log(&format!("[ftp] USUNIĘCIE OK: {remote_path} (skasowane z FTP)")),
        Err(e) => sync_log(&format!("[ftp] USUNIĘCIE BŁĄD: {e}")),
    }
    // Sprzątanie katalogów — tylko gdy plik zniknął (lub już go nie było).
    if res.is_ok() {
        for dir in dirs {
            match ftp.rmdir(dir) {
                Ok(()) => sync_log(&format!("[ftp] USUNIĘCIE KATALOGU OK: {dir}")),
                Err(e) => {
                    sync_log(&format!("[ftp] USUNIĘCIE KATALOGU pominięte ({dir}): {e}"));
                    // Katalog nadrzędny nie zniknie, jeśli ten został — przerywamy łańcuch.
                    break;
                }
            }
        }
    }
    let _ = ftp.quit();
    res
}

/// Z `/async/<id>/slave-upload/delta.enc` wyciąga listę katalogów do skasowania
/// po pliku: `["/async/<id>/slave-upload/", "/async/<id>/"]` (od najgłębszego).
/// Zwraca pusty wektor, jeśli ścieżka nie pasuje do oczekiwanego kształtu.
pub fn package_dirs_from_blob_path(remote_path: &str) -> Vec<String> {
    // Odetnij nazwę pliku → katalog slave-upload (z trailing slash).
    let Some(slash) = remote_path.rfind('/') else { return Vec::new() };
    let slave_dir = &remote_path[..=slash]; // ".../slave-upload/"
    let trimmed = slave_dir.trim_end_matches('/');
    let Some(parent_slash) = trimmed.rfind('/') else { return Vec::new() };
    let pkg_dir = &trimmed[..=parent_slash]; // ".../async/<id>/"
    vec![slave_dir.to_string(), pkg_dir.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_dirs_from_blob_path_extracts_two_dirs() {
        let dirs = package_dirs_from_blob_path("/async/abc-123/slave-upload/delta.enc");
        assert_eq!(
            dirs,
            vec![
                "/async/abc-123/slave-upload/".to_string(),
                "/async/abc-123/".to_string(),
            ]
        );
    }

    #[test]
    fn package_dirs_from_blob_path_handles_no_slash() {
        assert!(package_dirs_from_blob_path("delta.enc").is_empty());
    }

    // resolve_addr — loopback rozwiązuje się bez sieci zewnętrznej.
    #[test]
    fn resolve_addr_loopback_ok() {
        let a = resolve_addr("127.0.0.1", 21).expect("loopback");
        assert_eq!(a.port(), 21);
        assert!(a.ip().is_loopback());
    }

    #[test]
    fn classify_upload_confirm_branches() {
        // Rozmiar zgodny → zweryfikowane (true)
        assert_eq!(classify_upload_confirm(100, Ok(100)), Ok(true));
        // Rozmiar różny → niepełny zapis (Err)
        assert!(classify_upload_confirm(100, Ok(90)).is_err());
        // SIZE niedostępne → OK bez weryfikacji (false)
        assert_eq!(classify_upload_confirm(100, Err("no size".into())), Ok(false));
    }

    // upload_bytes — strażnik limitu odrzuca nadmiarowy payload PRZED siecią,
    // więc test nie potrzebuje serwera FTP. Używamy taniego sprawdzenia: bufor
    // o 1 bajt większy od limitu (alokacja leniwa przez resize zerowy).
    #[test]
    fn upload_rejects_oversize_before_connecting() {
        let target = FtpTarget {
            host: "203.0.113.1".to_string(), // TEST-NET-3, nieosiągalny — gdyby strażnik nie zadziałał
            port: 21,
            username: "u".to_string(),
            password: "p".to_string(),
            secure: Some(false),
        };
        let oversize = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
        let err = upload_bytes(&target, "/x/delta.enc", &oversize).unwrap_err();
        assert!(err.contains("przekracza limit"), "spodziewany błąd limitu: {err}");
    }
}
