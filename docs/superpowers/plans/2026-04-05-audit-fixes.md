# TIMEFLOW Audit Fixes — Plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naprawić 7 problemów KRYTYCZNYCH i 15 najważniejszych problemów WAŻNYCH z raportu audytu kodu.

**Architecture:** Zmiany podzielone na niezależne taski per-subsystem. Każdy task produkuje kompilujący się kod i może być commitowany osobno. Kolejność: najpierw CRIT (bezpieczeństwo/dane), potem WARN (stabilność/UX).

**Tech Stack:** Rust (daemon + Tauri commands), TypeScript/React (dashboard), SQLite, i18n (i18next)

---

## Task 1: CRIT-5 — Brakujący klucz tłumaczenia `sync_progress.frozen_notice`

**Files:**
- Modify: `dashboard/src/locales/en/common.json:1825` (przed zamknięciem sekcji `sync_progress`)
- Modify: `dashboard/src/locales/pl/common.json:1825` (analogicznie)

- [ ] **Step 1: Dodaj klucz EN**

W `dashboard/src/locales/en/common.json`, w sekcji `"sync_progress"`, przed zamykającym `}`, dodaj:

```json
    "not_needed": "Synchronization not needed — databases identical",
    "frozen_notice": "Session recording is paused. Please do not close the application."
```

(Zamień istniejącą linię `"not_needed": ...` żeby dodać przecinek i nowy klucz.)

- [ ] **Step 2: Dodaj klucz PL**

W `dashboard/src/locales/pl/common.json`, analogicznie:

```json
    "not_needed": "Synchronizacja nie jest potrzebna — bazy danych są identyczne",
    "frozen_notice": "Rejestrowanie wpisów jest wstrzymane. Proszę nie zamykać aplikacji."
```

- [ ] **Step 3: Weryfikacja**

Run: `cd dashboard && npx tsc --noEmit`
Expected: brak błędów. Klucz `sync_progress.frozen_notice` będzie teraz rozwiązywany z JSON zamiast fallbacku.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "fix(i18n): add missing sync_progress.frozen_notice translation key"
```

---

## Task 2: CRIT-6 — Brak transakcji w `update_database_settings`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/database.rs:147-183`
- Modify: `dashboard/src-tauri/src/db.rs` (dodaj `set_system_setting_conn`)

- [ ] **Step 1: Dodaj `set_system_setting_conn` w db.rs**

W `dashboard/src-tauri/src/db.rs`, pod istniejącą funkcją `set_system_setting` (~linia 330), dodaj wariant operujący na `&Connection`:

```rust
pub fn set_system_setting_conn(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
        [key, value],
    )
    .map_err(|e| {
        log::error!("DB Error: failed to set {}: {}", key, e);
        e.to_string()
    })?;
    Ok(())
}
```

- [ ] **Step 2: Opakuj `update_database_settings` w transakcję**

Zamień body `run_app_blocking` w `database.rs:161-180` na:

```rust
    run_app_blocking(app, move |app| {
        let conn = db::get_connection(&app)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

        db::set_system_setting_conn(&tx, "vacuum_on_startup", &vacuum_on_startup.to_string())?;
        db::set_system_setting_conn(&tx, "backup_enabled", &backup_enabled.to_string())?;
        db::set_system_setting_conn(&tx, "backup_path", &backup_path)?;
        db::set_system_setting_conn(&tx, "backup_interval_days", &backup_interval_days.to_string())?;
        db::set_system_setting_conn(&tx, "auto_optimize_enabled", &auto_optimize_enabled.to_string())?;
        db::set_system_setting_conn(&tx, "auto_optimize_interval_hours", &normalized_auto_optimize_interval_hours.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
```

Uwaga: `unchecked_transaction()` jest już stosowany w projekcie (np. training.rs). `Transaction` dereferencjonuje do `Connection`, więc `set_system_setting_conn` zadziała.

- [ ] **Step 3: Build**

