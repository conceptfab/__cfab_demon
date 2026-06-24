//! Online sync — niskopoziomowe helpery HTTP (ureq) współdzielone przez
//! store-and-forward (`online_store_forward`). Po przejściu na store-and-forward
//! cała stara maszyna sesyjna (master/slave, peer-wait, async-delta, SFTP)
//! została usunięta — został tylko cienki klient HTTP + obsługa anulowania.

use crate::lan_common::sync_log;
use std::sync::atomic::{AtomicBool, Ordering};

static ONLINE_SYNC_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

// ── HTTP client using ureq (supports TLS, DNS, chunked encoding) ──

fn format_ureq_error(method: &str, path: &str, err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("HTTP {} {} → {} : {}", method, path, code, body)
        }
        other => format!("HTTP {} {} failed: {}", method, path, other),
    }
}

/// Compute timeout based on body size — 30s base + 10s per MB of payload.
fn compute_timeout(body_len: usize) -> std::time::Duration {
    let base_secs = 30u64;
    let extra_secs = (body_len as u64) / (1024 * 1024) * 10;
    std::time::Duration::from_secs(base_secs + extra_secs)
}

pub(crate) fn server_post(server_url: &str, path: &str, token: &str, body: &str) -> Result<String, String> {
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(compute_timeout(body.len()))
        .send_string(body)
        .map_err(|e| format_ureq_error("POST", path, e))?;
    resp.into_string().map_err(|e| format!("Read response: {}", e))
}

/// Sentinel błędu zwracany, gdy żądanie zostało porzucone w locie z powodu
/// anulowania (`request_cancel`) lub zamykania demona (`stop_signal`). Wołający
/// rozpoznaje go (`== CANCELLED_MARKER`) i traktuje przebieg jako ANULOWANY,
/// a nie jako błąd synchronizacji (bez `record_online_sync_failure`).
pub(crate) const CANCELLED_MARKER: &str = "__online_sync_cancelled__";

/// Wariant `server_post` przerywalny przez cancel/stop.
///
/// `ureq` jest synchroniczny i nie ma cancellation tokenu — pojedynczy
/// `send_string` blokuje aż do odpowiedzi albo timeoutu (30s + 10s/MB). Dlatego
/// blokujące żądanie leci tu na osobnym wątku roboczym, a wątek wołający odpytuje
/// flagi co 150 ms. Gdy zażądano anulowania, PORZUCAMY żądanie w locie (wątek
/// roboczy dożyje swojego timeoutu i zakończy się sam, wysyłając wynik w pustkę)
/// i natychmiast zwracamy `CANCELLED_MARKER` — zamiast wisieć do ~530 s.
pub(crate) fn server_post_cancellable(
    server_url: &str,
    path: &str,
    token: &str,
    body: &str,
    stop_signal: &AtomicBool,
) -> Result<String, String> {
    // Wątek roboczy musi być 'static — przekazujemy własne kopie argumentów.
    let server = server_url.to_string();
    let path_owned = path.to_string();
    let token_owned = token.to_string();
    let body_owned = body.to_string();
    run_cancellable(stop_signal, move || {
        server_post(&server, &path_owned, &token_owned, &body_owned)
    })
}

/// Uruchamia blokującą operację `f` na wątku roboczym i odpytuje cancel/stop co
/// 150 ms. Gdy zażądano anulowania — PORZUCA operację w locie (wątek roboczy
/// dożyje własnego timeoutu i zakończy się sam, wysyłając wynik w pustkę) i
/// zwraca `CANCELLED_MARKER`. Wspólny mechanizm dla HTTP (`server_post_cancellable`)
/// i transferów FTP (`online_async_delta`), żeby Cancel działał natychmiast także
/// w trakcie długiego uploadu/downloadu, nie tylko między krokami.
pub(crate) fn run_cancellable<T, F>(stop_signal: &AtomicBool, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    loop {
        match rx.recv_timeout(std::time::Duration::from_millis(150)) {
            Ok(result) => return result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if is_cancel_requested() || stop_signal.load(Ordering::SeqCst) {
                    sync_log("[online] operacja porzucona w locie (cancel/stop)");
                    return Err(CANCELLED_MARKER.to_string());
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("worker thread zakończył się bez odpowiedzi".to_string());
            }
        }
    }
}

