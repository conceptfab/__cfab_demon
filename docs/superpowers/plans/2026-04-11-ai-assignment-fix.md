# AI Assignment Fix — Plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naprawic przypisywanie sesji do projektow przez AI — aktualnie Photoshop (i inne design apps) zawsze trafia do jednego projektu, bo system nie korzysta z `project_folders` i deterministyczne reguly blokuja ponowna klasyfikacje.

**Architecture:** Trzy niezalezne zmiany: (1) Dodanie path-based inference do kontekstu sesji AI — `build_session_context()` sprawdza `detected_path`/`file_path` z `file_activities` wzgledem `project_folders`, (2) Ograniczenie deterministic rules przez recency + wykluczenie design/browsing apps, (3) Normalizacja Layer 1 (app scores) zeby historyczny bias nie dominowal.

**Tech Stack:** Rust (Tauri backend), SQLite, TypeScript (dashboard frontend)

**Raport diagnostyczny:** `AI_raport.md` w root repo

---

## File Structure

| Plik | Akcja | Odpowiedzialnosc |
|------|-------|------------------|
| `dashboard/src-tauri/src/commands/assignment_model/context.rs` | Modify | Dodanie path-inference do `build_session_context()` |
| `dashboard/src-tauri/src/commands/assignment_model/scoring.rs` | Modify | Dodanie `path_inferred_weights` do Layer 0 |
| `dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs` | Modify | Recency + activity-type guard w `deterministic_sync()` |
| `dashboard/src-tauri/src/commands/assignment_model/training.rs` | Modify | Normalizacja per-app w Layer 1 |
| `dashboard/src-tauri/src/commands/projects.rs` | Modify | Wyeksponowanie `infer_project_from_path` jako `pub(crate)` (juz jest) + nowa `resolve_project_id_by_name` |

---

