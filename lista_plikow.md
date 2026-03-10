# TIMEFLOW — Raport: pliki wymagające refaktoryzacji/uproszczenia

Data: 2026-03-10

---

## Legenda priorytetów

| Priorytet | Znaczenie |
|-----------|-----------|
| **P0** | Krytyczny — wpływ na wydajność/UX, naprawić jak najszybciej |
| **P1** | Wysoki — istotny koszt wydajnościowy lub długu technicznego |
| **P2** | Średni — poprawa jakości kodu i utrzymywalności |
| **P3** | Niski — kosmetyka, przyszła prewencja problemów |

---

## BACKEND (Rust / Tauri)

### P0 — Krytyczne problemy wydajnościowe

| Plik | Linie | Problem | Rekomendacja |
|------|-------|---------|--------------|
| `auto_safe.rs:102-239` | 549 | **N+1 query** — 6+ zapytań DB na sesję w pętli (3000-5000 zapytań na batch 500 sesji) | Batch-load: sesje, file_activities, manual overrides jednym zapytaniem, potem scoring w pamięci |
| `scoring.rs:344-395` | 395 | **N+1 query** w `suggest_projects_for_sessions_*` (wywoływane przy każdym otwarciu Sessions) | Batch-load danych sesji i scoring in-memory |

### P1 — Wysoki priorytet

| Plik | Linie | Problem | Rekomendacja |
|------|-------|---------|--------------|
| `projects.rs` | 1427 | **Największy plik w codebase.** 4+ obszary odpowiedzialności (CRUD, foldery, detekcja, statystyki). Podwójne wywołanie `compute_project_activity_unique` w `query_projects_with_stats` (linie 396-411). Inline SQL zamiast istniejących helperów. | Podział na moduł `projects/` (crud.rs, folders.rs, detection.rs). Cache/deduplikacja `compute_project_activity_unique`. |
| `dashboard.rs` (cały) | 641 | **5x redundantne** wywołanie `compute_project_activity_unique` z Dashboard page (5 endpointów, każdy osobno) | Jeden endpoint "dashboard data" z jednym obliczeniem |
| `projects.rs:1180-1300` | — | **5 ciężkich CTE** w `get_project_extra_info` — SESSION_PROJECT_CTE przeliczane od zera 3x | Jedno CTE, 3 agregacje w jednym SQL |
| `sessions/split.rs` | 888 | Bardzo duży plik. Logika analizy kandydatów + mutacja splita w jednym pliku. | Podział na analysis + mutations |

### P2 — Średni priorytet (jakość kodu)

| Plik | Linie | Problem | Rekomendacja |
|------|-------|---------|--------------|
| `training.rs` | 616 | `retrain_model_sync` ma 312 linii. Zduplikowane pętle feedback (linie 142-253). Nieograniczony HashMap tokenów (linie 255-306). | Rozbić na sub-funkcje (train_app_layer, train_time_layer, train_token_layer). Limit tokenów. |
| `auto_safe.rs` | 549 | 3x powtórzony SQL `UPDATE file_activities SET project_id` (linie 197, 358, 510). 3x powtórzony SQL `INSERT INTO assignment_feedback` (linie 231, 378, 522). | Wyciągnąć do shared helperów |
| `scoring.rs` | 395 | Magic numbers (wagi warstw 0.80/0.30/0.10/0.30 inline). Per-candidate DB lookup na nazwę projektu (linie 213-219). `check_manual_override` robi 3 sekwencyjne query zamiast 1 JOIN. | Wagi do stałych w config.rs. Pre-load nazw projektów. JOIN query. |
| `mod.rs` | 678 | Glob re-export (`pub use *`) eksponuje wewnętrzne helpery. Redundantne ładowanie statusu w setterach (linie 486-643). `get_assignment_model_metrics` ma 208 linii. | Explicit exports. Cache statusu w setterach. Rozbić metrics. |
| `config.rs` + cały moduł | 179 | **Stringly-typed mode** — `"off"/"suggest"/"auto_safe"` jako surowe stringi w 9+ miejscach. Brak enum `AssignmentMode`. | Dodać enum z Serialize/Deserialize |
| `context.rs` | 219 | Pętla tokenizacji (linie 174-205) zduplikowana z `training.rs:284-304`. `parse_timestamp` to zbędny wrapper. Full table scan `applications` (linie 91-112). | Shared helper `extract_tokens_from_row()`. Usunąć wrapper. WHERE zamiast full scan. |
| `import_data.rs` | 937 | Duży plik. `validate_import`/`execute_import` to rozbudowane funkcje. | Potencjalny split walidacja/import |
| `import.rs` | 736 | `normalize_file_path` (linia 29) duplikuje `normalize_path_for_compare` z context.rs | Jeden shared helper `normalize_path_separators()` w helpers.rs |
| `analysis.rs` | 551 | `compute_project_activity_unique` — single ~200-liniowa funkcja | Dekomponować |
| `projects.rs:558-643` | — | Zduplikowane 4-UNION subquery w `auto_freeze_projects` (freeze i unfreeze) | Jedno obliczenie → temp table |

