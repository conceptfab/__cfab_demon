# Spójność liczenia czasu (F1–F6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doprowadzić do stanu, w którym każda prezentowana liczba godzin (karta projektu, dashboard, raport, timeline raportu, estymacje, strona Sessions) wywodzi się z jednego kanonicznego źródła (wall-clock z dedupem i podziałem czasu współbieżnego), a sumy sekcji zgadzają się z totalami w każdym trybie zaokrąglania.

**Architektura:** Backend (`time_algorithm.rs`) zyskuje atrybucję czasu efektywnego **per sesja** (udział po dedupie/splicie), zwracaną obok istniejących totali — bez zmiany `total_by_project`/`bucket_project_seconds`. Raport dołącza `effective_seconds` do każdej sesji; timeline i nagłówek liczą z tych samych liczb. Frontend zyskuje jedną funkcję rozkładu zaokrąglenia po strukturze raportu (sesja → dzień → total) używaną spójnie przez nagłówek, timeline i estymacje. Strona Sessions czyta totale grup z kanonu zamiast reimplementacji.

**Tech Stack:** Rust (rusqlite, chrono, `#[cfg(test)]` unit-testy), TypeScript/React, Vitest.

**Decyzje wejściowe (zatwierdzone przez użytkownika 2026-07-03):**
- **F1** → backend `effective_seconds` per sesja (najwyższa wierność).
- **Zakres** → wszystkie F1–F6, fazowo.
- **F4** → tryb `per_session` zaimplementowany naprawdę (round każdej sesji, potem suma) tam, gdzie dostępne są listy sesji/dni (raport, estymacje). W miejscach mających tylko zagregowany total (licznik na Dashboardzie) `per_session` degraduje się do zaokrąglenia agregatu — udokumentowane w Help (brak rozbicia na sesje w tym widoku).
- **F5** → jedna reguła per-tryb wszędzie: `per_total` → round(Σ); `per_session` → Σ round(sesja); `per_day` → Σ round(dzień). Estimates wyrównane do tej reguły.
- **F6** → totale grup na stronie Sessions z kanonu (backend).

**Świadoma zmiana zachowania wymagająca akceptacji (konsekwencja F2):** próg `min_session_duration` (domyślnie 10 s) zaczyna obowiązywać **jednakowo we wszystkich widokach czasu projektu**, w tym na karcie projektu i Dashboardzie. Dziś karta/dashboard liczą total z `min_session_duration: None` (wliczają sesje < progu), a lista sesji/timeline filtruje `>= próg`. Po zmianie wszystkie ścieżki filtrują `>= próg` — karta projektu i Dashboard mogą pokazać minimalnie mniej niż dziś (odjęte zostają sesje krótsze niż próg, dotąd traktowane jako szum). To jedyny sposób, by timeline = total = karta. **Jeśli to niepożądane — alternatywą jest zniesienie filtra z listy sesji raportu (pokazywać wszystkie sesje ≥ 0), co zachowuje dzisiejsze totale, ale zaśmieca listę mikrosesjami. Domyślnie realizujemy wariant „jeden próg wszędzie".**

**Znany, udokumentowany brzeg (F1):** sesja przecinająca północ. Kanon dzieli jej czas między dwa dni (bucket dzienny), a timeline grupuje cały wpis pod dniem `start_time`. Dlatego **grand total timeline = total raportu co do sekundy** (Σ `effective_seconds` = total projektu z definicji), ale total pojedynczego dnia w timeline dla sesji przez północ jest liczony po dniu startu wpisu, nie po podziale bucketowym. Timeline pozostaje wewnętrznie spójny (dzień = Σ jego wpisów), a rozjazd dotyczy wyłącznie przypisania minut sesji przez-północ do dnia startu. Odnotowane w komentarzu i Help.

---

## Struktura plików

**Backend (Rust) — `dashboard/src-tauri/src/commands/`**
- `time_algorithm.rs` — `IntervalInput`, `BucketPiece`, `ActivityOutput`, `WallClockStrategy::compute`, `load_project_intervals`, `compute_project_activity_unique`, nowy typ wyniku per-sesja. Serce zmiany F1.
- `types.rs` — pola `effective_seconds` w `SessionWithApp` i `ManualSessionWithProject`.
- `report.rs` — wpięcie `effective_seconds` do sesji raportu; ujednolicony `min_duration` (F2).
- `projects.rs` — `query_active_project_with_stats` filtruje po `min_duration` (F2).
- `dashboard.rs` / `clients.rs` — przekazanie `min_duration` do totali (F2, spójność).
- `sessions/…` lub `dashboard.rs` — komenda/rozszerzenie zwracające kanoniczne totale per projekt dla strony Sessions (F6).

**Frontend (TS/React) — `dashboard/src/`**
- `lib/rounding.ts` — nowa `distributeReportRounding` (rdzeń F3/F4). Zostają istniejące funkcje.
- `lib/report-timeline.ts` — `buildTimelineDays` grupuje po `effective_seconds` (F1).
- `lib/report-view-formatting.ts` — nagłówek i formatter liczą z jednej `distributeReportRounding` (F3/F4).
- `hooks/useReportViewController.ts` — spina powyższe.
- `pages/report-view/ReportViewTimelineSection.tsx`, `ReportViewSessionsSection.tsx`, `ReportViewManualSessionsSection.tsx` — konsumują nowe wartości.
- `lib/estimate-report.ts` — wyrównanie do reguły per-tryb (F5).
- `lib/db-types.ts` — pola `effective_seconds` po stronie TS.
- `lib/sessions-grouping.ts`, `hooks/useSessionsPageController.ts`, `lib/session-utils.ts` — totale grup z kanonu (F6).
- `pages/Help.tsx` — opis trybów, progu i miar czasu.
- `locales/en.json`, `locales/pl.json` — klucze i18n.

**Testy**
- Rust: `time_algorithm.rs` (`mod tests`), `projects.rs` (`mod tests`).
- TS: `lib/rounding.test.ts`, `lib/report-timeline.test.ts`, nowy `lib/report-consistency.test.ts` (asercje sekcja=total per tryb).

---

## FAZA 1 — Dane: kanoniczny czas per sesja (F1) + jeden próg (F2)

### Task 1: Przeprowadź tożsamość źródła (session id + kind) do interwałów

**Files:**
- Modify: `dashboard/src-tauri/src/commands/time_algorithm.rs` (`IntervalInput` ~:88-96, `BucketPiece` ~:207-214, `load_project_intervals` SQL ~:551-641)

- [ ] **Step 1: Test — interwały niosą stabilny klucz źródła**

W `mod tests` (`time_algorithm.rs`) dodaj test na nowy helper `source_key`:

```rust
#[test]
fn source_key_is_unique_across_auto_and_manual() {
    // auto i manual o tym samym id nie kolidują
    assert_ne!(source_key(false, 5), source_key(true, 5));
    assert_eq!(source_key(false, 5), source_key(false, 5));
}
```

- [ ] **Step 2: Uruchom — ma nie kompilować (brak `source_key`)**

Run: `cd dashboard/src-tauri && cargo test source_key_is_unique -q`
Expected: błąd kompilacji „cannot find function `source_key`".

- [ ] **Step 3: Dodaj `source_key` + pola źródła**

W `time_algorithm.rs`:

```rust
/// Stabilny klucz źródła interwału: rozłączny między sesjami auto i manualnymi
/// o tym samym `id`. Używany do atrybucji czasu efektywnego per sesja.
pub(crate) fn source_key(is_manual: bool, id: i64) -> String {
    if is_manual { format!("m{id}") } else { format!("a{id}") }
}
```

Do `IntervalInput` dodaj pole:

```rust
    pub source_key: String,
```

Do `BucketPiece` dodaj pole:

```rust
    source_key: String,
```

- [ ] **Step 4: Wczytaj id źródła w SQL i zbuduj `source_key`**

W `load_project_intervals` SQL dołóż `sp.id` / `ms.id` jako pierwsze kolumny obu gałęzi UNION (nazwa aliasu `src_id`) i `is_manual` już jest. Zmień closure `query_map`, by czytała `src_id`, oraz budowanie `IntervalInput`:

```rust
// w SELECT gałęzi sesji:  sp.id as src_id, sp.start_time, ...
// w SELECT gałęzi manual: ms.id as src_id, ms.start_time, ...
```

W pętli budującej interwały:

```rust
let is_manual = row.6 != 0;
let src_id = row_src_id; // odczyt z "src_id"
intervals.push(IntervalInput {
    start,
    end,
    project_key: series.key.clone(),
    multiplier: row.5,
    is_manual,
    comment: row.7.clone(),
    source_key: source_key(is_manual, src_id),
});
```

(Odczyt `src_id`: dodaj `row.get::<_, i64>("src_id")?` na początku krotki i przenumeruj indeksy.)

W `WallClockStrategy::compute`, przy tworzeniu `BucketPiece`, przekaż `source_key: interval.source_key.clone()`.

- [ ] **Step 5: Uruchom cały suite testów algorytmu**

Run: `cd dashboard/src-tauri && cargo test --lib commands::time_algorithm -q`
Expected: PASS (istniejące testy bez zmian zachowania — dodaliśmy tylko pola).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/time_algorithm.rs
git commit -m "feat(time): thread per-source identity into activity intervals"
```

### Task 2: Atrybucja czasu efektywnego per sesja w sweep-line

**Files:**
- Modify: `dashboard/src-tauri/src/commands/time_algorithm.rs` (`ActivityOutput` ~:106-111, inner loop ~:765-812)

- [ ] **Step 1: Test — dwie sesje tego samego projektu, nakładka**

```rust
#[test]
fn effective_seconds_split_within_and_across_projects() {
    // Projekt P1: sesja A 10:00-11:00 (a1), sesja B 10:30-11:00 (a2).
    // Wall-clock P1 = 60 min. Atrybucja: A=45m (30 solo + 15 współ), B=15m.
    let range = day_range("2026-03-01");
    let out = WallClockStrategy.compute(
        &[
            interval("2026-03-01T10:00:00", "2026-03-01T11:00:00", "p:1", "a1"),
            interval("2026-03-01T10:30:00", "2026-03-01T11:00:00", "p:1", "a2"),
        ],
        &range,
    );
    let eff = &out.effective_by_source;
    assert_eq!(eff.get("a1").copied().unwrap_or(0.0).round() as i64, 2700); // 45m
    assert_eq!(eff.get("a2").copied().unwrap_or(0.0).round() as i64, 900);  // 15m
    // niezmiennik: suma efektywnych = total projektu
    let total_p1 = out.total_by_project.get("p:1").copied().unwrap();
    assert!((eff.values().sum::<f64>() - total_p1).abs() < 1e-6);
}
```

Dodaj lokalne helpery testowe (jeśli brak): `day_range(&str) -> ComputeRange` i `interval(start,end,project_key,source_key) -> IntervalInput` (wzoruj się na istniejącym budowaniu `IntervalInput`; `multiplier:1.0, is_manual:false, comment:None`).

- [ ] **Step 2: Uruchom — FAIL (brak `effective_by_source`)**

Run: `cd dashboard/src-tauri && cargo test effective_seconds_split -q`
Expected: błąd kompilacji „no field `effective_by_source`".

- [ ] **Step 3: Dodaj pole wyniku i policz atrybucję**

Do `ActivityOutput`:

```rust
    /// Czas efektywny (po dedupie i podziale czasu współbieżnego) per klucz źródła.
    /// Niezmiennik: Σ po źródłach danego projektu == jego total_by_project.
    effective_by_source: HashMap<String, f64>,
```

W inner loop zamień śledzenie `active: HashMap<String,i32>` (klucz = projekt) na śledzenie źródeł z przypisanym projektem. Kluczowy fragment podziału:

```rust
let mut active: HashMap<String, (String, i32)> = HashMap::new(); // source_key -> (project_key, count)
// ... przy delcie:
if current_ms > prev_ms && !active.is_empty() {
    let delta_seconds = (current_ms - prev_ms) as f64 / 1000.0;
    // aktywne źródła pogrupowane po projekcie
    let mut sources_by_project: HashMap<String, Vec<String>> = HashMap::new();
    for (src, (proj, count)) in active.iter() {
        if *count > 0 {
            sources_by_project.entry(proj.clone()).or_default().push(src.clone());
        }
    }
    let project_count = sources_by_project.len();
    if project_count > 0 {
        let project_share = delta_seconds / project_count as f64;
        for (proj, srcs) in sources_by_project {
            *seconds_for_bucket.entry(proj.clone()).or_insert(0.0) += project_share;
            *total_by_project.entry(proj).or_insert(0.0) += project_share;
            let per_source = project_share / srcs.len() as f64;
            for src in srcs {
                *effective_by_source.entry(src).or_insert(0.0) += per_source;
            }
        }
    }
}
```

Zdarzenia muszą nieść `source_key` i `project_key`:

```rust
// events: (ms, delta, source_key, project_key)
for slice in slices {
    if slice.end_ms <= slice.start_ms { continue; }
    events.push((slice.start_ms, 1, slice.source_key.clone(), slice.project_key.clone()));
    events.push((slice.end_ms, -1, slice.source_key, slice.project_key));
}
events.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
// aktualizacja `active` po source_key:
while i < events.len() && events[i].0 == current_ms {
    let (delta, src, proj) = (events[i].1, events[i].2.clone(), events[i].3.clone());
    let entry = active.entry(src.clone()).or_insert((proj, 0));
    entry.1 += delta;
    if entry.1 <= 0 { active.remove(&src); }
    i += 1;
}
```

Zadeklaruj `let mut effective_by_source: HashMap<String, f64> = HashMap::new();` obok pozostałych akumulatorów i zwróć je w `ActivityOutput { … , effective_by_source }`.

- [ ] **Step 4: Uruchom nowy test + regresję**

Run: `cd dashboard/src-tauri && cargo test --lib commands::time_algorithm -q`
Expected: PASS (nowy test zielony; `total_by_project` niezmienione → stare testy zielone).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/time_algorithm.rs
git commit -m "feat(time): attribute deduplicated wall-clock seconds per session"
```