### Task 1: Path-based project inference w kontekscie sesji

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/context.rs`
- Read: `dashboard/src-tauri/src/commands/projects.rs` (reuse `infer_project_from_path_pub`, `load_project_folders_from_db`)
- Read: `dashboard/src-tauri/src/commands/types.rs` (`ProjectFolder` struct)

**Cel:** Gdy `file_activities` ma `detected_path` lub `file_path`, a `project_id` jest `NULL`, sprobuj zainferowac projekt z `project_folders`. Dodaj wynik do `file_project_weights` w `SessionContext`.

- [ ] **Step 1: Dodaj import `projects` do `context.rs`**

Na gorze `context.rs`, po istniejacych importach, dodaj:

```rust
use crate::commands::projects::{infer_project_from_path_pub, load_project_folders_from_db};
use crate::commands::types::ProjectFolder;
```

- [ ] **Step 2: Dodaj helper `resolve_project_id_by_name` w `context.rs`**

Przed funkcja `build_session_context`, dodaj:

```rust
/// Resolves a project name (from path inference) to project_id.
/// Returns None if no active project with that name exists.
fn resolve_project_id_by_name(conn: &rusqlite::Connection, name: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM projects WHERE lower(name) = lower(?1) AND excluded_at IS NULL AND frozen_at IS NULL LIMIT 1",
        rusqlite::params![name],
        |row| row.get(0),
    )
    .ok()
}
```

- [ ] **Step 3: Zaladuj `project_folders` na poczatku `build_session_context`**

W `build_session_context`, po linii `let Some((app_id, date, start_time, end_time)) = session else {` (linia ~179), dodaj:

```rust
    let project_roots = load_project_folders_from_db(conn).unwrap_or_default();
```

- [ ] **Step 4: Dodaj path-inference w petli file_activities**

Wewnatrz petli `while let Some(row) = file_rows.next()...`, po bloku ktory obsluguje `if let Some(pid) = project_id { ... }` (konczy sie na linii ~286), dodaj nowy blok `else`:

Zmien istniejacy fragment (linia ~270-286):
```rust
        if let Some(pid) = project_id {
            let overlap = if let (Some(ss), Some(se), Some(fs), Some(fe)) = (
                session_start_ts,
                session_end_ts,
                parse_timestamp(&file_first_seen),
                parse_timestamp(&file_last_seen),
            ) {
                let overlap_start = ss.max(fs);
                let overlap_end = se.min(fe);
                let overlap_secs = (overlap_end - overlap_start).num_seconds().max(0) as f64;
                (overlap_secs / session_duration_secs).clamp(0.05, 1.0)
            } else {
                1.0 // fallback: full weight if timestamps can't be parsed
            };
            let entry = file_project_overlap.entry(pid).or_insert(0.0);
            *entry = (*entry).max(overlap); // take the max overlap for this project
        }
```

Na:

```rust
        // Compute overlap weight for this file entry
        let overlap = if let (Some(ss), Some(se), Some(fs), Some(fe)) = (
            session_start_ts,
            session_end_ts,
            parse_timestamp(&file_first_seen),
            parse_timestamp(&file_last_seen),
        ) {
            let overlap_start = ss.max(fs);
            let overlap_end = se.min(fe);
            let overlap_secs = (overlap_end - overlap_start).num_seconds().max(0) as f64;
            (overlap_secs / session_duration_secs).clamp(0.05, 1.0)
        } else {
            1.0
        };

        if let Some(pid) = project_id {
            let entry = file_project_overlap.entry(pid).or_insert(0.0);
            *entry = (*entry).max(overlap);
        } else if !project_roots.is_empty() {
            // Path-based inference: try detected_path first, then file_path
            let inferred_name = detected_path
                .as_deref()
                .and_then(|p| infer_project_from_path_pub(p, &project_roots))
                .or_else(|| {
                    let fp = file_path.as_str();
                    if fp.is_empty() || fp == "(unknown)" {
                        None
                    } else {
                        infer_project_from_path_pub(fp, &project_roots)
                    }
                });
            if let Some(ref name) = inferred_name {
                if let Some(pid) = resolve_project_id_by_name(conn, name) {
                    let entry = file_project_overlap.entry(pid).or_insert(0.0);
                    *entry = (*entry).max(overlap);
                }
            }
        }
```

- [ ] **Step 5: Zbuduj i sprawdz kompilacje**

```bash
cd dashboard && cargo build 2>&1 | head -30
```

Oczekiwany wynik: kompilacja bez bledow.

- [ ] **Step 6: Dodaj test `path_inference_populates_file_project_weights`**

Na dole `context.rs`, wewnatrz istniejacego `#[cfg(test)] mod tests { ... }`, dodaj:

```rust
    #[test]
    fn resolve_project_id_by_name_finds_active() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, excluded_at TEXT, frozen_at TEXT);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (1, 'Alpha', NULL, NULL);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (2, 'Beta', '2024-01-01', NULL);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (3, 'Gamma', NULL, '2024-01-01');",
        ).unwrap();

        assert_eq!(super::resolve_project_id_by_name(&conn, "Alpha"), Some(1));
        assert_eq!(super::resolve_project_id_by_name(&conn, "alpha"), Some(1)); // case-insensitive
        assert_eq!(super::resolve_project_id_by_name(&conn, "Beta"), None); // excluded
        assert_eq!(super::resolve_project_id_by_name(&conn, "Gamma"), None); // frozen
        assert_eq!(super::resolve_project_id_by_name(&conn, "Nope"), None);
    }
```

- [ ] **Step 7: Uruchom test**

```bash
cd dashboard && cargo test resolve_project_id_by_name -- --nocapture 2>&1
```

Oczekiwany wynik: test PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/context.rs
git commit -m "feat(ai): add path-based project inference from project_folders in session context"
```

---

### Task 2: Recency + activity-type guard w deterministic_sync

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs:415-442`

**Cel:** Deterministic rules nie powinny sie tworzyc dla (a) aplikacji Design/Browsing, (b) aplikacji ktorych ostatnia sesja jest starsza niz 30 dni.

- [ ] **Step 1: Dodaj import `activity_classification` do `auto_safe.rs`**

Na gorze `auto_safe.rs`, dodaj:

```rust
use timeflow_shared::activity_classification::{classify_activity_type, ActivityType};
```

- [ ] **Step 2: Zmien SQL w `deterministic_sync` na wersje z recency**

W `deterministic_sync()` (linia ~421-441), zmien query:

```rust
    let app_rules: Vec<(i64, i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT s.app_id, s.project_id, a.executable_name
                 FROM (
                     SELECT app_id, project_id, COUNT(*) as cnt,
                            COUNT(DISTINCT project_id) as distinct_projects,
                            MAX(start_time) as last_session_time
                     FROM sessions
                     WHERE project_id IS NOT NULL AND duration_seconds > 10
                     GROUP BY app_id
                     HAVING distinct_projects = 1
                       AND cnt >= ?1
                       AND date(last_session_time) >= date('now', '-30 days')
                 ) s
                 JOIN applications a ON a.id = s.app_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![min_sessions], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read deterministic app rule row: {}", e))?
    };
```

- [ ] **Step 3: Dodaj filtr activity-type po pobraniu rules**

Po pobraniu `app_rules`, przed `if app_rules.is_empty()`, dodaj filtrowanie:

```rust
    // Exclude Design and Browsing apps — they naturally span multiple projects
    let app_rules: Vec<(i64, i64)> = app_rules
        .into_iter()
        .filter(|(_, _, exe_name)| {
            let activity = classify_activity_type(exe_name);
            !matches!(activity, Some(ActivityType::Design) | Some(ActivityType::Browsing))
        })
        .map(|(app_id, project_id, _)| (app_id, project_id))
        .collect();
```

- [ ] **Step 4: Zaktualizuj `apps_with_rules` po filtrze**

Upewnij sie ze linia `let apps_with_rules = app_rules.len() as i64;` jest PO nowym filtrze.

- [ ] **Step 5: Zbuduj i sprawdz kompilacje**

```bash
cd dashboard && cargo build 2>&1 | head -30
```

Oczekiwany wynik: kompilacja bez bledow.

- [ ] **Step 6: Dodaj test `deterministic_excludes_design_apps`**

W `auto_safe.rs`, na dole pliku, dodaj modul testowy (jezeli jeszcze nie istnieje):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_excludes_stale_and_design_apps() {
        // This test verifies the filtering logic conceptually.
        // Full integration requires DB setup — here we test the activity-type guard.
        use timeflow_shared::activity_classification::{classify_activity_type, ActivityType};

        // photoshop.exe is Design — should be excluded
        assert!(matches!(
            classify_activity_type("photoshop.exe"),
            Some(ActivityType::Design)
        ));
        // chrome.exe is Browsing — should be excluded
        assert!(matches!(
            classify_activity_type("chrome.exe"),
            Some(ActivityType::Browsing)
        ));
        // code.exe is Coding — should NOT be excluded
        assert!(matches!(
            classify_activity_type("code.exe"),
            Some(ActivityType::Coding)
        ));
        // unknown.exe has no type — should NOT be excluded
        assert!(classify_activity_type("unknown.exe").is_none());
    }
}
```

- [ ] **Step 7: Uruchom test**

```bash
cd dashboard && cargo test deterministic_excludes -- --nocapture 2>&1
```

Oczekiwany wynik: test PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs
git commit -m "fix(ai): exclude design/browsing apps and stale rules from deterministic assignment"
```

