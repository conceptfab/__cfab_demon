# TIMEFLOW — Plan implementacji

> Wygenerowano: 2026-03-16
> Źródło: `refactor.md` (audyt kodu z 2026-03-15)
> Zasada: zachowanie dotychczasowych danych, zmiany addytywne, backup przed operacjami na DB

---

## Faza 1: Błędy krytyczne (ryzyko utraty danych)

### Zadanie 1.1: `rebuild_sessions` może scalać sesje po splicie ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/sessions/rebuild.rs:24-60`
- **Problem:** `ACTIVE_SESSION_FILTER` nie wyklucza sesji z `split_source_session_id` — rebuild może scalić dwie połówki splitu z powrotem.
- **Zmiana:** Dodać `AND split_source_session_id IS NULL` do `ACTIVE_SESSION_FILTER` w zapytaniu SQL.
- **Test:** Wykonać split sesji → uruchomić rebuild → sprawdzić, że obie połówki splitu pozostają oddzielne.
- **Ryzyko:** Średnie — zmiana filtra może wykluczyć sesje, które powinny być w rebuild. Przetestować na kopii bazy.
- **Zależności:** Brak.

### Zadanie 1.2: Zduplikowany klucz `sessions.prompts` w JSON — utrata tłumaczeń ✅ DONE
- **Pliki:** `dashboard/src/locales/en/common.json` (~linia 328 i 357), `dashboard/src/locales/pl/common.json` (analogicznie)
- **Problem:** Klucz `prompts` zdefiniowany dwukrotnie w obiekcie `sessions` — JSON bierze ostatnią wartość, klucze `bulk_comment_title` i `bulk_comment_description` z pierwszego bloku są niedostępne.
- **Zmiana:** Zmergować oba bloki `prompts` w jeden obiekt (przenieść klucze z pierwszego bloku do drugiego).
- **Test:** `cd dashboard && npm run lint:locales` + sprawdzić w UI, że `bulk_comment_title` i `bulk_comment_description` wyświetlają się poprawnie.
- **Ryzyko:** Niskie — zmiana struktury JSON, bez zmiany kodu.
- **Zależności:** Brak.

### Zadanie 1.3: `train_assignment_model` z `force=true` przy 0 danych resetuje model AI ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/mod.rs:556-578`
- **Problem:** Wymuszony retrain przy 0 feedbacku zapisuje puste tabele — utrata wiedzy modelu.
- **Zmiana:** Dodać guard na początku funkcji:
  ```rust
  if feedback_count == 0 {
      return Err("Nothing to train: no feedback data available".into());
  }
  ```
- **Test:** Wywołać retrain z `force=true` bez danych feedbacku → powinien zwrócić błąd, model niezmieniony.
- **Ryzyko:** Niskie — dodanie early return, brak zmiany istniejącej logiki.
- **Zależności:** Brak.

---

## Faza 2: Błędy logiczne (poprawność działania)

### Zadanie 2.1: Race condition w `useSessionsData` — podwójne ładowanie ✅ DONE
- **Plik:** `dashboard/src/hooks/useSessionsData.ts:54-89`
- **Problem:** Dwa effecty mogą uruchomić `loadFirstSessionsPage` jednocześnie.
- **Zmiana:** Dodać `isLoadingRef = useRef(false)` i sprawdzać flagę przed rozpoczęciem fetcha:
  ```typescript
  if (isLoadingRef.current) return;
  isLoadingRef.current = true;
  try { await loadFirstSessionsPage(); } finally { isLoadingRef.current = false; }
  ```