### Task 3: Udostępnij mapę czasu efektywnego per sesja z hosta

**Files:**
- Modify: `dashboard/src-tauri/src/commands/time_algorithm.rs` (`ProjectActivityUniqueResult` ~:271-277, `compute_project_activity_unique` ~:402-444)

- [ ] **Step 1: Test — host zwraca `effective_by_source`**

```rust
#[test]
fn compute_unique_exposes_effective_by_source() {
    let conn = test_conn_time(); // patrz helper w mod tests
    conn.execute_batch(
        "INSERT INTO projects (id,name,created_at) VALUES (1,'P',datetime('now'));
         INSERT INTO applications (id,executable_name,display_name,project_id) VALUES (1,'code','Code',1);
         INSERT INTO sessions (id,app_id,start_time,end_time,duration_seconds)
           VALUES (10,1,'2026-03-01T10:00:00','2026-03-01T11:00:00',3600),
                  (11,1,'2026-03-01T10:30:00','2026-03-01T11:00:00',1800);",
    ).unwrap();
    let range = DateRange { start: "2026-03-01".into(), end: "2026-03-01".into() };
    let (_b, totals, _m, _f, _c, effective) =
        compute_project_activity_unique(&conn, &range, false, true, None, None, true).unwrap();
    let total: f64 = totals.values().sum();
    let eff: f64 = effective.values().sum();
    assert!((total - eff).abs() < 1e-6, "Σ effective == Σ total");
    assert_eq!(effective.get("a10").copied().unwrap().round() as i64, 2700);
}
```

- [ ] **Step 2: Uruchom — FAIL (krotka 5-elementowa)**

Run: `cd dashboard/src-tauri && cargo test compute_unique_exposes_effective -q`
Expected: błąd typu — wynik ma 5 pól, test oczekuje 6.

- [ ] **Step 3: Rozszerz typ wyniku o szósty element**

W `ProjectActivityUniqueResult` dodaj `HashMap<String, f64>` (effective per source). W `compute_project_activity_unique` przenieś `output.effective_by_source` przez `fold_merged_series` (efektywne źródła nie wymagają foldowania — klucz źródła nie zmienia projektu; wystarczy przekazać mapę bez zmian) i zwróć jako ostatni element krotki. W gałęzi `intervals.is_empty()` zwróć dodatkowo `HashMap::new()`.

- [ ] **Step 4: Zaktualizuj wszystkich wywołujących `compute_project_activity_unique`**

Znajdź i dopnij nowy element krotki (destrukturyzacja) u wszystkich konsumentów. Miejsca: `projects.rs:434`, `projects.rs:637`, `dashboard.rs:229`, `dashboard.rs:294`, `clients.rs:754` (użyj `let (…, _effective) = …` tam, gdzie na razie nieużywane).

Run pomocniczo: `rg -n "compute_project_activity_unique\(" dashboard/src-tauri/src`

- [ ] **Step 5: Uruchom pełny build testów**

Run: `cd dashboard/src-tauri && cargo test --lib -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/time_algorithm.rs dashboard/src-tauri/src/commands/projects.rs dashboard/src-tauri/src/commands/dashboard.rs dashboard/src-tauri/src/commands/clients.rs
git commit -m "feat(time): expose per-session effective seconds from activity host"
```

### Task 4: Jeden próg `min_duration` na karcie projektu (F2)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/projects.rs` (`query_active_project_with_stats` ~:633-655)

- [ ] **Step 1: Test — sesja poniżej progu nie wchodzi do totalu karty**

W `projects.rs mod tests`:

```rust
#[test]
fn project_card_total_honors_min_duration() {
    let conn = test_conn();
    conn.execute_batch(
        "INSERT INTO projects (id,name,created_at) VALUES (1,'P',datetime('now'));
         INSERT INTO applications (id,executable_name,display_name,project_id) VALUES (1,'code','Code',1);
         INSERT INTO sessions (id,app_id,start_time,end_time,duration_seconds)
           VALUES (1,1,'2026-03-01T10:00:00','2026-03-01T11:00:00',3600),
                  (2,1,'2026-03-01T12:00:00','2026-03-01T12:00:05',5);",
    ).unwrap();
    // próg 10 s → mikrosesja 5 s odpada
    let stats = query_active_project_with_stats_with_min(&conn, 1, 10).unwrap();
    assert_eq!(stats.total_seconds, 3600, "5s session excluded by threshold");
}
```

- [ ] **Step 2: Uruchom — FAIL (brak wariantu z progiem)**

Run: `cd dashboard/src-tauri && cargo test project_card_total_honors_min_duration -q`
Expected: błąd — brak `query_active_project_with_stats_with_min`.

- [ ] **Step 3: Wprowadź próg do obliczenia totalu**

Zmień `compute_project_activity_unique(conn, &all_time_range, false, true, None, None, true)` w `query_active_project_with_stats` tak, by 6. argument = `Some(min_duration)`. Sygnaturę rozszerz o `min_duration: i64`, dodaj cienki wrapper zachowujący dotychczasowe API:

```rust
pub(crate) fn query_active_project_with_stats(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<ProjectWithStats, String> {
    let min_duration = load_persisted_session_min_duration();
    query_active_project_with_stats_with_min(conn, id, min_duration)
}

pub(crate) fn query_active_project_with_stats_with_min(
    conn: &rusqlite::Connection,
    id: i64,
    min_duration: i64,
) -> Result<ProjectWithStats, String> {
    // …dotychczasowe ciało, z compute_project_activity_unique(…, Some(min_duration), true)…
}
```

