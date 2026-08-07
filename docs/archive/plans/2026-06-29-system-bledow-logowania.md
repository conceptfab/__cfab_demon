# System obsługi błędów i logowania — plan naprawczy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować spójny i wydajny, w pełni lokalny (bez telemetrii zewnętrznej) system obsługi błędów i logowania w TIMEFLOW.

**Architecture:** Trzy warstwy — (1) jeden typ błędu `CommandError` jako standard zwrotny komend Tauri → frontend zawsze dostaje `{code,message}`; (2) jeden strumień logów: logi frontu forwardowane do pliku i widoczne w istniejącej przeglądarce logów, spójne poziomy/rotacja; (3) centralna obsługa na froncie: globalny handler + `usePageError` jako jedyny kanał „błąd usera → log + toast".

**Tech Stack:** Rust + Tauri 2 (`thiserror`, `tauri-plugin-log`, `anyhow` w daemonie), React + TypeScript (Vite, Vitest, i18next).

---

## Korekta audytu (ustalenia z fazy planowania)

Wstępny audyt zawyżył kilka findingów, zliczając **kod testowy jako produkcyjny**. Zweryfikowano przed napisaniem planu:

- ❌ **„Krytyczny unwrap() w webui/server.rs crashuje wątek HTTP"** — NIEPRAWDA. Wszystkie `unwrap()/expect()` w [server.rs](../../../dashboard/src-tauri/src/webui/server.rs) są za markerem `#[cfg(test)]` (linia 373). Zero w kodzie produkcyjnym.
- ❌ **„Debug println! w produkcji (import_data.rs:1966-1986)"** — NIEPRAWDA. Są za `#[cfg(test)]` (linia 1168) — to kod testowy.
- ❌ **„190 unwrap() w backendzie dashboard"** — zawyżone. Produkcyjnie (poza testami): **13** w [webui/auth.rs](../../../dashboard/src-tauri/src/webui/auth.rs) (wszystkie to idiomatyczny `mutex.lock().expect("...poisoned")`), 2 w `db/pool.rs`, 1 w `lib.rs`, 1 w `commands/sessions/split.rs`, 1 w `bughunter.rs` (literał MIME — bezpieczny).

