# TIMEFLOW — Plan remediacji audytu bezpieczeństwa (Tauri)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domknąć luki bezpieczeństwa znalezione w audycie Tauri — przede wszystkim pełną powierzchnię komend wystawioną przez wbudowany serwer WWW oraz sekrety trzymane plaintext na macOS/Linux.

**Architecture:** TIMEFLOW = workspace Cargo z trzema crate'ami: `timeflow-demon` (root `src/`, tray daemon), `timeflow-dashboard` (`dashboard/src-tauri/`, aplikacja Tauri), `timeflow-shared` (`shared/`, wspólny kod). Dashboard wystawia wbudowany serwer HTTP (`webui/server.rs`, surowy `TcpListener`) z mostem RPC (`webui/rpc_generated.rs`) do KAŻDEJ zarejestrowanej komendy `#[tauri::command]` — całkowicie poza modelem capabilities/scopes Tauri. Remediacja działa na trzech frontach: hardening serwera HTTP (bind + auth + nagłówki), przeniesienie sekretów do OS keychain (wspólny helper w `shared/`), oraz walidacja wejścia w komendach osiągalnych zdalnie.

**Tech Stack:** Rust (tauri 2, rusqlite, reqwest, getrandom, sha2), keyring 3 (nowa zależność — OS keychain), React + TypeScript + Vite (dashboard frontend, testy vitest), Cargo workspace.

**Decyzje (zatwierdzone z użytkownikiem 2026-06-17):**
1. Zakres: **wszystko** (CRITICAL + HIGH + MEDIUM + LOW).
2. WebUI: **bind 127.0.0.1 domyślnie + opt-in LAN** za świadomym przełącznikiem; obrona CSRF (token zawsze + walidacja Origin/Host + nagłówek wymagany + brak `ACAO: *`) jest OBOWIĄZKOWA niezależnie od bindu.
3. Sekrety macOS/Linux: **OS keychain przez crate `keyring`**, wspólny dla dashboardu i demona.

**Konwencje testów/komend (zweryfikuj raz na starcie):**
- Rust: `cargo test -p timeflow-dashboard` (z roota repo). Pojedynczy moduł: `cargo test -p timeflow-dashboard webui::server`.
- Frontend: `cd dashboard && npx vitest run <plik>` (w repo są już testy `*.test.ts`).
- Jakość React: `npx -y react-doctor@latest . --verbose` z roota → oczekiwany wynik **100/100** (patrz CLAUDE.md §5).
- **Help.tsx**: każda zmiana zachowania odczuwalna przez użytkownika wymaga aktualizacji odpowiedniej sekcji Help w tym samym commicie (CLAUDE.md §3).

---

## File Structure

**Nowe pliki:**
- `shared/src/secret_store.rs` — wspólny helper OS keychain (get/set/delete sekretu), używany przez dashboard i demon. Jedna odpowiedzialność: dostęp do keychaina.

**Modyfikowane (backend dashboard):**
- `dashboard/src-tauri/Cargo.toml` — dep `keyring`.
- `dashboard/src-tauri/src/webui/config.rs` — pole `lan_exposure` w `WebServerConfig`.
- `dashboard/src-tauri/src/webui/server.rs` — bind adresu, nagłówki odpowiedzi, walidacja Origin/Host, serve_spa anty-traversal.
- `dashboard/src-tauri/src/webui/mod.rs` — przekazanie bind adresu do `spawn`.
- `dashboard/src-tauri/src/commands/webserver.rs` — `webserver_set_config` przyjmuje `lan_exposure`.
- `dashboard/src-tauri/src/commands/secure_store.rs` — sekret w keychainie + migracja `sync_token.dat`.
- `dashboard/src-tauri/src/commands/online_sync.rs` — auth_token/encryption_key w keychainie + migracja JSON.
- `dashboard/src-tauri/src/commands/database.rs` — walidacja ścieżki w `restore_database_from_file`.
- `dashboard/src-tauri/src/commands/lan_sync.rs` — guard prywatnego IP w `ping_lan_peer`/`run_lan_sync`.
- `dashboard/src-tauri/src/commands/import_data.rs` — `VACUUM INTO` przez `quote()`.
- `dashboard/src-tauri/src/lib.rs` — ograniczenie walk-up `.env`.
- `dashboard/src-tauri/tauri.conf.json` — `freezePrototype: true`, komentarz o signingu.

**Modyfikowane (shared / demon):**
- `shared/Cargo.toml` — dep `keyring`.
- `shared/src/lib.rs` — `pub mod secret_store;`.
- `src/config.rs` (demon) — `load_online_sync_settings` hydratuje sekrety z keychaina.
- `Cargo.toml` (root) — `strip = true` w `[profile.release]`.

**Modyfikowane (frontend):**
- `dashboard/src/lib/webui/http-transport.ts` — zawsze token + nagłówek `X-TIMEFLOW-RPC`, usunięcie trusted-flag.
- `dashboard/src/lib/tauri/webserver.ts` — typ configu z `lanExposure`.
- `dashboard/src/components/settings/web-server-card-state.ts` + `WebServerCard.tsx` + `pages/settings/SettingsWebServerTab.tsx` — przełącznik LAN + ostrzeżenie.
- `dashboard/src/components/help/sections/HelpWebServerSection.tsx` — dokumentacja LAN/pairingu.

**Zależności (npm/cargo):** `dashboard/package.json` (npm audit fix), `Cargo.lock`.

---

## Phase 0 — Baseline tooling (audyt zależności)

### Task 0: Audyt zależności i naprawa npm

**Files:**
- Modify: `dashboard/package.json`, `dashboard/package-lock.json`, `Cargo.lock`

- [ ] **Step 1: Zainstaluj cargo-audit i przeskanuj crate'y Rust**

Run:
```bash
cargo install cargo-audit --locked
cargo audit
```
Expected: lista advisories (jeśli są) z `RUSTSEC-*`. Zapisz wynik do opisu commita. Dla każdego HIGH/critical advisory zaktualizuj wersję w odpowiednim `Cargo.toml` i ponów `cargo audit`.

- [ ] **Step 2: Napraw podatności npm (vite/picomatch/postcss — M3)**

Run:
```bash
cd dashboard && npm audit fix && npm audit
```
Expected: `found 0 vulnerabilities` (lub same low nienaprawialne bez `--force`). NIE używaj `--force` bez weryfikacji buildu.

