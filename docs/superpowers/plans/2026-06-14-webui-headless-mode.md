# Tryb Web UI bez okna (headless) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uruchamiany z menu demona tryb, w którym dashboard działa bez okna i udostępnia UI wyłącznie przez przeglądarkę (localhost auto-zalogowany, LAN przez kod).

**Architecture:** Demon spawnuje ukryty proces `timeflow-dashboard --headless`, który reużywa istniejący web server + RPC bridge + auth. Połączenia z `127.0.0.1`/`::1` są zaufane (pomijają parowanie) — serwer wykrywa to po realnym `peer_addr()`, a do SPA wstrzykuje flagę `window.__TIMEFLOW_WEBUI_TRUSTED__`, dzięki czemu frontend pomija ekran logowania. Stan procesu śledzony przez `webui_host.json` (pid+port) w katalogu danych.

**Tech Stack:** Rust (Tauri 2, `tray-icon` macOS / `native-windows-gui` Windows), TypeScript/React (Vite SPA), `timeflow-shared`.

**Zmiana zakresu względem specu (do akceptacji):** Pozycja menu „Pokaż kod parowania" zostaje **usunięta**. Dzięki auto-loginowi na localhost operator generuje kody dla urządzeń LAN z istniejącej zakładki „Web Server" w samym UI (komenda `webserver_generate_pairing_code` jest już zbridge'owana, [rpc_generated.rs:243](dashboard/src-tauri/src/webui/rpc_generated.rs#L243)). Eliminuje to cross-process RPC demon→dashboard. Reszta specu bez zmian.

**Naturalny checkpoint:** po Tasku 6 tryb headless działa end-to-end uruchamiany ręcznie (`open TIMEFLOW.app --args --headless`); Taski 7–10 dokładają UX z menu demona.

---

## File Structure

| Plik | Akcja | Odpowiedzialność |
|---|---|---|
| `shared/src/webui_host.rs` | Create | Format + ścieżka + read/write/clear pliku statusu `webui_host.json` (współdzielone przez demona i dashboard). |
| `shared/src/lib.rs` | Modify | Rejestracja `pub mod webui_host;`. |
| `dashboard/src-tauri/tauri.conf.json` | Modify | Okno `"visible": false` (start ukryty, brak mignięcia). |
| `dashboard/src-tauri/src/lib.rs` | Modify | Wykrycie `--headless`; gałąź headless (accessory policy, brak `show`, forced server, zapis statusu) vs desktop (`show`). |
| `dashboard/src-tauri/src/webui/mod.rs` | Modify | `start_headless()` — wymuszony start serwera niezależnie od `enabled` + zapis `webui_host.json`. |
| `dashboard/src-tauri/src/webui/server.rs` | Modify | Przekazanie `is_loopback` z gniazda do `handle`/`handle_rpc`/`serve_index`; trust loopbacka + wstrzyknięcie flagi do index.html. |
| `dashboard/src/lib/webui/http-transport.ts` | Modify | `isTrustedHost()`; `httpInvoke` działa bez tokenu na zaufanym hoscie. |
| `dashboard/src/components/webui/WebLoginGate.tsx` | Modify | Pominięcie bramki logowania na zaufanym hoscie. |
| `src/webui_host_ctl.rs` | Create | Demon: spawn headless, detekcja stanu (pid alive), stop (kill+sprzątanie), wait-for-healthz + auto-open przeglądarki, adres LAN. |
| `src/main.rs` | Modify | Rejestracja `mod webui_host_ctl;`. |
| `src/platform/macos/tray.rs` | Modify | Blok menu Web UI: status (adres) + toggle Start/Stop. |
| `src/platform/windows/tray.rs` | Modify | Lustrzany blok menu Web UI. |
| `src/i18n.rs` | Modify | Teksty tray: `WebUiStart`, `WebUiStop`, `WebUiStatusOff`, `WebUiStatusOn`. |
| `dashboard/src/components/Help.tsx` | Modify | Sekcja „TIMEFLOW Web UI (tryb bez okna)". |

---

## Task 1: Plik statusu hosta w `timeflow-shared`

**Files:**
- Create: `shared/src/webui_host.rs`
- Modify: `shared/src/lib.rs`
- Test: w `shared/src/webui_host.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Zarejestruj moduł**

W `shared/src/lib.rs` dodaj obok istniejących `pub mod ...`:

```rust
pub mod webui_host;
```

- [ ] **Step 2: Napisz failing test (roundtrip + brak pliku)**

Utwórz `shared/src/webui_host.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Status uruchomionego trybu Web UI bez okna. Zapisywany przez proces
/// `timeflow-dashboard --headless`, czytany przez demona (toggle + stop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebUiHost {
    pub pid: u32,
    pub port: u16,
    pub started_at: u64,
}