- **Test:** Otworzyć zakładkę Sessions z devtools → Network → sprawdzić, że nie ma zduplikowanych requestów.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 2.2: `feedback_since_train` rośnie N razy przy N-way splicie ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/sessions/split.rs:156-165`
- **Problem:** 5-way split dodaje 5 do licznika feedbacku zamiast 1 (niespójna semantyka).
- **Zmiana:** Zamienić `feedback_count = segments.len()` na `feedback_count = 1`.
- **Test:** Wykonać split na N segmentów → sprawdzić, że `feedback_since_train` wzrosło o 1.
- **Ryzyko:** Niskie — zmiana jednej wartości.
- **Zależności:** Brak.

### Zadanie 2.3: `inferPreset` nie rozpoznaje przesuniętego miesiąca ✅ DONE
- **Plik:** `dashboard/src/store/data-store.ts:58-74`
- **Problem:** Po powrocie do bieżącego miesiąca strzałkami, `inferPreset` porównuje z `now` zamiast z zakresem — zwraca `'custom'` zamiast `'month'`.
- **Zmiana:** Zmienić `isSameMonth(start, now)` na `isSameMonth(start, end)` + sprawdzić, że `start` to pierwszy dzień miesiąca i `end` to ostatni.
- **Test:** Nawigować strzałkami: miesiąc w przód → miesiąc w tył → preset powinien wrócić do `'month'`.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 2.4: "Unique Files" w projektach — błędne liczenie ✅ DONE (etap 1: SQL filter)
- **Pliki:**
  - `dashboard/src-tauri/src/commands/projects.rs:1389-1411` (zapytanie SQL)
  - `dashboard/src-tauri/src/commands/import.rs:298-314` (zapis file_activities)
  - `dashboard/src-tauri/src/commands/sql_fragments.rs:1-66` (CTE)
- **Problem:** 4 niezależne defekty powodujące dramatyczne niedoliczenie plików (opis w refactor.md §2.4).
- **Zmiana (etapowa):**
  1. **SQL:** Dodać `AND fa.project_id = ?3` (lub `fa.project_id = sp.project_id`) do JOINa w zapytaniu.
  2. **UNIQUE constraint:** Zmienić na `UNIQUE(app_id, date, file_path, detected_path)` — wymaga migracji addytywnej.
  3. **Zapis:** Gdy `detected_path` jest dostępny, użyć go jako `file_path`.
  4. **Prostsze zapytanie (opcja):** `COUNT(DISTINCT ...) FROM file_activities WHERE project_id = ?` jako alternatywa do CTE.
- **Test:** Otworzyć projekt z wieloma plikami w IDE → poczekać na zbieranie danych → sprawdzić "Unique Files".
- **Ryzyko:** Wysokie — zmiana UNIQUE constraint wymaga migracji DB. Backup bazy przed zmianą. Etap 1 (SQL filter) można wdrożyć niezależnie.
- **Zależności:** Etap 2 wymaga migracji DB.

### Zadanie 2.5: Rename `suggest_project_for_session_raw` ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs:379-430`
- **Problem:** Nazwa `raw` myląca — funkcja nie stosuje thresholdów.
- **Zmiana:** Zmienić nazwę na `suggest_project_for_session_unfiltered` + dodać doc-comment.
- **Test:** `cargo check --workspace` — brak błędów kompilacji.
- **Ryzyko:** Niskie — rename + find/replace wywołań.
- **Zależności:** Brak.

---

## Faza 3: Tłumaczenia i Help (jakość UX)

### Zadanie 3.1: Niespójność "ręczne" vs "
alne" w PL ✅ DONE
- **Pliki:** `dashboard/src/locales/pl/common.json` (~10 kluczy)
- **Problem:** Mieszane użycie "manualne" i "ręczne".
- **Zmiana:** Ujednolicić wszystkie do "ręczne" (naturalniejsze po polsku).
- **Test:** `npm run lint:locales` + przegląd UI w wersji PL.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 3.2: `project_day_timeline.text.s` PL = "e" — literówka ✅ DONE
- **Plik:** `dashboard/src/locales/pl/common.json:1718`
- **Problem:** Wartość `"s": "e"` nie ma sensu.
- **Zmiana:** Zmienić na `"s": "s"` (skrót od "sesje").
- **Test:** Sprawdzić timeline widok projektu w PL.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 3.3: Niespójność "Auto-safe" vs "Auto-Safe" ✅ DONE
- **Pliki:** `dashboard/src/locales/en/common.json` — `layout.status.auto_safe` vs `help_page.auto_safe`
- **Problem:** Niespójna wielkość liter.
- **Zmiana:** Ujednolicić do "Auto-safe" (lowercase 's').
- **Test:** `npm run lint:locales`.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 3.4: Usunąć martwy klucz `sync_on_startup_perform_...` ✅ DONE
- **Pliki:** `dashboard/src/locales/{en,pl}/common.json:1598`
- **Problem:** Klucz nieużywany, zastąpiony innym.
- **Zmiana:** Usunąć z obu plików JSON.
- **Test:** `npm run lint:locales` + grep po codebase potwierdzający brak użycia.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 3.5: Brak sekcji Help dla ReportView ✅ DONE
- **Plik:** `dashboard/src/pages/Help.tsx`
- **Problem:** ReportView nie ma dedykowanej sekcji w Help.
- **Zmiana:** Dodać `HelpDetailsBlock` w `TabsContent value="reports"` z opisem: co robi, kiedy użyć, jak drukować/eksportować PDF.
- **Test:** Otworzyć Help → zakładka Reports → sekcja ReportView widoczna. Sprawdzić PL + EN.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

---

## Faza 4: Wydajność (optymalizacje)