- [ ] **Step 3: Zweryfikuj build frontu po aktualizacji**

Run: `cd dashboard && npm run build`
Expected: build przechodzi bez błędów (vite major się nie zmienia przy `audit fix`).

- [ ] **Step 4: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json Cargo.lock
git commit -m "fix(deps): npm audit fix (vite/picomatch/postcss) + cargo audit baseline"
```

---

## Phase 1 — CRITICAL

### Task 1: WebServerConfig — pole `lan_exposure`, domyślnie bind 127.0.0.1 (C1a)

**Files:**
- Modify: `dashboard/src-tauri/src/webui/config.rs`
- Test: tenże plik (moduł `#[cfg(test)]` już istnieje)

- [ ] **Step 1: Napisz failing test na domyślny `lan_exposure=false` i roundtrip**

W `dashboard/src-tauri/src/webui/config.rs`, w module `tests`, dodaj:
```rust
    #[test]
    fn defaults_keep_lan_exposure_off() {
        let cfg = WebServerConfig::default();
        assert!(!cfg.lan_exposure);
    }

    #[test]
    fn lan_exposure_roundtrips() {
        let cfg = WebServerConfig { enabled: true, port: 47892, lan_exposure: true };
        let raw = cfg.to_json_string();
        assert_eq!(WebServerConfig::from_json_str(&raw), cfg);
    }
```

- [ ] **Step 2: Uruchom test — ma się NIE kompilować (brak pola)**

Run: `cargo test -p timeflow-dashboard webui::config`
Expected: błąd kompilacji „no field `lan_exposure`".

- [ ] **Step 3: Dodaj pole do struktury i Default**

W `WebServerConfig` (po `port`):
```rust
    /// Gdy false (domyślnie) serwer binduje tylko 127.0.0.1 (loopback).
    /// Gdy true — 0.0.0.0 (dostęp z LAN, np. telefon). Wymaga świadomego
    /// włączenia: ruch jest plaintext HTTP bez TLS.
    pub lan_exposure: bool,
```
W `impl Default` dodaj `lan_exposure: false,`.

Popraw też istniejący test `from_json_roundtrips` i `persistence_uses_webserver_settings_file_and_roundtrips`, dodając `lan_exposure: false` do literałów `WebServerConfig { .. }` (inaczej nie skompilują się).

- [ ] **Step 4: Uruchom testy — PASS**

Run: `cargo test -p timeflow-dashboard webui::config`
Expected: wszystkie testy modułu zielone.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/webui/config.rs
git commit -m "feat(webui): add lan_exposure flag to WebServerConfig (default loopback-only)"
```

---

### Task 2: Hardening nagłówków odpowiedzi serwera (C1c + M2)

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs:54-64` (funkcja `http`)
- Test: `dashboard/src-tauri/src/webui/server.rs` (moduł `tests`)

- [ ] **Step 1: Napisz failing test na nagłówki bezpieczeństwa**

W module `tests` w `server.rs`:
```rust
    #[test]
    fn responses_carry_hardened_headers_and_no_wildcard_cors() {
        let bytes = http("200 OK", "text/plain", b"x");
        let head = String::from_utf8_lossy(&bytes);
        assert!(head.contains("X-Content-Type-Options: nosniff"));
        assert!(head.contains("X-Frame-Options: DENY"));
        assert!(!head.contains("Access-Control-Allow-Origin: *"));
        assert!(!head.contains("'unsafe-inline'"));
    }
```

- [ ] **Step 2: Uruchom test — FAIL**

Run: `cargo test -p timeflow-dashboard webui::server::tests::responses_carry_hardened_headers`
Expected: FAIL (obecnie jest `ACAO: *` i `'unsafe-inline'`).

- [ ] **Step 3: Przepisz funkcję `http`**

Zamień ciało `http` (server.rs:54-64) na:
```rust
fn http(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'\r\n\
         X-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n\
         Connection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}
```
Uwaga: usuwamy `Access-Control-Allow-Origin: *` (SPA jest same-origin, CORS nie jest potrzebny) oraz `script-src 'unsafe-inline'` (bundle Vite nie wymaga inline-skryptów; jeśli okaże się, że wymaga — użyj hash/nonce, nie `unsafe-inline`).

- [ ] **Step 4: Uruchom test — PASS**

Run: `cargo test -p timeflow-dashboard webui::server`
Expected: nowy test zielony, istniejące testy `serve_index`/`parse_request` nadal zielone.

- [ ] **Step 5: Weryfikacja renderu (CSP bez unsafe-inline)**

Po zbudowaniu frontu (`npm run build`) i uruchomieniu serwera, otwórz web UI w przeglądarce i sprawdź konsolę pod kątem błędów CSP (zablokowane inline-skrypty). Jeśli wystąpią — bundle ma inline-script; rozwiąż przez hash w CSP, nie przez powrót do `unsafe-inline`. (Patrz pamięć: build+lint zielone ≠ render OK.)

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/webui/server.rs
git commit -m "fix(webui): harden response headers (drop CORS *, add nosniff/DENY, CSP without script unsafe-inline)"
```

---

### Task 3: `/rpc` wymaga tokenu zawsze + walidacja Origin/Host/nagłówka (C1b)

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs` — `parse_request`, `handle_rpc`, `serve_index`
- Test: `dashboard/src-tauri/src/webui/server.rs` (moduł `tests`)

- [ ] **Step 1: Rozszerz `ParsedRequest` o `origin` i `host`**

W strukturze `ParsedRequest` (server.rs:13-19) dodaj pola:
```rust
    pub origin: Option<String>,
    pub host: Option<String>,
```
W `parse_request` (w pętli po nagłówkach) dodaj parsowanie:
```rust
        if let Some(rest) = line.strip_prefix("Origin:") {
            origin = Some(rest.trim().to_string());
        }
        if let Some(rest) = line.strip_prefix("Host:") {
            host = Some(rest.trim().to_string());
        }
```
oraz `let mut origin = None; let mut host = None;` przed pętlą i uzupełnij konstrukcję `ParsedRequest { .., origin, host }`. Popraw istniejące testy `parses_*`, dodając `origin: None, host: ...` do oczekiwanych wartości (lub porównuj pola pojedynczo).

- [ ] **Step 2: Napisz failing test — brak tokenu = 401, obcy Origin = 403**