> Uwaga: `load_persisted_session_min_duration` żyje w `super::daemon`. Zaimportuj je w `projects.rs` (`use super::daemon::load_persisted_session_min_duration;`).

- [ ] **Step 4: Uruchom test progu + regresję listy**

Run: `cd dashboard/src-tauri && cargo test --lib commands::projects -q`
Expected: PASS (istniejące testy list operują na sesjach ≥ progu, więc bez zmian).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/projects.rs
git commit -m "fix(report): apply min_session_duration to project card total (F2)"
```

### Task 5: Dołącz `effective_seconds` do sesji raportu (F1 backend → API)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs` (`SessionWithApp` ~:110, `ManualSessionWithProject` ~:461)
- Modify: `dashboard/src-tauri/src/commands/report.rs` (`get_project_report_data` ~:112-214)

- [ ] **Step 1: Test — suma `effective_seconds` sesji = total raportu**

W `report.rs` dodaj `#[cfg(test)] mod tests` (jeśli brak) z testem integracyjnym na `test_conn`:

```rust
#[test]
fn report_effective_seconds_sum_matches_total() {
    let conn = test_conn();
    conn.execute_batch(
        "INSERT INTO projects (id,name,created_at) VALUES (1,'P',datetime('now'));
         INSERT INTO applications (id,executable_name,display_name,project_id) VALUES (1,'code','Code',1);
         INSERT INTO sessions (id,app_id,start_time,end_time,duration_seconds)
           VALUES (1,1,'2026-03-01T10:00:00','2026-03-01T11:00:00',3600),
                  (2,1,'2026-03-01T10:30:00','2026-03-01T11:00:00',1800);",
    ).unwrap();
    let (sessions, total) = compute_report_sessions_with_effective(&conn, 1, all_time(), 0).unwrap();
    let sum_eff: i64 = sessions.iter().map(|s| s.effective_seconds).sum();
    assert_eq!(sum_eff, total, "Σ effective == total raportu");
}
```

- [ ] **Step 2: Uruchom — FAIL (brak pola/funkcji)**

Run: `cd dashboard/src-tauri && cargo test report_effective_seconds_sum -q`
Expected: błąd kompilacji.

- [ ] **Step 3: Dodaj pola i policz efektywne w raporcie**

W `types.rs` dodaj do `SessionWithApp` i `ManualSessionWithProject`:

```rust
    /// Czas efektywny (kanon: dedup + podział czasu współbieżnego). Suma po sesjach
    /// raportu == total projektu. Do timeline i sum sekcji. `duration_seconds`
    /// pozostaje surowe (dla informacyjnej kolumny czasu sesji).
    #[serde(default)]
    pub effective_seconds: i64,
```

W `report.rs` policz mapę efektywną raz (kanon), rozdziel po sesjach. Dodaj funkcję (używaną też w teście):

```rust
fn compute_effective_by_source(
    conn: &rusqlite::Connection,
    project_id: i64,
    min_duration: i64,
) -> Result<std::collections::HashMap<String, f64>, String> {
    let range = super::analysis::query_activity_date_range(conn)?
        .unwrap_or(DateRange { start: "0001-01-01".into(), end: "0001-01-01".into() });
    let (_b, _t, _m, _f, _c, effective) = super::time_algorithm::compute_project_activity_unique(
        conn, &range, false, true, None, Some(min_duration), true,
    )?;
    Ok(effective)
}
```

Po złączeniu `sessions` i `manual_sessions` w `get_project_report_data`, przypisz `effective_seconds` (zaokrąglone do i64) każdemu wpisowi wg `source_key`:

```rust
let effective = compute_effective_by_source(&conn_for_eff, project_id, min_duration)?; // uruchom w run_db_blocking
for s in sessions.iter_mut() {
    s.effective_seconds = effective
        .get(&super::time_algorithm::source_key(false, s.id))
        .copied().unwrap_or(0.0).round() as i64;
}
for m in manual_sessions.iter_mut() {
    m.effective_seconds = effective
        .get(&super::time_algorithm::source_key(true, m.id))
        .copied().unwrap_or(0.0).round() as i64;
}
```

> `min_duration` = `load_persisted_session_min_duration()` (już w pliku, `report.rs:125`). Lista sesji raportu już filtruje `>= min_duration` (`report.rs:75`) — teraz total (Task 4) i efektywne używają tego samego progu, więc Σ się domyka. Zadbaj, by pobranie `effective` szło przez `run_db_blocking` (jak inne zapytania) — dodaj piąty spawn albo policz sekwencyjnie po złączeniu sesji.

- [ ] **Step 4: Uruchom test + pełny suite**

Run: `cd dashboard/src-tauri && cargo test --lib -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs dashboard/src-tauri/src/commands/report.rs
git commit -m "feat(report): attach canonical effective_seconds to report sessions (F1)"
```

### Task 6: Typy TS + timeline grupuje po `effective_seconds` (F1 frontend)

**Files:**
- Modify: `dashboard/src/lib/db-types.ts` (`Session` ~:26, `ManualSessionWithProject` ~:496)
- Modify: `dashboard/src/lib/report-timeline.ts` (`buildTimelineDays` ~:24-67)
- Modify: `dashboard/src/lib/report-timeline.test.ts`

- [ ] **Step 1: Test — timeline sumuje `effective_seconds`, nie surowe**

W `report-timeline.test.ts` dodaj:

```ts
it('day total uses effective_seconds (dedup), not raw duration', () => {
  const days = buildTimelineDays(
    [
      makeAuto({ id: 1, start_time: '2026-03-01T10:00:00', duration_seconds: 3600, effective_seconds: 2700 }),
      makeAuto({ id: 2, start_time: '2026-03-01T10:30:00', duration_seconds: 1800, effective_seconds: 900 }),
    ],
    [],
  );
  expect(days[0]?.totalSeconds).toBe(3600);            // 2700 + 900 = pełny dedup
  expect(days[0]?.entries.map((e) => e.durationSeconds)).toEqual([2700, 900]); // wpisy = efektywne
});
```

