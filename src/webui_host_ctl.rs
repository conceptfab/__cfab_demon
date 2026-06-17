// Demon: zarządzanie procesem dashboard w trybie Web UI bez okna.
// Spawn ukrytego procesu, detekcja stanu (pid żywy), stop (kill + sprzątanie),
// oczekiwanie na /healthz i auto-otwarcie przeglądarki na localhost.

use std::path::Path;

use timeflow_shared::webui_host::{self, WebUiHost};

/// Czy proces o danym PID żyje (POSIX: `kill -0`; Windows: `tasklist`).
#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use std::process::Command;
    let out = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
        Err(_) => false,
    }
}

/// Aktualny status: Some(host) jeśli plik istnieje i proces żyje, inaczej None.
/// Nieaktualny plik (martwy PID) jest sprzątany.
pub fn current(data_dir: &Path) -> Option<WebUiHost> {
    let host = webui_host::read(data_dir)?;
    if pid_alive(host.pid) {
        Some(host)
    } else {
        webui_host::clear(data_dir);
        None
    }
}

pub fn is_running(data_dir: &Path) -> bool {
    current(data_dir).is_some()
}

/// Musi zgadzać się z `webui/config.rs::DEFAULT_WEB_PORT` (dashboard) oraz
/// `webui_dev.py`. Zmiana tu wymaga zmiany tam.
const DEFAULT_PORT: u16 = 47892;

/// Odczyt ustawień web servera JEDNYM read+parse (DRY — wcześniej 2-3 odczyty/tick).
pub struct WebServerSettings {
    pub enabled: bool,
    pub port: u16,
}

pub fn read_webserver_settings(data_dir: &Path) -> WebServerSettings {
    let raw = std::fs::read_to_string(data_dir.join("webserver_settings.json"))
        .unwrap_or_default();
    let v = serde_json::from_str::<serde_json::Value>(&raw).ok();
    let enabled = v
        .as_ref()
        .and_then(|v| v.get("enabled").and_then(|e| e.as_bool()))
        .unwrap_or(false);
    let port = v
        .as_ref()
        .and_then(|v| v.get("port").and_then(|p| p.as_u64()))
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_PORT);
    WebServerSettings { enabled, port }
}

/// Czy Web Server jest włączony w ustawieniach. Domyślnie `false`.
pub fn is_enabled(data_dir: &Path) -> bool {
    read_webserver_settings(data_dir).enabled
}

fn configured_port(data_dir: &Path) -> u16 {
    read_webserver_settings(data_dir).port
}

/// Adres do menu: IP LAN, fallback localhost. BEZ efektu ubocznego —
/// czyta port z pliku hosta bezpośrednio (nie wywołuje `current()`, które kasuje
/// plik przy martwym PID). Czyszczenie martwego pliku robi `current()` w sekcji stanu.
pub fn display_address(data_dir: &Path) -> String {
    let port = webui_host::read(data_dir)
        .map(|h| h.port)
        .unwrap_or_else(|| configured_port(data_dir));
    let ip = crate::lan_common::primary_local_ip()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{ip}:{port}")
}

/// Wynik próby startu — sterujący UI/logiem i testowalny.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    Spawned,
    AlreadyRunning,
    Disabled,
    PortBusy,
}

/// Czy port jest zajęty. Sprawdza i 127.0.0.1, i 0.0.0.0 — serwer może
/// bindować na dowolnym z nich, a sam bind 127.0.0.1 nie wykryłby konfliktu
/// z procesem słuchającym na 0.0.0.0.
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
        || std::net::TcpListener::bind(("0.0.0.0", port)).is_err()
}

/// Natywne powiadomienie użytkownika. macOS: osascript (brak nowej zależności).
#[cfg(target_os = "macos")]
fn notify_user(title: &str, body: &str) {
    // Escape cudzysłowów na wypadek przyszłych dynamicznych treści i18n.
    let body = body.replace('"', "\\\"");
    let title = title.replace('"', "\\\"");
    let script = format!("display notification \"{body}\" with title \"{title}\"");
    // spawn (nie status) — fire-and-forget, by nie blokować wątku tray.
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn();
}

/// ⚠️ Windows: compile-check tylko na Windows. Na razie log; toast przez
/// tray TrayNotification do podpięcia w follow-upie.
#[cfg(windows)]
fn notify_user(_title: &str, body: &str) {
    log::warn!("[webui-ctl] notify: {body}");
}