### Zadanie 4.1: `rebuild.rs` — DELETE i UPDATE w pętli (N+1) ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/sessions/rebuild.rs:119-141`
- **Problem:** DELETE per-id zamiast batch.
- **Zmiana:** Zbierać ID do usunięcia/aktualizacji → wykonać `DELETE FROM sessions WHERE id IN (?,?,...)` i batch UPDATE.
- **Test:** Rebuild z wieloma sesjami do scalenia → porównać czas vs. poprzednia wersja.
- **Ryzyko:** Średnie — zmiana logiki SQL. Backup bazy.
- **Zależności:** Brak.

### Zadanie 4.2: Daemon — nowe połączenie SQLite przy każdym zapisie ⏭️ DEFERRED (wymaga zmiany architektury wątków)
- **Plik:** `src/storage.rs:save_daily`
- **Problem:** `open_daily_store()` otwiera nowe `Connection` co 5 minut.
- **Zmiana:** Trzymać `Connection` jako pole struktury. Odświeżać tylko przy błędzie.
- **Test:** Monitorować logi daemona — brak "opening connection" co 5 min. Brak memory leaks.
- **Ryzyko:** Średnie — wymaga sprawdzenia, czy connection nie jest używany z wielu wątków.
- **Zależności:** Brak.

### Zadanie 4.3: `SessionRow` — brak `React.memo` ✅ ALREADY DONE (memo already exists)
- **Plik:** `dashboard/src/components/sessions/SessionRow.tsx`
- **Problem:** Inline render w Virtuoso powoduje re-render wszystkich widocznych wierszy.
- **Zmiana:** Owinąć `SessionRow` w `React.memo()`.
- **Test:** React DevTools Profiler → Sessions → scroll → mniej re-renderów.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 4.4: WMI blokuje wątek monitorujący (niska priorytet) ⏭️ DEFERRED
- **Plik:** `src/monitor/wmi_detection.rs`
- **Problem:** WMI query (40-200ms) blokuje polling.
- **Zmiana:** Przenieść WMI queries do osobnego wątku z `mpsc::channel`.
- **Test:** Monitorować responsywność UI przy wielu nowych procesach.
- **Ryzyko:** Średnie — zmiana architektury wątków.
- **Zależności:** Brak.

### Zadanie 4.5: Tracker sleep loop (niska priorytet) ⏭️ DEFERRED
- **Plik:** `src/tracker.rs:531-546`
- **Problem:** Pętla 1-sekundowych sleep zamiast jednego `thread::sleep(remain)`.
- **Zmiana:** Użyć `Condvar::wait_timeout` na stop mutex.
- **Test:** Sprawdzić, że tracker zatrzymuje się natychmiast po sygnale stop.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

---

## Faza 5: Refaktoryzacja (utrzymywalność kodu)

### Zadanie 5.1: Usunąć duplikację `session-analysis.ts` vs `split.rs` ✅ DONE
- **Pliki:**
  - `dashboard/src/lib/session-analysis.ts:16-63` (usunąć)
  - `dashboard/src-tauri/src/commands/sessions/split.rs:509-531` (źródło prawdy)
- **Problem:** Identyczna logika `buildAnalysisFromBreakdown` w TS i Rust.
- **Zmiana:** Usunąć logikę z TS. Frontend konsumuje `is_splittable` z odpowiedzi Rust.
- **Test:** Split sesji w UI → wynik identyczny jak wcześniej. `npx tsc --noEmit` bez błędów.
- **Ryzyko:** Średnie — wymaga sprawdzenia wszystkich konsumentów TS function.
- **Zależności:** Brak.

### Zadanie 5.2: Przenieść `withTimeout` z `session-analysis.ts` ✅ DONE
- **Plik:** `dashboard/src/lib/session-analysis.ts:65-81` → `dashboard/src/lib/async-utils.ts`
- **Problem:** Funkcja `withTimeout<T>` nie ma związku z analizą sesji.
- **Zmiana:** Przenieść do `async-utils.ts`, zaktualizować importy.
- **Test:** `npx tsc --noEmit`.
- **Ryzyko:** Niskie.
- **Zależności:** Zadanie 5.1 (łatwiej przenieść po usunięciu duplikacji).

### Zadanie 5.3: Sprawdzić/usunąć `get_dashboard_stats` ⏭️ SKIP (jest używany w frontend)
- **Plik:** `dashboard/src-tauri/src/commands/dashboard.rs:168, 211`
- **Problem:** `get_dashboard_stats` i `get_dashboard_data` obie wywołują `compute_project_activity_unique`.
- **Zmiana:** Sprawdzić, czy `get_dashboard_stats` jest wywoływany z frontendu. Jeśli nie — usunąć.
- **Test:** `cargo check --workspace` + grep po codebase.
- **Ryzyko:** Niskie (jeśli nieużywany).
- **Zależności:** Brak.