```rust
    #[test]
    fn rpc_without_token_is_unauthorized_even_on_loopback() {
        let app_raw = concat!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:47892\r\n",
            "Content-Type: text/plain\r\n\r\n",
            r#"{"command":"clear_all_data","args":{}}"#
        );
        let req = parse_request(app_raw).unwrap();
        // is_loopback=true nie może już autoryzować bez tokenu:
        assert!(!rpc_is_authorized(&req, &AuthState::new(), 0, true));
    }

    #[test]
    fn rpc_rejects_foreign_origin() {
        let raw = concat!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:47892\r\n",
            "Origin: https://evil.example\r\nAuthorization: Bearer x\r\n\r\n",
            "{}"
        );
        let req = parse_request(raw).unwrap();
        assert!(origin_is_forbidden(&req));
    }
```

- [ ] **Step 3: Uruchom test — FAIL (funkcje nie istnieją)**

Run: `cargo test -p timeflow-dashboard webui::server`
Expected: błąd kompilacji (`rpc_is_authorized`/`origin_is_forbidden` undefined).

- [ ] **Step 4: Zaimplementuj walidację i wytnij loopback-bypass**

Dodaj funkcje pomocnicze i przepisz `handle_rpc` (server.rs:239-253):
```rust
/// Origin obcy = obecny i niepasujący do loopback/host. Same-origin SPA albo
/// nie wysyła Origin (GET), albo wysyła własny — dozwolony.
fn origin_is_forbidden(request: &ParsedRequest) -> bool {
    let Some(origin) = request.origin.as_deref() else { return false };
    // Pozwól tylko na http://127.0.0.1[:port], http://localhost[:port]
    // oraz origin równy własnemu Host.
    let allowed = origin.starts_with("http://127.0.0.1")
        || origin.starts_with("http://localhost")
        || request
            .host
            .as_deref()
            .map(|h| origin == format!("http://{h}"))
            .unwrap_or(false);
    !allowed
}

fn rpc_is_authorized(
    request: &ParsedRequest,
    auth: &AuthState,
    now: u64,
    _is_loopback: bool,
) -> bool {
    // Token JEST wymagany zawsze (brak loopback-bypass — to był wektor CSRF).
    request
        .bearer
        .as_deref()
        .map(|token| auth.is_authorized(token, now))
        .unwrap_or(false)
}
```
W `handle_rpc` zastąp blok `let authorized = is_loopback || ...`:
```rust
    if origin_is_forbidden(request) {
        return json_response("403 Forbidden", r#"{"ok":false,"error":"forbidden_origin"}"#);
    }
    // Wymagany nagłówek niemożliwy do ustawienia cross-origin bez preflightu.
    if !request_has_rpc_header(request) {
        return json_response("400 Bad Request", r#"{"ok":false,"error":"missing_rpc_header"}"#);
    }
    if !rpc_is_authorized(request, auth, now_secs(), is_loopback) {
        return json_response("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
    }
```
Dodaj parsowanie nagłówka `X-Timeflow-Rpc` w `parse_request` (pole `rpc_header: bool`) oraz helper:
```rust
fn request_has_rpc_header(request: &ParsedRequest) -> bool {
    request.rpc_header
}
```
(W `parse_request`: `if line.to_ascii_lowercase().starts_with("x-timeflow-rpc:") { rpc_header = true; }`.)

- [ ] **Step 5: Usuń wstrzykiwanie `__TIMEFLOW_WEBUI_TRUSTED__`**

W `serve_index` (server.rs:89-106) usuń blok `if is_loopback { inject.push_str("<script>window.__TIMEFLOW_WEBUI_TRUSTED__=true;</script>"); }`. Zaktualizuj test `index_injects_trusted_flag_only_for_loopback` → zmień na test, że flaga NIE jest już nigdy wstrzykiwana:
```rust
    #[test]
    fn index_never_injects_trusted_flag() {
        for loopback in [true, false] {
            let html = String::from_utf8(serve_index(loopback)).unwrap();
            assert!(!html.contains("__TIMEFLOW_WEBUI_TRUSTED__"));
        }
    }
```

- [ ] **Step 6: Uruchom testy — PASS**

Run: `cargo test -p timeflow-dashboard webui::server`
Expected: wszystkie zielone.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/webui/server.rs
git commit -m "fix(webui): require token for /rpc always; validate Origin/Host + X-Timeflow-Rpc header (kill loopback CSRF)"
```

---

### Task 4: Bind adresu wg `lan_exposure` + przekazanie do spawn (C1a c.d.)

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs` (`spawn`)
- Modify: `dashboard/src-tauri/src/webui/mod.rs` (`start_if_enabled`, `start_headless`)

- [ ] **Step 1: Zmień `spawn`, by przyjmował adres bind**

W `server.rs` zmień sygnaturę `spawn` (server.rs:134):
```rust
pub fn spawn(app: AppHandle, auth: Arc<AuthState>, port: u16, lan: bool) -> Result<(), String> {
    let host: std::net::IpAddr = if lan {
        std::net::Ipv4Addr::UNSPECIFIED.into() // 0.0.0.0
    } else {
        std::net::Ipv4Addr::LOCALHOST.into()   // 127.0.0.1
    };
    let listener = TcpListener::bind((host, port))
        .map_err(|e| format!("bind {host}:{port} failed: {e}"))?;
    log::info!("[webui] listening on {host}:{port} (lan_exposure={lan})");
    // ... reszta bez zmian ...
```

- [ ] **Step 2: Zaktualizuj wywołania w `mod.rs`**

W `start_if_enabled` (mod.rs:44): `server::spawn(app.clone(), auth(), cfg.port, cfg.lan_exposure)`.
W `start_headless` (mod.rs:62): `server::spawn(app.clone(), auth(), cfg.port, cfg.lan_exposure)`.

- [ ] **Step 3: Zbuduj — kompilacja OK**

Run: `cargo build -p timeflow-dashboard`
Expected: kompiluje się (brak innych wywołań `spawn`).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/webui/server.rs dashboard/src-tauri/src/webui/mod.rs
git commit -m "feat(webui): bind 127.0.0.1 by default, 0.0.0.0 only when lan_exposure enabled"
```

---

### Task 5: `webserver_set_config` przyjmuje `lan_exposure` (C1a — komenda)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/webserver.rs:23`

- [ ] **Step 1: Rozszerz komendę**