Rozszerz `makeAuto`/`makeManual` o `effective_seconds` w domyślnym obiekcie (np. równe `duration_seconds` tam, gdzie nieistotne).

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd dashboard && npx vitest run src/lib/report-timeline.test.ts -t "effective_seconds"`
Expected: FAIL (dziś sumuje `duration_seconds`: 3600+1800=5400).

- [ ] **Step 3: Dodaj pole TS i przełącz timeline na efektywne**

W `db-types.ts` dodaj `effective_seconds?: number;` do `Session` (dziedziczy `SessionWithApp`) i do `ManualSessionWithProject`.

W `report-timeline.ts` w mapowaniu wpisów użyj efektywnego czasu jako `durationSeconds` (fallback do surowego, gdy pole nieobecne — kompatybilność):

```ts
durationSeconds: s.effective_seconds ?? s.duration_seconds,
```

(oba źródła: auto i manual). Suma dnia `last.totalSeconds += entry.durationSeconds` pozostaje — teraz operuje na efektywnych, więc dzień = Σ efektywnych wpisów.

- [ ] **Step 4: Uruchom test**

Run: `cd dashboard && npx vitest run src/lib/report-timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/db-types.ts dashboard/src/lib/report-timeline.ts dashboard/src/lib/report-timeline.test.ts
git commit -m "feat(report): timeline groups by canonical effective_seconds (F1)"
```

### Checkpoint Fazy 1

- [ ] Uruchom: `cd dashboard/src-tauri && cargo test --lib -q` → PASS
- [ ] Uruchom: `cd dashboard && npx vitest run` → PASS
- [ ] Manualnie (scenariusz 1 z audytu): projekt z dwiema nakładającymi się sesjami → w raporcie suma dni timeline == „Total time". Zapisz wynik obserwacji.

---

## FAZA 2 — Zaokrąglanie spójne ze strukturą raportu (F3 + F4)

### Task 7: `distributeReportRounding` — jedna kotwica zaokrąglenia per tryb

**Files:**
- Modify: `dashboard/src/lib/rounding.ts` (po `roundDailyTotals`)
- Modify: `dashboard/src/lib/rounding.test.ts`

- [ ] **Step 1: Test — trzy tryby, niezmiennik dzień=Σwpisów, total=Σdni**

W `rounding.test.ts`:

```ts
describe('distributeReportRounding', () => {
  // dzień 1: sesje 600s + 600s (10m + 10m); dzień 2: 1200s (20m). Σ surowa = 2400s (40m).
  const days = [
    { date: '2026-03-01', sessionSeconds: [600, 600] },
    { date: '2026-03-02', sessionSeconds: [1200] },
  ];

  it('disabled → raw entries, day = Σ entries, total = Σ days', () => {
    const r = distributeReportRounding(days, settings({ enabled: false }));
    expect(r.days[0]!.entrySeconds).toEqual([600, 600]);
    expect(r.days[0]!.daySeconds).toBe(1200);
    expect(r.totalSeconds).toBe(2400);
  });

  it('per_total → entries raw, total rounded once', () => {
    const r = distributeReportRounding(days, settings({ enabled: true, mode: 'per_total', intervalMinutes: 15 }));
    expect(r.days[0]!.entrySeconds).toEqual([600, 600]); // surowe
    expect(r.days[0]!.daySeconds).toBe(1200);            // dzień surowy
    expect(r.totalSeconds).toBe(2700);                    // Σ=2400s (40m) → round do 45m = 2700s
  });

  it('per_session → each session rounded, day = Σ rounded, total = Σ days', () => {
    const r = distributeReportRounding(days, settings({ enabled: true, mode: 'per_session', intervalMinutes: 15 }));
    expect(r.days[0]!.entrySeconds).toEqual([900, 900]);  // 10m → 15m każda
    expect(r.days[0]!.daySeconds).toBe(1800);             // = Σ zaokrąglonych sesji
    expect(r.days[1]!.entrySeconds).toEqual([1800]);      // 20m → 30m
    expect(r.totalSeconds).toBe(1800 + 1800);             // Σ dni = 3600
  });

  it('per_day → each day rounded to full hour, total = Σ days', () => {
    const r = distributeReportRounding(days, settings({ enabled: true, mode: 'per_day' }));
    expect(r.days[0]!.daySeconds).toBe(3600); // 1200s → 1h
    expect(r.totalSeconds).toBe(3600 + 3600); // 1200s → 1h
  });
});
```

- [ ] **Step 2: Uruchom — FAIL (brak funkcji)**

Run: `cd dashboard && npx vitest run src/lib/rounding.test.ts -t distributeReportRounding`
Expected: FAIL (`distributeReportRounding is not defined`).

- [ ] **Step 3: Zaimplementuj funkcję**

W `rounding.ts`:

```ts
export interface ReportDayInput {
  date: string;
  /** Czas efektywny (już zdedupowany) per sesja w tym dniu. */
  sessionSeconds: readonly number[];
}
export interface ReportDayRounded {
  date: string;
  entrySeconds: number[];
  daySeconds: number;
}
export interface ReportRounding {
  days: ReportDayRounded[];
  totalSeconds: number;
}

/**
 * Rozkłada zaokrąglenie na strukturę raportu (sesja → dzień → total) wg trybu.
 * Jedna kotwica dla nagłówka, timeline i sum sekcji, żeby wpisy sumowały się do
 * dnia, a dni do totalu w KAŻDYM trybie:
 * - disabled/per_total: wpisy surowe; total = round(Σ) (per_total) lub Σ (disabled).
 * - per_session:        każda sesja round; dzień = Σ round(sesja); total = Σ dni.
 * - per_day:            dzień = round(Σ dnia) do pełnej godziny; total = Σ dni.
 */
export function distributeReportRounding(
  days: readonly ReportDayInput[],
  settings: RoundingSettings,
): ReportRounding {
  const sum = (xs: readonly number[]) =>
    xs.reduce((a, s) => a + (Number.isFinite(s) && s > 0 ? s : 0), 0);

  if (!settings.enabled) {
    const rd = days.map((d) => ({
      date: d.date,
      entrySeconds: [...d.sessionSeconds],
      daySeconds: sum(d.sessionSeconds),
    }));
    return { days: rd, totalSeconds: rd.reduce((a, d) => a + d.daySeconds, 0) };
  }

  if (settings.mode === 'per_session') {
    const rd = days.map((d) => {
      const entrySeconds = d.sessionSeconds.map((s) => roundSeconds(s, settings.intervalMinutes));
      return { date: d.date, entrySeconds, daySeconds: sum(entrySeconds) };
    });
    return { days: rd, totalSeconds: rd.reduce((a, d) => a + d.daySeconds, 0) };
  }

  if (settings.mode === 'per_day') {
    const rd = days.map((d) => ({
      date: d.date,
      entrySeconds: [...d.sessionSeconds], // wpisy surowe; dzień zaokrąglony jako całość
      daySeconds: roundSeconds(sum(d.sessionSeconds), FULL_HOUR_MINUTES),
    }));
    return { days: rd, totalSeconds: rd.reduce((a, d) => a + d.daySeconds, 0) };
  }

  // per_total: wpisy i dni surowe; jeden zaokrąglony total.
  const rd = days.map((d) => ({
    date: d.date,
    entrySeconds: [...d.sessionSeconds],
    daySeconds: sum(d.sessionSeconds),
  }));
  const rawTotal = rd.reduce((a, d) => a + d.daySeconds, 0);
  return { days: rd, totalSeconds: roundSeconds(rawTotal, settings.intervalMinutes) };
}
```

- [ ] **Step 4: Uruchom test**

Run: `cd dashboard && npx vitest run src/lib/rounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/rounding.ts dashboard/src/lib/rounding.test.ts
git commit -m "feat(rounding): add report-structure rounding distribution (F3/F4)"
```

### Task 8: Nagłówek raportu i timeline liczą z `distributeReportRounding`

**Files:**
- Modify: `dashboard/src/lib/report-view-formatting.ts` (`computeReportDisplayValues` ~:11-54)
- Modify: `dashboard/src/hooks/useReportViewController.ts` (~:115-152)
- Modify: `dashboard/src/pages/report-view/ReportViewTimelineSection.tsx` (~:36-113)
- Create: `dashboard/src/lib/report-consistency.test.ts`

- [ ] **Step 1: Test — sekcja = total w każdym trybie (integracja)**

Nowy `report-consistency.test.ts`: zbuduj `TimelineDay[]` + policz `distributeReportRounding` na tych samych danych i asertuj, że suma dni timeline (przez tę funkcję) == `displayTotal` nagłówka. Przykład szkieletu:

```ts
import { describe, expect, it } from 'vitest';
import { distributeReportRounding } from '@/lib/rounding';
import { DEFAULT_ROUNDING_SETTINGS } from '@/lib/rounding';