### Zadanie 5.4: Podział `Sessions.tsx` na moduły ✅ DONE
- **Plik:** `dashboard/src/pages/Sessions.tsx` (~990 linii)
- **Problem:** Zbyt duży komponent z ~15 useCallback, ~8 useMemo, ~10 useState.
- **Zmiana:** Wydzielić:
  - `dashboard/src/hooks/useSessionContextMenuActions.ts` (logika context menu)
  - `dashboard/src/hooks/useSessionBulkActions.ts` (operacje batch)
  - `dashboard/src/components/sessions/SessionsToolbar.tsx` (toolbar + filtry)
- **Test:** `npx tsc --noEmit` + UI Sessions działa identycznie.
- **Ryzyko:** Średnie — duży refaktor, dużo importów do zaktualizowania.
- **Zależności:** Brak.

---

## Faza 6: Brakujące funkcje (rozwój)

### Zadanie 6.1: Manual sessions w zakładce Sessions ✅ DONE
- **Pliki:**
  - `dashboard/src/pages/Sessions.tsx` (frontend)
  - `dashboard/src-tauri/src/commands/sessions/queries.rs` (backend)
  - `dashboard/src/lib/db-types.ts:420-445` (typy)
- **Problem:** Manual sessions nie pojawiają się w głównej zakładce Sessions.
- **Zmiana:**
  1. **Backend:** Dodać/rozszerzyć komendę — UNION `sessions` + `manual_sessions`, sortowanie po `start_time DESC`, paginacja.
  2. **Frontend:** Rozszerzyć typ sesji o wariant `manual`, dodać renderowanie w `SessionRow` z badge "Manual" (ikona `CalendarPlus`).
  3. Wykluczyć nieadekwatne akcje z context menu (split, hide, reassign app).
  4. Filtrowanie (projekt, zakres dat) musi uwzględniać manual sessions.
  5. Statystyki w headerze (total time, session count) muszą uwzględniać manual sessions.
- **Test:** Dodać manual session → zakładka Sessions → sesja widoczna, oznakowana, z poprawnym czasem i projektem.
- **Ryzyko:** Wysokie — duża zmiana, dotyka backend + frontend + paginację.
- **Zależności:** Zadanie 5.4 (łatwiej implementować po podziale Sessions.tsx).

---

## Faza 7: Architektura (sugestie usprawniające)

### Zadanie 7.1: `settings-store.ts` — brak reaktywności kluczowych ustawień ✅ DONE
- **Plik:** `dashboard/src/store/settings-store.ts`
- **Problem:** Store przechowuje tylko 2 z N ustawień; reszta (workingHours, language, splitSettings) w localStorage bez reaktywności — zmiana w jednym widoku nie propaguje się do innych bez przeładowania.
- **Zmiana:** Rozszerzyć Zustand store o kluczowe ustawienia (workingHours, language, splitSettings).
- **Test:** Zmienić ustawienia w Settings → sprawdzić, że inne widoki (Dashboard, Sessions) natychmiast reagują bez przeładowania.
- **Ryzyko:** Średnie — wymaga identyfikacji wszystkich miejsc odczytu ustawień.
- **Zależności:** Brak.

### Zadanie 7.2: `background-status-store.ts` — 3 osobne flagi InFlight ⏭️ SKIP (prosty wzorzec, działa dobrze)
- **Plik:** `dashboard/src/store/background-status-store.ts`
- **Problem:** 3 osobne flagi boolean `InFlight` zamiast mapy — przy dodawaniu nowych background jobs trzeba modyfikować store.
- **Zmiana:** Zamienić na `Map<string, boolean>` lub zostawić jeśli nie planowane nowe jobs.
- **Test:** Sprawdzić, że status bar poprawnie pokazuje trwające operacje.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

### Zadanie 7.3: Rename `src/process_utils.rs` ✅ DONE
- **Plik:** `src/process_utils.rs`
- **Problem:** Nazwa myląca — `src/process_utils.rs` vs `shared/process_utils.rs` mają różną odpowiedzialność, ale identyczne nazwy.
- **Zmiana:** Zmienić nazwę `src/process_utils.rs` na `src/win_process_snapshot.rs` + zaktualizować `mod` deklarację.
- **Test:** `cargo check --workspace` — brak błędów kompilacji.
- **Ryzyko:** Niskie — rename + find/replace.
- **Zależności:** Brak.