Zmień sygnaturę `webserver_set_config` (webserver.rs:23):
```rust
pub async fn webserver_set_config(
    _app: AppHandle,
    enabled: bool,
    port: u16,
    lan_exposure: bool,
) -> Result<(), String> {
```
i przekaż `lan_exposure` do zapisywanego `WebServerConfig { enabled, port, lan_exposure }`. Jeśli komenda restartuje serwer — re-spawn użyje nowej flagi.

- [ ] **Step 2: Zregeneruj most RPC (most musi znać nowy arg)**

Run: `cd dashboard/src-tauri && node scripts/gen_webrpc.cjs`
Expected: `rpc_generated.rs` zawiera `from_arg(args, "lan_exposure")` dla `webserver_set_config`. Zweryfikuj: `grep -n webserver_set_config dashboard/src-tauri/src/webui/rpc_generated.rs`.

- [ ] **Step 3: Zbuduj**

Run: `cargo build -p timeflow-dashboard`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/webserver.rs dashboard/src-tauri/src/webui/rpc_generated.rs
git commit -m "feat(webui): webserver_set_config accepts lan_exposure flag"
```

---

### Task 6: Frontend — zawsze token + nagłówek RPC, usunięcie trusted-flag (C1 frontend)

**Files:**
- Modify: `dashboard/src/lib/webui/http-transport.ts`
- Test: `dashboard/src/lib/webui/http-transport.test.ts` (nowy)

- [ ] **Step 1: Napisz failing test (vitest) na wymóg tokenu i nagłówek**

Utwórz `dashboard/src/lib/webui/http-transport.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpInvoke } from './http-transport';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('httpInvoke', () => {
  it('rejects when no token is stored (no loopback trust)', async () => {
    await expect(httpInvoke('clients_list')).rejects.toThrow();
  });

  it('sends bearer token and X-Timeflow-Rpc header', async () => {
    localStorage.setItem('timeflow.webui.token', 'tok123');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, json: async () => ({ ok: true, data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await httpInvoke('clients_list');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok123');
    expect(init.headers['X-Timeflow-Rpc']).toBe('1');
  });
});
```

- [ ] **Step 2: Uruchom test — FAIL**

Run: `cd dashboard && npx vitest run src/lib/webui/http-transport.test.ts`
Expected: FAIL (obecnie `isTrustedHost()` pozwala bez tokenu; brak nagłówka).

- [ ] **Step 3: Przepisz transport**

W `http-transport.ts` usuń `isTrustedHost` i przepisz `httpInvoke`:
```ts
export async function httpInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const token = getWebToken();
  if (!token) throw new WebUnauthorizedError('no_token');
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timeflow-Rpc': '1',
      Authorization: `Bearer ${token}`,
    },
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
Wyeksportuj `WebUnauthorizedError` jeśli jest używany w `WebLoginGate.tsx`. Usuń import/uses `isTrustedHost` w pozostałych plikach (`grep -rn isTrustedHost dashboard/src`).

- [ ] **Step 4: Uruchom test — PASS**

Run: `cd dashboard && npx vitest run src/lib/webui/http-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Zweryfikuj, że nic nie używa już trusted-flag**

Run: `grep -rn "TIMEFLOW_WEBUI_TRUSTED\|isTrustedHost" dashboard/src`
Expected: brak wyników (poza ewentualnym usuniętym kodem).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/webui/http-transport.ts dashboard/src/lib/webui/http-transport.test.ts
git commit -m "fix(webui): frontend always sends token + X-Timeflow-Rpc; drop loopback trust path"
```

---

### Task 7: UI ustawień LAN + ostrzeżenie + Help (C1a UX, H3 mitygacja)

**Files:**
- Modify: `dashboard/src/lib/tauri/webserver.ts` (typ + wywołanie `webserver_set_config`)
- Modify: `dashboard/src/components/settings/web-server-card-state.ts`, `WebServerCard.tsx`, `dashboard/src/pages/settings/SettingsWebServerTab.tsx`
- Modify: `dashboard/src/components/help/sections/HelpWebServerSection.tsx`
- Modify: `dashboard/src/locales/pl/common.json`, `dashboard/src/locales/en/common.json`

- [ ] **Step 1: Dodaj `lanExposure` do typu i wywołania**

W `lib/tauri/webserver.ts` dodaj `lanExposure: boolean` do typu configu i przekaż do `invoke('webserver_set_config', { enabled, port, lanExposure })` (Tauri konwertuje camelCase→snake_case).

- [ ] **Step 2: Dodaj przełącznik „Dostęp z sieci LAN" w `SettingsWebServerTab.tsx`**

Przełącznik widoczny tylko gdy Web Server `enabled`. Pod przełącznikiem (gdy `lanExposure=true`) pokaż ostrzeżenie (komponent alert/warning, klasa zgodna z design systemem — użyj `cn()`, patrz pamięć o Tailwind):
> „Ruch web UI w sieci LAN jest nieszyfrowany (HTTP). Włączaj tylko w zaufanej sieci. Każde urządzenie musi sparować się kodem."

Stan w `web-server-card-state.ts` rozszerz o `lanExposure`.

- [ ] **Step 3: Zaktualizuj Help (CLAUDE.md §3 — obowiązkowe)**

W `HelpWebServerSection.tsx` opisz: (a) domyślnie web UI działa tylko lokalnie (127.0.0.1); (b) tryb LAN to osobny przełącznik z ostrzeżeniem o braku szyfrowania; (c) każda przeglądarka (także lokalna) wymaga sparowania kodem — nie ma już „zaufanego hosta". Dodaj klucze tłumaczeń do `pl/common.json` i `en/common.json` (spójna terminologia: „Dostęp z sieci LAN").

- [ ] **Step 4: Build + render + react-doctor**

Run:
```bash
cd dashboard && npm run build && npx vitest run
cd .. && npx -y react-doctor@latest . --verbose
```
Expected: build OK, testy zielone, react-doctor **100/100**.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/tauri/webserver.ts dashboard/src/components/settings/ dashboard/src/pages/settings/SettingsWebServerTab.tsx dashboard/src/components/help/sections/HelpWebServerSection.tsx dashboard/src/locales/
git commit -m "feat(webui): LAN-exposure toggle with warning + Help; loopback-only by default"
```

---

### Task 8: Wspólny helper OS keychain w `shared/` (C2 — fundament)

**Files:**
- Create: `shared/src/secret_store.rs`
- Modify: `shared/Cargo.toml`, `shared/src/lib.rs`
- Test: `shared/src/secret_store.rs` (moduł `tests`)

- [ ] **Step 1: Dodaj zależność keyring do shared**

W `shared/Cargo.toml`, w `[dependencies]`:
```toml
keyring = "3"
```
(Crate keyring 3 obsługuje macOS Keychain, Windows Credential Manager, Linux Secret Service.)

- [ ] **Step 2: Napisz helper z testem (TDD)**

Utwórz `shared/src/secret_store.rs`:
```rust
//! Wspólny dostęp do sekretów przez natywny keychain OS (macOS/Windows/Linux).
//! Używany przez dashboard (Tauri) i demon — oba czytają TE SAME wpisy.