**Co już istnieje (nie budować od zera):**
- Podsystem logów: [commands/log_management.rs](../../../dashboard/src-tauri/src/commands/log_management.rs) — `get/save_log_settings`, `get_log_files_info`, `read_log_file`, `clear_log_file`, `open_logs_folder`. Klucze: `daemon`, `lan_sync`, `online_sync`, `dashboard`.
- Front-API logów: [src/lib/tauri/log-management.ts](../../../dashboard/src/lib/tauri/log-management.ts), UI w [DevSettingsCard.tsx](../../../dashboard/src/components/settings/DevSettingsCard.tsx), dokumentacja w [HelpSettingsSection.tsx](../../../dashboard/src/components/help/sections/HelpSettingsSection.tsx).
- Typ błędu: `CommandError` z formatem wire `{code,message}` — [commands/error.rs](../../../dashboard/src-tauri/src/commands/error.rs).
- Front: `getErrorMessage`, `logTauriError` ([lib/utils.ts:142-164](../../../dashboard/src/lib/utils.ts#L142-L164)), `usePageError` ([hooks/usePageError.ts](../../../dashboard/src/hooks/usePageError.ts)), toast z a11y, Error Boundary ([App.tsx:138-184](../../../dashboard/src/App.tsx#L138-L184)), wrapper `invoke` ([lib/tauri/core.ts](../../../dashboard/src/lib/tauri/core.ts)).

**Realna skala rozjazdu typów:** ~290 sygnatur `Result<_, String>` vs 28 `Result<_, CommandError>` w komendach.

---

## Kolejność i zasady

Fazy uporządkowane: niskie ryzyko + wysoki zysk najpierw, breaking changes (typy) na końcu. Każda faza = osobny commit. Przed zamknięciem każdej fazy:

```bash
cd dashboard && npm run lint && npm run test
cd dashboard/src-tauri && cargo test
```

Help.tsx aktualizujemy tylko gdy zmiana jest widoczna dla użytkownika (Faza 2 i 5).

---

## Faza 1 — Bezpieczeństwo (panic hook w dashboardzie)

Zakres zredukowany po korekcie audytu. Jedyna realna luka: daemon ma panic hook, dashboard nie. Produkcyjne `expect("...poisoned")` w auth.rs to idiomatyczny Rust — zostawiamy (panik tylko przy już-zatrutym muteksie).

### Task 1: Panic hook w dashboardzie logujący do pliku

**Files:**
- Modify: `dashboard/src-tauri/src/lib.rs` (w `run()`, po inicjalizacji `tauri_plugin_log`, ok. linii 92-95)

- [ ] **Step 1: Dodać panic hook tuż po `log::info!("TIMEFLOW Dashboard starting ...")`**

```rust
// Po zainicjowaniu loggera: każdy panic trafia do pliku logu dashboardu,
// nie tylko do stderr (analogicznie do daemona, main.rs:254-270).
std::panic::set_hook(Box::new(|info| {
    let location = info
        .location()
        .map(|l| format!("{}:{}", l.file(), l.line()))
        .unwrap_or_else(|| "<unknown>".into());
    let msg = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "<non-string panic payload>".into());
    log::error!("PANIC at {}: {}", location, msg);
}));
```

- [ ] **Step 2: Zbudować, by potwierdzić kompilację**

Run: `cd dashboard/src-tauri && cargo build`
Expected: kompiluje się bez błędów.

- [ ] **Step 3: Manualna weryfikacja (opcjonalnie)** — tymczasowo dodać `panic!("test")` w dowolnej komendzie, uruchomić, sprawdzić wpis `PANIC at ...` w `%APPDATA%/TimeFlow/logs/dashboard.log`, następnie usunąć.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/lib.rs
git commit -m "feat: dodaj panic hook w dashboardzie logujący do pliku"
```

---

## Faza 2 — Forwarding logów frontu do pliku (przeglądarka już istnieje)

Logi frontu lecą dziś tylko do konsoli przeglądarki. Cel: zapisywać warn/error frontu do `frontend.log`, widocznego w istniejącej przeglądarce logów (DevSettingsCard).

### Task 2: Komenda `append_frontend_log` + klucz `frontend`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/log_management.rs` (lista `LOG_FILES`, nowa komenda)
- Modify: `dashboard/src-tauri/src/lib.rs` (rejestracja komendy w `generate_handler!`)

- [ ] **Step 1: Dodać klucz `frontend` do `LOG_FILES` (log_management.rs:4-9)**

```rust
const LOG_FILES: &[(&str, &str)] = &[
    ("daemon", "daemon.log"),
    ("lan_sync", "lan_sync.log"),
    ("online_sync", "online_sync.log"),
    ("dashboard", "dashboard.log"),
    ("frontend", "frontend.log"),
];
```

- [ ] **Step 2: Dodać komendę dopisującą linię do `frontend.log` (z timestampem, jak daemon)**

```rust
/// Dopisuje pojedynczą linię logu z frontendu do logs/frontend.log.
/// Poziom ograniczony do warn/error po stronie wywołującej (logger.ts).
#[tauri::command]
pub async fn append_frontend_log(level: String, message: String) -> Result<(), String> {
    use std::io::Write;
    let path = logs_dir()?.join("frontend.log");
    let lvl = match level.to_uppercase().as_str() {
        "ERROR" | "WARN" | "INFO" | "DEBUG" => level.to_uppercase(),
        _ => "INFO".to_string(),
    };
    let line = format!(
        "{} [{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        lvl,
        message.replace('\n', " ")
    );
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open frontend.log: {}", e))?;
    f.write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write frontend.log: {}", e))?;
    Ok(())
}
```

> Uwaga: jeśli `chrono` nie jest jeszcze zależnością `dashboard/src-tauri`, użyć już obecnego mechanizmu czasu (sprawdzić `Cargo.toml`); daemon formatuje czas w `main.rs` — można powielić jego helper zamiast dodawać zależność.

- [ ] **Step 3: Zarejestrować `append_frontend_log` w `tauri::generate_handler![...]` w lib.rs** (dopisać do listy obok pozostałych komend `log_management::*`).

- [ ] **Step 4: Zbudować backend**

Run: `cd dashboard/src-tauri && cargo build`
Expected: kompiluje się.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/log_management.rs dashboard/src-tauri/src/lib.rs
git commit -m "feat: komenda append_frontend_log + klucz frontend w przeglądarce logów"
```

### Task 3: Front forwarduje warn/error do pliku

**Files:**
- Modify: `dashboard/src/lib/tauri/log-management.ts` (dodać wrapper API)
- Modify: `dashboard/src/lib/utils.ts:158-164` (`logTauriError` forwarduje błąd)
- Modify: `dashboard/src/lib/logger.ts` (warn/error forwardują)
- Test: `dashboard/src/lib/utils.test.ts`

- [ ] **Step 1: Dodać wrapper w log-management.ts**

```typescript
import { invoke } from '@/lib/tauri/core';

/** Forward pojedynczej linii logu frontu do pliku frontend.log (best-effort). */
export function appendFrontendLog(level: string, message: string): void {
  // Nigdy nie rzucamy — logowanie nie może wywrócić aplikacji.
  void invoke('append_frontend_log', { level, message }).catch(() => {});
}
```

- [ ] **Step 2: `logTauriError` forwarduje do pliku (utils.ts:158-160)**

```typescript
export function logTauriError(action: string, error: unknown): void {
  const msg = `Failed to ${action}: ${getErrorMessage(error, String(error))}`;
  console.error(`[TIMEFLOW] ${msg}`, error);
  // Best-effort forward do pliku (dynamiczny import — utils.ts nie zależy od warstwy tauri).
  import('@/lib/tauri/log-management')
    .then((m) => m.appendFrontendLog('error', msg))
    .catch(() => {});
}
```

- [ ] **Step 3: `logger.warn`/`logger.error` forwardują (logger.ts:14-15)**

```typescript
function forward(level: string, args: unknown[]) {
  void import('@/lib/tauri/log-management')
    .then((m) => m.appendFrontendLog(level, args.map(String).join(' ')))
    .catch(() => {});
}

export const logger = {
  debug: isDebug ? console.debug.bind(console) : () => {},
  info: isDebug ? console.info.bind(console) : () => {},
  log: isDebug ? console.log.bind(console) : () => {},
  warn: (...a: unknown[]) => { console.warn(...a); forward('warn', a); },
  error: (...a: unknown[]) => { console.error(...a); forward('error', a); },
};
```

- [ ] **Step 4: Test — `logTauriError` woła forward**

```typescript
import { vi, it, expect } from 'vitest';

it('logTauriError forwarduje błąd do pliku', async () => {
  const spy = vi.fn();
  vi.doMock('@/lib/tauri/log-management', () => ({ appendFrontendLog: spy }));
  const { logTauriError } = await import('@/lib/utils');
  logTauriError('save settings', new Error('boom'));
  await Promise.resolve();
  expect(spy).toHaveBeenCalledWith('error', expect.stringContaining('save settings'));
});
```

- [ ] **Step 5: Uruchomić testy**

Run: `cd dashboard && npm run test -- utils`
Expected: PASS.

- [ ] **Step 6: Manualna weryfikacja** — wywołać akcję kończącą się błędem, otworzyć przeglądarkę logów (DevSettingsCard), wybrać klucz `frontend`, potwierdzić wpis.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/tauri/log-management.ts dashboard/src/lib/utils.ts dashboard/src/lib/logger.ts dashboard/src/lib/utils.test.ts
git commit -m "feat: forward logów warn/error frontu do pliku frontend.log"
```

### Task 4: Help — dodać klucz `frontend` do sekcji logów

**Files:**
- Modify: `dashboard/src/components/help/sections/HelpSettingsSection.tsx`
- Modify: `dashboard/src/locales/{pl,en}/common.json` (jeśli teksty z i18n)

- [ ] **Step 1:** W sekcji o logach dopisać, że dostępny jest też log `frontend` (błędy interfejsu), krótko: „co to", „kiedy użyć" (diagnostyka problemów UI).
- [ ] **Step 2: Lint** — `cd dashboard && npm run lint` (obejmuje sprawdzenie i18n).
- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/help dashboard/src/locales
git commit -m "docs(help): opis logu frontend w sekcji ustawień"
```

---

## Faza 3 — Spójność typów błędów (String → CommandError)

Migracja ~290 sygnatur `Result<_, String>` na `CommandError`, modułami. `CommandError` ma już `From<String>`/`From<&str>` oraz `From<CommandError> for String` (dla `rpc_generated.rs`) — migracja jest kompatybilna wstecz formatu wire dla loopbacka. Kolejność modułów: od najmniejszych/najmniej ryzykownych do największych.

**Rekomendowana kolejność:** `webserver.rs` (4) → `online_sync.rs` (7) → `estimates.rs` (7) → `pm.rs` (13) → `sessions/*` → `projects.rs` (36, ostatni).

### Task 5 (wzorzec, powtarzany per moduł): migracja jednego modułu

Poniższy przepis stosuje się do KAŻDEGO modułu. Przykład na `webserver.rs`.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/<moduł>.rs`
- Modify (po module): `dashboard/src-tauri/src/webui/rpc_generated.rs` (regeneracja)

- [ ] **Step 1: Zaimportować typ na górze pliku**

```rust
use crate::commands::error::CommandError;
```

- [ ] **Step 2: Zamienić sygnatury** — każde `-> Result<T, String>` na `-> Result<T, CommandError>`. Wewnątrz funkcji:
  - `return Err("msg".to_string())` → `return Err(CommandError::Other("msg".into()))` lub trafniejszy wariant (`Validation`/`NotFound`/`Conflict`).
  - `.map_err(|e| e.to_string())?` → `.map_err(|e| CommandError::Other(e.to_string()))?` (lub usunąć `map_err`, jeśli błąd ma `From` do `CommandError` — np. `std::io::Error`, `rusqlite::Error`).

Przykład transformacji jednej komendy:

```rust
// PRZED
#[tauri::command]
pub async fn webserver_start(port: u16) -> Result<(), String> {
    if port < 1024 {
        return Err("port musi być >= 1024".to_string());
    }
    do_start(port).map_err(|e| e.to_string())
}

// PO
#[tauri::command]
pub async fn webserver_start(port: u16) -> Result<(), CommandError> {
    if port < 1024 {
        return Err(CommandError::Validation("port musi być >= 1024".into()));
    }
    do_start(port).map_err(|e| CommandError::Other(e.to_string()))
}
```

- [ ] **Step 3: Zbudować moduł** — `cd dashboard/src-tauri && cargo build`. Naprawić błędy typów aż do czysta.

- [ ] **Step 4: Regeneracja RPC** — `node scripts/gen_webrpc.cjs` (z katalogu, w którym skrypt działa; sprawdzić `package.json`/README skryptu). Potwierdzić, że `rpc_generated.rs` nadal kompiluje (`From<CommandError> for String` to obsługuje).

- [ ] **Step 5: Testy backendu** — `cargo test`. Expected: PASS.

- [ ] **Step 6: Commit (per moduł)**

```bash
git add dashboard/src-tauri/src/commands/<moduł>.rs dashboard/src-tauri/src/webui/rpc_generated.rs
git commit -m "refactor(errors): migracja <moduł> na CommandError"
```

- [ ] **Step 7: Powtórzyć Task 5 dla kolejnego modułu** wg rekomendowanej kolejności, aż `grep -rnE 'Result<[^>]*, *String>' dashboard/src-tauri/src/commands` zwróci tylko przypadki świadomie pozostawione (jeśli jakieś).

> Po zakończeniu fazy: front dostaje `{code,message}` ze wszystkich komend — `getErrorMessage` (utils.ts:142) już to obsługuje, więc UI nie wymaga zmian.

---

## Faza 4 — Centralizacja obsługi błędów na froncie

### Task 6: Globalny `unhandledrejection` + log z Error Boundary do pliku

**Files:**
- Modify: `dashboard/src/main.tsx`
- Modify: `dashboard/src/App.tsx:149` (Error Boundary — forward do pliku)

- [ ] **Step 1: Globalny listener w main.tsx (przed renderem)**

```typescript
import { logger } from '@/lib/logger';

window.addEventListener('unhandledrejection', (e) => {
  logger.error('[unhandledrejection]', e.reason);
});
window.addEventListener('error', (e) => {
  logger.error('[window.error]', e.message);
});
```

- [ ] **Step 2: Error Boundary forwarduje** — w `componentDidCatch`/`getDerivedStateFromError` (App.tsx:144-149) zamienić surowe `console.error` na `logger.error('[ErrorBoundary]', error, info)` (forward do pliku z Fazy 2).

- [ ] **Step 3: Lint + test** — `cd dashboard && npm run lint && npm run test`.
- [ ] **Step 4: Commit**

```bash
git add dashboard/src/main.tsx dashboard/src/App.tsx
git commit -m "feat: globalny handler unhandledrejection + log Error Boundary do pliku"
```

### Task 7: Eliminacja bezpośrednich `console.error` (23 miejsca)

**Files (główne):** `dashboard/src/components/settings/WebServerCard.tsx`, `dashboard/src/hooks/useProjectPageController.ts`, `dashboard/src/hooks/useTimeAnalysisData.ts`, `dashboard/src/components/layout/BugHunter.tsx` i pozostałe z grep.

- [ ] **Step 1: Znaleźć wszystkie** — `cd dashboard && grep -rnE 'console\.(error|warn)' src --include=*.ts --include=*.tsx | grep -v '\.test\.'`
- [ ] **Step 2: Zamienić** każde `console.error(...)` na `logTauriError('<opis akcji>', err)` (błędy operacji) lub `logger.error(...)` (diagnostyka). Dla błędów inicjowanych przez usera w kontrolerach — użyć `usePageError` (Task 8).
- [ ] **Step 3: Lint + test** — `cd dashboard && npm run lint && npm run test`.
- [ ] **Step 4: Commit**

```bash
git add -A dashboard/src
git commit -m "refactor(errors): zastąp bezpośrednie console.error przez logTauriError/logger"
```

### Task 8: Adopcja `usePageError` + przegląd cichych catchy

**Files:** kontrolery w `dashboard/src/hooks/*Controller.ts` (20+), pliki z pustym `.catch(()=>{})`.

- [ ] **Step 1: Kontrolery** — w miejscach, które ręcznie wołają `logTauriError(...)` + `showError(...)`, zastąpić wywołaniem `reportError` z `usePageError()`.
- [ ] **Step 2: Przegląd 26 cichych catchy** — `grep -rnE 'catch *\(\) *\{\s*\}|\.catch\(\(\) *=> *\{\}\)' src`:
  - Zostawić udokumentowane, świadome (i18n.ts:29,31; daemon-unreachable w DaemonSyncOverlay.tsx:68; localStorage fallback).
  - Naprawić gubiące błędy: `useJobPool.ts:185`, ciche catchy w wykresach (`WeeklyView.impl.tsx`, `MonthlyView.impl.tsx`), `time-analysis/types.ts:227` — dodać co najmniej `logger.warn(...)`.
- [ ] **Step 3: Lint + test** — `cd dashboard && npm run lint && npm run test`.
- [ ] **Step 4: Commit**

```bash
git add -A dashboard/src
git commit -m "refactor(errors): adopcja usePageError + logowanie wcześniej cichych błędów"
```

---

## Faza 5 — Dokumentacja (Help.tsx)

### Task 9: Sekcja troubleshooting / odzyskiwania

**Files:**
- Modify: `dashboard/src/pages/Help.tsx` (lub odpowiednia podsekcja w `components/help/sections/`)
- Modify: `dashboard/src/locales/{pl,en}/common.json`

- [ ] **Step 1: Dodać krótką sekcję** „Diagnostyka i błędy": gdzie są logi (daemon/dashboard/frontend), jak je podejrzeć/wyeksportować (DevSettingsCard), co zrobić przy braku połączenia z daemonem. Format zgodny z resztą Help (co/kiedy/ograniczenia).
- [ ] **Step 2: Lint** — `cd dashboard && npm run lint`.
- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Help.tsx dashboard/src/components/help dashboard/src/locales
git commit -m "docs(help): sekcja diagnostyki i obsługi błędów"
```

---

## Weryfikacja końcowa

- [ ] `cd dashboard && npm run lint && npm run test` — zielone.
- [ ] `cd dashboard/src-tauri && cargo test` — zielone.
- [ ] `npx -y react-doctor@latest . --verbose` z roota repo → **100/100**.
- [ ] `grep -rnE 'Result<[^>]*, *String>' dashboard/src-tauri/src/commands` → tylko świadomie pozostawione przypadki.
- [ ] Manualnie: wymuszony błąd komendy → toast + wpis w `frontend.log` widoczny w przeglądarce logów.
- [ ] PARITY.md / Help.tsx spójne z wprowadzonymi zmianami widocznymi dla usera.