Run: `cd dashboard/src-tauri && cargo check`
Expected: kompilacja bez błędów.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/database.rs dashboard/src-tauri/src/db.rs
git commit -m "fix(db): wrap update_database_settings in transaction to prevent partial updates"
```

---

## Task 3: CRIT-7 — Weryfikacja importu `triggerDaemonOnlineSync`

**Files:**
- Verify: `dashboard/src/components/sync/BackgroundServices.tsx`

- [ ] **Step 1: Sprawdź import**

Grep `triggerDaemonOnlineSync` w BackgroundServices.tsx — agent eksploracyjny potwierdził, że import ISTNIEJE z `@/lib/tauri/online-sync`. **Ten CRIT jest fałszywie pozytywny.**

- [ ] **Step 2: Oznacz jako zweryfikowany, brak zmian**

Brak akcji — import jest na miejscu. Commit nie wymagany.

---

## Task 4: CRIT-1 — Bezpieczniejszy restore bazy danych

**Files:**
- Modify: `src/sync_common.rs:86-125`

- [ ] **Step 1: Dodaj wyraźne ostrzeżenie i sprawdzenie**

Zmień funkcję `restore_database_backup`, aby po restore wymusić ponowne otwarcie połączenia przez callera. Dodaj `log::warn` oraz zwracaj specjalny typ:

```rust
/// Restore result indicating caller MUST re-open the database connection.
pub struct RestoreResult {
    pub restored_from: std::path::PathBuf,
}

pub fn restore_database_backup(conn: &rusqlite::Connection) -> Result<RestoreResult, String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups");

    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("Cannot read backup dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("timeflow_sync_backup_"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();

    let latest = backups.last().ok_or("No backup files found")?.clone();
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;

    // Checkpoint WAL to flush all pages to main db file
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;
    conn.cache_flush()
        .map_err(|e| format!("Cache flush failed: {}", e))?;

    // Close the connection's internal statement cache
    conn.execute_batch("PRAGMA optimize;").ok();

    std::fs::copy(&latest, &db_path)
        .map_err(|e| format!("File copy restore failed: {}", e))?;

    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");
    let _ = std::fs::remove_file(&wal_path);
    let _ = std::fs::remove_file(&shm_path);

    log::warn!("Database restored from backup: {:?}. Caller MUST re-open connection.", latest);
    Ok(RestoreResult { restored_from: latest })
}
```

- [ ] **Step 2: Zaktualizuj call-sites**

Wyszukaj wszystkie wywołania `restore_database_backup` i upewnij się, że po restore połączenie jest ponownie otwierane. Sprawdź `lan_server.rs` i `online_sync.rs` — w obu przypadkach po restore sync się kończy i połączenie jest naturalnie zamykane (thread exit). Jeśli tak, wystarczy zmienić typ zwracany.

- [ ] **Step 3: Build**

Run: `cargo check`
Expected: kompilacja OK (ewentualnie poprawki w call-sites dot. nowego typu zwracanego).

- [ ] **Step 4: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(sync): improve restore_database_backup safety with RestoreResult type"
```

---

## Task 5: WARN-3 — Tombstone merge: dodaj obsługę sesji

**Files:**
- Modify: `src/sync_common.rs:508-526`

- [ ] **Step 1: Dodaj branche dla sessions i manual_sessions**

W bloku `match table_name` (linia 509-512), dodaj:

```rust
match table_name {
    "projects" => { let _ = tx.execute("DELETE FROM projects WHERE name = ?1", [sync_key]); }
    "applications" => { let _ = tx.execute("DELETE FROM applications WHERE executable_name = ?1", [sync_key]); }
    "sessions" => { let _ = tx.execute("DELETE FROM sessions WHERE id = ?1", [sync_key]); }
    "manual_sessions" => { let _ = tx.execute("DELETE FROM manual_sessions WHERE id = ?1", [sync_key]); }
    _ => { log::warn!("Tombstone for unknown table: {}", table_name); }
}
```

- [ ] **Step 2: Build i test**