const SERVICE: &str = "TIMEFLOW";

/// Pobierz sekret; None gdy brak wpisu.
pub fn get_secret(account: &str) -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, account).ok()?;
    match entry.get_password() {
        Ok(v) => Some(v),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            log::warn!("[secret_store] get '{account}' failed: {e}");
            None
        }
    }
}

/// Zapisz/zastąp sekret. Pusty string = usuń wpis.
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    if value.is_empty() {
        return delete_secret(account);
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

/// Usuń sekret (idempotentnie — brak wpisu nie jest błędem).
pub fn delete_secret(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_set_get_delete() {
        let acct = "test.timeflow.roundtrip";
        set_secret(acct, "sekret-123").expect("set");
        assert_eq!(get_secret(acct).as_deref(), Some("sekret-123"));
        delete_secret(acct).expect("delete");
        assert_eq!(get_secret(acct), None);
    }
}
```
W `shared/src/lib.rs` dodaj: `pub mod secret_store;`. Upewnij się, że `log` jest zależnością shared (jeśli nie — dodaj `log = "0.4"`).

- [ ] **Step 3: Uruchom test**

Run: `cargo test -p timeflow-shared secret_store`
Expected: PASS na macOS (test używa realnego Keychaina — w CI bez keychaina test może wymagać `#[ignore]`; jeśli środowisko CI nie ma keyringu, oznacz test `#[ignore]` z komentarzem i uruchamiaj lokalnie).

- [ ] **Step 4: Commit**

```bash
git add shared/Cargo.toml shared/src/lib.rs shared/src/secret_store.rs Cargo.lock
git commit -m "feat(shared): OS keychain secret_store helper (keyring) shared by dashboard+daemon"
```

---

### Task 9: Migracja `sync_token.dat` → keychain (C2 — dashboard-only)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/secure_store.rs`
- Modify: `dashboard/src-tauri/Cargo.toml` (jeśli używa shared bezpośrednio — już zależy)

**Kontekst:** `sync_token.dat` jest czytany TYLKO przez dashboard (demon go nie czyta — zweryfikowane grepem), więc migracja jest samodzielna.

- [ ] **Step 1: Przepisz `get_secure_token` — keychain z fallbackiem migracyjnym**

W `secure_store.rs` zastąp ciało `get_secure_token`:
```rust
const KEYCHAIN_ACCOUNT: &str = "sync_token";

#[tauri::command]
pub async fn get_secure_token(_app: AppHandle) -> Result<String, String> {
    // 1. Keychain (źródło docelowe).
    if let Some(tok) = timeflow_shared::secret_store::get_secret(KEYCHAIN_ACCOUNT) {
        return Ok(tok.trim().to_string());
    }
    // 2. Migracja z legacy pliku, jeśli istnieje.
    let path = secure_token_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    let raw = fs::read(&path).map_err(|e| format!("Failed to read secure token: {}", e))?;
    let legacy = decode_legacy_token(&raw)?;
    if !legacy.is_empty() {
        let _ = timeflow_shared::secret_store::set_secret(KEYCHAIN_ACCOUNT, &legacy);
        let _ = fs::remove_file(&path); // sprzątnij plaintext po migracji
    }
    Ok(legacy)
}

fn decode_legacy_token(raw: &[u8]) -> Result<String, String> {
    #[cfg(windows)]
    {
        if let Ok(token) = decrypt_token_bytes_windows(raw) {
            return Ok(token.trim().to_string());
        }
    }
    String::from_utf8(raw.to_vec())
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to decode secure token: {}", e))
}
```

- [ ] **Step 2: Przepisz `set_secure_token` — zapis do keychaina**

```rust
#[tauri::command]
pub async fn set_secure_token(_app: AppHandle, token: String) -> Result<(), String> {
    let trimmed = token.trim();
    // Usuń ewentualny legacy plik niezależnie od wartości.
    if let Ok(path) = secure_token_path() {
        let _ = fs::remove_file(&path);
    }
    timeflow_shared::secret_store::set_secret(KEYCHAIN_ACCOUNT, trimmed)
}
```
Kod Windows DPAPI (`encrypt_token_bytes_windows`) pozostaje tylko do odczytu legacy w `decode_legacy_token`; `encrypt_*` można usunąć jeśli nieużywane (sprawdź `cargo build` warningi).

- [ ] **Step 3: Build + istniejące testy**

Run: `cargo build -p timeflow-dashboard && cargo test -p timeflow-dashboard secure_store`
Expected: OK.

- [ ] **Step 4: Test manualny migracji**

1. Stwórz plik `~/Library/Application Support/TimeFlow/sync_token.dat` z treścią `legacy-xyz`.
2. Uruchom appkę, wywołaj funkcję czytającą token (lub odpowiedni ekran).
3. Sprawdź: plik zniknął, a `security find-generic-password -s TIMEFLOW -a sync_token -w` zwraca `legacy-xyz`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/secure_store.rs
git commit -m "fix(secrets): store sync_token in OS keychain; migrate+delete legacy plaintext file"
```

---

### Task 10: Migracja `online_sync` sekretów → keychain (C2 — dashboard + demon)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/online_sync.rs`
- Modify: `src/config.rs` (demon — `load_online_sync_settings`)

**Kontekst:** `online_sync_settings.json` jest czytany przez OBA procesy (demon: `src/config.rs:210`). Sekrety (`auth_token`, `encryption_key`) idą do keychaina; pola niewrażliwe (enabled, server_url, device_id, interwały) zostają w JSON. Oba procesy hydratują sekrety z keychaina.

- [ ] **Step 1: Dashboard — `save_online_sync_settings` zapisuje sekrety do keychaina, JSON bez sekretów**

W `online_sync.rs` zastąp `save_online_sync_settings`:
```rust
const KC_AUTH: &str = "online.auth_token";
const KC_ENC: &str = "online.encryption_key";

#[tauri::command]
pub fn save_online_sync_settings(settings: OnlineSyncSettings) -> Result<(), String> {
    timeflow_shared::secret_store::set_secret(KC_AUTH, &settings.auth_token)?;
    timeflow_shared::secret_store::set_secret(KC_ENC, &settings.encryption_key)?;
    // JSON na dysku BEZ sekretów.
    let on_disk = OnlineSyncSettings {
        auth_token: String::new(),
        encryption_key: String::new(),
        ..settings
    };
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let json = serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Dashboard — `get_online_sync_settings` hydratuje sekrety z keychaina + migracja**

```rust
#[tauri::command]
pub fn get_online_sync_settings() -> Result<OnlineSyncSettings, String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let mut settings = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<OnlineSyncSettings>(&content).map_err(|e| e.to_string())?
    } else {
        OnlineSyncSettings::default()
    };
    // Migracja: jeśli JSON nadal trzyma sekrety, przenieś do keychaina i wyczyść plik.
    let needs_migration =
        !settings.auth_token.is_empty() || !settings.encryption_key.is_empty();
    if needs_migration {
        let migrated = settings.clone();
        // zapis przez save_* wyzeruje sekrety w pliku:
        save_online_sync_settings(migrated)?;
    }
    settings.auth_token =
        timeflow_shared::secret_store::get_secret(KC_AUTH).unwrap_or_default();
    settings.encryption_key =
        timeflow_shared::secret_store::get_secret(KC_ENC).unwrap_or_default();
    Ok(settings)
}
```

- [ ] **Step 3: Demon — hydratacja sekretów w `load_online_sync_settings`**

W `src/config.rs` (demon), po wczytaniu JSON w `load_online_sync_settings` (ok. linii 210-219), dodaj hydratację z keychaina, gdy pola są puste:
```rust
    if settings.auth_token.is_empty() {
        if let Some(v) = timeflow_shared::secret_store::get_secret("online.auth_token") {
            settings.auth_token = v;
        }
    }
    if settings.encryption_key.is_empty() {
        if let Some(v) = timeflow_shared::secret_store::get_secret("online.encryption_key") {
            settings.encryption_key = v;
        }
    }
