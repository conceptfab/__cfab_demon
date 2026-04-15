# Remove auto-unfreeze of frozen projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zlikwidować automatyczne odmrażanie zamrożonych projektów przez `auto_freeze_projects`, które wywoływało się przy każdym wejściu na zakładkę Projects i cicho cofało ręczny freeze, powodując ponowne przypisywanie zamrożonego projektu do bieżących sesji.

**Architecture:** Usuwamy drugi SQL `UPDATE … SET frozen_at = NULL` z `auto_freeze_projects`, redukujemy `AutoFreezeResult` do samego `frozen_count`, aktualizujemy typ TypeScript konsumenta oraz kopię Help/i18n. Core SQL do automatycznego zamrażania wydzielamy do prywatnej, testowalnej funkcji przyjmującej `&rusqlite::Connection`, żeby dodać regresję w `#[cfg(test)]` wewnątrz `projects.rs`. Po wprowadzeniu zmian odmrożenie projektu jest możliwe **wyłącznie** przez ręczną akcję `unfreeze_project`.

**Tech Stack:** Rust (rusqlite, tauri), TypeScript (React hooks, Tauri invoke), inline i18n (`createInlineTranslator`).

---

## Relevant context

- **Broken code:** [dashboard/src-tauri/src/commands/projects.rs:704-729](../../../dashboard/src-tauri/src/commands/projects.rs#L704-L729) — blok `let unfrozen = conn.execute("UPDATE projects SET frozen_at = NULL WHERE frozen_at IS NOT NULL AND excluded_at IS NULL AND id IN (…) ", …)`.
- **Trigger na frontendzie:** [dashboard/src/hooks/useProjectsData.ts:88-95](../../../dashboard/src/hooks/useProjectsData.ts#L88-L95) — `useEffect` bezwarunkowo woła `projectsApi.autoFreezeProjects()` na mount.
- **Typ TS:** [dashboard/src/lib/tauri/projects.ts:51-61](../../../dashboard/src/lib/tauri/projects.ts#L51-L61) — deklaruje `{ frozen_count; unfrozen_count }` i warunkuje notyfikację `result.unfrozen_count > 0`.
- **Regresja logiczna:** commit `c0bbed0` zostawił historyczne `sessions.project_id` nietknięte po freeze, więc blok auto-unfreeze (który patrzy na `sessions.end_time >= now - N days`) zawsze widzi „aktywność” zamrożonego projektu i natychmiast cofa freeze.
- **Istniejące testy:** [dashboard/src-tauri/src/commands/projects.rs:1524-1575](../../../dashboard/src-tauri/src/commands/projects.rs#L1524-L1575) — prosty `#[cfg(test)] mod tests` z `setup_conn()` używany przez `prune_projects_missing_on_disk`. Rozszerzamy o fixture dla auto-freeze.
- **Help/i18n:** klucze `auto_freezing_the_system_automatically_freezes_projects`, `freezing_blocks_override_reapply` żyją w `dashboard/src/locales/{pl,en}/common.json` (linie 1607-1610 w PL). Help.tsx używa inline translator więc edycja idzie po stronie JSON + odpowiadający string w Help.tsx, jeśli istnieje.

---

## File Structure

**Modify:**
- `dashboard/src-tauri/src/commands/projects.rs`
  - Usunąć pole `unfrozen_count` ze struktury `AutoFreezeResult`.
  - Wydzielić core SQL (clear stale `unfreeze_reason` + freeze stale projects) do prywatnej funkcji `fn auto_freeze_stale_projects(conn: &rusqlite::Connection, days: i64) -> rusqlite::Result<i64>`.
  - `#[tauri::command] auto_freeze_projects` ma wołać tę funkcję i zwracać `AutoFreezeResult { frozen_count }`.
  - Usunąć blok `let unfrozen = conn.execute("UPDATE projects SET frozen_at = NULL …")`.
  - Dodać testy jednostkowe do `mod tests`.
- `dashboard/src/lib/tauri/projects.ts`
  - Zaktualizować typ generic w `invokeMutation` do `{ frozen_count: number }`.
  - Uprościć `notify` do `result.frozen_count > 0`.
- `dashboard/src/hooks/useProjectsData.ts`
  - Zostaje bez zmian w logice wywołania (nadal wywołuje `autoFreezeProjects()` na mount — ale teraz wywołanie jest bezpieczne: tylko dokłada freeze'y, nigdy nie odmraża).
  - Komentarz wyjaśniający semantykę (1 linia).
- `dashboard/src/locales/pl/common.json`
  - Rozszerzyć wartość klucza `auto_freezing_the_system_automatically_freezes_projects` o zdanie: „Odmrożenie jest zawsze ręczne — system nigdy samoczynnie nie zdejmuje zamrożenia."
  - Rozszerzyć `freezing_blocks_override_reapply` analogicznie.
- `dashboard/src/locales/en/common.json`
  - Te same klucze, angielska treść symetryczna.

**Create:** (nic — nie dodajemy nowych plików)

**Test:**
- `dashboard/src-tauri/src/commands/projects.rs` (rozszerzenie `#[cfg(test)] mod tests`)

---

## Task 1: Wydzielenie testowalnej funkcji `auto_freeze_stale_projects`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/projects.rs:646-737`

- [ ] **Step 1: Dodać nową prywatną funkcję tuż nad `#[tauri::command] auto_freeze_projects`**

Wklej dokładnie to w `dashboard/src-tauri/src/commands/projects.rs` przed istniejącym `#[derive(serde::Serialize)] pub struct AutoFreezeResult`:

```rust
/// Core logic for `auto_freeze_projects`, exposed for unit tests.
///
/// Freezes stale projects (no session/manual_session/file_activity in the
/// last `days` days and older than `days` since creation). Does **not**
/// unfreeze anything — unfreeze is a manual-only operation. Callers must
/// pass `days >= 1`.
fn auto_freeze_stale_projects(
    conn: &rusqlite::Connection,
    days: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "UPDATE projects
         SET unfreeze_reason = NULL
         WHERE excluded_at IS NULL
           AND unfreeze_reason IS NOT NULL
           AND julianday(unfreeze_reason) < julianday('now', '-' || ?1 || ' days')",
        [days],
    )?;

    let frozen = conn.execute(
        "UPDATE projects
         SET frozen_at = datetime('now'),
             unfreeze_reason = NULL
         WHERE excluded_at IS NULL
           AND frozen_at IS NULL
           AND julianday('now') - julianday(created_at) >= ?1
           AND id NOT IN (
               SELECT DISTINCT s.project_id FROM sessions s
               WHERE s.project_id IS NOT NULL
                 AND julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
               UNION
               SELECT DISTINCT p.id FROM projects p
               JOIN applications a ON a.project_id = p.id
               JOIN sessions s ON s.app_id = a.id
               WHERE julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
               UNION
               SELECT DISTINCT project_id FROM manual_sessions
               WHERE julianday(end_time) >= julianday('now', '-' || ?1 || ' days')
               UNION
               SELECT DISTINCT project_id FROM file_activities
               WHERE project_id IS NOT NULL
                 AND julianday(last_seen) >= julianday('now', '-' || ?1 || ' days')
               UNION
               SELECT id FROM projects
               WHERE unfreeze_reason IS NOT NULL
                 AND julianday(unfreeze_reason) >= julianday('now', '-' || ?1 || ' days')
           )",
        [days],
    )? as i64;

    Ok(frozen)
}
```

- [ ] **Step 2: Podmienić ciało `AutoFreezeResult` i `#[tauri::command] auto_freeze_projects`**

Zastąp cały blok od `#[derive(serde::Serialize)] pub struct AutoFreezeResult` do końca funkcji `auto_freeze_projects` (czyli aktualne linie ~646-737) tym:

```rust
#[derive(serde::Serialize)]
pub struct AutoFreezeResult {
    pub frozen_count: i64,
}

#[tauri::command]
pub async fn auto_freeze_projects(
    app: AppHandle,
    threshold_days: Option<i64>,
) -> Result<AutoFreezeResult, String> {
    run_db_blocking(app, move |conn| {
        let days = threshold_days.unwrap_or(14).max(1);
        let frozen_count = auto_freeze_stale_projects(conn, days)
            .map_err(|e| e.to_string())?;
        Ok(AutoFreezeResult { frozen_count })
    })
    .await
}
```

Powyższe:
- usuwa blok `let unfrozen = conn.execute("UPDATE projects SET frozen_at = NULL …")` w całości,
- usuwa pole `unfrozen_count` z `AutoFreezeResult`,
- deleguje SQL do nowej funkcji `auto_freeze_stale_projects`.

- [ ] **Step 3: Sprawdzić, że kompiluje się**

Run: `cd dashboard/src-tauri && cargo check -p <crate-name>`

Jeśli nazwa crate'a nieznana, użyj: `cd dashboard/src-tauri && cargo check`

Expected: `Finished` bez błędów kompilacji. Ostrzeżenia o nieużywanych polach dla `AutoFreezeResult` są OK do tego kroku (zostaną rozwiązane po aktualizacji TS).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/projects.rs
git commit -m "refactor(projects): extract auto_freeze_stale_projects for testability"
```

---

## Task 2: Regresja — zamrożony projekt nie jest odmrażany przez `auto_freeze_stale_projects`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/projects.rs:1524-1575` (blok `#[cfg(test)] mod tests`)

- [ ] **Step 1: Rozszerzyć `use super::` na początku `mod tests`**

W `mod tests` zmień istniejący import:

```rust
use super::prune_projects_missing_on_disk;
```

na:

```rust
use super::{auto_freeze_stale_projects, prune_projects_missing_on_disk};
```

- [ ] **Step 2: Dodać fixture `setup_auto_freeze_conn()`**

Wklej poniżej istniejącej funkcji `setup_conn()` w `mod tests`:

```rust
fn setup_auto_freeze_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            excluded_at TEXT,
            frozen_at TEXT,
            unfreeze_reason TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE applications (
            id INTEGER PRIMARY KEY,
            project_id INTEGER
        );
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            app_id INTEGER,
            end_time TEXT NOT NULL
        );
        CREATE TABLE manual_sessions (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            end_time TEXT NOT NULL
        );
        CREATE TABLE file_activities (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            last_seen TEXT NOT NULL
        );",
    )
    .expect("schema");
    conn
}
```

- [ ] **Step 3: Napisać failing test — zamrożony projekt z aktywną historyczną sesją zostaje zamrożony**

Wklej w `mod tests` poniżej `setup_auto_freeze_conn()`:

```rust
#[test]
fn auto_freeze_never_unfreezes_manual_freeze() {
    let conn = setup_auto_freeze_conn();

    conn.execute(
        "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
         VALUES (10, 'ManualFrozen', NULL, datetime('now', '-1 days'), NULL,
                 datetime('now', '-30 days'))",
        [],
    )
    .expect("insert frozen project");

    // Historyczna sesja z ostatnich 14 dni wciąż wskazująca na zamrożony projekt
    // (c0bbed0 celowo nie czyści historycznego sessions.project_id po freeze).
    conn.execute(
        "INSERT INTO sessions (id, project_id, app_id, end_time)
         VALUES (1, 10, NULL, datetime('now', '-2 days'))",
        [],
    )
    .expect("insert historic session");

    let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

    assert_eq!(
        frozen_count, 0,
        "nothing new to freeze — project already frozen"
    );

    let frozen_at: Option<String> = conn
        .query_row(
            "SELECT frozen_at FROM projects WHERE id = 10",
            [],
            |row| row.get(0),
        )
        .expect("select frozen_at");

    assert!(
        frozen_at.is_some(),
        "manual freeze must NOT be cleared by auto_freeze_stale_projects, got {:?}",
        frozen_at
    );
}
```

- [ ] **Step 4: Uruchomić nowy test i zobaczyć że przechodzi**

Run: `cd dashboard/src-tauri && cargo test --package <crate-name> commands::projects::tests::auto_freeze_never_unfreezes_manual_freeze -- --nocapture`

Jeśli nazwa crate'a nieznana: `cd dashboard/src-tauri && cargo test auto_freeze_never_unfreezes_manual_freeze -- --nocapture`

Expected: `test result: ok. 1 passed`. (Test musi przejść — to jest regresja pozytywna: po Task 1 nie ma już auto-unfreeze, więc `frozen_at` pozostaje niepuste.)

- [ ] **Step 5: Dodać drugi test — stale project bez aktywności zostaje zamrożony**

Wklej w `mod tests` poniżej poprzedniego testu:

```rust
#[test]
fn auto_freeze_freezes_stale_project_without_activity() {
    let conn = setup_auto_freeze_conn();

    conn.execute(
        "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
         VALUES (20, 'StaleAlive', NULL, NULL, NULL, datetime('now', '-60 days'))",
        [],
    )
    .expect("insert stale project");

    let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

    assert_eq!(frozen_count, 1, "stale project without activity must be frozen");

    let frozen_at: Option<String> = conn
        .query_row(
            "SELECT frozen_at FROM projects WHERE id = 20",
            [],
            |row| row.get(0),
        )
        .expect("select frozen_at");

    assert!(frozen_at.is_some(), "StaleAlive should now be frozen");
}
```

- [ ] **Step 6: Dodać trzeci test — projekt z ostatnią sesją w oknie NIE jest zamrażany**

Wklej w `mod tests`:

```rust
#[test]
fn auto_freeze_skips_project_with_recent_session() {
    let conn = setup_auto_freeze_conn();

    conn.execute(
        "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
         VALUES (30, 'Active', NULL, NULL, NULL, datetime('now', '-60 days'))",
        [],
    )
    .expect("insert active project");

    conn.execute(
        "INSERT INTO sessions (id, project_id, app_id, end_time)
         VALUES (5, 30, NULL, datetime('now', '-3 days'))",
        [],
    )
    .expect("insert recent session");

    let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

    assert_eq!(frozen_count, 0, "project with recent activity must stay active");

    let frozen_at: Option<String> = conn
        .query_row(
            "SELECT frozen_at FROM projects WHERE id = 30",
            [],
            |row| row.get(0),
        )
        .expect("select frozen_at");

    assert!(frozen_at.is_none(), "active project must not be frozen");
}
```

- [ ] **Step 7: Uruchomić pełny zestaw testów `projects::tests`**

Run: `cd dashboard/src-tauri && cargo test commands::projects::tests -- --nocapture`

Expected: `test result: ok. 4 passed; 0 failed` (3 nowe + 1 istniejący `prune_does_not_delete_manual_projects`).

- [ ] **Step 8: Commit**

```bash
git add dashboard/src-tauri/src/commands/projects.rs
git commit -m "test(projects): regression — auto_freeze never clears manual freeze"
```

---

## Task 3: Zaktualizować TypeScript typ i konsumenta

**Files:**
- Modify: `dashboard/src/lib/tauri/projects.ts:51-61`
- Modify: `dashboard/src/hooks/useProjectsData.ts:88-95`

- [ ] **Step 1: Zaktualizować `autoFreezeProjects` w `projects.ts`**

Zastąp linie 51-61 w `dashboard/src/lib/tauri/projects.ts`:

```ts
export const autoFreezeProjects = (thresholdDays?: number) =>
  invokeMutation<{ frozen_count: number }>(
    'auto_freeze_projects',
    {
      thresholdDays: thresholdDays ?? null,
    },
    {
      notify: (result) => result.frozen_count > 0,
    },
  );
```

- [ ] **Step 2: Dodać komentarz semantyczny w `useProjectsData.ts`**

Zastąp linie 88-95 w `dashboard/src/hooks/useProjectsData.ts`:

```ts
  useEffect(() => {
    if (autoFreezeInitializedRef.current) return;
    autoFreezeInitializedRef.current = true;
    // Auto-freeze is additive only: it freezes stale projects but never
    // clears a manual freeze. Safe to run on every Projects page mount.
    projectsApi.autoFreezeProjects()
      .catch(() => {
        /* feature optional */
      });
  }, []);
```

- [ ] **Step 3: Sprawdzić typecheck dashboardu**

Run: `cd dashboard && npx tsc --noEmit`

Expected: brak błędów. Jeżeli gdziekolwiek w repo pozostał odczyt `unfrozen_count` — pojawi się TS error. Wtedy: grep `unfrozen_count` w `dashboard/src`, usuń referencje (powinny nie istnieć — TS wcześniej nie widział tego pola, bo był tylko lokalnie zadeklarowany w `projects.ts`).

- [ ] **Step 4: Weryfikacja greppem**

Run: `rg "unfrozen_count|unfrozenCount" dashboard/src dashboard/src-tauri/src`

Expected: brak wyników.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/tauri/projects.ts dashboard/src/hooks/useProjectsData.ts
git commit -m "refactor(projects): drop unfrozen_count from autoFreezeProjects type"
```

---

## Task 4: Zaktualizować i18n PL/EN i Help

**Files:**
- Modify: `dashboard/src/locales/pl/common.json:1607-1610`
- Modify: `dashboard/src/locales/en/common.json` (te same klucze)

- [ ] **Step 1: Znaleźć klucze w EN**

Run: `rg "freezing_blocks_override_reapply|auto_freezing_the_system_automatically|freezing_hide_inactive" dashboard/src/locales/en/common.json`

Zapisz numery linii klucza `auto_freezing_the_system_automatically_freezes_projects` i `freezing_blocks_override_reapply` w EN.

- [ ] **Step 2: Edytować PL — klucz `auto_freezing_…`**

W `dashboard/src/locales/pl/common.json` zamień linię 1608 (wartość klucza `auto_freezing_the_system_automatically_freezes_projects`) na:

```json
    "auto_freezing_the_system_automatically_freezes_projects": "Automatyczne zamrożenie – system sam zamraża projekty nieużywane przez określoną liczbę dni. Odmrożenie jest zawsze ręczne – system nigdy samoczynnie nie zdejmuje zamrożenia z projektu.",
```

- [ ] **Step 3: Edytować PL — klucz `freezing_blocks_override_reapply`**

W tym samym pliku zamień linię 1609 na:

```json
    "freezing_blocks_override_reapply": "Zamrożenie a ręczne przypisania – sesje pasujące do starych ręcznych przypisań nie wrócą do zamrożonego projektu przy kolejnej synchronizacji. Po zamrożeniu TIMEFLOW nigdy nie przypisze projektu do nowych sesji, dopóki nie odmrozisz go ręcznie.",
```

- [ ] **Step 4: Edytować EN — te same klucze**

W `dashboard/src/locales/en/common.json` ustaw wartości:

```json
    "auto_freezing_the_system_automatically_freezes_projects": "Auto-freeze – TIMEFLOW automatically freezes projects that have been inactive for the configured number of days. Unfreezing is always manual – TIMEFLOW never clears a freeze on its own.",
```

```json
    "freezing_blocks_override_reapply": "Freeze vs manual overrides – sessions matching old manual assignments will not return to a frozen project after sync. Once frozen, TIMEFLOW will never assign the project to new sessions until you unfreeze it manually.",
```

- [ ] **Step 5: Weryfikacja JSON-a**

Run: `node -e "JSON.parse(require('fs').readFileSync('dashboard/src/locales/pl/common.json','utf8')); JSON.parse(require('fs').readFileSync('dashboard/src/locales/en/common.json','utf8')); console.log('ok')"`

Expected: `ok`. Jakiekolwiek błędy parsingu → wróć i sprawdź przecinki/cudzysłowy.

- [ ] **Step 6: Sprawdzić czy Help.tsx zawiera te klucze bezpośrednio**

Run: `rg "auto_freezing_the_system|freezing_blocks_override" dashboard/src/pages/Help.tsx`

Jeśli brak wyników — Help.tsx używa inline translator z polskim tekstem jako klucz. W takim przypadku:

Run: `rg "Automatyczne zamrożenie|Zamrożenie a ręczne" dashboard/src/pages/Help.tsx`

Jeśli są trafienia — edytuj Help.tsx, aktualizując parę PL/EN w odpowiednim `t('…', '…')` tak, żeby treść była zgodna z JSON-ami z kroków 2-4. Jeśli nie ma trafień — sekcja pomocy auto-freeze nie jest jeszcze podpięta, pomiń.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json dashboard/src/pages/Help.tsx
git commit -m "docs(help): clarify auto-freeze never unfreezes manually frozen projects"
```

Jeśli Help.tsx nie był edytowany, usuń go z listy `git add`.

---

## Task 5: Weryfikacja end-to-end

**Files:** (tylko uruchomienia, bez zmian)

- [ ] **Step 1: Full cargo check**

Run: `cd dashboard/src-tauri && cargo check`

Expected: `Finished` bez błędów i nowych warningów.

- [ ] **Step 2: Full cargo test dla commands::projects**

Run: `cd dashboard/src-tauri && cargo test commands::projects`

Expected: wszystkie testy zielone, w tym 3 nowe `auto_freeze_*`.

- [ ] **Step 3: Full TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`

Expected: 0 błędów.

- [ ] **Step 4: Smoke test manualny na istniejącej bazie**

1. Uruchom dashboard (`cd dashboard && npm run tauri dev`).
2. Otwórz zakładkę Projects.
3. Ręcznie zamroź jeden projekt, który ma sesje w ostatnich 14 dniach (ikona śnieżynki/płomienia).
4. Przełącz się na inną zakładkę i wróć na Projects.
5. **Expected:** projekt pozostaje zamrożony. Przed fixem pole `frozen_at` było zerowane przy powrocie.
6. Sprawdź, że żadna nowa sesja ani `file_activity` nie dostaje `project_id` zamrożonego projektu:
   Run w konsoli SQLite bazy TIMEFLOW: `SELECT id, start_time, project_id FROM sessions WHERE project_id = <frozen_id> AND start_time >= datetime('now', '-1 hours');`
   Expected: 0 wierszy (nowo powstające sesje nie są bindowane do frozen).

- [ ] **Step 5: Commit merge/close**

Jeśli wszystkie taski były commitowane osobno, nic więcej do zrobienia. Jeśli branża/worktree — push i PR.

```bash
git log --oneline -5
```

Expected: 4 commity z tasków 1-4 (task 5 jest tylko weryfikacją).

---

## Self-review notes

- **Spec coverage:** plan z rozmowy miał 5 punktów. Task 1 pokrywa pkt 1 (usunięcie auto-unfreeze). Task 1 + Task 3 pokrywa pkt 2 (zmiana AutoFreezeResult + TS). Pkt 3 (ręczny freeze respektowany) wynika bezpośrednio z pkt 1 — nie trzeba oddzielnego taska, bo freeze block niczego nie zmienia w swoim warunku, a auto-unfreeze przestaje istnieć. Pkt 4 (odcięcie wywołania z useProjectsData / opt-in) — świadomie przesunięty: zostawiamy wywołanie, ale dodajemy komentarz i robimy je bezpiecznym (nie mutuje freeze, tylko dokłada). Decyzja konserwatywna — nie dotykamy UX ustawień bez potrzeby. Pkt 5 (regresja + Help PL/EN) — Task 2 + Task 4.
- **Placeholder scan:** żadnego „TBD", „implement later", „handle edge cases". Wszystkie bloki kodu są kompletne.
- **Type consistency:** funkcja `auto_freeze_stale_projects(&rusqlite::Connection, i64) -> rusqlite::Result<i64>` — używana identycznie w Task 1 Step 2, Task 2 Steps 3/5/6. `AutoFreezeResult { frozen_count: i64 }` — spójne w Rust Task 1 Step 2 i TS Task 3 Step 1. Klucze i18n `auto_freezing_the_system_automatically_freezes_projects` i `freezing_blocks_override_reapply` — identyczne we wszystkich Task 4 stepach.
- **Ryzyko regresji:** minimalne. Usuwamy TYLKO drugi blok `UPDATE`. Pierwszy (freeze) oraz `freeze_project` / `unfreeze_project` zostają. Historyczne `sessions.project_id` zamrożonych projektów nadal zostają nietknięte zgodnie z regułą „freezing does not rewrite history".