### P2 — Cross-cutting issues

| Problem | Pliki | Rekomendacja |
|---------|-------|--------------|
| **Duplikacja `increment_feedback_counter` SQL** — 4 kopie zamiast 1 wywołania | `config.rs:146`, `projects.rs:866`, `sessions/mutations.rs:75`, `sessions/split.rs:154` | Użyć istniejącej funkcji z config.rs |
| **Duplikacja normalizacji ścieżek** — 3+ implementacje | `context.rs:33`, `config.rs:55`, `import.rs:29`, `projects.rs:231,250` | Jeden helper w helpers.rs |
| **Brak centralnego enum feedback sources** — 20+ hardcoded stringów | training.rs, auto_safe.rs, mod.rs, projects.rs, sessions/ | Enum/stałe w jednym module |
| **80x `.map_err(\|e\| e.to_string())`** bez kontekstu | Cały backend | `.map_err(\|e\| format!("Opis: {e}"))` lub centralny typ błędu |
| **`clamp_i64`** reimplementuje stdlib `i64::clamp()` | config.rs:132 | Użyć `i64::clamp()` |

### P3 — Niski priorytet

| Plik | Linie | Problem |
|------|-------|---------|
| `estimates.rs` | 483 | Średni rozmiar, akceptowalny |
| `database.rs` | 442 | Migracje — akceptowalna złożoność |
| `export.rs` | 415 | Spójny, jednorodny |
| `settings.rs` | 379 | Umiarkowany rozmiar |
| `daemon.rs` | 330 | Spójny |
| `types.rs` | 552 | Definicje typów — OK |
| `mod.rs:580` | — | `suggest_project_for_session` oznaczony `#[allow(dead_code)]` — sprawdzić czy potrzebny |

---

## FRONTEND (TypeScript / React)

### P2 — Potrzebna refaktoryzacja

| Plik | Linie | Problem | Rekomendacja |
|------|-------|---------|--------------|
| `pages/Projects.tsx` | 2115 | Ogromny komponent. 15 useMemo/useCallback (dobra optymalizacja), ale rozmiar utrudnia utrzymanie. | Wyciągnąć zawartość tabów do sub-komponentów |
| `pages/Sessions.tsx` | 1938 | Ogromny, ale dobrze zoptymalizowany (30+ useMemo/useCallback). | Podział na sub-komponenty dla czytelności |
| `pages/ProjectPage.tsx` | 1596 | **Niska memoizacja** — tylko 7 useMemo/useCallback na 1596 linii. Ryzyko zbędnych re-renderów. | Dodać memoizację event handlerów i danych pochodnych |
| `components/dashboard/ProjectDayTimeline.tsx` | 1512 | Monolityczny komponent timeline. | Podział na mniejsze sub-komponenty |
| `pages/AI.tsx` | 1112 | **Niska memoizacja** (6 hooków na 1112 linii). Wiele useEffect z fetch — ryzyko zbędnych re-fetchów. | Dodać memoizację, useMemo dla derived state |

### P3 — Do obserwacji

| Plik | Linie | Problem |
|------|-------|---------|
| `lib/online-sync.ts` | 1721 | Czysta logika (bez React). Rozmiar z złożoności sync protocol — akceptowalny. |
| `components/sessions/SessionRow.tsx` | 664 | **Brak `React.memo`** — hot-path w liście 500+ sesji | Dodać React.memo |
| `pages/Dashboard.tsx` | 553 | Wywołuje 5 osobnych endpointów backend, każdy przelicza to samo (patrz dashboard.rs P1) | Powiązany z backend fix |
| `pages/Help.tsx` | 834 | Statyczna treść — OK |
| `pages/Settings.tsx` | 756 | Umiarkowany rozmiar — OK |

---

## Podsumowanie — TOP 10 akcji

| # | Akcja | Pliki | Priorytet |
|---|-------|-------|-----------|
| 1 | Batch-load w auto_safe i scoring (eliminacja N+1) | auto_safe.rs, scoring.rs | P0 |
| 2 | Podział `projects.rs` na moduł z sub-plikami | projects.rs | P1 |
| 3 | Deduplikacja `compute_project_activity_unique` (dashboard + projects) | dashboard.rs, projects.rs | P1 |
| 4 | Konsolidacja CTE w `get_project_extra_info` | projects.rs | P1 |
| 5 | Podział `sessions/split.rs` | sessions/split.rs | P1 |
| 6 | Rozbicie `retrain_model_sync` na sub-funkcje | training.rs | P2 |
| 7 | Enum `AssignmentMode` zamiast stringów | config.rs + 9 plików | P2 |
| 8 | Shared helpery (update_file_activities, feedback insert, path normalize) | auto_safe.rs, helpers.rs, context.rs, import.rs | P2 |
| 9 | Memoizacja w ProjectPage.tsx i AI.tsx | ProjectPage.tsx, AI.tsx | P2 |
| 10 | React.memo na SessionRow.tsx | SessionRow.tsx | P3 |