const days = [
  { date: '2026-03-01', sessionSeconds: [2700, 900] }, // efektywne
  { date: '2026-03-02', sessionSeconds: [1200] },
];

for (const mode of ['per_total', 'per_session', 'per_day'] as const) {
  it(`timeline days sum equals total in ${mode}`, () => {
    const r = distributeReportRounding(days, {
      ...DEFAULT_ROUNDING_SETTINGS, enabled: true, mode, intervalMinutes: 15,
    });
    const daysSum = r.days.reduce((a, d) => a + d.daySeconds, 0);
    if (mode === 'per_total') {
      // per_total: total zaokrąglony raz, sumy dni surowe — nagłówek pokazuje total,
      // timeline pokazuje surowe dni; test pilnuje że total = round(Σ dni surowych)
      expect(r.totalSeconds).toBeGreaterThanOrEqual(daysSum);
    } else {
      expect(daysSum).toBe(r.totalSeconds);
    }
  });
}
```

- [ ] **Step 2: Uruchom — PASS od razu (test pilnuje kontraktu funkcji z Task 7)**

Run: `cd dashboard && npx vitest run src/lib/report-consistency.test.ts`
Expected: PASS. (Ten test to regresja kontraktu; kolejne kroki podpinają go do UI.)

- [ ] **Step 3: Policz strukturę zaokrągleń raz w kontrolerze**

W `useReportViewController.ts` zbuduj `reportRounding` z `timelineDays` (efektywne sesje per dzień) i `roundingSettings`, tylko gdy `rounded`:

```ts
const reportRounding = useMemo(() => {
  if (!timelineDays) return null;
  const input = timelineDays.map((d) => ({
    date: d.date,
    sessionSeconds: d.entries.map((e) => e.durationSeconds), // = effective
  }));
  return distributeReportRounding(input, rounded ? roundingSettings : { ...roundingSettings, enabled: false });
}, [timelineDays, rounded, roundingSettings]);
```

Zwróć `reportRounding` z kontrolera.

- [ ] **Step 4: Nagłówek bierze total z tej samej struktury**

W `computeReportDisplayValues` przyjmij opcjonalny `reportRounding` i, gdy podany, ustaw `displayTotal = reportRounding.totalSeconds` (zamiast lokalnego `roundSeconds`/`roundDailyTotals`). Zachowaj skalowanie wartości `scaleValueToRounded(estimate, valueBaseSeconds, displayTotal)` bez zmian. To gwarantuje, że nagłówek i timeline dzielą JEDEN total.

- [ ] **Step 5: Timeline renderuje z `reportRounding` (dzień + wpisy zgodne)**

W `ReportViewTimelineSection.tsx` przyjmij `reportRounding` i mapuj dni po dacie: nagłówek dnia = `daySeconds`, wpisy = `entrySeconds[i]` (fallback do `entry.durationSeconds`, gdy brak). Zamiast `fmtDur(day.totalSeconds)` użyj `fmtDurRaw(dayRounded.daySeconds)`; zamiast `fmtDur(entry.durationSeconds)` użyj `fmtDurRaw(entrySeconds[i])`. `fmtDurRaw` = surowy formatter (bez ponownego zaokrąglania — wartości są już rozłożone). Dzięki temu Σ wpisów == nagłówek dnia w trybie per_session/disabled.

> Uwaga: w `per_total`/`per_day` wpisy są surowe (celowo), a zaokrąglony jest total/dzień — to zgodne z regułą per-tryb. Nagłówek dnia w per_day = pełna godzina; wpisy pod nim surowe (informacyjne). Odnotuj w Help.

- [ ] **Step 6: Uruchom testy + typecheck**

Run: `cd dashboard && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, brak błędów typów.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/report-view-formatting.ts dashboard/src/hooks/useReportViewController.ts dashboard/src/pages/report-view/ReportViewTimelineSection.tsx dashboard/src/lib/report-consistency.test.ts
git commit -m "feat(report): single rounding anchor for header + timeline (F3/F4)"
```

### Task 9: Wiersze sesji raportu — surowy czas sesji, bez podwójnego zaokrąglenia

**Files:**
- Modify: `dashboard/src/pages/report-view/ReportViewSessionsSection.tsx` (~:54)
- Modify: `dashboard/src/pages/report-view/ReportViewManualSessionsSection.tsx` (~:59)

- [ ] **Step 1: Test manualny (brak izolowanej logiki) — opis scenariusza**

Sekcje „Sesje"/„Sesje manualne" pokazują czas pojedynczej sesji. Zgodnie z regułą: w `per_session` wiersz = round(sesji); w pozostałych trybach = surowy czas sesji. Zamiast ad-hoc `fmtDur` przekaż wartość z `reportRounding` (mapa po id sesji → `entrySeconds`) lub, gdy sekcja pokazuje `duration_seconds` niezależnie od dnia, użyj `roundSeconds` tylko w `per_session`. Ustal jedno: wiersz sesji = `effective_seconds` sesji, sformatowane `fmtDurRaw`, a w `per_session` `roundSeconds(effective, interval)`.

- [ ] **Step 2: Zamień formatter w obu sekcjach**

Wprowadź w kontrolerze pomocniczy `fmtSessionDur(seconds)`:

```ts
const fmtSessionDur = (seconds: number) =>
  formatDurationRaw(
    rounded && roundingSettings.mode === 'per_session'
      ? roundSeconds(seconds, roundingSettings.intervalMinutes)
      : seconds,
  );