```
(Demon zależy od `timeflow-shared` — `Cargo.toml:30`.)

- [ ] **Step 4: Build obu crate'ów**

Run: `cargo build -p timeflow-dashboard -p timeflow-demon`
Expected: oba kompilują się.

- [ ] **Step 5: Test manualny end-to-end**

1. Skonfiguruj online sync w UI (token + klucz), zapisz.
2. Sprawdź `online_sync_settings.json` — pola `auth_token`/`encryption_key` PUSTE.
3. `security find-generic-password -s TIMEFLOW -a online.auth_token -w` zwraca token.
4. Uruchom sync z demona — działa (czyta token z keychaina).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/online_sync.rs src/config.rs
git commit -m "fix(secrets): move online-sync auth_token/encryption_key to OS keychain (dashboard+daemon), migrate JSON"
```

---

## Phase 2 — HIGH

### Task 11: `restore_database_from_file` — walidacja ścieżki (H1)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/database.rs:482`
- Modify: `dashboard/src-tauri/src/commands/helpers.rs` (nowy helper walidacji absolutnej ścieżki)
- Test: `dashboard/src-tauri/src/commands/database.rs` lub `helpers.rs` (moduł tests)

**Kontekst:** Komenda jest osiągalna zdalnie przez `/rpc` (`rpc_generated.rs:196`). Po Task 3 wymaga tokenu, ale walidacja ścieżki jest niezbędna (paired device / lokalny atak). Plik restore powinien być plikiem `.db`/`.sqlite` wskazanym świadomie — odrzucamy ścieżki bez rozszerzenia bazy oraz spoza katalogów użytkownika.

- [ ] **Step 1: Dodaj helper `validate_restore_source` w `helpers.rs`**

```rust
/// Waliduje plik źródłowy restore: musi istnieć, być absolutny, bez '..',
/// z rozszerzeniem bazy danych. Zwraca skanonizowaną ścieżkę.
pub(crate) fn validate_restore_source(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err("Restore path must be absolute".into());
    }
    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("Restore path must not contain '..'".into());
        }
    }
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "db" | "sqlite" | "sqlite3" | "bak"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("Restore file must be a .db/.sqlite/.bak database".into());
    }
    let canon = std::fs::canonicalize(p).map_err(|e| format!("Cannot resolve path: {e}"))?;
    Ok(canon)
}
```

- [ ] **Step 2: Napisz failing test**

W module tests `helpers.rs`:
```rust
    #[test]
    fn restore_source_rejects_relative_and_traversal_and_nondb() {
        assert!(validate_restore_source("relative/x.db").is_err());
        assert!(validate_restore_source("/tmp/../etc/passwd").is_err());
        assert!(validate_restore_source("/etc/passwd").is_err()); // brak rozszerzenia db
    }
```

- [ ] **Step 3: Uruchom — FAIL (helper nie istnieje)**

Run: `cargo test -p timeflow-dashboard helpers::`
Expected: błąd kompilacji.

- [ ] **Step 4: Wepnij walidację do `restore_database_from_file`**

W `database.rs:482`, na początku funkcji (przed użyciem `path`):
```rust
    let validated = crate::commands::helpers::validate_restore_source(&path)?;
    let path = validated.to_string_lossy().to_string();
```
Reszta (`src.exists()`, `ATTACH DATABASE ?1`) bez zmian — `ATTACH` już jest parametryzowane (database.rs:302).

- [ ] **Step 5: Uruchom testy — PASS + build**

Run: `cargo test -p timeflow-dashboard helpers:: && cargo build -p timeflow-dashboard`
Expected: PASS, build OK.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/helpers.rs dashboard/src-tauri/src/commands/database.rs
git commit -m "fix(db): validate restore source path (absolute, no traversal, db extension)"
```

---

### Task 12: Guard prywatnego IP w LAN sync (H2 — SSRF)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/lan_sync.rs` — `ping_lan_peer:170`, `run_lan_sync:335`
- Test: `dashboard/src-tauri/src/commands/lan_sync.rs` (moduł tests)