Run: `cargo check`
Expected: kompilacja OK.

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(sync): handle session tombstones in merge to propagate deletions"
```

---

## Task 6: WARN-1 — `sync_in_progress` nie resetowany po panic

**Files:**
- Modify: `src/main.rs:99-121`

- [ ] **Step 1: Dodaj RAII guard**

Na początku pliku `src/main.rs` (lub w osobnym module, np. inline), dodaj:

```rust
struct SyncGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
        log::info!("SyncGuard dropped — sync_in_progress reset to false");
    }
}
```

- [ ] **Step 2: Użyj guarda w spawnie**

Zamień blok w `main.rs:105-120`:

```rust
if sync_state_clone.sync_in_progress.compare_exchange(
    false, true,
    std::sync::atomic::Ordering::SeqCst,
    std::sync::atomic::Ordering::Relaxed,
).is_ok() {
    let _guard = SyncGuard(sync_state_clone.sync_in_progress.clone());
    log::info!("Auto-starting online sync on startup (mode: {})", online_settings.sync_mode);
    match online_settings.sync_mode.as_str() {
        "async" if !online_settings.group_id.is_empty() => {
            let group_id = online_settings.group_id.clone();
            online_sync::run_async_delta_sync(online_settings, sync_state_clone, &group_id);
        }
        _ => {
            online_sync::run_online_sync(online_settings, sync_state_clone, stop_signal_clone);
        }
    }
    // _guard drops here, resets flag
}
```

Uwaga: Trzeba sprawdzić, czy `run_online_sync` / `run_async_delta_sync` same resetują flagę. Jeśli tak — guard zrobi podwójny reset (bezpieczny, bo to `store(false)`). Jeśli nie — guard naprawia problem.

- [ ] **Step 3: Build**

Run: `cargo check`
Expected: kompilacja OK.

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "fix(daemon): add SyncGuard RAII to reset sync_in_progress on panic"
```

---

## Task 7: WARN-2 — Timestamp normalizacja ignoruje timezone suffix

**Files:**
- Modify: `src/sync_common.rs:150-157`

- [ ] **Step 1: Rozszerz `normalize_ts` o parsowanie timezone**

Zamień funkcję na:

```rust
fn normalize_ts(ts: &str) -> String {
    // Try timezone-aware formats first (convert to UTC-like string for comparison)
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    // Try with explicit offset
    if let Ok(dt) = chrono::DateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%z") {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    // Fallback: naive (no timezone) — assume local/same timezone
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| ts.to_string())
}
```

- [ ] **Step 2: Build**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(sync): normalize timestamps to UTC when timezone info available"
```

---

## Task 8: WARN-6 — Race condition `isLoadingRef` w `useSessionsData`

**Files:**
- Modify: `dashboard/src/hooks/useSessionsData.ts:67-88`

- [ ] **Step 1: Przeczytaj aktualny kod**

Przeczytaj `useSessionsData.ts` linie 60-95 żeby zobaczyć dokładny pattern.

- [ ] **Step 2: Dodaj reset w finally niezależnie od cancelled**

Zmień `.finally()` callback tak, aby ZAWSZE resetował `isLoadingRef`:

```typescript
.finally(() => {
  isLoadingRef.current = false;
  if (!cancelled) {
    // ... existing logic
  }
});
```

Kluczowe: `isLoadingRef.current = false` PRZED sprawdzeniem `cancelled`.

- [ ] **Step 3: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useSessionsData.ts
git commit -m "fix(sessions): always reset isLoadingRef on fetch cancel to prevent deadlock"
```

---

## Task 9: WARN-9 — Hardcoded polskie statusy PM

**Files:**
- Modify: `dashboard/src/pages/PM.tsx:89-105`
- Modify: `dashboard/src/locales/en/common.json` (sekcja `pm`)
- Modify: `dashboard/src/locales/pl/common.json` (sekcja `pm`)

- [ ] **Step 1: Dodaj klucze tłumaczeń statusów**

W `en/common.json`, w sekcji `"pm"`, dodaj:

```json
"status_active": "Active",
"status_frozen": "Frozen",
"status_excluded": "Excluded",
"status_archived": "Archived"
```

