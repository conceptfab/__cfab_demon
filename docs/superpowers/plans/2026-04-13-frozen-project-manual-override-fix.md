# Fix: zamrożone projekty nadal przypisywane przez manual overrides

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zablokować re-aplikację historycznych `session_manual_overrides` na projekty, które w międzyczasie zostały zamrożone (`frozen_at IS NOT NULL`), oraz opisać to zachowanie w panelu pomocy.

**Architecture:** Bug leży w pojedynczym zapytaniu SQL w `apply_manual_session_overrides`, które filtrowało tylko `excluded_at IS NULL` i ignorowało `frozen_at`. Funkcja ta jest wołana po każdym `import_data` i każdej synchronizacji online (`import_data.rs:192`, `import_data.rs:667`), więc każda operacja sync/import ponownie wpisywała `sessions.project_id` na zamrożony projekt dla sesji pasujących po `(executable_name, start_time, end_time)`. Naprawa sprowadza się do dopisania `AND frozen_at IS NULL` w jednym miejscu + test regresyjny + aktualizacja Help.

**Tech Stack:** Rust (rusqlite, cargo test) w `dashboard/src-tauri/`, React/TS (Help.tsx) + i18next JSON lokalizacje (pl/en).

---

## Kontekst (dla osoby wykonującej)

Trzy fakty, które musisz znać zanim zaczniesz:

1. **Gdzie żyje bug:** [dashboard/src-tauri/src/commands/sessions/manual_overrides.rs:107-114](../../../dashboard/src-tauri/src/commands/sessions/manual_overrides.rs#L107-L114). Zapytanie buduje `HashMap<project_name, project_id>`, którego potem używa pętla re-aplikująca każdy override z tabeli `session_manual_overrides` na wszystkie sesje pasujące po `(exe, start_time, end_time)`. Jeżeli nazwa projektu z override'u trafi do mapy, sesja dostaje `project_id` — nawet jeśli projekt ma ustawione `frozen_at`.

2. **Dlaczego pozostałe ścieżki są OK:** wszystkie inne miejsca, które mogą przypisać `sessions.project_id`, już filtrują `frozen_at IS NULL`. Nie dotykaj ich w tym planie:
   - `assignment_model/config.rs:158` (`is_project_active`) → scoring `Layer 0..3b`
   - `assignment_model/auto_safe.rs:484` (`deterministic_sync`)
   - `assignment_model/scoring.rs:113` (manual override target resolver, ścieżka NOWEGO override'u przez UI)
   - `assignment_model/context.rs:164` (path inference)
   - `assignment_model/folder_scan.rs:45`
   - `sessions/mutations.rs:79` — to jest ścieżka jawnego przypisania przez użytkownika (drag & drop, assign button); tu nie filtrujemy, bo user świadomie wybiera projekt w UI, a UI nie pokazuje zamrożonych jako kandydatów. NIE ruszaj tej ścieżki.

3. **Schema i test harness:** `sessions/tests.rs` ma już przygotowany in-memory SQLite schema z tabelami `projects` (z kolumną `frozen_at`), `sessions`, `applications`, `session_manual_overrides`, `assignment_feedback`. Używaj funkcji `setup_conn()` — NIE dubluj schema. Test może wywołać `super::manual_overrides::apply_manual_session_overrides` bezpośrednio (moduł jest rodzeństwem `tests`).

## Plik manifest

Zmieniane pliki:
- **Modify:** `dashboard/src-tauri/src/commands/sessions/manual_overrides.rs` — jedna linia SQL + dopisek w komentarzu funkcji
- **Modify:** `dashboard/src-tauri/src/commands/sessions/tests.rs` — nowy moduł testowy `manual_overrides_tests` na końcu pliku (lub dopisanie testów do istniejącego modułu plikowego)
- **Modify:** `dashboard/src/components/help/sections/HelpProjectsSection.tsx` — dopisanie pozycji do `features[]`
- **Modify:** `dashboard/src/locales/pl/common.json` — nowy klucz lokalizacji
- **Modify:** `dashboard/src/locales/en/common.json` — nowy klucz lokalizacji

---

## Task 1: Regression test — zamrożony projekt nie może być re-aplikowany z override'u

**Files:**
- Modify: `dashboard/src-tauri/src/commands/sessions/tests.rs` (dopisanie na końcu pliku)

Cel: test, który seeduje projekt `Beta` (id=20) jako zamrożony, wpisuje override wskazujący na `Beta`, wpisuje sesję pasującą po exe+czasach z `project_id = NULL`, uruchamia `apply_manual_session_overrides` i sprawdza, że `sessions.project_id` wciąż jest `NULL`.

- [ ] **Krok 1: Dopisać test do `sessions/tests.rs`**

Dopisać NA KOŃCU pliku `dashboard/src-tauri/src/commands/sessions/tests.rs` (po istniejącym ostatnim `#[test]`), używając już istniejącej funkcji `setup_conn()`:

```rust
#[test]
fn apply_manual_overrides_skips_frozen_project() {
    let conn = setup_conn();

    // Zamrażamy projekt Beta (id=20 jest seedowany przez setup_conn)
    conn.execute(
        "UPDATE projects SET frozen_at = '2026-04-13T10:00:00+02:00' WHERE id = 20",
        [],
    )
    .expect("freeze Beta");

    // Sesja bez przypisania — pasuje do override'u po exe+start+end
    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            100_i64,
            1_i64, // editor.exe seedowany przez setup_conn
            "2026-04-12T09:00:00+02:00",
            "2026-04-12T10:00:00+02:00",
            3600_i64,
            "2026-04-12",
        ],
    )
    .expect("insert session");

    // Override wskazujący na zamrożony projekt Beta
    conn.execute(
        "INSERT INTO session_manual_overrides (session_id, executable_name, start_time, end_time, project_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            100_i64,
            "editor.exe",
            "2026-04-12T09:00:00+02:00",
            "2026-04-12T10:00:00+02:00",
            "Beta",
        ],
    )
    .expect("insert override");

    let reapplied = super::manual_overrides::apply_manual_session_overrides(&conn)
        .expect("apply overrides ok");

    assert_eq!(
        reapplied, 0,
        "zamrożony projekt nie powinien być re-aplikowany, apply_manual_session_overrides zwróciło {}",
        reapplied
    );

    let project_id: Option<i64> = conn
        .query_row(
            "SELECT project_id FROM sessions WHERE id = 100",
            [],
            |row| row.get(0),
        )
        .expect("read session");
    assert_eq!(
        project_id, None,
        "sessions.project_id powinno zostać NULL, dostaliśmy {:?}",
        project_id
    );
}

#[test]
fn apply_manual_overrides_still_works_for_active_project() {
    // Strażnik przed false-positive: upewniamy się, że fix nie zepsuł happy path.
    let conn = setup_conn();

    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            101_i64,
            1_i64,
            "2026-04-12T11:00:00+02:00",
            "2026-04-12T12:00:00+02:00",
            3600_i64,
            "2026-04-12",
        ],
    )
    .expect("insert session");

    conn.execute(
        "INSERT INTO session_manual_overrides (session_id, executable_name, start_time, end_time, project_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            101_i64,
            "editor.exe",
            "2026-04-12T11:00:00+02:00",
            "2026-04-12T12:00:00+02:00",
            "Alpha", // id=10, aktywny
        ],
    )
    .expect("insert override");

    let reapplied = super::manual_overrides::apply_manual_session_overrides(&conn)
        .expect("apply overrides ok");

    assert_eq!(reapplied, 1, "aktywny projekt powinien być re-aplikowany");

    let project_id: Option<i64> = conn
        .query_row(
            "SELECT project_id FROM sessions WHERE id = 101",
            [],
            |row| row.get(0),
        )
        .expect("read session");
    assert_eq!(project_id, Some(10), "sesja powinna być przypisana do Alpha (id=10)");
}
```

Uwaga: test odwołuje się do `super::manual_overrides::...`. Sprawdź, że w `sessions/mod.rs` moduł `manual_overrides` jest deklarowany jako `mod manual_overrides;` (tak jest dzisiaj, linia 7) — wtedy `super::manual_overrides` działa z wnętrza `sessions/tests.rs`, bo `tests` jest podmodulem `sessions`.

- [ ] **Krok 2: Uruchomić test — ma FAILOWAĆ**

Z katalogu `dashboard/src-tauri/`:

```bash
cargo test apply_manual_overrides_skips_frozen_project -- --nocapture
```

Oczekiwany wynik:
```
test commands::sessions::tests::apply_manual_overrides_skips_frozen_project ... FAILED

failures:
    sessions.project_id powinno zostać NULL, dostaliśmy Some(20)
```

Drugi test (`apply_manual_overrides_still_works_for_active_project`) powinien PRZEJŚĆ już teraz — to sanity check dla happy path. Jeśli FAILUJE na tym etapie, masz inny problem — STOP i zgłoś.

---

## Task 2: Fix — dopisać `AND frozen_at IS NULL` w `apply_manual_session_overrides`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/sessions/manual_overrides.rs:107-114`

- [ ] **Krok 1: Zmienić SQL**

W pliku `dashboard/src-tauri/src/commands/sessions/manual_overrides.rs`, znaleźć blok:

```rust
    let project_name_to_id: HashMap<String, i64> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, name
                 FROM projects
                 WHERE excluded_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
```

Zastąpić zapytanie SQL na:

```rust
    let project_name_to_id: HashMap<String, i64> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, name
                 FROM projects
                 WHERE excluded_at IS NULL
                   AND frozen_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
```

To jedyna zmiana kodu produkcyjnego w tym tasku. Nie dotykaj niczego innego.

- [ ] **Krok 2: (opcjonalnie) Dopisać docstring nad funkcją**

Nad deklaracją `pub(crate) fn apply_manual_session_overrides` (linia 81) dopisać komentarz doc, który wyjaśnia kontrakt — bez tego przyszły czytelnik znowu wpadnie w tę samą pułapkę:

```rust
/// Re-applies historical manual overrides from `session_manual_overrides` onto
/// sessions that match by `(executable_name, start_time, end_time)`.
///
/// Called after every import_data / sync-pull so manual assignments survive
/// session-id churn caused by re-importing archives.
///
/// Frozen projects (`projects.frozen_at IS NOT NULL`) are intentionally
/// excluded — freezing is the user's explicit signal that a project should
/// not receive any new assignments, including reapplication of past overrides.
/// If the project is later unfrozen, the override will naturally take effect
/// again on the next reapplication pass.
pub(crate) fn apply_manual_session_overrides(conn: &rusqlite::Connection) -> Result<i64, String> {
```

- [ ] **Krok 3: Uruchomić testy — mają PRZEJŚĆ**

```bash
cargo test apply_manual_overrides -- --nocapture
```

Oczekiwany wynik:
```
test commands::sessions::tests::apply_manual_overrides_skips_frozen_project ... ok
test commands::sessions::tests::apply_manual_overrides_still_works_for_active_project ... ok

test result: ok. 2 passed; 0 failed
```

- [ ] **Krok 4: Uruchomić całość testów modułu `commands::sessions` — regresja**

```bash
cargo test commands::sessions
```

Oczekiwany wynik: wszystkie testy w `commands::sessions::*` zielone. Jeśli coś się wysypie, STOP — nie twój fix zepsuł, ale i tak zbadaj przed commitem.

- [ ] **Krok 5: `cargo check` całości crate'u**

```bash
cargo check
```

Zero warningów związanych ze zmianami. Istniejące warningi (dead code z poprzednich commitów) ignoruj.

---

## Task 3: Help.tsx — dopisać pozycję o zamrożeniu i manual overrides

Cel: użytkownik musi widzieć w Help, że zamrożenie blokuje również ponowne „ożywanie" starych ręcznych przypisań. Bez tego wpisu bug będzie wyglądał na fixa pod stołem.

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/components/help/sections/HelpProjectsSection.tsx:14-34`

- [ ] **Krok 1: Dodać nowy klucz lokalizacji PL**

W pliku `dashboard/src/locales/pl/common.json` znaleźć linię:

```json
"auto_freezing_the_system_automatically_freezes_projects": "Automatyczne zamrożenie – system sam zamraża projekty nieużywane przez określoną liczbę dni.",
```

Dopisać tuż PO niej nowy klucz:

```json
"freezing_blocks_override_reapply": "Zamrożenie blokuje też automatyczne re-aplikowanie historycznych ręcznych przypisań – sesje pasujące do starych override'ów nie wrócą do zamrożonego projektu przy kolejnych synchronizacjach. Odmrożenie przywraca to zachowanie.",
```

- [ ] **Krok 2: Dodać nowy klucz lokalizacji EN**

W pliku `dashboard/src/locales/en/common.json` znaleźć analogiczną linię (klucz `auto_freezing_the_system_automatically_freezes_projects`) i dopisać pod nią:

```json
"freezing_blocks_override_reapply": "Freezing also blocks automatic reapplication of past manual assignments — sessions matching old overrides will not be reassigned to a frozen project during the next sync. Unfreezing restores this behavior.",
```

Uwaga: jeśli JSON jest alfabetycznie sortowany w tym projekcie, wstaw klucz w odpowiednie miejsce alfabetycznie (sprawdź wzrokowo sąsiadujące klucze). Jeśli nie jest sortowany, dopisanie po `auto_freezing_the_system...` jest OK.

- [ ] **Krok 3: Wstawić pozycję w `HelpProjectsSection.tsx`**

W pliku `dashboard/src/components/help/sections/HelpProjectsSection.tsx`, w tablicy `features={[...]}` (linia 14), dopisać nową pozycję BEZPOŚREDNIO POD istniejącą pozycją dotyczącą auto-freezing:

Znajdź:

```tsx
        t18n('help_page.auto_freezing_the_system_automatically_freezes_projects'),
        t18n('help_page.unfreezing_use_the_flame_icon_to_restore_a_project_to_th'),
```

Zastąp przez:

```tsx
        t18n('help_page.auto_freezing_the_system_automatically_freezes_projects'),
        t18n('help_page.freezing_blocks_override_reapply'),
        t18n('help_page.unfreezing_use_the_flame_icon_to_restore_a_project_to_th'),
```

- [ ] **Krok 4: Sanity check UI**

Z katalogu `dashboard/`:

```bash
pnpm dev
```

(Lub `npm run dev` / `bun run dev` — tym co projekt używa; sprawdź `package.json` jeśli niejasne.)

Otworzyć aplikację, wejść do Help → sekcja Projekty. Potwierdzić:
- [x] Nowy punkt jest widoczny na liście „key_functionalities".
- [x] Tekst PL jest poprawny i spójny z innymi opisami (nie mieszać czasów, nie używać żargonu).
- [x] Brak ostrzeżeń „missing translation" w konsoli devtools dla klucza `freezing_blocks_override_reapply`.

Jeśli chcesz sprawdzić EN — przełącz język w ustawieniach aplikacji i powtórz.

- [ ] **Krok 5: Typecheck + lint frontend**

Z katalogu `dashboard/`:

```bash
pnpm test   # vitest run — szybki sanity check snapshotów
```

Uruchom też, jeśli projekt to używa:

```bash
pnpm tsc --noEmit
```

Cel: zero nowych błędów TS, zero nowych ostrzeżeń związanych z twoimi zmianami.

---

## Task 4: Commit

**Files:** wszystkie zmodyfikowane powyżej.

- [ ] **Krok 1: Sprawdzić git status**

```bash
git status
git diff --stat
```

Oczekiwane pliki (dokładnie 5):
- `dashboard/src-tauri/src/commands/sessions/manual_overrides.rs`
- `dashboard/src-tauri/src/commands/sessions/tests.rs`
- `dashboard/src/components/help/sections/HelpProjectsSection.tsx`
- `dashboard/src/locales/pl/common.json`
- `dashboard/src/locales/en/common.json`

Plus ten plan (`docs/superpowers/plans/2026-04-13-frozen-project-manual-override-fix.md`), jeśli jeszcze niezacommitowany.

- [ ] **Krok 2: Commit**

```bash
git add dashboard/src-tauri/src/commands/sessions/manual_overrides.rs \
        dashboard/src-tauri/src/commands/sessions/tests.rs \
        dashboard/src/components/help/sections/HelpProjectsSection.tsx \
        dashboard/src/locales/pl/common.json \
        dashboard/src/locales/en/common.json

git commit -m "$(cat <<'EOF'
fix(sessions): skip frozen projects when reapplying manual overrides

apply_manual_session_overrides is called after every import_data and
sync-pull to restore manual assignments across session-id churn. Its
project-name-to-id map filtered only excluded_at, which meant frozen
projects were silently reassigned to matching sessions on every sync.

Freezing is now a hard stop for both new assignments and reapplied
historical overrides. Unfreezing restores the override on the next pass.

Adds regression tests and documents the behavior in Help → Projects.
EOF
)"
```

- [ ] **Krok 3: Zweryfikować commit**

```bash
git log -1 --stat
```

Commit musi zawierać dokładnie te 5 (lub 6 z planem) plików. Jeśli widzisz coś dodatkowego — STOP, cofnij i zbadaj.

---

## Self-review checklist (dla osoby piszącej fix)

Przed zamknięciem PR:

- [ ] `apply_manual_session_overrides` filtruje `frozen_at IS NULL` — sprawdzone grep'em: `rg "frozen_at" dashboard/src-tauri/src/commands/sessions/manual_overrides.rs` zwraca dopisaną linię.
- [ ] Test `apply_manual_overrides_skips_frozen_project` istnieje i jest zielony.
- [ ] Test `apply_manual_overrides_still_works_for_active_project` jest zielony (happy path).
- [ ] `cargo test commands::sessions` — wszystko zielone.
- [ ] Help.tsx pokazuje nowy punkt po polsku w sekcji Projekty.
- [ ] Klucz `freezing_blocks_override_reapply` istnieje w obu lokalizacjach (pl i en).
- [ ] Terminologia spójna: używamy „zamrożenie" i „override" tak samo jak w istniejących punktach.
- [ ] Brak zmian w plikach nieobjętych planem.
- [ ] Brak nowych zależności.
- [ ] Brak sekretów/tokenów w diffie.

## Zakres, którego NIE ruszamy w tym planie

- Czyszczenie już istniejących `sessions.project_id` wskazujących na zamrożone projekty. To osobna decyzja produktowa: „zamrożenie rozłącza istniejące przypisania" vs „zamrożenie tylko blokuje przyszłe przypisania". Obecna implementacja to drugie. Jeśli user chce pierwsze — osobny plan, bo wymaga migracji i UX decyzji (czy użytkownik widzi sesje, które straciły projekt?).
- Usuwanie rekordów z `session_manual_overrides` wskazujących na zamrożone projekty. Po odmrożeniu override ma „ożyć" — obecne zachowanie jest świadome. Jeśli user chce twardego cięcia — osobny plan.
- Filtrowanie zamrożonych projektów w `sessions/mutations.rs::assign_session_to_project_tx`. To jawne przypisanie przez user action — jeżeli user klika „assign to Beta" w UI i Beta jest zamrożona, to problem warstwy UI (nie powinna oferować zamrożonego jako kandydata). Jeśli UI faktycznie pokazuje zamrożone — osobny ticket, osobny plan.
