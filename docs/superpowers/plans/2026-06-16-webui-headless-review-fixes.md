# Web UI Headless — poprawki po code review (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domknąć cykl życia procesu headless Web UI (brak sieroty/desync, brak ubicia obcego PID), zredukować koszt/leak w tray macOS i obsłużyć ścieżki błędu startu zgodnie ze specem.

**Architecture:** Demon (`timeflow-demon`, crate `src/`) steruje procesem `timeflow-dashboard --headless` przez plik statusu `webui_host.json` (pid+port). Poprawki: (1) dashboard sam sprząta plik przy wyjściu, (2) demon weryfikuje tożsamość procesu przed killem i czeka na zgon, (3) `start()` zwraca jawny wynik i powiadamia użytkownika, (4) tray macOS cache'uje stan menu Web UI tak jak już cache'uje status sync.

**Tech Stack:** Rust (workspace: `timeflow-demon`, `timeflow-dashboard`, `timeflow-shared`), Tauri v2, tray-icon (macOS) / native-windows-gui (Windows).

**Komendy (host macOS):**
- Build demona: `cargo build -p timeflow-demon`
- Build backendu dashboardu: `cargo build -p timeflow-dashboard`
- Testy demona: `cargo test -p timeflow-demon`
- Testy shared: `cargo test -p timeflow-shared`

**Ograniczenia środowiska (WAŻNE):**
- Kod `#[cfg(windows)]` (`src/platform/windows/*`, windowsowe gałęzie `webui_host_ctl.rs`) **nie kompiluje się na macOS** (cross-compile pada na `libsqlite3-sys`/C). Zmiany windowsowe w tym planie shippują niezweryfikowane z maca — oznaczono je „⚠️ Windows: tylko compile-check na Windows".
- Tray (macOS `tray.rs`, Windows `tray.rs`) i spawn procesów nie są jednostkowo testowalne → dla nich plan podaje **scenariusze manualne**. Logikę czystą (parsowanie, dopasowania, I/O na plikach tymczasowych) pokrywamy `cargo test`.

---

## File Structure

| Plik | Odpowiedzialność | Zmiana |
|------|------------------|--------|
| `dashboard/src-tauri/src/lib.rs` | bootstrap aplikacji Tauri | Task 1: cleanup `webui_host.json` na `RunEvent::Exit` |
| `src/webui_host_ctl.rs` | sterowanie procesem headless po stronie demona | Task 2,3,6: identity-check, wait-on-exit, guardy startu, single-read ustawień, `StartOutcome`, notify |
| `src/platform/macos/tray.rs` | tray macOS | Task 4: cache stanu Web UI w `AppliedTray` |
| `src/platform/windows/tray.rs` | tray Windows | Task 3: użyć `StartOutcome` (⚠️ Windows) |
| `src/i18n.rs` | teksty UI/tray | Task 3,6: teksty powiadomień + doprecyzowanie `WebUiStatusOff` |
| `dashboard/dashboard/src/components/Help.tsx` (ścieżka do potwierdzenia) | panel pomocy | Task 7: semantyka „wymaga włączonego Web Server" |
| `docs/superpowers/specs/2026-06-14-webui-headless-mode-design.md` | spec | Task 7: korekta „force-start" → „respektuje enabled" |

---

## Task 1: Dashboard sprząta `webui_host.json` przy wyjściu (Critical C1a)

Proces headless zapisuje plik statusu, ale nigdy go nie usuwa przy zamknięciu. Po crashu/ubiciu zostaje „żywo wyglądający" wpis. Dashboard musi czyścić plik na `RunEvent::Exit`.

**Files:**
- Modify: `dashboard/src-tauri/src/lib.rs:378-379` (zmiana `.run(...)` na `.build(...).run(callback)`)

- [ ] **Step 1: Zamień `.run(generate_context!())` na build + run z callbackiem cleanup**

W `dashboard/src-tauri/src/lib.rs` zastąp końcówkę buildera (linie 377-379, fragment `])\n        .run(tauri::generate_context!())\n        .expect("error while running tauri application");`):

```rust
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // Tryb headless: posprzątaj plik statusu, by demon nie widział
            // sieroty po zamknięciu/ubiciu tego procesu.
            if let tauri::RunEvent::Exit = event {
                if headless {
                    if let Ok(dir) = commands::helpers::timeflow_data_dir() {
                        timeflow_shared::webui_host::clear(&dir);
                        log::info!("[webui] headless exit — cleared webui_host.json");
                    }
                }
            }
        });
}
```