W `pl/common.json`:

```json
"status_active": "Aktywny",
"status_frozen": "Zamrożony",
"status_excluded": "Wykluczony",
"status_archived": "Archiwalny"
```

- [ ] **Step 2: Zmień `buildTfMatch` w PM.tsx**

Funkcja `buildTfMatch` musi przyjmować `t` i zwracać klucze statusów zamiast hardcoded stringów. Zmień typ `PmTfMatch.status` na enum-key:

```typescript
type PmStatus = 'archived' | 'excluded' | 'frozen' | 'active';

function buildTfMatch(
  match: ProjectWithStats | null,
  estimates: Map<number, EstimateProjectRow>,
  hotIds: Set<number>,
): PmTfMatch {
  if (!match) return { status: 'archived' as PmStatus, totalSeconds: 0, estimatedValue: 0, hasRate: false, isHot: false, tfProjectId: null };
  const status: PmStatus = match.excluded_at ? 'excluded' : match.frozen_at ? 'frozen' : 'active';
  const est = estimates.get(match.id);
  return {
    status,
    totalSeconds: est?.seconds || match.total_seconds || 0,
    estimatedValue: est?.estimated_value || 0,
    hasRate: (est?.effective_hourly_rate || 0) > 0,
    isHot: hotIds.has(match.id),
    tfProjectId: match.id,
  };
}
```

- [ ] **Step 3: Zaktualizuj rendering statusu**

Wszędzie gdzie `status` jest wyświetlany, użyj `t(`pm.status_${status}`)`. Sprawdź też `PmProjectsList.tsx` — `statusColor()` powinien działać na klucze enum zamiast polskich stringów.

- [ ] **Step 4: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/PM.tsx dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "fix(pm): replace hardcoded Polish status strings with i18n keys"
```

---

## Task 10: WARN-28 — `update_manual_session` nie sprawdza rows_affected

**Files:**
- Modify: `dashboard/src-tauri/src/commands/manual_sessions.rs:164-168`

- [ ] **Step 1: Przeczytaj aktualny kod update**

Przeczytaj `manual_sessions.rs` linie 155-175.

- [ ] **Step 2: Dodaj sprawdzenie rows_affected**

```rust
let rows = conn.execute(
    "UPDATE manual_sessions SET ... WHERE id = ?N",
    params![...],
)
.map_err(|e| format!("Failed to update manual session: {}", e))?;

if rows == 0 {
    return Err(format!("Manual session with id {} not found", id));
}
```

- [ ] **Step 3: Build**

Run: `cd dashboard/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/manual_sessions.rs
git commit -m "fix(manual-sessions): return error when updating non-existent session"
```

---

## Task 11: WARN-29 + WARN-30 — Brakujące indeksy SQLite

**Files:**
- Create: `dashboard/src-tauri/src/db_migrations/m18_performance_indexes.rs`
- Modify: `dashboard/src-tauri/src/db_migrations/mod.rs`

- [ ] **Step 1: Sprawdź pattern migracji**

Przeczytaj `mod.rs` w `db_migrations/` i jedną istniejącą migrację (np. `m17_project_folder_meta.rs`) żeby zobaczyć wzorzec.

- [ ] **Step 2: Utwórz migrację m18**

```rust
use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_manual_sessions_date ON manual_sessions(date);
         CREATE INDEX IF NOT EXISTS idx_sessions_date_hidden ON sessions(date, is_hidden);"
    )
    .map_err(|e| format!("Migration m18 failed: {}", e))?;
    Ok(())
}
```

- [ ] **Step 3: Zarejestruj migrację w mod.rs**

Dodaj `mod m18_performance_indexes;` i wywołanie w `run_migrations()`.

- [ ] **Step 4: Build**

Run: `cd dashboard/src-tauri && cargo check`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/db_migrations/
git commit -m "perf(db): add indexes on manual_sessions.date and sessions(date, is_hidden)"
```

---

## Task 12: WARN-23 — `is_training` flaga nie jest atomowa (AI model)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs:49`