/// Start trybu headless. Respektuje `enabled`, sprawdza zajętość portu i
/// powiadamia użytkownika o nieudanym starcie. Zwraca `StartOutcome`.
pub fn start(data_dir: &Path) -> StartOutcome {
    let lang = crate::i18n::load_language();
    if !is_enabled(data_dir) {
        log::info!("[webui-ctl] start refused — Web Server disabled in settings");
        notify_user(
            lang.t(crate::i18n::TrayText::WebUiNotifyTitle),
            lang.t(crate::i18n::TrayText::WebUiNotifyDisabled),
        );
        return StartOutcome::Disabled;
    }
    if is_running(data_dir) {
        log::info!("[webui-ctl] already running — opening browser only");
        open_browser_when_ready(data_dir.to_path_buf(), configured_port(data_dir));
        return StartOutcome::AlreadyRunning;
    }
    let port = configured_port(data_dir);
    if port_in_use(port) {
        // Port zajęty — ale jeśli na nim odpowiada NASZE Web UI (np. otwarte okno
        // dashboardu serwuje web server na tym samym porcie, bez pliku webui_host.json),
        // nie krzycz „port zajęty" — to to samo Web UI. Otwórz przeglądarkę jak przy
        // AlreadyRunning. /healthz 200 na tym nietypowym porcie to wiarygodny sygnał,
        // że to nasz serwer, a nie obcy proces.
        if healthz_ok(port) {
            log::info!(
                "[webui-ctl] port {port} busy but our Web UI responds — opening browser only"
            );
            open_browser_when_ready(data_dir.to_path_buf(), port);
            return StartOutcome::AlreadyRunning;
        }
        log::error!("[webui-ctl] start refused — port {port} already in use");
        notify_user(
            lang.t(crate::i18n::TrayText::WebUiNotifyTitle),
            lang.t(crate::i18n::TrayText::WebUiNotifyPortBusy),
        );
        return StartOutcome::PortBusy;
    }
    // TOCTOU: między port_in_use a spawnem inny proces może zająć port.
    // Wtedy open_browser_when_ready/healthz zaloguje błąd i NIE otworzy
    // przeglądarki — wystarczające (ryzyko minimalne: demon single-instance).
    spawn_headless();
    open_browser_when_ready(data_dir.to_path_buf(), port);
    StartOutcome::Spawned
}

/// Czy nazwa procesu wskazuje na nasz dashboard TIMEFLOW. Pure — testowalne.
fn comm_matches_dashboard(comm: &str) -> bool {
    comm.to_lowercase().contains("timeflow")
}

/// Nazwa procesu (command) o danym PID. None jeśli proces nie istnieje.
#[cfg(unix)]
fn process_comm(pid: u32) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// ⚠️ Windows: compile-check tylko na Windows. tasklist CSV: "image","pid",...
#[cfg(windows)]
fn process_comm(pid: u32) -> Option<String> {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty() || !first.contains(&pid.to_string()) {
        return None;
    }
    // pierwszy element CSV w cudzysłowach to nazwa obrazu
    Some(first.split('"').nth(1).unwrap_or("").to_string())
}

/// Czy PID żyje I jest naszym dashboardem (ochrona przed killem obcego PID
/// po reużyciu numeru). Konserwatywnie: brak nazwy => false.
fn pid_is_dashboard(pid: u32) -> bool {
    match process_comm(pid) {
        Some(comm) => comm_matches_dashboard(&comm),
        None => false,
    }
}

/// Czeka aż PID przestanie żyć, maks. `timeout`. Loguje, jeśli nie zdążył.
fn wait_for_exit(pid: u32, timeout: std::time::Duration) {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if !pid_alive(pid) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    log::warn!("[webui-ctl] pid {pid} still alive after {timeout:?}");
}

/// Stop: ubij proces z pliku statusu (tylko jeśli to NASZ dashboard) i posprzątaj.
/// Kill + oczekiwanie na zgon biegnie w osobnym wątku, by nie blokować wołającego
/// (stop() leci z pętli/handlera tray). Plik statusu czyścimy od razu — ochronę
/// przed double-startem na zajętym porcie zapewnia guard portu w `start()`.
pub fn stop(data_dir: &Path) {
    if let Some(host) = webui_host::read(data_dir) {
        if pid_is_dashboard(host.pid) {
            let pid = host.pid;
            std::thread::spawn(move || {
                kill_pid(pid);
                wait_for_exit(pid, std::time::Duration::from_secs(5));
            });
        } else {
            log::info!(
                "[webui-ctl] stop: pid {} is not our dashboard (or already gone) — not killing",
                host.pid
            );
        }
    }
    webui_host::clear(data_dir);
    log::info!("[webui-ctl] stopped");
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status();
}