`headless` to `bool` (Copy) zdefiniowany w `lib.rs:70`, captured przez `move` w `.setup(...)` i nadal dostępny tu — capture przez kopię nie koliduje.

- [ ] **Step 2: Build backendu — weryfikacja kompilacji**

Run: `cargo build -p timeflow-dashboard`
Expected: kompiluje się bez błędów (callback ma poprawny typ `Fn(&AppHandle, RunEvent)`).

- [ ] **Step 3: Scenariusz manualny — cleanup na zamknięciu**

1. Włącz Web Server w ustawieniach (`enabled=true`).
2. Uruchom z menu demona „Uruchom Web UI" → potwierdź, że powstał `<data_dir>/webui_host.json`.
3. Zamknij proces headless (z menu „Zatrzymaj Web UI" oraz osobno: ubij ręcznie `kill <pid>` z pliku).
4. Po zamknięciu z menu plik MA zniknąć; po ręcznym `kill` plik znika dopiero po cleanupie demona (Task 2) — to oczekiwane.
Expected: zamknięcie kontrolowane (RunEvent::Exit) zostawia katalog bez `webui_host.json`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/lib.rs
git commit -m "fix(webui): clear webui_host.json on headless process exit"
```

---

## Task 2: `stop()` weryfikuje tożsamość procesu i czeka na zgon (Critical C1b + C2)

Obecnie `stop()` ubija PID z pliku bez sprawdzenia, czy to nasz dashboard (ryzyko `taskkill /F` na obcy proces po reużyciu PID) i czyści plik natychmiast, nie czekając na faktyczny zgon (wyścig z `start()`).

**Files:**
- Modify: `src/webui_host_ctl.rs` (dodać `comm_matches_dashboard`, `process_comm`/refactor `pid_alive` win, `pid_is_dashboard`, `wait_for_exit`; przepisać `stop`)
- Test: `src/webui_host_ctl.rs` (moduł `#[cfg(test)]`)

- [ ] **Step 1: Test jednostkowy — dopasowanie nazwy procesu (pure)**

Dodaj w module `tests` w `src/webui_host_ctl.rs`:

```rust
    #[test]
    fn comm_matches_only_our_binary() {
        assert!(comm_matches_dashboard("timeflow-dashboard"));
        assert!(comm_matches_dashboard("TIMEFLOW"));
        assert!(comm_matches_dashboard("/Applications/TIMEFLOW.app/Contents/MacOS/TIMEFLOW"));
        assert!(!comm_matches_dashboard("Google Chrome"));
        assert!(!comm_matches_dashboard("bash"));
        assert!(!comm_matches_dashboard(""));
    }
```

- [ ] **Step 2: Uruchom test — ma nie kompilować się (brak funkcji)**

Run: `cargo test -p timeflow-demon comm_matches_only_our_binary`
Expected: FAIL — `cannot find function comm_matches_dashboard`.

- [ ] **Step 3: Dodaj pure matcher + lookup nazwy procesu po PID**

W `src/webui_host_ctl.rs` dodaj (po `pid_alive`):

```rust
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
```

- [ ] **Step 4: Uruchom test — PASS**

Run: `cargo test -p timeflow-demon comm_matches_only_our_binary`
Expected: PASS.

- [ ] **Step 5: Test jednostkowy — `wait_for_exit` wraca natychmiast dla martwego PID**

Dodaj w module `tests`:

```rust
    #[test]
    fn wait_for_exit_returns_for_dead_pid() {
        let start = std::time::Instant::now();
        wait_for_exit(999_999_990, std::time::Duration::from_secs(2));
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
    }
```

- [ ] **Step 6: Uruchom — FAIL (brak funkcji), potem dodaj `wait_for_exit`**

Run: `cargo test -p timeflow-demon wait_for_exit_returns_for_dead_pid`
Expected: FAIL — `cannot find function wait_for_exit`.

Dodaj w `src/webui_host_ctl.rs`:

```rust
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
```

- [ ] **Step 7: Uruchom — PASS**

Run: `cargo test -p timeflow-demon wait_for_exit_returns_for_dead_pid`
Expected: PASS.

- [ ] **Step 8: Przepisz `stop()` — identity-check + wait przed czyszczeniem pliku**

Zastąp całe `stop()` (`src/webui_host_ctl.rs:91-98`):

```rust
/// Stop: ubij proces z pliku statusu (tylko jeśli to NASZ dashboard) i posprzątaj.
pub fn stop(data_dir: &Path) {
    if let Some(host) = webui_host::read(data_dir) {
        if pid_alive(host.pid) && pid_is_dashboard(host.pid) {
            kill_pid(host.pid);
            wait_for_exit(host.pid, std::time::Duration::from_secs(5));
        } else {
            log::warn!(
                "[webui-ctl] stop: pid {} is not our dashboard (or already gone) — not killing",
                host.pid
            );
        }
    }
    webui_host::clear(data_dir);
    log::info!("[webui-ctl] stopped");
}
```

- [ ] **Step 9: Build + cała sucha próba testów demona**

Run: `cargo build -p timeflow-demon && cargo test -p timeflow-demon`
Expected: build OK, wszystkie testy PASS (w tym istniejące `dead_pid_is_cleaned_and_not_running`, `live_pid_is_running`).

- [ ] **Step 10: Scenariusz manualny — brak ubicia obcego PID**

1. Uruchom Web UI, zanotuj `pid` z `webui_host.json`.
2. Ubij ręcznie proces (`kill <pid>`), NIE usuwając pliku.
3. Poczekaj na reużycie PID przez inny proces (lub zasymuluj: ręcznie podmień `pid` w `webui_host.json` na PID dowolnej innej żywej aplikacji, np. Findera).
4. Kliknij „Zatrzymaj Web UI".
Expected: w logu demona „is not our dashboard … not killing"; obcy proces NIE zostaje ubity; plik wyczyszczony.

- [ ] **Step 11: Commit**

```bash
git add src/webui_host_ctl.rs
git commit -m "fix(webui): verify process identity before kill + wait for exit on stop"
```

---

## Task 3: `start()` z guardami i jawnym wynikiem + powiadomienie (Important I1+I2, Critical C2)

`start()` musi: odmówić gdy Web Server wyłączony (I1), nie spawnować gdy port zajęty (C2), i powiadomić użytkownika o nieudanym starcie (I2). Zwraca `StartOutcome` (testowalne + sterowanie UI).

**Files:**
- Modify: `src/webui_host_ctl.rs` (enum `StartOutcome`, `port_in_use`, `notify_user`, przepis `start`)
- Modify: `src/i18n.rs` (teksty powiadomień)
- Modify: `src/platform/macos/tray.rs:583-592` (logowanie wyniku — opcjonalnie)
- Test: `src/webui_host_ctl.rs`

- [ ] **Step 1: Test jednostkowy — `port_in_use` wykrywa zajęty port**

Dodaj w module `tests`:

```rust
    #[test]
    fn port_in_use_detects_bound_listener() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_in_use(port));
        drop(listener);
        // po zwolnieniu port jest wolny (może wymagać chwili na niektórych OS,
        // ale dla 127.0.0.1 bind zwykle natychmiast)
        assert!(!port_in_use(port));
    }
```

- [ ] **Step 2: Uruchom — FAIL (brak funkcji)**

Run: `cargo test -p timeflow-demon port_in_use_detects_bound_listener`
Expected: FAIL — `cannot find function port_in_use`.

- [ ] **Step 3: Dodaj `port_in_use`, `StartOutcome`, `notify_user`**

W `src/webui_host_ctl.rs`:

```rust
/// Wynik próby startu — sterujący UI/logiem i testowalny.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    Spawned,
    AlreadyRunning,
    Disabled,
    PortBusy,
}

/// Czy port na loopbacku jest zajęty (nie da się zbindować).
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// Natywne powiadomienie użytkownika. macOS: osascript (brak nowej zależności).
#[cfg(target_os = "macos")]
fn notify_user(title: &str, body: &str) {
    let script = format!("display notification {body:?} with title {title:?}");
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .status();
}

/// ⚠️ Windows: compile-check tylko na Windows. Na razie log; toast przez
/// tray TrayNotification do podpięcia w follow-upie.
#[cfg(windows)]
fn notify_user(_title: &str, body: &str) {
    log::error!("[webui-ctl] notify: {body}");
}
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cargo test -p timeflow-demon port_in_use_detects_bound_listener`
Expected: PASS.

- [ ] **Step 5: Dodaj teksty powiadomień w i18n**

W `src/i18n.rs` dodaj warianty do enuma `TrayText` (obok `WebUiStatusDisabled`):

```rust
    WebUiNotifyTitle,
    WebUiNotifyPortBusy,
    WebUiNotifyDisabled,
```

oraz arms w metodzie `t` (obok istniejących `WebUiStatus*`):

```rust
            (Lang::Pl, TrayText::WebUiNotifyTitle) => "TIMEFLOW",
            (Lang::En, TrayText::WebUiNotifyTitle) => "TIMEFLOW",

            (Lang::Pl, TrayText::WebUiNotifyPortBusy) => "Nie udało się uruchomić Web UI — port jest zajęty.",
            (Lang::En, TrayText::WebUiNotifyPortBusy) => "Could not start Web UI — the port is in use.",

            (Lang::Pl, TrayText::WebUiNotifyDisabled) => "Web Server jest wyłączony w ustawieniach — włącz go, aby uruchomić Web UI.",
            (Lang::En, TrayText::WebUiNotifyDisabled) => "Web Server is disabled in settings — enable it to start Web UI.",
```

- [ ] **Step 6: Przepisz `start()` — guardy + outcome + notify**

Zastąp `start()` (`src/webui_host_ctl.rs:79-89`):

```rust
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
        log::error!("[webui-ctl] start refused — port {port} already in use");
        notify_user(
            lang.t(crate::i18n::TrayText::WebUiNotifyTitle),
            lang.t(crate::i18n::TrayText::WebUiNotifyPortBusy),
        );
        return StartOutcome::PortBusy;
    }
    spawn_headless();
    open_browser_when_ready(data_dir.to_path_buf(), port);
    StartOutcome::Spawned
}
```

(Sprawdź nazwę modułu i18n: w `tray.rs` używane jako `i18n::TrayText` i `i18n::load_language` — w `webui_host_ctl.rs` użyj `crate::i18n::...`.)

- [ ] **Step 7: Zaktualizuj callera w tray macOS (log wyniku)**

W `src/platform/macos/tray.rs` w gałęzi `else { crate::webui_host_ctl::start(&dir); }` (linia ~590) zamień na:

```rust
                    } else {
                        let outcome = crate::webui_host_ctl::start(&dir);
                        log::info!("[tray] Web UI start outcome: {outcome:?}");
                    }
```

- [ ] **Step 8: ⚠️ Windows mirror — caller w tray Windows**

W `src/platform/windows/tray.rs` (linia ~407, gałąź startu) analogicznie przypisz wynik `start(&dir)` do zmiennej i zaloguj. Compile-check tylko na Windows.

- [ ] **Step 9: Build + testy demona**

Run: `cargo build -p timeflow-demon && cargo test -p timeflow-demon`
Expected: build OK, testy PASS.

- [ ] **Step 10: Scenariusz manualny — ścieżki błędu**

1. Web Server wyłączony → „Uruchom Web UI" z menu (jeśli dostępne) → powiadomienie „Web Server wyłączony…", brak spawnu.
2. Zajmij port (np. `python3 -m http.server 47892`), włącz Web Server, kliknij start → powiadomienie „port jest zajęty", brak drugiego procesu.
Expected: powiadomienia widoczne, brak sieroty, toggle nie kłamie po następnym ticku tray.

- [ ] **Step 11: Commit**

```bash
git add src/webui_host_ctl.rs src/i18n.rs src/platform/macos/tray.rs src/platform/windows/tray.rs
git commit -m "feat(webui): start() guards (enabled/port) + user notification + StartOutcome"
```

---

## Task 4: Tray macOS cache'uje stan Web UI w `AppliedTray` (Important I3 + M2 + M5)

Setterki Web UI wołane co 5 s bezwarunkowo (klasa wywołań, którą reszta tray świadomie gate'uje przeciw leakowi Image IO). Dodaj cache i pojedynczy odczyt ustawień.

**Files:**
- Modify: `src/webui_host_ctl.rs` (single-read `read_webserver_settings`; `display_address` bez efektu ubocznego)
- Modify: `src/platform/macos/tray.rs` (`AppliedTray` + blok aktualizacji Web UI)
- Test: `src/webui_host_ctl.rs`

- [ ] **Step 1: Test jednostkowy — pojedynczy odczyt ustawień web servera**

Dodaj w module `tests` w `src/webui_host_ctl.rs`:

```rust
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
```

- [ ] **Step 2: Uruchom — FAIL (brak funkcji/typu)**

Run: `cargo test -p timeflow-demon read_webserver_settings`
Expected: FAIL — `cannot find function read_webserver_settings`.

- [ ] **Step 3: Dodaj `WebServerSettings` + `read_webserver_settings`; przepisz `is_enabled`/`configured_port`/`display_address`**

W `src/webui_host_ctl.rs` zastąp `configured_port` (50-58) i `is_enabled` (60-69) oraz `display_address` (71-77) tym:

```rust
/// Odczyt ustawień web servera JEDNYM read+parse (DRY — wcześniej 2-3 odczyty/tick).
pub struct WebServerSettings {
    pub enabled: bool,
    pub port: u16,
}

fn read_webserver_settings(data_dir: &Path) -> WebServerSettings {
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
```

- [ ] **Step 4: Uruchom — PASS**

Run: `cargo test -p timeflow-demon read_webserver_settings`
Expected: oba PASS.

- [ ] **Step 5: Dodaj pola cache do `AppliedTray`**

W `src/platform/macos/tray.rs` w `struct AppliedTray` (linie 147-155) dodaj pola:

```rust
    webui_status: Option<String>,
    webui_toggle_text: Option<String>,
    webui_toggle_enabled: Option<bool>,
```

oraz w `AppliedTray::new()` (159-166):

```rust
            webui_status: None,
            webui_toggle_text: None,
            webui_toggle_enabled: None,
```

- [ ] **Step 6: Przepisz blok aktualizacji Web UI tak, by aplikował tylko przy zmianie**

W `src/platform/macos/tray.rs` zastąp blok `if let Ok(dir) = crate::config::config_dir() { ... }` (linie 541-559) tym:

```rust
            if let Ok(dir) = crate::config::config_dir() {
                let lang = lang_state.get();
                let s = crate::webui_host_ctl::read_webserver_settings(&dir);
                let (status_text, toggle_text, toggle_enabled) = if !s.enabled {
                    // Wyłączone w ustawieniach — nie oferuj startu.
                    (
                        lang.t(TrayText::WebUiStatusDisabled).to_string(),
                        lang.t(TrayText::WebUiStart).to_string(),
                        false,
                    )
                } else if crate::webui_host_ctl::is_running(&dir) {
                    let addr = crate::webui_host_ctl::display_address(&dir);
                    (
                        format!("{} {}", lang.t(TrayText::WebUiStatusOn), addr),
                        lang.t(TrayText::WebUiStop).to_string(),
                        true,
                    )
                } else {
                    (
                        lang.t(TrayText::WebUiStatusOff).to_string(),
                        lang.t(TrayText::WebUiStart).to_string(),
                        true,
                    )
                };

                if applied.webui_status.as_deref() != Some(status_text.as_str()) {
                    webui_status_item.set_text(&status_text);
                    applied.webui_status = Some(status_text);
                }
                if applied.webui_toggle_text.as_deref() != Some(toggle_text.as_str()) {
                    webui_toggle_item.set_text(&toggle_text);
                    applied.webui_toggle_text = Some(toggle_text);
                }
                if applied.webui_toggle_enabled != Some(toggle_enabled) {
                    webui_toggle_item.set_enabled(toggle_enabled);
                    applied.webui_toggle_enabled = Some(toggle_enabled);
                }
            }
```

Wymaga `read_webserver_settings` jako `pub` — zmień jego sygnaturę w `webui_host_ctl.rs` na `pub fn read_webserver_settings`.

- [ ] **Step 7: Build demona**

Run: `cargo build -p timeflow-demon`
Expected: kompiluje się; brak warningu o nieużytych polach `AppliedTray`.

- [ ] **Step 8: Scenariusz manualny — tray nadal poprawny, bez ciągłych setterków**

1. Uruchom demona, otwórz menu tray — status Web UI poprawny.
2. Włącz/wyłącz Web Server w ustawieniach → po ≤5 s tekst i enabled togglą się.
3. Start/Stop z menu → status i tekst przycisku zmieniają się raz, nie migoczą.
4. (Opcjonalnie) długi przebieg + `vmmap <pid> | grep -i imageio` lub Instruments → liczba regionów Image IO nie rośnie liniowo (jak w opisie cache `AppliedTray`).
Expected: aktualizacje tylko przy realnej zmianie stanu.

- [ ] **Step 9: Commit**

```bash
git add src/webui_host_ctl.rs src/platform/macos/tray.rs
git commit -m "perf(webui): cache Web UI tray state in AppliedTray + single settings read"
```

---

## Task 5: DRY — wspólny locator binarki dashboardu (Minor M1)

`macos_app_candidates`/`windows_exe_candidates` w `webui_host_ctl.rs` dublują logikę z `tray.rs::launch_dashboard`. Wystaw je jako `pub(crate)` i użyj w tray.

**Files:**
- Modify: `src/webui_host_ctl.rs` (`pub(crate)` na candidates)
- Modify: `src/platform/macos/tray.rs:694-716` (`launch_dashboard` używa wspólnego helpera)
- Modify (⚠️ Windows): `src/platform/windows/tray.rs:826-847`

- [ ] **Step 1: Wystaw candidates jako `pub(crate)`**

W `src/webui_host_ctl.rs` zmień sygnatury:
- `fn macos_app_candidates()` → `pub(crate) fn macos_app_candidates()`
- `fn windows_exe_candidates()` → `pub(crate) fn windows_exe_candidates()`

- [ ] **Step 2: macOS `launch_dashboard` używa wspólnej listy**

W `src/platform/macos/tray.rs::launch_dashboard` zastąp lokalne budowanie listy kandydatów `.app` wywołaniem `crate::webui_host_ctl::macos_app_candidates()`. Zachowaj istniejącą próbę `open -b com.timeflow.dashboard` jako pierwszą (jeśli tam jest). Iteruj po wspólnej liście do pierwszego `cand.exists()`.

- [ ] **Step 3: Build demona**

Run: `cargo build -p timeflow-demon`
Expected: OK, brak duplikatów; jeśli `macos_app_candidates` było `#[cfg(target_os="macos")]`, upewnij się że tray (też macOS) widzi je pod tym cfg.

- [ ] **Step 4: ⚠️ Windows mirror**

W `src/platform/windows/tray.rs` analogicznie przełącz na `crate::webui_host_ctl::windows_exe_candidates()`. Compile-check tylko na Windows.

- [ ] **Step 5: Scenariusz manualny — uruchamianie dashboardu nadal działa**

„Otwórz dashboard" z menu tray uruchamia okno; „Uruchom Web UI" uruchamia headless. Obie ścieżki znajdują binarkę.

- [ ] **Step 6: Commit**

```bash
git add src/webui_host_ctl.rs src/platform/macos/tray.rs src/platform/windows/tray.rs
git commit -m "refactor(webui): share dashboard binary locator between tray and headless ctl"
```

---

## Task 6: Doprecyzowanie i18n + stała portu (Minor M3 + M4)

`WebUiStatusOff` („Web UI: wyłączone") myli się z `WebUiStatusDisabled` (faktycznie wyłączone w ustawieniach). `DEFAULT_PORT` żyje w wielu miejscach bez noty.

**Files:**
- Modify: `src/i18n.rs:89-90`
- Modify: `src/webui_host_ctl.rs:47`

- [ ] **Step 1: Popraw tekst `WebUiStatusOff` (stan: włączone w ustawieniach, ale nie uruchomione)**

W `src/i18n.rs` zmień:

```rust
            (Lang::Pl, TrayText::WebUiStatusOff) => "Web UI: zatrzymane",
            (Lang::En, TrayText::WebUiStatusOff) => "Web UI: stopped",
```

- [ ] **Step 2: Dodaj notę do `DEFAULT_PORT`**

W `src/webui_host_ctl.rs:47` dodaj komentarz:

```rust
/// Musi zgadzać się z `webui/config.rs::DEFAULT_WEB_PORT` (dashboard) oraz
/// `webui_dev.py`. Zmiana tu wymaga zmiany tam.
const DEFAULT_PORT: u16 = 47892;
```

- [ ] **Step 3: Build + testy**

Run: `cargo build -p timeflow-demon && cargo test -p timeflow-demon`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/i18n.rs src/webui_host_ctl.rs
git commit -m "fix(i18n): clarify Web UI 'stopped' vs 'disabled' + note DEFAULT_PORT sources"
```

---

## Task 7: Dokumentacja — semantyka „wymaga włączonego Web Server" (CLAUDE.md §3)

Implementacja respektuje `enabled` (kończy proces gdy off) — odwrotnie niż „force-start" w specu/planie. Zaktualizuj spec i Help.tsx.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-14-webui-headless-mode-design.md`
- Modify: `docs/superpowers/plans/2026-06-14-webui-headless-mode.md`
- Modify: panel pomocy — `Help.tsx` (potwierdź ścieżkę: `grep -rl "Help" dashboard --include=*.tsx`)

- [ ] **Step 1: Zlokalizuj Help.tsx i sekcję Web UI**

Run: `grep -rln "Web UI\|headless\|Web Server" dashboard --include=*.tsx`
Expected: plik(i) z sekcją pomocy Web UI.

- [ ] **Step 2: Popraw spec — „force-start" → „respektuje enabled"**

W `docs/superpowers/specs/2026-06-14-webui-headless-mode-design.md` znajdź sekcję o force-starcie serwera i zastąp opis: tryb headless NIE startuje serwera, gdy Web Server jest wyłączony w ustawieniach (proces kończy się); użytkownik musi najpierw włączyć Web Server. Dodaj opis powiadomień (port zajęty / wyłączony).

- [ ] **Step 3: Dopisz notę w planie 2026-06-14**

W `docs/superpowers/plans/2026-06-14-webui-headless-mode.md` przy Task 4 dodaj notę: „Zmieniono względem planu — patrz `2026-06-16-webui-headless-review-fixes.md`. Headless respektuje `enabled`."

- [ ] **Step 4: Zaktualizuj Help.tsx**

W sekcji Web UI dodaj/popraw: „Tryb Web UI wymaga włączonego Web Server w ustawieniach. Jeśli port jest zajęty lub serwer wyłączony, TIMEFLOW pokaże powiadomienie i nie uruchomi Web UI." Zachowaj format i terminologię (TIMEFLOW, „Web Server", „Web UI").

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-14-webui-headless-mode-design.md docs/superpowers/plans/2026-06-14-webui-headless-mode.md dashboard
git commit -m "docs(webui): document enabled-gated headless start + failure notifications"
```

---

## Self-Review

**Pokrycie ustaleń recenzji:**
- C1 (brak cleanup + reuse PID) → Task 1 (exit cleanup) + Task 2 (identity-check). ✓
- C2 (wyścig stop/start, brak wait, port) → Task 2 (wait_for_exit) + Task 3 (port_in_use). ✓
- I1 (`start` nie sprawdza enabled) → Task 3. ✓
- I2 (brak powiadomień port/enabled) → Task 3 (`notify_user` + i18n). ✓ (Windows toast = follow-up, jawnie oznaczone.)
- I3 (setterki co tick) → Task 4 (cache AppliedTray). ✓
- I4 (`kill -0` spawn) — ŚWIADOMIE pominięte: niski priorytet (5 s interwał), a Task 2 dodaje już `ps`/`tasklist`; dalsza zamiana na `libc::kill` to osobny follow-up. Udokumentowane tutaj.
- M1 (duplikacja candidates) → Task 5. ✓
- M2 (powtórzone read ustawień) → Task 4 (`read_webserver_settings`). ✓
- M3 (DEFAULT_PORT) → Task 6. ✓
- M4 (mylący tekst) → Task 6. ✓
- M5 (`display_address` efekt uboczny) → Task 4 (czyta plik bez `current()`). ✓
- Plan/spec/Help rozjazd → Task 7. ✓

**Type/nazwy spójne:** `read_webserver_settings` (pub), `WebServerSettings{enabled,port}`, `StartOutcome{Spawned,AlreadyRunning,Disabled,PortBusy}`, `comm_matches_dashboard`, `process_comm`, `pid_is_dashboard`, `wait_for_exit`, `port_in_use`, `notify_user`, i18n: `WebUiNotifyTitle/PortBusy/Disabled` — używane spójnie w Task 2-6.

**Placeholdery:** brak — każdy krok ma realny kod lub konkretny scenariusz manualny.

**Ryzyka:**
- `process_comm` na macOS dla procesu z bundla może zwrócić nazwę binarki executable (np. „TIMEFLOW") — matcher `contains("timeflow")` to pokrywa. Jeśli nazwa produktu w bundlu różni się od „TIMEFLOW", zweryfikuj manualnie krokiem Task 2/Step 10 i rozszerz matcher.
- Zmiany `#[cfg(windows)]` shippują niezweryfikowane z maca — wymagają build+smoke na Windows przed wydaniem (PARITY.md).
```