- [ ] **Step 1: Przeczytaj aktualny mechanizm**

Przeczytaj `training.rs` linie 40-65 żeby zobaczyć jak `is_training` jest sprawdzany i ustawiany.

- [ ] **Step 2: Zamień na atomowy UPDATE**

Zamiast osobnego SELECT + UPDATE, użyj:

```rust
let rows = conn.execute(
    "UPDATE system_settings SET value = 'true', updated_at = datetime('now') WHERE key = 'is_training' AND value = 'false'",
    [],
).map_err(|e| e.to_string())?;

if rows == 0 {
    return Err("Training already in progress".to_string());
}
```

I analogicznie, po zakończeniu treningu:

```rust
conn.execute(
    "UPDATE system_settings SET value = 'false', updated_at = datetime('now') WHERE key = 'is_training'",
    [],
).map_err(|e| e.to_string())?;
```

- [ ] **Step 3: Build**

Run: `cd dashboard/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/training.rs
git commit -m "fix(ai): make is_training flag atomic via single UPDATE WHERE"
```

---

## Task 13: CRIT-2 — Usunięcie pola `encryptionKey` z UI (opcja prosta)

**Files:**
- Modify: `dashboard/src/lib/online-sync-types.ts:10`
- Modify: `dashboard/src/hooks/useSettingsFormState.ts:349`
- Modify: odpowiednie komponenty Settings UI

Raport sugeruje dwie opcje: implementacja szyfrowania (duża) lub usunięcie misleading pola. Wybieramy usunięcie pola z UI z zachowaniem typu na przyszłość.

- [ ] **Step 1: Ukryj pole w UI**

Znajdź formularz online sync w Settings i ukryj/usuń input `encryptionKey`. Dodaj komentarz `// TODO: re-enable when client-side encryption is implemented`.

- [ ] **Step 2: Zachowaj pole w typie**

W `online-sync-types.ts`, dodaj komentarz do pola:

```typescript
/** Reserved for future client-side encryption. Not yet implemented — do not show in UI. */
encryptionKey?: string;
```

- [ ] **Step 3: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/online-sync-types.ts dashboard/src/hooks/useSettingsFormState.ts
git commit -m "fix(ui): hide encryptionKey field until client-side encryption is implemented"
```

---

## Task 14: CRIT-3 — SSE token w URL — dodaj komentarz TODO (quick win)

**Files:**
- Modify: `dashboard/src/lib/sync/sync-sse.ts:39-44`

Pełna implementacja SSE ticket endpoint wymaga zmian serwera. Na razie dokumentujemy ryzyko.

- [ ] **Step 1: Dodaj komentarz o ryzyku bezpieczeństwa**

```typescript
// SECURITY TODO: Token in URL is logged by proxies/CDN/server access logs.
// Migrate to short-lived SSE ticket: POST /api/sync/sse-ticket → one-time token,
// or use fetch() streaming with Authorization header when EventSource is dropped.
url.searchParams.set('token', apiToken);
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/lib/sync/sync-sse.ts
git commit -m "docs(sync): document SSE token-in-URL security risk with migration plan"
```

---

## Task 15: CRIT-4 — Auth token w plaintext JSON (Rust backend)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/online_sync.rs:49-66`

- [ ] **Step 1: Sprawdź jak frontend migruje do secure storage**

Grep `auth_token` / `secureStorage` w `dashboard/src/` żeby zrozumieć migrację po stronie frontend.

- [ ] **Step 2: Usuń `auth_token` z zapisu JSON**

W `save_online_sync_settings`, przed serializacją, wyczyść pole:

```rust
pub fn save_online_sync_settings(mut settings: OnlineSyncSettings) -> Result<(), String> {
    // auth_token is stored in Tauri secure storage, not in plaintext JSON
    settings.auth_token = String::new();
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Upewnij się, że `get_online_sync_settings` nie polega na `auth_token` z pliku**

Zweryfikuj, że dashboard pobiera token z secure storage, nie z tego pliku.

- [ ] **Step 4: Build**

Run: `cd dashboard/src-tauri && cargo check`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/online_sync.rs
git commit -m "security(sync): strip auth_token from plaintext JSON, use secure storage only"
```