**Kontekst:** Istnieje już helper `is_private_lan_ip(Ipv4Addr)` (lan_sync.rs:209). `ping_lan_peer`/`run_lan_sync` przyjmują dowolne `ip` od użytkownika i są osiągalne zdalnie (`rpc_generated.rs:200`). Bez guardu = SSRF/proxy.

- [ ] **Step 1: Dodaj helper walidacji stringa IP**

W `lan_sync.rs` obok `is_private_lan_ip`:
```rust
/// Odrzuca cele inne niż prywatny LAN IPv4 (anty-SSRF dla komend sync).
fn ensure_private_peer(ip: &str) -> Result<Ipv4Addr, String> {
    let addr: Ipv4Addr = ip
        .parse()
        .map_err(|_| format!("Invalid peer IP: {ip}"))?;
    if !is_private_lan_ip(addr) {
        return Err(format!("Peer IP {ip} is not a private LAN address"));
    }
    Ok(addr)
}
```

- [ ] **Step 2: Napisz failing test**

```rust
    #[test]
    fn ensure_private_peer_blocks_public_and_loopback() {
        assert!(ensure_private_peer("8.8.8.8").is_err());
        assert!(ensure_private_peer("127.0.0.1").is_err());
        assert!(ensure_private_peer("169.254.1.1").is_err());
        assert!(ensure_private_peer("192.168.1.50").is_ok());
        assert!(ensure_private_peer("10.0.0.2").is_ok());
        assert!(ensure_private_peer("not-an-ip").is_err());
    }
```

- [ ] **Step 3: Uruchom — FAIL**

Run: `cargo test -p timeflow-dashboard lan_sync::tests::ensure_private_peer`
Expected: FAIL (funkcja nie istnieje).

- [ ] **Step 4: Wepnij guard na wejściu komend**

W `ping_lan_peer` (lan_sync.rs:170), na początku:
```rust
    ensure_private_peer(&ip)?;
```
W `run_lan_sync` (lan_sync.rs:335), na początku (po `let force = ...`):
```rust
    ensure_private_peer(&peer_ip)?;
```

- [ ] **Step 5: Uruchom testy — PASS + build**

Run: `cargo test -p timeflow-dashboard lan_sync:: && cargo build -p timeflow-dashboard`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/lan_sync.rs
git commit -m "fix(lan): restrict ping/sync peer IP to private LAN ranges (anti-SSRF)"
```

> **H3 (brak TLS w LAN sync) — pozycja jawnie poza zakresem kodu tego planu.** Mitygacja: bind 127.0.0.1 domyślnie (Task 4) + ostrzeżenie w UI/Help (Task 7) + guard IP (Task 12). Pełne TLS peer-to-peer (self-signed + pinning device_id↔cert) to osobny projekt — udokumentuj jako follow-up w `PARITY.md`/issue. Powód wyłączenia: wymaga uzgodnienia modelu zaufania certyfikatów między demonami i zmian protokołu po obu stronach.

---

## Phase 3 — MEDIUM

### Task 13: `freezePrototype: true` w konfiguracji Tauri (M1)

**Files:**
- Modify: `dashboard/src-tauri/tauri.conf.json:26-28`

- [ ] **Step 1: Dodaj flagę do `app.security`**

W `tauri.conf.json`, w obiekcie `security` (obok `csp`):
```json
    "security": {
      "csp": "default-src 'self'; base-uri 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://cfabserver-production.up.railway.app; font-src 'self' data:",
      "freezePrototype": true
    }
```

- [ ] **Step 2: Build i smoke test okna**

Run: `cargo build -p timeflow-dashboard`
Expected: OK. Uruchom appkę — UI ładuje się normalnie (freezePrototype nie psuje React; gdyby jakaś zależność polegała na mutacji prototypów, ujawni się w konsoli — wtedy zgłoś).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/tauri.conf.json
git commit -m "fix(security): enable freezePrototype to block prototype pollution"
```

---

### Task 14: Ograniczenie walk-up ładowania `.env` (M5)

**Files:**
- Modify: `dashboard/src-tauri/src/lib.rs:14-68`

**Kontekst:** Obecnie `.env` (z poświadczeniami SMTP) jest szukany przez wędrówkę 6 katalogów w górę od exe ORAZ od CWD — w spakowanej appce może wciągnąć podrzucony plik. Zostawiamy tylko bezpieczne źródła: katalog danych użytkownika i katalog tuż obok exe.

- [ ] **Step 1: Zastąp logikę ładowania `.env`**

W `lib.rs` zastąp cały blok `let mut loaded = false; ... // 4. Walk up from CWD ...` (linie ~15-68) na:
```rust
    let mut loaded = false;
    // 1. Katalog danych użytkownika (stabilna ścieżka produkcyjna).
    if let Ok(data_dir) = timeflow_shared::timeflow_paths::timeflow_data_dir() {
        let env_path = data_dir.join(".env");
        if env_path.exists() && dotenvy::from_path(&env_path).is_ok() {
            loaded = true;
        }
    }
    // 2. Plik tuż obok pliku wykonywalnego (paczka). BEZ wędrówki w górę —
    //    walk-up po CWD/rodzicach mógł wciągnąć podrzucony .env z poświadczeniami.
    if !loaded {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let env_path = dir.join(".env");
                if env_path.exists() {
                    let _ = dotenvy::from_path(&env_path);
                }
            }
        }
    }
```
(Jeśli dev-flow wymaga `.env` z roota repo — wczytuj go tylko pod `#[cfg(debug_assertions)]`, nie w buildzie release.)

- [ ] **Step 2: Build + dev smoke (SMTP/BugHunter)**