### Zadanie 7.4: Doc-comments dla `shared/daily_store/` ✅ DONE
- **Plik:** `shared/daily_store/mod.rs`
- **Problem:** Brak dokumentacji modułu — nowy developer nie wie co moduł robi bez czytania kodu.
- **Zmiana:** Dodać doc-comments do `mod.rs` opisujące: cel modułu, format plików JSON, cykl życia danych.
- **Test:** `cargo doc --workspace --no-deps` — dokumentacja się generuje.
- **Ryzyko:** Niskie.
- **Zależności:** Brak.

---

## Faza 8: Sugestie rozwojowe (long-term)

### Zadanie 8.1: Evidence boost dla background apps w modelu AI ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs`
- **Problem:** Model AI słabo klasyfikuje sesje bez plików (background apps) — evidence_count rośnie wolno (warstwy 1/2/3 dają +1 vs warstwa 0 +2).
- **Zmiana:** Podwyższyć wagę layer1 dla znanych background apps lub dodać osobną ścieżkę scoringu.
- **Test:** Przypisać background app do projektu kilka razy → sprawdzić, że model szybciej się uczy.
- **Ryzyko:** Średnie — zmiana wag może wpłynąć na istniejące przypisania.
- **Zależności:** Brak.

### Zadanie 8.2: Daemon → `SetWinEventHook` (event-driven detection) ✅ DONE
- **Plik:** `src/foreground_hook.rs` (nowy), `src/tracker.rs`, `src/main.rs`
- **Problem:** Polling co 10s vs event-driven — opóźnienie wykrycia zmian okna.
- **Zmiana:** Nowy moduł `foreground_hook.rs` z `SetWinEventHook` + message pump w osobnym wątku. Tracker budzi się natychmiast przez Condvar zamiast sleep-loop. Polling zachowany jako fallback gdy hook nie zadziała.
- **Test:** Przełączać okna szybko → sprawdzić, że tracker rejestruje wszystkie zmiany bez opóźnienia.
- **Ryzyko:** Wysokie — duża zmiana architektoniczna, dotyczy core daemon.
- **Zależności:** Brak.

### Zadanie 8.3: Auto-split false positives — guard `updated_at` ✅ DONE
- **Plik:** `dashboard/src-tauri/src/commands/sessions/split.rs`
- **Problem:** Przy 50 sesjach per cykl z `sleep(100ms)` throttle, cykl trwa 5-10s. Jeśli użytkownik w tym czasie zmieni projekt sesji, auto-split może nadpisać przypisanie.
- **Zmiana:** Sprawdzać `updated_at` sesji przed splitem — jeśli sesja była zmodyfikowana od początku cyklu, pominąć ją.
- **Test:** Podczas auto-split cyklu ręcznie zmienić projekt sesji → sprawdzić, że zmiana nie jest nadpisana.
- **Ryzyko:** Niskie — dodanie warunku guard.
- **Zależności:** Brak.

---

## Podsumowanie

| Faza | Zadań | Ryzyko | Szacunkowa złożoność |
|------|-------|--------|---------------------|
| 1. Błędy krytyczne | 3 | Średnie | Niska-średnia |
| 2. Błędy logiczne | 5 | Średnie-Wysokie (2.4) | Średnia |
| 3. Tłumaczenia + Help | 5 | Niskie | Niska |
| 4. Wydajność | 5 | Średnie | Średnia |
| 5. Refaktoryzacja | 4 | Średnie | Średnia-wysoka |
| 6. Brakujące funkcje | 1 | Wysokie | Wysoka |
| 7. Architektura | 4 | Niskie-Średnie | Niska-średnia |
| 8. Sugestie rozwojowe | 3 | Średnie-Wysokie | Średnia-wysoka |
| **RAZEM** | **30** | — | — |

## Zasady bezpieczeństwa (przed każdą fazą)

1. **Backup bazy** przed zmianami w `rebuild.rs`, `split.rs`, `mutations.rs`, migracjach DB.
2. **Migracje DB: TYLKO addytywne** (nowe kolumny, indeksy), NIGDY destructive.
3. **Zmiany w `daily_store/write.rs`** — testować na kopii plików JSON.
4. **Zmiany w `common.json`** — uruchomić `npm run lint:locales` po każdej edycji.

## Komendy weryfikacyjne

```bash
cd dashboard && npx tsc --noEmit        # TypeScript
cd dashboard && npm run lint:locales     # Tłumaczenia
cd dashboard && npm run test             # Testy
cd dashboard && npm run lint             # Lint
cargo check --workspace                  # Rust
```
