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
    let mut ftp = connect(target)?;
    let mut cursor = Cursor::new(data);
    let res = ftp
        .put_file(remote_path, &mut cursor)
        .map(|_| ())
        .map_err(|e| format!("FTP upload {remote_path}: {e}"));
    let _ = ftp.quit();
    res
}

/// Pobiera bajty z `remote_path`. Waliduje limit rozmiaru po pobraniu.
pub fn download_bytes(target: &FtpTarget, remote_path: &str) -> Result<Vec<u8>, String> {
    let mut ftp = connect(target)?;
    let res = ftp
        .retr_as_buffer(remote_path)
        .map(|cur| cur.into_inner())
        .map_err(|e| format!("FTP download {remote_path}: {e}"));
    let _ = ftp.quit();
    let data = res?;
    if data.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "Pobrany plik {} B przekracza limit {} B",
            data.len(),
            MAX_FILE_BYTES
        ));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    // resolve_addr — loopback rozwiązuje się bez sieci zewnętrznej.
    #[test]
    fn resolve_addr_loopback_ok() {
        let a = resolve_addr("127.0.0.1", 21).expect("loopback");
        assert_eq!(a.port(), 21);
        assert!(a.ip().is_loopback());
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