Run: `cargo build -p timeflow-dashboard`
Expected: OK. Zweryfikuj, że BugHunter (SMTP) nadal znajduje `.env` w katalogu danych (produkcyjna ścieżka). W dev: trzymaj `.env` w katalogu danych lub obok exe.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/src/lib.rs
git commit -m "fix(security): load .env only from data dir + next-to-exe (drop unsafe walk-up)"
```

---

### Task 15: macOS — jawny status code signing (M4)

**Files:**
- Modify: `dashboard/src-tauri/tauri.conf.json` (komentarz/konfig) i/lub `build_all_macos.py`

**Kontekst:** `signingIdentity: null`, `entitlements: null` → buildy niesygnowane. Decyzja produktowa: jeśli dystrybucja przez DMG poza App Store, włącz Developer ID signing + notarization (skill `tauri-code-signing`/`tauri-macos-distribution`).

- [ ] **Step 1: Ustal i udokumentuj ścieżkę podpisu**

Jeśli build robi `build_all_macos.py` — sprawdź, czy już podpisuje (`codesign`/`notarytool`). Jeśli tak: dodaj komentarz w `tauri.conf.json`, że signing jest poza Tauri bundlerem (w skrypcie), aby `null` nie wyglądał na przeoczenie. Jeśli nie: skonfiguruj `signingIdentity` na „Developer ID Application: …" (z env/keychain) i dodaj krok notarization w skrypcie.

- [ ] **Step 2: Weryfikacja podpisu artefaktu (jeśli wdrożono)**

Run: `codesign --verify --deep --strict --verbose=2 <ścieżka>.app && spctl -a -vvv <ścieżka>.app`
Expected: `accepted` / `valid on disk`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/tauri.conf.json build_all_macos.py
git commit -m "docs(build): document/enable macOS code signing path"
```

> Jeśli decyzja brzmi „na razie bez podpisu" — udokumentuj to w `PARITY.md` jako świadomy dług, zamiast zostawiać niejasny `null`.

---

## Phase 4 — LOW (defense-in-depth)

### Task 16: `serve_spa` odrzuca `..` (LOW — defense-in-depth)

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs:108-119`
- Test: `server.rs` (tests)

**Kontekst:** `SPA` to `include_dir!` (embedded), więc realny path traversal nie czyta dysku — ale jawne odrzucenie `..` to czysta higiena.

- [ ] **Step 1: Failing test**

```rust
    #[test]
    fn serve_spa_rejects_dotdot() {
        let resp = String::from_utf8(serve_spa("/../secret", false)).unwrap();
        // Fallback do index.html jest OK, ale nie może serwować spoza dist.
        assert!(resp.contains("<")); // dostajemy HTML index, nie 200 z innym plikiem
    }
```

- [ ] **Step 2: Dodaj guard w `serve_spa`**

Na początku `serve_spa`, po `let rel = ...`:
```rust
    if rel.contains("..") {
        return serve_index(is_loopback);
    }
```

- [ ] **Step 3: Test + commit**

Run: `cargo test -p timeflow-dashboard webui::server`
```bash
git add dashboard/src-tauri/src/webui/server.rs
git commit -m "chore(webui): reject '..' in SPA path (defense-in-depth)"
```

---

### Task 17: `VACUUM INTO` przez `quote()` zamiast ręcznego escape (LOW)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/import_data.rs:1299-1300`

**Kontekst:** Wzorzec poprawny jest już w `sync_markers.rs:118-120` (parametr + `quote(?1)`).

- [ ] **Step 1: Zamień ręczny escape na parametryzację**

Zamiast `let escaped = dest_path.to_string_lossy().replace('\'', "''"); conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))?;` użyj:
```rust
    let dest = dest_path.to_string_lossy().to_string();
    let sql: String = conn.query_row("SELECT 'VACUUM INTO ' || quote(?1)", [&dest], |r| r.get(0))?;
    conn.execute_batch(&sql)?;
```
(Analogicznie do `sync_markers.rs`.)

- [ ] **Step 2: Build + test importu**

Run: `cargo test -p timeflow-dashboard import_data:: && cargo build -p timeflow-dashboard`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/src/commands/import_data.rs
git commit -m "chore(db): VACUUM INTO via quote() (consistency, kill format! antipattern)"
```

---

### Task 18: `strip = true` w profilu release (LOW — binary size)

**Files:**
- Modify: `Cargo.toml:82-87` (root, `[profile.release]`)

- [ ] **Step 1: Włącz strip**

W `[profile.release]` zmień `strip = false` na `strip = "symbols"`.

- [ ] **Step 2: Build release i porównaj rozmiar**

Run: `cargo build --release -p timeflow-dashboard`
Expected: binarka mniejsza niż przed zmianą (strip usuwa symbole). Zweryfikuj `ls -la target/release/`.

- [ ] **Step 3: Smoke test (czy aplikacja startuje po strip)**

Uruchom zbudowany artefakt — startuje normalnie. (Strip symboli nie wpływa na `panic = "abort"` ani logikę.)

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml
git commit -m "perf(build): strip symbols in release profile (smaller binaries)"
```

---

## Self-Review

**1. Pokrycie znalezisk audytu:**
- C1 (CSRF/loopback/CORS/bind) → Task 1,2,3,4,5,6,7 ✅
- C2 (plaintext secrets) → Task 8,9,10 ✅
- H1 (restore path traversal) → Task 11 ✅
- H2 (SSRF LAN) → Task 12 ✅
- H3 (brak TLS) → mitygacja Task 4+7+12, pełne TLS jawnie poza zakresem (udokumentowane) ✅
- M1 freezePrototype → Task 13 ✅; M2 nagłówki/CSP → Task 2 ✅; M3 npm audit → Task 0 ✅; M4 signing → Task 15 ✅; M5 .env → Task 14 ✅; M6 cargo audit → Task 0 ✅
- LOW: SPA `..` → Task 16; VACUUM → Task 17; strip → Task 18; „constant-time" pairing code — **świadomie pominięte** (rate-limit 5/60s + TTL 180s czyni timing 6-cyfrowego kodu niepraktycznym; dodawanie crate `subtle` nie jest uzasadnione). ✅

**2. Skan placeholderów:** Każdy krok kodu ma konkretny kod; komendy mają oczekiwany wynik; ścieżki są dokładne. Brak „TODO/itd.".

**3. Spójność typów:** `WebServerConfig { enabled, port, lan_exposure }` używane spójnie w Task 1/4/5/7. `secret_store::{get_secret,set_secret,delete_secret}` (Task 8) używane identycznie w Task 9/10. `ensure_private_peer`/`is_private_lan_ip` (Task 12) zgodne z istniejącym helperem. `validate_restore_source` (Task 11) — jedna definicja, jedno użycie. Konto keychain: `sync_token`, `online.auth_token`, `online.encryption_key` — te same stringi po stronie dashboardu (Task 9/10) i demona (Task 10 step 3).

**Uwaga wykonawcza:** Po Task 5 zawsze regeneruj `rpc_generated.rs` (`node scripts/gen_webrpc.cjs`) gdy zmieniasz sygnaturę dowolnej komendy — most musi pasować. Po wszystkich zmianach frontu: `npx -y react-doctor@latest . --verbose` = 100/100 (CLAUDE.md).