---

## Task 16: WARN-11 — `t` w tablicy zależności useEffect wymusza reload

**Files:**
- Modify: `dashboard/src/pages/Dashboard.tsx:436`

- [ ] **Step 1: Przeczytaj useEffect**

Przeczytaj `Dashboard.tsx` linie 425-445 żeby zobaczyć kontekst.

- [ ] **Step 2: Usuń `t` z tablicy zależności**

Zamień `[..., t, ...]` na `[..., ...]` (bez `t`). Funkcja `t` zmienia referencję przy zmianie języka, co triggeruje reload 3 zapytań. Dane nie zależą od języka — tylko ich prezentacja.

- [ ] **Step 3: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Dashboard.tsx
git commit -m "perf(dashboard): remove t from useEffect deps to prevent unnecessary data reload on language change"
```

---

## Task 17: WARN-19 — `cancel_online_sync()` jest no-op

**Files:**
- Modify: `dashboard/src-tauri/src/commands/online_sync.rs:111-117`

- [ ] **Step 1: Zaimplementuj cancel przez endpoint daemon**

```rust
#[tauri::command]
pub async fn cancel_online_sync() -> Result<(), String> {
    let client = build_http_client();
    let url = format!("{}/online/cancel-sync", DAEMON_BASE);
    client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Daemon unreachable: {}", e))?;
    Ok(())
}
```

- [ ] **Step 2: Sprawdź czy daemon ma endpoint `/online/cancel-sync`**

Jeśli nie — dodaj TODO i zostaw placeholder z logowaniem:

```rust
#[tauri::command]
pub fn cancel_online_sync() -> Result<(), String> {
    log::warn!("cancel_online_sync called but daemon endpoint not yet implemented");
    // TODO: implement /online/cancel-sync endpoint in daemon
    Ok(())
}
```

- [ ] **Step 3: Build**

Run: `cd dashboard/src-tauri && cargo check`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/online_sync.rs
git commit -m "fix(sync): add logging to cancel_online_sync placeholder"
```

---

## Podsumowanie priorytetów

| # | ID | Priorytet | Ryzyko | Złożoność |
|---|-----|-----------|--------|-----------|
| 1 | CRIT-5 | 🔴 | Brak | Trivial |
| 2 | CRIT-6 | 🔴 | Niskie | Łatwy |
| 3 | CRIT-7 | 🔴 | — | Weryfikacja only |
| 4 | CRIT-1 | 🔴 | Średnie | Średni |
| 5 | WARN-3 | 🟡 | Niskie | Łatwy |
| 6 | WARN-1 | 🟡 | Niskie | Łatwy |
| 7 | WARN-2 | 🟡 | Niskie | Łatwy |
| 8 | WARN-6 | 🟡 | Niskie | Trivial |
| 9 | WARN-9 | 🟡 | Niskie | Średni |
| 10 | WARN-28 | 🟡 | Niskie | Trivial |
| 11 | WARN-29/30 | 🟡 | Niskie | Łatwy |
| 12 | WARN-23 | 🟡 | Niskie | Łatwy |
| 13 | CRIT-2 | 🔴 | Niskie | Łatwy |
| 14 | CRIT-3 | 🔴 | — | Dokumentacja |
| 15 | CRIT-4 | 🔴 | Średnie | Średni |
| 16 | WARN-11 | 🟡 | Niskie | Trivial |
| 17 | WARN-19 | 🟡 | Niskie | Łatwy |

**Poza scope tego planu** (wymagają osobnego planu/epicu):
- CRIT-2 pełne szyfrowanie client-side (duży feature)
- CRIT-3 SSE ticket endpoint (wymaga zmian serwera)
- WARN-4 LAN auth (duży redesign)
- WARN-5 streaming JSON (refaktor)
- WARN-12 refaktor Sessions.tsx (god component)
- WARN-22 AI token bias (złożona zmiana modelu)