// Parny helper do `server_post`. Store-and-forward używa obecnie tylko POST-ów,
// ale GET zostaje jako gotowy klient dla przyszłych endpointów (status GET itd.).
#[allow(dead_code)]
pub(crate) fn server_get(server_url: &str, path: &str, token: &str) -> Result<String, String> {
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| format_ureq_error("GET", path, e))?;
    resp.into_string().map_err(|e| format!("Read response: {}", e))
}

// ── Cancellation ──

/// Zgłoś żądanie anulowania trwającego online synca. Wywoływane przez
/// `handle_online_cancel_sync` (loopback-only). Store-and-forward odczytuje flagę
/// (`is_cancel_requested`, razem ze `stop_signal`) na trzech grubych granicach:
/// na starcie przebiegu, przed lokalnym merge oraz przed każdą próbą push.
pub fn request_cancel() {
    ONLINE_SYNC_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    sync_log("[online] Cancel requested");
}

/// Wyczyść flagę anulowania — wołane na starcie każdego przebiegu store-and-forward.
pub(crate) fn clear_cancel() {
    ONLINE_SYNC_CANCEL_REQUESTED.store(false, Ordering::SeqCst);
}

/// Czy zażądano anulowania bieżącego synca.
pub(crate) fn is_cancel_requested() -> bool {
    ONLINE_SYNC_CANCEL_REQUESTED.load(Ordering::SeqCst)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // compute_timeout — pure function, verifies base timeout for zero-byte body.
    #[test]
    fn compute_timeout_base_is_30s() {
        let t = compute_timeout(0);
        assert_eq!(t, Duration::from_secs(30));
    }

    // compute_timeout — verifies each additional MB adds 10 seconds.
    // A 3 MB body should yield 30 + 3×10 = 60 seconds.
    #[test]
    fn compute_timeout_adds_10s_per_mb() {
        let three_mb = 3 * 1024 * 1024;
        let t = compute_timeout(three_mb);
        assert_eq!(t, Duration::from_secs(60));

        // Non-integer: 1.5 MB floors to 1 MB extra → 40s
        let one_and_half_mb = 1024 * 1024 + 512 * 1024;
        let t2 = compute_timeout(one_and_half_mb);
        assert_eq!(t2, Duration::from_secs(40));
    }

    // format_ureq_error — transport errors include method and path in the message.
    // We construct a transport error via the public From<io::Error> impl.
    #[test]
    fn format_ureq_transport_error_includes_method_and_path() {
        let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "refused");
        let ureq_err = ureq::Error::from(io_err);
        let msg = format_ureq_error("POST", "/api/sync/status", ureq_err);
        // Transport errors are formatted as "HTTP METHOD PATH failed: ..."
        assert!(msg.contains("POST"), "message should include method: {msg}");
        assert!(
            msg.contains("/api/sync/status"),
            "message should include path: {msg}"
        );
    }

    #[test]
    fn cancel_flag_round_trips() {
        clear_cancel();
        assert!(!is_cancel_requested());
        request_cancel();
        assert!(is_cancel_requested());
        clear_cancel();
        assert!(!is_cancel_requested());
    }

    // server_post_cancellable — gdy stop_signal jest już ustawiony, żądanie do
    // zawieszonego serwera musi zostać porzucone od razu (CANCELLED_MARKER),
    // a nie czekać na pełny 30s timeout `ureq`. Używa LOKALNEGO stop_signal
    // (nie globalnej flagi cancel), więc test jest odporny na równoległość.
    #[test]
    fn server_post_cancellable_aborts_in_flight_on_stop() {
        use std::io::Read;
        use std::net::TcpListener;
        use std::time::Instant;

        // Listener przyjmuje połączenie i zawiesza się — POST zablokuje się na
        // czekaniu na odpowiedź (realny in-flight request, nie connect-refused).
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut sock, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf); // wczytaj żądanie, nigdy nie odpowiadaj
                std::thread::sleep(Duration::from_secs(10));
            }
        });

        let stop = AtomicBool::new(true); // anulowanie zażądane natychmiast
        let server = format!("http://{}", addr);
        let start = Instant::now();
        let res = server_post_cancellable(&server, "/x", "tok", "{}", &stop);
        let elapsed = start.elapsed();

        assert_eq!(res.as_deref().map_err(String::as_str), Err(CANCELLED_MARKER));
        assert!(
            elapsed < Duration::from_secs(5),
            "cancel powinien wrócić od razu, nie czekać na 30s timeout (było {elapsed:?})"
        );
    }
}