pub fn status_path(data_dir: &Path) -> PathBuf {
    data_dir.join("webui_host.json")
}

pub fn read(data_dir: &Path) -> Option<WebUiHost> {
    let raw = std::fs::read_to_string(status_path(data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write(data_dir: &Path, host: &WebUiHost) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(host)
        .unwrap_or_else(|_| "{}".to_string());
    std::fs::write(status_path(data_dir), json)
}

pub fn clear(data_dir: &Path) {
    let _ = std::fs::remove_file(status_path(data_dir));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("tf-webui-host-{}-{}", std::process::id(), unique));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_missing_returns_none() {
        let dir = temp_dir();
        assert_eq!(read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn write_then_read_roundtrips_and_clear_removes() {
        let dir = temp_dir();
        let host = WebUiHost { pid: 4242, port: 47892, started_at: 100 };
        write(&dir, &host).unwrap();
        assert_eq!(read(&dir), Some(host));
        clear(&dir);
        assert_eq!(read(&dir), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
```

- [ ] **Step 3: Uruchom testy — mają przejść**

Run: `cargo test -p timeflow-shared webui_host`
Expected: PASS (2 testy).

- [ ] **Step 4: Commit**

```bash
git add shared/src/webui_host.rs shared/src/lib.rs
git commit -m "feat(webui): shared webui_host status file (pid+port)"
```

---

## Task 2: Zaufany loopback w serwerze + wstrzyknięcie flagi do SPA

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs`
- Test: `dashboard/src-tauri/src/webui/server.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Napisz failing test wstrzyknięcia flagi**

Dopisz w module `tests` w `server.rs`:

```rust
    #[test]
    fn index_injects_trusted_flag_only_for_loopback() {
        let trusted = String::from_utf8(serve_index(true)).unwrap();
        assert!(trusted.contains("window.__TIMEFLOW_WEBUI_TRUSTED__=true"));

        let untrusted = String::from_utf8(serve_index(false)).unwrap();
        assert!(!untrusted.contains("__TIMEFLOW_WEBUI_TRUSTED__"));
    }
```

- [ ] **Step 2: Uruchom — ma się NIE skompilować/failować**

Run: `cargo test -p timeflow-dashboard webui::server`
Expected: FAIL (compile error — `serve_index` przyjmuje 0 argumentów).

- [ ] **Step 3: Zmień sygnatury i logikę**

W `server.rs` zmień `serve_index`, `serve_spa`, `handle`, `handle_rpc` i `handle_connection`:

```rust
fn serve_index(is_loopback: bool) -> Vec<u8> {
    let Some(index) = SPA.get_file("index.html") else {
        return http("500 Internal Server Error", "text/plain", b"bundle missing");
    };
    let html = String::from_utf8_lossy(index.contents());
    let mut inject = format!(
        "<script>window.__TIMEFLOW_LANG__=\"{}\";</script>",
        read_persisted_language()
    );
    if is_loopback {
        // Zaufany host (operator maszyny) — frontend pomija bramkę logowania,
        // RPC działa bez tokenu (serwer i tak ufa loopbackowi po peer_addr()).
        inject.push_str("<script>window.__TIMEFLOW_WEBUI_TRUSTED__=true;</script>");
    }
    let injected = match html.find("<head>") {
        Some(pos) => format!("{}{}{}", &html[..pos + 6], inject, &html[pos + 6..]),
        None => format!("{inject}{html}"),
    };
    http("200 OK", "text/html", injected.as_bytes())
}

fn serve_spa(path: &str, is_loopback: bool) -> Vec<u8> {
    let rel = path.trim_start_matches('/');
    let candidate = if rel.is_empty() { "index.html" } else { rel };
    if candidate == "index.html" {
        return serve_index(is_loopback);
    }
    match SPA.get_file(candidate) {
        Some(file) => http("200 OK", mime_for(candidate), file.contents()),
        None => serve_index(is_loopback),
    }
}
```

Zmień `handle` i `handle_rpc`:

```rust
fn handle(app: &AppHandle, auth: &Arc<AuthState>, raw: &str, is_loopback: bool) -> Vec<u8> {
    let Some(request) = parse_request(raw) else {
        return json_response("400 Bad Request", r#"{"ok":false,"error":"bad_request"}"#);
    };

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/healthz") => json_response("200 OK", r#"{"ok":true}"#),
        ("POST", "/auth/pair") => handle_pair(auth, &request.body),
        ("POST", "/rpc") => handle_rpc(app, auth, &request, is_loopback),
        ("GET", _) => serve_spa(&request.path, is_loopback),
        _ => json_response("404 Not Found", r#"{"ok":false,"error":"not_found"}"#),
    }
}

fn handle_rpc(
    app: &AppHandle,
    auth: &Arc<AuthState>,
    request: &ParsedRequest,
    is_loopback: bool,
) -> Vec<u8> {
    let authorized = is_loopback
        || request
            .bearer
            .as_deref()
            .map(|token| auth.is_authorized(token, now_secs()))
            .unwrap_or(false);
    if !authorized {
        return json_response("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
    }
    // ...reszta bez zmian (RpcRequest::parse + rpc::dispatch)...
```

W `handle_connection` policz loopback z gniazda i przekaż:

```rust
fn handle_connection(mut stream: std::net::TcpStream, app: &AppHandle, auth: &Arc<AuthState>) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));
    let is_loopback = stream
        .peer_addr()
        .map(|addr| addr.ip().is_loopback())
        .unwrap_or(false);

    let mut buf = vec![0u8; 64 * 1024];
    let n = match stream.read(&mut buf) {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };
    let raw = String::from_utf8_lossy(&buf[..n]).to_string();
    let response = handle(app, auth, &raw, is_loopback);
    let _ = stream.write_all(&response);
    let _ = stream.flush();
}
```

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `cargo test -p timeflow-dashboard webui::server`
Expected: PASS (parsowanie + nowy test wstrzyknięcia).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/webui/server.rs
git commit -m "feat(webui): trust loopback connections, inject trusted flag into SPA"
```

---

## Task 3: Frontend — pominięcie logowania na zaufanym hoscie

**Files:**
- Modify: `dashboard/src/lib/webui/http-transport.ts`
- Modify: `dashboard/src/components/webui/WebLoginGate.tsx`

- [ ] **Step 1: Dodaj `isTrustedHost` i obsłuż brak tokenu w `httpInvoke`**

W `http-transport.ts` dodaj eksport i zmień `httpInvoke`:

```ts
export function isTrustedHost(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { __TIMEFLOW_WEBUI_TRUSTED__?: unknown }).__TIMEFLOW_WEBUI_TRUSTED__);
}

export async function httpInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const token = getWebToken();
  const trusted = isTrustedHost();
  if (!token && !trusted) throw new WebUnauthorizedError('no_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ command, args: args ?? {} }),
  });
  if (res.status === 401) {
    clearWebToken();
    throw new WebUnauthorizedError('unauthorized');
  }
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error ?? 'rpc_error');
  return payload.data as T;
}
```

- [ ] **Step 2: Pomiń bramkę logowania na zaufanym hoscie**

W `WebLoginGate.tsx` zmień import i warunek `authed`:

```ts
import { getWebToken, isTrustedHost, pairWithCode } from '@/lib/webui/http-transport';
```

```ts
  const [authed] = useState(() => hasTauriRuntime() || isTrustedHost() || !!getWebToken());
```

- [ ] **Step 3: Build frontu — bez błędów typów**

Run: `cd dashboard && npm run build`
Expected: build OK (Vite + tsc bez błędów).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/webui/http-transport.ts dashboard/src/components/webui/WebLoginGate.tsx
git commit -m "feat(webui): skip login gate and token requirement on trusted host"
```

---

## Task 4: Tryb headless w dashboard (ukryte okno + accessory + forced server)

> **Aktualizacja (2026-06-16):** Zmieniono względem tego planu — tryb headless RESPEKTUJE flagę `enabled` (nie startuje serwera, gdy Web Server wyłączony) i powiadamia o nieudanym starcie. Szczegóły i uzasadnienie: `docs/superpowers/plans/2026-06-16-webui-headless-review-fixes.md` (Task 3).

**Files:**
- Modify: `dashboard/src-tauri/tauri.conf.json`
- Modify: `dashboard/src-tauri/src/webui/mod.rs`
- Modify: `dashboard/src-tauri/src/lib.rs`

- [ ] **Step 1: Okno startuje ukryte**

W `tauri.conf.json` w obiekcie okna (obok `"decorations": false`) dodaj:

```json
        "visible": false
```

- [ ] **Step 2: Dodaj `start_headless` w `webui/mod.rs`**

W `dashboard/src-tauri/src/webui/mod.rs` dodaj funkcję (obok `start_if_enabled`):

```rust
/// Wymuszony start serwera w trybie bez okna — niezależnie od flagi `enabled`
/// (użytkownik świadomie odpalił tryb z menu demona). Zapisuje status hosta,
/// by demon mógł wykryć stan i zatrzymać proces.
pub fn start_headless(app: &tauri::AppHandle) {
    let cfg = config::load();
    match server::spawn(app.clone(), auth(), cfg.port) {
        Ok(()) => {
            log::info!("[webui] headless mode active on port {}", cfg.port);
            if let Ok(dir) = crate::commands::helpers::timeflow_data_dir() {
                let started_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let host = timeflow_shared::webui_host::WebUiHost {
                    pid: std::process::id(),
                    port: cfg.port,
                    started_at,
                };
                if let Err(e) = timeflow_shared::webui_host::write(&dir, &host) {
                    log::warn!("[webui] failed to write host status: {e}");
                }
            }
        }
        Err(e) => log::error!("[webui] headless start failed: {e}"),
    }
}
```

- [ ] **Step 3: Wykryj `--headless` i rozgałęź setup w `lib.rs`**

W `dashboard/src-tauri/src/lib.rs` na początku `run()` (po `let mut loaded = false;` bloku ładowania `.env`, przed `tauri::Builder`):

```rust
    let headless = std::env::args().any(|a| a == "--headless");
```

Zamień końcówkę domknięcia `.setup(...)` — zastąp linię `webui::start_if_enabled(app.handle());` blokiem:

```rust
            use tauri::Manager;
            if headless {
                #[cfg(target_os = "macos")]
                {
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
                // Okno pozostaje ukryte (visible:false). Serwer wymuszony.
                webui::start_headless(app.handle());
            } else {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
                webui::start_if_enabled(app.handle());
            }
```

> Uwaga: `headless` musi być `move`'owane do domknięcia setup — `.setup(move |app| { ... })`. Zmień `.setup(|app| {` na `.setup(move |app| {`.

- [ ] **Step 4: Kompilacja**

Run: `cargo build -p timeflow-dashboard`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/tauri.conf.json dashboard/src-tauri/src/webui/mod.rs dashboard/src-tauri/src/lib.rs
git commit -m "feat(webui): headless dashboard mode (hidden window, accessory, forced server)"
```

---

## Task 5: Weryfikacja manualna trybu headless (macOS, bez demona)

**Files:** — (tylko uruchomienie)

- [ ] **Step 1: Zbuduj `.app`**

Run: `python3 build_all_macos.py` (lub istniejący skrypt buildu dashboardu)
Expected: powstaje `dist/TIMEFLOW.app` lub `/Applications/TIMEFLOW.app`.

- [ ] **Step 2: Uruchom headless ręcznie**

Run: `open dist/TIMEFLOW.app --args --headless`
Expected:
- żadne okno się nie pokazuje;
- brak ikony TIMEFLOW w Docku;
- w `~/Library/Application Support/TimeFlow/logs/dashboard.log` linia `[webui] headless mode active on port 47892`;
- powstaje `webui_host.json` z `pid`/`port`.

- [ ] **Step 3: Otwórz UI na localhost**

Run: `open http://127.0.0.1:47892`
Expected: pełny dashboard ładuje się **bez ekranu logowania** (auto-login przez zaufany loopback); dane się ładują.

- [ ] **Step 4: Sprawdź, że LAN wymaga kodu**

Z innego urządzenia w sieci otwórz `http://<lan-ip>:47892`.
Expected: ekran logowania (kod parowania) — brak wstrzykniętej flagi trusted.

- [ ] **Step 5: Zatrzymaj proces i posprzątaj plik ręcznie**

Run: `kill $(python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/TimeFlow/webui_host.json'))['pid'])")`
Expected: proces ginie. (Sprzątanie pliku obejmie Task 7 — stop z demona.)

> Jeśli krok 3 pokazuje ekran logowania zamiast UI: potwierdź, że wstrzykiwany inline `<script>` wykonuje się (ta sama mechanika co `__TIMEFLOW_LANG__`). Jeśli CSP blokuje inline, dodaj do nagłówka w `server.rs::http` `script-src 'self' 'unsafe-inline'` i powtórz.

---

## Task 6: Sterownik headless w demonie (`webui_host_ctl`)

**Files:**
- Create: `src/webui_host_ctl.rs`
- Modify: `src/main.rs` (rejestracja modułu)
- Test: `src/webui_host_ctl.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Zarejestruj moduł w `main.rs`**

W `src/main.rs` w bloku `mod ...` dodaj:

```rust
mod webui_host_ctl;
```

- [ ] **Step 2: Napisz failing test (klasyfikacja stanu z pliku)**

Utwórz `src/webui_host_ctl.rs`:

```rust
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("tf-ctl-{}-{}", std::process::id(), unique));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn dead_pid_is_cleaned_and_not_running() {
        let dir = temp_dir();
        // PID 1 nie należy do nas; używamy zapisu z pid, którego na pewno nie ma:
        // bardzo wysoki pid raczej nie istnieje.
        let host = WebUiHost { pid: 999_999_990, port: 47892, started_at: 1 };
        webui_host::write(&dir, &host).unwrap();
        assert!(!is_running(&dir));
        assert_eq!(webui_host::read(&dir), None); // plik sprzątnięty
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
}
```

- [ ] **Step 3: Uruchom testy — mają przejść**

Run: `cargo test -p timeflow-demon webui_host_ctl`
Expected: PASS (2 testy).

- [ ] **Step 4: Dodaj spawn / stop / auto-open (bez testów jednostkowych — I/O zewnętrzne)**

Dopisz do `src/webui_host_ctl.rs` (przed `#[cfg(test)]`):

```rust
const DEFAULT_PORT: u16 = 47892;

/// Port z konfiguracji web servera (ten sam plik, którego używa dashboard).
fn configured_port(data_dir: &Path) -> u16 {
    let raw = std::fs::read_to_string(data_dir.join("webserver_settings.json"))
        .unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| v.get("port").and_then(|p| p.as_u64()))
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_PORT)
}

/// Adres pokazywany w menu: preferuj IP LAN, fallback localhost.
pub fn display_address(data_dir: &Path) -> String {
    let port = current(data_dir).map(|h| h.port).unwrap_or_else(|| configured_port(data_dir));
    let ip = crate::lan_common::primary_local_ip()
        .unwrap_or_else(|| "127.0.0.1".to_string());
    format!("http://{ip}:{port}")
}

/// Start trybu headless: spawn ukrytego dashboardu + wątek czekający na
/// /healthz, po czym otwiera przeglądarkę na localhost.
pub fn start(data_dir: &Path) {
    if is_running(data_dir) {
        log::info!("[webui-ctl] already running — opening browser only");
        open_browser_when_ready(configured_port(data_dir));
        return;
    }
    spawn_headless();
    open_browser_when_ready(configured_port(data_dir));
}

/// Stop: ubij proces z pliku statusu i posprzątaj plik.
pub fn stop(data_dir: &Path) {
    if let Some(host) = webui_host::read(data_dir) {
        kill_pid(host.pid);
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
    // 1) bundle id przez LaunchServices
    if Command::new("open")
        .args(["-b", "com.timeflow.dashboard", "--args", "--headless"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return;
    }
    // 2) fallback ścieżkowy obok demona / w /Applications
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
fn macos_app_candidates() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut v = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("TIMEFLOW.app"));
            if let Some(parent) = dir.parent() {
                v.push(parent.join("dist").join("TIMEFLOW.app"));
            }
        }
        if let Some(app_dir) = exe.ancestors().find(|p| p.extension().map(|e| e == "app").unwrap_or(false)) {
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

/// Wątek: poll GET /healthz na localhost aż 200 (max ~10 s), potem otwórz przeglądarkę.
fn open_browser_when_ready(port: u16) {
    std::thread::spawn(move || {
        for _ in 0..50 {
            if healthz_ok(port) {
                open_url(&format!("http://127.0.0.1:{port}"));
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        log::warn!("[webui-ctl] server not ready in time — opening anyway");
        open_url(&format!("http://127.0.0.1:{port}"));
    });
}

fn healthz_ok(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    let req = format!("GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
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
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).status();
}
```

- [ ] **Step 5: Dodaj `primary_local_ip` w `lan_common` (jeśli nie istnieje)**

Run: `grep -n "primary_local_ip\|fn .*local_ip" src/lan_common.rs`
Jeśli brak — dodaj w `src/lan_common.rs`:

```rust
/// Najlepszy adres IPv4 LAN (pierwszy nie-loopback), fallback None.
pub fn primary_local_ip() -> Option<String> {
    use std::net::UdpSocket;
    // Trik: "połącz" UDP do publicznego IP — OS wybiera lokalny interfejs wyjściowy.
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    let addr = sock.local_addr().ok()?;
    let ip = addr.ip();
    if ip.is_loopback() { None } else { Some(ip.to_string()) }
}
```

Jeśli istnieje funkcja o innej nazwie zwracająca lokalne IP — użyj jej w `display_address` zamiast `primary_local_ip`.

- [ ] **Step 6: Kompilacja**

Run: `cargo build -p timeflow-demon`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add src/webui_host_ctl.rs src/main.rs src/lan_common.rs
git commit -m "feat(webui): daemon controller for headless web UI (start/stop/status/browser)"
```

---

## Task 7: Teksty i18n dla menu Web UI

**Files:**
- Modify: `src/i18n.rs`

- [ ] **Step 1: Dodaj warianty `TrayText`**

Run: `grep -n "enum TrayText\|OpenDashboard\|fn t(" src/i18n.rs`
W `enum TrayText` dodaj warianty:

```rust
    WebUiStart,
    WebUiStop,
    WebUiStatusOff,
    WebUiStatusOn,
```

W implementacji `fn t(self, key: TrayText) -> &'static str` (lub mapie tłumaczeń) dodaj dla PL i EN, wzorując się na istniejących wpisach `OpenDashboard`:

```rust
    // PL
    TrayText::WebUiStart => "Uruchom Web UI",
    TrayText::WebUiStop => "Zatrzymaj Web UI",
    TrayText::WebUiStatusOff => "Web UI: wyłączone",
    TrayText::WebUiStatusOn => "Web UI:", // adres doklejany dynamicznie
```

```rust
    // EN
    TrayText::WebUiStart => "Start Web UI",
    TrayText::WebUiStop => "Stop Web UI",
    TrayText::WebUiStatusOff => "Web UI: off",
    TrayText::WebUiStatusOn => "Web UI:",
```

- [ ] **Step 2: Kompilacja**

Run: `cargo build -p timeflow-demon`
Expected: build OK (wszystkie ramiona match pokryte).

- [ ] **Step 3: Commit**

```bash
git add src/i18n.rs
git commit -m "feat(webui): tray i18n strings for web UI toggle"
```

---

## Task 8: Menu demona — macOS

**Files:**
- Modify: `src/platform/macos/tray.rs`

- [ ] **Step 1: Dodaj pozycje menu Web UI**

W `run()` po utworzeniu `dashboard_item` ([tray.rs:414](src/platform/macos/tray.rs#L414)) dodaj:

```rust
    let webui_status_item = MenuItem::new(lang.t(TrayText::WebUiStatusOff), false, None);
    let webui_toggle_item = MenuItem::new(lang.t(TrayText::WebUiStart), true, None);
```

W sekcji budowy menu, po `let _ = menu.append(&dashboard_item);` ([tray.rs:431](src/platform/macos/tray.rs#L431)) dodaj:

```rust
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&webui_status_item);
    let _ = menu.append(&webui_toggle_item);
```

> Blok sync wstawia się na indeksach 3..=6 ([set_sync_block_visible](src/platform/macos/tray.rs#L304)). Dodajemy blok Web UI **po** `dashboard_item`, ale przesuwa to indeksy sync. Aby nie ruszać logiki sync, wstaw blok Web UI **po** bloku sync — tj. zamiast wyżej, dodaj pozycje Web UI tuż przed separatorem `restart`. Konkretnie: przenieś oba `menu.append` Web UI na miejsce **bezpośrednio przed** `let _ = menu.append(&PredefinedMenuItem::separator());` poprzedzającym `restart_item` ([tray.rs:436](src/platform/macos/tray.rs#L436)). Wtedy indeksy 3..=6 sync pozostają wolne i `set_sync_block_visible` działa bez zmian.

- [ ] **Step 2: Zarejestruj id toggle i odśwież stan w pętli**

Po `let exit_id = exit_item.id().clone();` ([tray.rs:475](src/platform/macos/tray.rs#L475)) dodaj:

```rust
    let webui_toggle_id = webui_toggle_item.id().clone();
    let data_dir_for_webui = crate::commands_helpers_data_dir();
```

> Demon nie ma `commands::helpers`. Użyj istniejącej funkcji katalogu danych demona. Sprawdź: `grep -n "fn config_dir\|timeflow_data_dir\|fn data_dir" src/config.rs`. Użyj `crate::config::config_dir()` (zwraca `Result<PathBuf>`). Zamień powyższe na:

```rust
    let webui_toggle_id = webui_toggle_item.id().clone();
```

W bloku odświeżania stanu (`if now.duration_since(last_state_update) >= TRAY_STATE_INTERVAL`), po aktualizacji `update_sync_menu(...)` ([tray.rs:532](src/platform/macos/tray.rs#L532)) dodaj:

```rust
            if let Ok(dir) = crate::config::config_dir() {
                let running = crate::webui_host_ctl::is_running(&dir);
                let lang = lang_state.get();
                if running {
                    webui_toggle_item.set_text(lang.t(TrayText::WebUiStop));
                    let addr = crate::webui_host_ctl::display_address(&dir);
                    webui_status_item.set_text(format!("{} {}", lang.t(TrayText::WebUiStatusOn), addr));
                } else {
                    webui_toggle_item.set_text(lang.t(TrayText::WebUiStart));
                    webui_status_item.set_text(lang.t(TrayText::WebUiStatusOff));
                }
            }
```

> Jeśli `crate::config::config_dir()` to nie jest katalog z `webserver_settings.json`/`webui_host.json`, użyj tej samej bazy, której używa dashboard: `timeflow_shared::timeflow_paths::timeflow_data_dir()`. Zweryfikuj: `grep -rn "webserver_settings.json\|timeflow_data_dir" src shared | head`.

- [ ] **Step 3: Obsłuż kliknięcie toggle**

W pętli zdarzeń menu, w łańcuchu `if ev.id == dashboard_id { ... }` ([tray.rs:554](src/platform/macos/tray.rs#L554)) dodaj gałąź:

```rust
            } else if ev.id == webui_toggle_id {
                if let Ok(dir) = crate::config::config_dir() {
                    if crate::webui_host_ctl::is_running(&dir) {
                        crate::webui_host_ctl::stop(&dir);
                    } else {
                        crate::webui_host_ctl::start(&dir);
                    }
                }
```

(użyj tej samej funkcji katalogu, co w Step 2).

- [ ] **Step 4: Kompilacja**

Run: `cargo build -p timeflow-demon`
Expected: build OK.

- [ ] **Step 5: Weryfikacja manualna (macOS)**

Run: uruchom demona (`cargo run -p timeflow-demon` lub zbudowany `.app`), kliknij w tray „Uruchom Web UI".
Expected:
- przeglądarka otwiera `http://127.0.0.1:47892`, UI bez logowania;
- status w menu pokazuje `Web UI: http://<lan-ip>:47892`, toggle → „Zatrzymaj Web UI";
- klik „Zatrzymaj Web UI" ubija proces, `webui_host.json` znika, menu wraca do „Web UI: wyłączone".

- [ ] **Step 6: Commit**

```bash
git add src/platform/macos/tray.rs
git commit -m "feat(webui): macOS tray toggle to start/stop headless web UI"
```

---

## Task 9: Menu demona — Windows (lustrzane)

**Files:**
- Modify: `src/platform/windows/tray.rs`

> Implementacja lustrzana wobec macOS. Shippuje niezweryfikowana z maca (znane ograniczenie cross-buildu — patrz pamięć projektu). Wzoruj się na istniejących pozycjach menu (`dashboard`, `restart`) w tym pliku.

- [ ] **Step 1: Dodaj pozycje menu Web UI**

Run: `grep -n "OpenDashboard\|MenuItem\|fn build_menu\|append\|fn run" src/platform/windows/tray.rs | head -40`
Wzorując się na sposobie tworzenia `dashboard` itemu, dodaj `webui_status_item` (disabled) i `webui_toggle_item` (enabled) tuż przed pozycją „Restart".

- [ ] **Step 2: Odśwież tekst toggle/status w pętli**

W miejscu, gdzie Windows aktualizuje teksty menu (NWG `ModifyMenuW`, [tray.rs:24](src/platform/windows/tray.rs#L24)), dodaj logikę analogiczną do macOS Step 2 z Task 8:

```rust
if let Ok(dir) = crate::config::config_dir() {
    let running = crate::webui_host_ctl::is_running(&dir);
    if running {
        // set text webui_toggle -> WebUiStop
        // set text webui_status -> "Web UI: " + display_address(&dir)
    } else {
        // set text webui_toggle -> WebUiStart
        // set text webui_status -> WebUiStatusOff
    }
}
```

Użyj istniejącego helpera `ModifyMenuW`/`set_text` z tego pliku do podmiany etykiet (NWG nie ma `set_text`).

- [ ] **Step 3: Obsłuż kliknięcie toggle**

W handlerze zdarzeń menu (tam gdzie obsługiwany jest klik „Open Dashboard") dodaj gałąź:

```rust
if clicked == webui_toggle_handle {
    if let Ok(dir) = crate::config::config_dir() {
        if crate::webui_host_ctl::is_running(&dir) {
            crate::webui_host_ctl::stop(&dir);
        } else {
            crate::webui_host_ctl::start(&dir);
        }
    }
}
```

- [ ] **Step 4: Kompilacja sprawdzeniowa (cargo check pod target Windows — best effort)**

Run: `cargo check -p timeflow-demon` (na macOS sprawdzi tylko wspólny kod; gałęzie `#[cfg(windows)]` zweryfikuj wzrokowo + na maszynie Windows).
Expected: brak błędów we wspólnym kodzie.

- [ ] **Step 5: Commit**

```bash
git add src/platform/windows/tray.rs
git commit -m "feat(webui): Windows tray toggle to start/stop headless web UI (unverified)"
```

---

## Task 10: Dokumentacja Help.tsx

**Files:**
- Modify: `dashboard/src/components/Help.tsx`

- [ ] **Step 1: Znajdź istniejącą sekcję Web Server**

Run: `grep -n "Web Server\|webserver\|LAN" dashboard/src/components/Help.tsx | head`

- [ ] **Step 2: Dodaj sekcję „TIMEFLOW Web UI (tryb bez okna)"**

Tuż po sekcji o LAN Web Server dodaj sekcję w tym samym formacie co sąsiednie (nagłówek + akapity „co to robi / kiedy użyć / ograniczenia"). Treść (PL — dopasuj do realnego formatu komponentu):

```tsx
// Nagłówek: "TIMEFLOW Web UI (tryb bez okna)"
// - Co to robi: udostępnia interfejs przez przeglądarkę bez otwierania okna aplikacji.
//   Uruchamiasz z menu demona ("Uruchom Web UI"); aplikacja działa w tle jako serwer.
// - Kiedy użyć: chcesz korzystać z TIMEFLOW z innego urządzenia w sieci lub bez okna na hoscie.
// - Parowanie: przeglądarka na tej samej maszynie (localhost) loguje się automatycznie.
//   Urządzenia w sieci LAN wymagają 6-cyfrowego kodu — wygeneruj go w zakładce "Web Server".
// - Jak zatrzymać: menu demona → "Zatrzymaj Web UI".
// - Ograniczenia: tryb zakłada zaufaną maszynę-host (dostęp z localhost bez hasła);
//   wymaga skonfigurowanego portu serwera.
```

Zachowaj spójną terminologię z menu demona (te same nazwy: „Uruchom/Zatrzymaj Web UI").

- [ ] **Step 3: Build frontu**

Run: `cd dashboard && npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/Help.tsx
git commit -m "docs(help): describe headless Web UI mode"
```

---

## Self-Review (autor planu)

- **Pokrycie specu:** headless bez okna (T4) ✓; brak ikony Docku/accessory (T4) ✓; toggle Start/Stop + adres LAN (T8/T9) ✓; auto-open przeglądarki (T6) ✓; auto-login loopback (T2+T3) ✓; LAN przez kod (zakładka Web Server, T2 brak flagi dla nie-loopback) ✓; plik statusu (T1) ✓; Help (T10) ✓; testy Rust (T1/T2/T6) ✓; macOS realnie (T5/T8), Windows mirror nieweryfikowany (T9) ✓.
- **Odstępstwo od specu:** usunięto pozycję menu „Pokaż kod parowania" (kody z zakładki Web UI) — wymaga akceptacji użytkownika; spec zaktualizuję po zatwierdzeniu.
- **Spójność typów:** `WebUiHost{pid,port,started_at}` używane jednolicie w `timeflow_shared::webui_host` (T1), `webui::start_headless` (T4), `webui_host_ctl` (T6). `is_running`/`current`/`start`/`stop`/`display_address` — spójne nazwy w T6/T8/T9.
- **Ryzyka:** (1) inline-injection flagi trusted zależy od CSP — fallback w T5 (dodać `script-src 'unsafe-inline'`). (2) nazwa katalogu danych w demonie (`config::config_dir()` vs `timeflow_data_dir()`) — kroki T8 nakazują weryfikację, by wskazać ten sam katalog co `webserver_settings.json`.