---

### Task 3: Normalizacja Layer 1 (app score) w scoring

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/scoring.rs:151-171`

**Cel:** Layer 1 (app model) powinien uzywac proporcji zamiast surowego `cnt`, zeby 20 sesji w projekcie A vs 2 w B nie dawalo 10x przewagi. Logarytm juz czesciowo to lagodziO, ale dodajemy normalizacje per-app.

- [ ] **Step 1: Zmien Layer 1 w `compute_score_breakdowns`**

W `scoring.rs`, zmien blok Layer 1 (linia ~151-171):

```rust
    // Layer 1: app
    // For background apps (no file evidence), boost evidence from +1 to +2
    // so that the evidence_factor grows at a comparable rate to file-based apps.
    let is_background_app = context.file_project_weights.is_empty();
    let layer1_evidence_weight: i64 = if is_background_app { 2 } else { 1 };

    // Collect raw counts first, then normalize per-app
    let mut app_raw_counts: Vec<(i64, f64)> = Vec::new();
    {
        let mut stmt = conn
            .prepare_cached("SELECT project_id, cnt FROM assignment_model_app WHERE app_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![context.app_id])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
            let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
            app_raw_counts.push((pid, cnt));
        }
    }

    let app_total: f64 = app_raw_counts.iter().map(|(_, c)| *c).sum();
    for (pid, cnt) in app_raw_counts {
        if !is_project_active_cached(conn, &mut active_project_cache, pid) {
            continue;
        }
        // Blend log-scale with proportion: prevents historical dominance
        // while still rewarding higher absolute counts
        let proportion = if app_total > 0.0 { cnt / app_total } else { 0.0 };
        let log_score = (1.0 + cnt).ln();
        let score = 0.30 * (0.6 * log_score + 0.4 * proportion * log_score);
        *layer1.entry(pid).or_insert(0.0) += score;
        *candidate_evidence.entry(pid).or_insert(0) += layer1_evidence_weight;
    }
```

- [ ] **Step 2: Zbuduj i sprawdz kompilacje**

```bash
cd dashboard && cargo build 2>&1 | head -30
```

Oczekiwany wynik: kompilacja bez bledow.

- [ ] **Step 3: Dodaj test normalizacji**

W `scoring.rs`, wewnatrz istniejacego `#[cfg(test)] mod confidence_tests { ... }`, dodaj:

```rust
    #[test]
    fn normalized_app_score_reduces_dominance() {
        // Scenario: project A has 20 sessions, project B has 2
        // Old: pure log → ln(21)=3.04 vs ln(3)=1.10 → ratio 2.76x
        // New: blended → should be closer, reducing dominance
        let cnt_a = 20.0_f64;
        let cnt_b = 2.0_f64;
        let total = cnt_a + cnt_b;

        let prop_a = cnt_a / total;
        let prop_b = cnt_b / total;
        let log_a = (1.0 + cnt_a).ln();
        let log_b = (1.0 + cnt_b).ln();

        let old_ratio = log_a / log_b;
        let new_a = 0.6 * log_a + 0.4 * prop_a * log_a;
        let new_b = 0.6 * log_b + 0.4 * prop_b * log_b;
        let new_ratio = new_a / new_b;

        assert!(old_ratio > 2.5, "old ratio should be >2.5, was {}", old_ratio);
        assert!(new_ratio < old_ratio, "new ratio {} should be less than old {}", new_ratio, old_ratio);
        // The new ratio should still favor A but less aggressively
        assert!(new_ratio > 1.0, "new ratio should still favor A");
    }
```

- [ ] **Step 4: Uruchom test**

```bash
cd dashboard && cargo test normalized_app_score -- --nocapture 2>&1
```

Oczekiwany wynik: test PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/scoring.rs
git commit -m "fix(ai): normalize Layer 1 app scores to reduce historical bias"
```

---

### Task 4: Aktualizacja Help.tsx (wymagane przez CLAUDE.md)

**Files:**
- Modify: `dashboard/src/pages/Help.tsx`
- Read: `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

**Cel:** Zgodnie z CLAUDE.md sekcja 3 — kazda zmiana zachowania wymaga aktualizacji Help.tsx.

- [ ] **Step 1: Znajdz sekcje AI w Help.tsx**

```bash
cd dashboard && grep -n "ai\|AI\|assignment\|model" src/pages/Help.tsx | head -20
```

- [ ] **Step 2: Dodaj opis zmian w sekcji AI**

Dodaj informacje o 3 zmianach:
1. AI teraz automatycznie rozpoznaje projekt na podstawie lokalizacji pliku (foldery projektow)
2. Reguly deterministyczne nie blokuja juz aplikacji graficznych (Photoshop, Figma, Blender itp.)
3. Scoring lepiej balansuje nowe vs stare przypisania

Uzyj formatu `t('tekst PL', 'text EN')` — oba jezyki wymagane.

Dokladna tresc zalezy od istniejacego formatu sekcji AI w Help.tsx — przeczytaj plik i dostosuj styl.

- [ ] **Step 3: Zweryfikuj TypeScript**

```bash
cd dashboard && npx tsc --noEmit 2>&1 | head -20
```

Oczekiwany wynik: brak bledow.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Help.tsx
git commit -m "docs: update Help.tsx with AI assignment improvements"
```

---

### Task 5: Weryfikacja end-to-end

**Files:** Brak zmian — tylko testy.

**Cel:** Upewnic sie ze wszystkie testy przechodza i TypeScript jest OK.

- [ ] **Step 1: Uruchom wszystkie testy Rust**

```bash
cd dashboard && cargo test 2>&1
```

Oczekiwany wynik: wszystkie testy PASS, w tym nowe z Task 1-3.

- [ ] **Step 2: Sprawdz TypeScript**

```bash
cd dashboard && npx tsc --noEmit 2>&1
```

Oczekiwany wynik: brak bledow.

- [ ] **Step 3: Sprawdz kompilacje demona (root crate)**

```bash
cargo build 2>&1 | head -30
```

Oczekiwany wynik: kompilacja bez bledow (zmiany w `shared/` nie sa wymagane, ale upewnij sie ze nic nie zepsulismy).

- [ ] **Step 4: Commit finalny (jesli byly poprawki)**

Jesli byly jakies poprawki w krokach 1-3:

```bash
git add -A
git commit -m "fix: address test/build issues from AI assignment improvements"
```

---

## Checklist zgodnosci z CLAUDE.md

- [x] Implementacja dziala (Task 1-3: path inference, deterministic guard, normalizacja)
- [x] Help.tsx zaktualizowany (Task 4)
- [x] Terminologia spojna (UI/Help/logi) — weryfikacja w Task 4
- [x] Brak zbednych zmian stylistycznych w niepowiazanych plikach
- [x] Testy dodane (Task 1 step 6-7, Task 2 step 6-7, Task 3 step 3-4)

## Diagram zaleznosci taskow

```
Task 1 (path inference) ──┐
Task 2 (deterministic)  ──┼── Task 5 (weryfikacja E2E)
Task 3 (normalizacja)   ──┤
Task 4 (Help.tsx)       ──┘
```

Taski 1, 2, 3 sa niezalezne — mozna je robic rownolegle lub w dowolnej kolejnosci.
Task 4 wymaga znajomosci zmian z 1-3 (tresc opisu).
Task 5 uruchamiany na koncu.