```

W obu sekcjach zamień `fmtDur(s.duration_seconds)` → `fmtSessionDur(s.effective_seconds ?? s.duration_seconds)`.

- [ ] **Step 3: Uruchom typecheck + testy**

Run: `cd dashboard && npx tsc -p tsconfig.app.json --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/report-view/ReportViewSessionsSection.tsx dashboard/src/pages/report-view/ReportViewManualSessionsSection.tsx dashboard/src/hooks/useReportViewController.ts
git commit -m "fix(report): session rows show effective time, per_session-aware (F3/F4)"
```

### Checkpoint Fazy 2

- [ ] Scenariusz 4 audytu: per_total 15 min, dzień z 2×5 min → wpisy 5m+5m, dzień 10m, total = round(Σ). Wpisy sumują się do dnia.
- [ ] Scenariusz 5: per_session 15 min, sesje 7m + 20m → wpisy 15m + 30m, total 45m. Zgodność sekcja/total.

---

## FAZA 3 — Ujednolicenie konwencji (F5) i strona Sessions z kanonu (F6)

### Task 10: Estimates używają reguły per-tryb (F5)

**Files:**
- Modify: `dashboard/src/lib/estimate-report.ts` (`buildEstimateReportModel` ~:71-120, `roundedEstimatesSummary` ~:136-160)
- Modify: `dashboard/src/lib/estimate-report.test.ts` (jeśli istnieje; inaczej utwórz)

- [ ] **Step 1: Test — total Estimates = round(Σ) w per_total (nie Σ round)**

```ts
it('per_total total is round(Σ), matching dashboard convention', () => {
  const rows = [
    { /* projekt A */ seconds: 1200, hours: 1200/3600, estimated_value: 100, daily_seconds: [1200], days: [{date:'d1', seconds:1200}], project_id:1, project_name:'A', project_color:'#000', client_name:null },
    { /* projekt B */ seconds: 1200, hours: 1200/3600, estimated_value: 100, daily_seconds: [1200], days: [{date:'d1', seconds:1200}], project_id:2, project_name:'B', project_color:'#000', client_name:null },
  ] as unknown as EstimateProjectRow[];
  const model = buildEstimateReportModel(rows, true, settings({ enabled:true, mode:'per_total', intervalMinutes:15 }));
  // Σ surowa = 2400s (40m) → round(Σ) = 45m = 2700s. NIE 2×round(20m)=2×30m=3600s.
  expect(model.totalSeconds).toBe(2700);
});
```

- [ ] **Step 2: Uruchom — FAIL (dziś Σ round = 3600)**

Run: `cd dashboard && npx vitest run src/lib/estimate-report.test.ts -t "round(Σ)"`
Expected: FAIL.

- [ ] **Step 3: Przelicz total modelu wg reguły per-tryb**

W `buildEstimateReportModel` pozostaw `displaySeconds`/`displayValue` per projekt do prezentacji wierszy, ale policz `totalSeconds` wg reguły:
- `per_total` → `roundSeconds(Σ realTotal, interval)`,
- `per_session` → `Σ displaySeconds` (gdzie displaySeconds już = round per projekt/sesja — tu projekt jest jednostką „sesji"),
- `per_day` → `Σ roundDailyTotals(projektu)` (bez zmian),
- disabled → `Σ realTotal`.

Analogicznie `roundedEstimatesSummary`: w `per_total` zwróć `roundSeconds(Σ raw, interval)` zamiast Σ round-per-wiersz; wartość skaluj do tego totalu (`scaleValueToRounded(Σ estimated_value, Σ hours*3600, roundedTotal)`).

> To wyrównuje kartę „Total time" na Estimates do Dashboardu w per_total. Wiersze per projekt nadal pokazują round per projekt (informacyjnie) — jak dziś — ale TOTAL jest jedną kotwicą.

- [ ] **Step 4: Uruchom test + regresję estimate**

Run: `cd dashboard && npx vitest run src/lib/estimate-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/estimate-report.ts dashboard/src/lib/estimate-report.test.ts
git commit -m "fix(estimates): unify rounding total to per-mode rule (F5)"
```

### Task 11: Strona Sessions — totale grup z kanonu (F6)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/dashboard.rs` (lub nowa lekka komenda) — zwróć mapę `project_id → canonical_seconds`
- Modify: `dashboard/src/lib/tauri` (binding) — wywołanie
- Modify: `dashboard/src/hooks/useSessionsPageController.ts` (~:248)
- Modify: `dashboard/src/lib/sessions-grouping.ts` (`groupSessionsByProject` ~:68-70)
- Modify: `dashboard/src/lib/session-utils.ts` (komentarz ~:29-33)

- [ ] **Step 1: Test — grupa bierze total z mapy kanonu, nie z `wallClockSeconds`**

W `sessions-grouping.test.ts` (utwórz, jeśli brak):

```ts
it('uses canonical per-project totals when provided', () => {
  const groups = groupSessionsByProject(sessions, 'Unassigned', new Map(), new Map([[1, 4500]]));
  const p1 = groups.find((g) => g.projectId === 1)!;
  expect(p1.totalSeconds).toBe(4500); // z kanonu, nie unia interwałów
});
```

- [ ] **Step 2: Uruchom — FAIL (sygnatura bez mapy)**

Run: `cd dashboard && npx vitest run src/lib/sessions-grouping.test.ts`
Expected: FAIL (za dużo argumentów / brak użycia mapy).

- [ ] **Step 3: Backend — kanoniczne totale per projekt**

Dodaj komendę `get_project_canonical_totals(date_range) -> HashMap<i64, i64>` w `dashboard.rs`, liczoną z `compute_project_activity_unique(conn, &range, false, true, None, Some(min_duration), true)` → `total_by_project` zredukowane do `project_id` przez `series_meta`. Zarejestruj w `lib.rs` (jak `get_project_report_data`) i w `rpc_generated.rs` (jeśli generowane — sprawdź build). Dodaj binding TS w `lib/tauri`.

- [ ] **Step 4: Frontend — przekaż mapę do grupowania**

W `groupSessionsByProject` dodaj parametr `canonicalByProjectId?: Map<number, number>`. W finalnej pętli:

```ts
for (const group of groups.values()) {
  const canon = group.projectId != null ? canonicalByProjectId?.get(group.projectId) : undefined;
  group.totalSeconds = canon ?? wallClockSeconds(group.sessions); // fallback dla grup bez id (np. unassigned)
}
```

W `useSessionsPageController.ts` pobierz mapę (nowa komenda) dla bieżącego zakresu i przekaż do `groupSessionsByProject`.

- [ ] **Step 5: Popraw mylący komentarz `wallClockSeconds`**

W `session-utils.ts` zamień zdanie „This mirrors the backend's unique-time computation…" na:

```ts
 * NOTE: this is a per-group union of intervals. It does NOT split time between
 * concurrent PROJECTS the way the backend canon (compute_project_activity_unique)
 * does. Used only as a fallback for groups without a canonical total (e.g.
 * unassigned). Project group totals come from the backend canon.
```

- [ ] **Step 6: Uruchom testy + typecheck + Rust**

Run: `cd dashboard && npx vitest run && npx tsc -p tsconfig.app.json --noEmit` oraz `cd dashboard/src-tauri && cargo test --lib -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/dashboard.rs dashboard/src-tauri/src/lib.rs dashboard/src/hooks/useSessionsPageController.ts dashboard/src/lib/sessions-grouping.ts dashboard/src/lib/session-utils.ts dashboard/src/lib/sessions-grouping.test.ts
git commit -m "fix(sessions): project group totals from backend canon (F6)"
```

### Checkpoint Fazy 3

- [ ] Scenariusz 2 audytu: nakładka między dwoma projektami → karta A + karta B == Dashboard total; suma grup na Sessions == karty projektów.

---

## FAZA 4 — Dokumentacja i testy integracyjne końcowe

### Task 12: Help.tsx — tryby zaokrąglania, próg, miary czasu

**Files:**
- Modify: `dashboard/src/pages/Help.tsx`
- Modify: `dashboard/src/locales/en.json`, `dashboard/src/locales/pl.json`

- [ ] **Step 1: Dodaj/uzupełnij sekcję pomocy**

W sekcji o czasie/zaokrąglaniu dopisz (spójnie z istniejącym formatem sekcji — „co to robi / kiedy użyć / ograniczenia"):
- że wszystkie totale (karta, dashboard, raport, timeline, Sessions) liczą się kanonicznie (dedup + podział czasu współbieżnego), więc sumy sekcji zgadzają się z totalami;
- że próg minimalnej długości sesji obowiązuje jednakowo we wszystkich widokach czasu projektu;
- trzy tryby zaokrąglania z regułą per-tryb (per_total = round sumy; per_session = round każdej sesji, potem suma; per_day = round każdego dnia do pełnej godziny);
- ograniczenie: w widokach mających tylko zagregowany total (licznik Dashboardu) tryb per_session zaokrągla agregat (brak rozbicia na sesje);
- brzeg: sesja przez północ liczona w timeline po dniu startu (grand total pozostaje zgodny).

Dodaj klucze i18n w `en.json` i `pl.json` (te same identyfikatory, oba języki).

- [ ] **Step 2: Walidacja lokalizacji**

Run: `cd dashboard && npm run lint:locales` (lub `node ../compare_locales.py` wg repo)
Expected: brak brakujących kluczy.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Help.tsx dashboard/src/locales/en.json dashboard/src/locales/pl.json
git commit -m "docs(help): document canonical time, threshold and rounding modes"
```

### Task 13: Test integracyjny „sekcja = total" na danych raportu

**Files:**
- Modify: `dashboard/src/lib/report-consistency.test.ts`

- [ ] **Step 1: Test — pełny łańcuch: efektywne sesje → timeline → total, 3 tryby + disabled**

Rozszerz `report-consistency.test.ts` o przypadki z sesjami nakładającymi się (efektywne < surowe) i asercje:
- disabled: Σ wpisów timeline == Σ dni == total == Σ effective_seconds sesji.
- per_session: Σ round(wpis) == dzień; Σ dni == total.
- per_day: dzień == round(Σ, 60m); Σ dni == total.
- per_total: total == round(Σ effective); wpisy/dni surowe.

```ts
it('disabled: entries sum to day sum to total (dedup dataset)', () => {
  const days = [{ date: 'd1', sessionSeconds: [2700, 900] }, { date: 'd2', sessionSeconds: [1200] }];
  const r = distributeReportRounding(days, settings({ enabled: false }));
  const entriesSum = r.days.flatMap((d) => d.entrySeconds).reduce((a, s) => a + s, 0);
  const daysSum = r.days.reduce((a, d) => a + d.daySeconds, 0);
  expect(entriesSum).toBe(daysSum);
  expect(daysSum).toBe(r.totalSeconds);
  expect(r.totalSeconds).toBe(4800);
});
```

- [ ] **Step 2: Uruchom**

Run: `cd dashboard && npx vitest run src/lib/report-consistency.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/report-consistency.test.ts
git commit -m "test(report): section totals reconcile with grand total in all modes"
```

### Checkpoint końcowy (weryfikacja przed scaleniem)

- [ ] `cd dashboard/src-tauri && cargo test --lib -q` → PASS
- [ ] `cd dashboard && npx vitest run` → PASS
- [ ] `cd dashboard && npx tsc -p tsconfig.app.json --noEmit` → brak błędów
- [ ] `cd dashboard && npm run lint` (jeśli skonfigurowane) → czysto
- [ ] React Doctor z roota: `npx -y react-doctor@latest . --verbose` → 100/100
- [ ] Manualnie 6 scenariuszy z audytu (`docs/AUDIT-time-consistency.md`, sekcja „Scenariusze testowe") — każdy: sekcja == total.
- [ ] Zapisz obserwacje scenariuszy w opisie PR.

---

## Mapowanie audyt → zadania (kontrola pokrycia)

| Znalezisko | Zadania |
|---|---|
| F1 — timeline vs total | Task 1–3 (backend efektywne), Task 5 (API), Task 6 (timeline), Task 8 (jeden total) |
| F2 — próg min_duration | Task 4 (karta), Task 5 (raport używa tego samego progu) |
| F3 — zaokrąglanie per wartość | Task 7 (distribute), Task 8 (timeline/nagłówek), Task 9 (wiersze sesji) |
| F4 — per_session martwy | Task 7 (gałąź per_session), Task 8–9 (użycie), Task 12 (ograniczenie w Help) |
| F5 — dwie konwencje | Task 10 (Estimates → reguła per-tryb) |
| F6 — trzecia implementacja unii | Task 11 (Sessions z kanonu + komentarz) |
| Dokumentacja + testy | Task 12 (Help/i18n), Task 13 (integracja) |