#[cfg(target_os = "macos")]
fn spawn_headless() {
    use std::process::Command;
    if Command::new("open")
        .args(["-b", "com.timeflow.dashboard", "--args", "--headless"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return;
    }
    for cand in macos_app_candidates() {
        if cand.exists()
            && Command::new("open")
                .arg(&cand)
                .args(["--args", "--headless"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        {
            return;
        }
    }
    log::error!("[webui-ctl] could not launch headless dashboard");
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_app_candidates() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut v = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("TIMEFLOW.app"));
            if let Some(parent) = dir.parent() {
                v.push(parent.join("dist").join("TIMEFLOW.app"));
                v.push(parent.join("TIMEFLOW.app"));
            }
        }
        if let Some(app_dir) = exe
            .ancestors()
            .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        {
            if let Some(base) = app_dir.parent() {
                v.push(base.join("TIMEFLOW.app"));
            }
        }
    }
    v.push(PathBuf::from("/Applications/TIMEFLOW.app"));
    v
}

#[cfg(windows)]
fn spawn_headless() {
    use std::process::Command;
    for path in windows_exe_candidates() {
        if path.exists() {
            let mut cmd = Command::new(&path);
            cmd.arg("--headless");
            timeflow_shared::process_utils::no_console(&mut cmd);
            if cmd.spawn().is_ok() {
                return;
            }
        }
    }
    log::error!("[webui-ctl] could not launch headless dashboard");
}

#[cfg(windows)]
fn windows_exe_candidates() -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("timeflow-dashboard.exe"));
        }
    }
    v
}

/// Wątek: poll GET /healthz na localhost aż 200 (max ~10 s). Po sukcesie otwiera
/// przeglądarkę na realnym porcie z `webui_host.json` (autorytatywny — config mógł
/// się zmienić). Jeśli serwer nie wstał (np. zajęty port), loguje błąd i NIE
/// otwiera przeglądarki — żeby nie pokazywać ślepej karty do martwego serwera.
fn open_browser_when_ready(data_dir: std::path::PathBuf, poll_port: u16) {
    std::thread::spawn(move || {
        for _ in 0..50 {
            if healthz_ok(poll_port) {
                let port = webui_host::read(&data_dir)
                    .map(|h| h.port)
                    .unwrap_or(poll_port);
                open_url(&format!("http://127.0.0.1:{port}"));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        log::error!(
            "[webui-ctl] server did not become ready on port {poll_port} — not opening browser"
        );
    });
}

fn healthz_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    let req = format!(
        "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).contains("200"),
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).status();
}

#[cfg(windows)]
fn open_url(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "tf-ctl-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_webserver_settings_parses_both_fields() {
        let dir = temp_dir();
        std::fs::write(
            dir.join("webserver_settings.json"),
            r#"{"enabled":true,"port":51000}"#,
        )
        .unwrap();
        let s = read_webserver_settings(&dir);
        assert!(s.enabled);
        assert_eq!(s.port, 51000);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_webserver_settings_defaults_when_missing() {
        let dir = temp_dir();
        let s = read_webserver_settings(&dir);
        assert!(!s.enabled);
        assert_eq!(s.port, DEFAULT_PORT);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn dead_pid_is_cleaned_and_not_running() {
        let dir = temp_dir();
        let host = WebUiHost { pid: 999_999_990, port: 47892, started_at: 1 };
        webui_host::write(&dir, &host).unwrap();
        assert!(!is_running(&dir));
        assert_eq!(webui_host::read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn live_pid_is_running() {
        let dir = temp_dir();
        let host = WebUiHost { pid: std::process::id(), port: 47892, started_at: 1 };
        webui_host::write(&dir, &host).unwrap();
        assert!(is_running(&dir));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn comm_matches_only_our_binary() {
        assert!(comm_matches_dashboard("timeflow-dashboard"));
        assert!(comm_matches_dashboard("TIMEFLOW"));
        assert!(comm_matches_dashboard("/Applications/TIMEFLOW.app/Contents/MacOS/TIMEFLOW"));
        assert!(comm_matches_dashboard("timeflow-dashboard.exe"));
        assert!(!comm_matches_dashboard("Google Chrome"));
        assert!(!comm_matches_dashboard("bash"));
        assert!(!comm_matches_dashboard(""));
    }

    #[test]
    fn wait_for_exit_returns_for_dead_pid() {
        let start = std::time::Instant::now();
        wait_for_exit(999_999_990, std::time::Duration::from_secs(2));
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn port_in_use_detects_bound_listener() {
        // Bind na 0.0.0.0, by pokryć obie ścieżki port_in_use (127.0.0.1 i 0.0.0.0).
        let listener = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_in_use(port));
        // Świadomie BEZ asercji po drop: ponowny bind właśnie zwolnionego portu
        // jest wyścigowy (TIME_WAIT / równoległe wątki testowe) i powodował flaky fails.
    }
}
