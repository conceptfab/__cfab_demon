# Raport analizy kodu TIMEFLOW

Data analizy: 2026-03-03  
Zakres: daemon Rust (`src/`), backend Tauri (`dashboard/src-tauri/`), frontend React (`dashboard/src/`), skrypty pomocnicze.

## 1. Metodyka i weryfikacje

- Przegląd statyczny kodu (logika, odporność na błędy, i18n, potencjalne hot-pathy).
- Skan wzorców ryzykownych (`rows.flatten()`, `filter_map(|r| r.ok())`, `unwrap/expect`, hardcoded UI strings).
- Walidacja kompilacji:
  - `cargo check` (daemon): **OK**
  - `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`: **OK**
  - `npm run build` (dashboard): **OK**, ale z ostrzeżeniem o dużym chunku (`~963 kB`).
  - `cargo test --manifest-path dashboard/src-tauri/Cargo.toml --no-run`: **BŁĄD** (szczegóły poniżej).

---

## 2. Najważniejsze problemy (priorytety)

## P0 / krytyczne

### P0-1: Testy backendu Tauri nie kompilują się
- Lokalizacja: `dashboard/src-tauri/src/commands/dashboard.rs:612-613`
- Objaw: destrukturyzacja 4-elementowej krotki z funkcji, która zwraca 3 elementy.
- Skutek:
  - `cargo test --no-run` dla dashboardu kończy się błędem kompilacji.
  - Brak możliwości uruchomienia pełnej walidacji testowej w CI.
- Rekomendacja:
  - Naprawić test (dopasować liczbę elementów do sygnatury `query_dashboard_counters`).
  - Dodać check w pipeline: `cargo test --no-run` dla obu crate’ów.

## P1 / wysokie

### P1-1: Ciche ignorowanie błędów z bazy danych (utrata spójności wyników)
- Przykłady lokalizacji:
  - `dashboard/src-tauri/src/commands/sessions.rs:344-347`, `411-416`, `923-925`
  - `dashboard/src-tauri/src/commands/assignment_model.rs:155-157`, `572`
  - `dashboard/src-tauri/src/commands/projects.rs:31-33`, `417-419`
  - analogiczny wzorzec występuje też w innych modułach (`filter_map(|r| r.ok())`, `rows.flatten()`).
- Problem:
  - Błędy mapowania/odczytu wierszy są pomijane, a funkcje zwracają częściowe dane bez sygnału błędu.
- Skutek:
  - Trudna diagnostyka.
  - Potencjalnie niepełne listy sesji/projektów/sugestii AI.
- Rekomendacja:
  - W warstwach krytycznych biznesowo traktować błąd wiersza jako błąd całego zapytania (`collect::<Result<Vec<_>, _>>()` + `map_err`).
  - Jeśli częściowe wyniki są dopuszczalne, raportować licznik pominiętych rekordów do loga/telemetrii.

### P1-2: Brak walidacji interwałów monitoringu może wejść w pętlę „busy loop”
- Lokalizacja:
  - `src/config.rs:220-227` (brak clamp/zakresów)
  - `src/tracker.rs:191-197`, `337-350`
- Problem:
  - Konfiguracja z `poll_secs=0` (lub podobnie dla innych interwałów) nie jest odrzucana.
- Skutek:
  - Potencjalnie bardzo wysoki CPU, zalew logów i nadmiar operacji I/O.
- Rekomendacja:
  - Wprowadzić walidację i clamp minimalnych wartości (np. `poll_secs >= 1`, `save_secs >= 10`, itp.).
  - Przy wykryciu wartości spoza zakresu logować ostrzeżenie i przechodzić na bezpieczne defaulty.

---

## 3. Poprawność logiki i ryzyka funkcjonalne

### 3.1. Heurystyka mapowania ścieżek jest case-sensitive na Windows
- Lokalizacja: `dashboard/src-tauri/src/commands/projects.rs:207-214`
- Problem:
  - `strip_prefix` na ścieżkach może nie zadziałać przy różnicy wielkości liter.
- Skutek:
  - Gorsza skuteczność automatycznego wykrywania projektu z file-path.
- Rekomendacja:
  - Normalizować ścieżki dla Windows (np. canonical + lowercase do porównania logicznego).

### 3.2. Startup daemona może panicować przez `expect` przy brakujących zasobach ikony
- Lokalizacja: `src/tray.rs:50-60`, `67-78`, `87-94` itd.
- Problem:
  - Inicjalizacja tray używa `expect` w wielu miejscach.
- Skutek:
  - Awaryjne zakończenie procesu przy uszkodzonych zasobach/środowisku.
- Rekomendacja:
  - Zastąpić `expect` kontrolowanym błędem i fallbackiem (log + komunikat + clean exit).

### 3.3. Frontend: kontekstowe akcje sesji zawierają hardcoded logikę „1 session”
- Lokalizacja: `dashboard/src/pages/ProjectPage.tsx:1435`
- Problem:
  - Wartość i fraza są stałe, mimo że komponent jest dynamiczny.
- Skutek:
  - Nieścisłość UX i niespójność tłumaczeń.
- Rekomendacja:
  - Podłączyć pod licznik i pluralizację i18n.

---

## 4. Wydajność i optymalizacje

### 4.1. O(n²) w budowaniu kluczy sesji
- Lokalizacja: `dashboard/src-tauri/src/commands/sessions.rs:350-357`
- Problem:
  - Deduplikacja par `(app_id, date)` przez `keys.iter().any(...)` dla każdej sesji.
- Rekomendacja:
  - Zastąpić przez `HashSet<(i64, String)>`.

### 4.2. O(n²) przy filtrowaniu `needs_suggestion`
- Lokalizacja: `dashboard/src-tauri/src/commands/sessions.rs:545-552`
- Problem:
  - `needs_suggestion.contains(id)` na `Vec` w pętli.
- Rekomendacja:
  - Konwersja `needs_suggestion` do `HashSet<i64>` przed filtrowaniem.

### 4.3. O(n*m) w walidacji importu
- Lokalizacja: `dashboard/src-tauri/src/commands/import_data.rs:66-72`
- Problem:
  - Dla każdej sesji wyszukiwanie appki przez `.iter().find(...)`.
- Rekomendacja:
  - Jednorazowo zbudować mapę `app_id -> executable_name`.

### 4.4. Duży bundle frontendu
- Objaw z buildu:
  - `dist/assets/index-*.js` ~ `962.94 kB` (minified, przed gzip).
- Rekomendacja:
  - Dalszy code-splitting (`manualChunks`) dla ciężkich bibliotek/widoków.
  - Rozważyć lazy-loading danych i chartów tam, gdzie możliwe.

---

## 5. Nadmiarowy kod / dług techniczny

### 5.1. Duplikacja parserów timestampów
- Lokalizacje:
  - `dashboard/src-tauri/src/commands/assignment_model.rs:288-314`
  - `dashboard/src-tauri/src/commands/sessions.rs:879-904`, `968-1006`
  - `dashboard/src-tauri/src/commands/analysis.rs:44-63`
- Problem:
  - Kilka niezależnych implementacji tej samej logiki.
- Ryzyko:
  - Rozjechanie zachowania, trudniejsze poprawki i testowanie.
- Rekomendacja:
  - Wydzielić wspólny moduł helperów daty/czasu i pokryć testami brzegowymi.

### 5.2. Niespójny styl i18n (`i18next` + inline PL/EN + lokalne helpery)
- Przykłady:
  - `useTranslation` + klucze locale,
  - `useInlineT`,
  - lokalne `tt(...)` / `t(pl,en)` (np. `QuickStart`).
- Skutek:
  - Wyższy koszt utrzymania i większe ryzyko pominięcia tłumaczeń.
- Rekomendacja:
  - Ujednolicić na jeden standard i18n (preferencyjnie klucze w locale JSON).

---

## 6. Brakujące / niekompletne tłumaczenia

## 6.1. `ProjectPage` ma wiele hardcoded angielskich etykiet
- Lokalizacje (przykładowe, nie wyczerpujące):
  - `dashboard/src/pages/ProjectPage.tsx:1185`
  - `1206-1215`, `1226`, `1241-1246`, `1262`, `1268`, `1282-1283`
  - `1366-1370`, `1406-1410`, `1435`, `1456-1460`, `1472`, `1478`
  - `1509-1510`, `1531`, `1559`
  - `1582-1595`, `1600`, `1619`, `1627`, `1648`, `1660`, `1689`, `1700`, `1710`
- Problem:
  - Część tekstów jest przez `tt(...)`, część pozostaje na sztywno po angielsku.
- Rekomendacja:
  - Przenieść wszystkie teksty UI do i18n; użyć pluralizacji dla „session/sessions”.

## 6.2. `ProjectContextMenu` bez i18n
- Lokalizacja: `dashboard/src/components/project/ProjectContextMenu.tsx:117`, `129`
- Teksty:
  - `Project:`
  - `Go to project card`

## 6.3. `Help` ma sekcje częściowo po angielsku
- Lokalizacja: `dashboard/src/pages/Help.tsx:468`, `781`, `788`, `806`, `862`
- Problem:
  - Pojedyncze stałe labelki nie przechodzą przez `t(...)`.

## 6.4. `AI` pokazuje surowe wartości techniczne zamiast etykiet użytkowych
- Lokalizacja: `dashboard/src/pages/AI.tsx:519-521`
- Teksty:
  - `off`, `suggest`, `auto_safe`
- Rekomendacja:
  - Label tłumaczony, wartość techniczna tylko jako `value`.

---

## 7. Plan naprawczy (rekomendowana kolejność)

1. **Naprawa P0**: test `dashboard.rs` (kompilacja testów).  
2. **Uszczelnienie błędów DB**: usunąć ciche `flatten()/ok()` w krytycznych ścieżkach (`sessions`, `assignment_model`, `projects`).  
3. **Walidacja konfiguracji interwałów** w daemonie (bezpieczne minimum + fallback).  
4. **Pakiet i18n**:
   - `ProjectPage` + `ProjectContextMenu` + `Help` + etykiety `AI`.
   - Dodać zasadę: brak hardcoded tekstów UI poza i18n.
5. **Optymalizacje hot-path** (`HashSet` dla deduplikacji i lookupów).  
6. **Refactor parserów timestampów** do wspólnego helpera + testy.

---

## 8. Podsumowanie

Architektura jest ogólnie dojrzała i aplikacja kompiluje się oraz buduje poprawnie, ale są 3 obszary wymagające pilnej poprawy:

- niedziałający build testów Tauri,
- ciche pomijanie błędów danych w backendzie,
- wyraźne luki i niespójność i18n (szczególnie `ProjectPage`).

Po ich domknięciu największy zwrot da stabilizacja warstwy danych (jawne błędy zamiast „partial success”) oraz porządny cleanup tłumaczeń.

---

## 9. Status wdrożenia (2026-03-03)

Wdrożone:

1. Uszczelnienie odczytów DB (bez cichego `flatten()/ok()`) w kluczowych komendach:
   - `dashboard/src-tauri/src/commands/sessions.rs`
   - `dashboard/src-tauri/src/commands/assignment_model.rs`
   - `dashboard/src-tauri/src/commands/projects.rs`
   - dodatkowo `dashboard/src-tauri/src/commands/import_data.rs` (spójność importu/validacji).
   - dodatkowo pełny sweep modułów:
     - `dashboard/src-tauri/src/commands/analysis.rs`
     - `dashboard/src-tauri/src/commands/dashboard.rs`
     - `dashboard/src-tauri/src/commands/estimates.rs`
   - status po sweepie: brak wzorca `filter_map(|r| r.ok())` / `rows.flatten()` w `dashboard/src-tauri/src/commands/`.
2. Walidacja i clamp interwałów monitoringu:
   - `src/config.rs` (`poll_secs`, `save_secs`, `cache_*`, `session_gap_secs`, `config_reload_secs`, `cpu_threshold`).
   - eliminacja ryzyka `poll_secs=0` i busy loop.
3. Optymalizacje wydajności:
   - `sessions.rs`: deduplikacja kluczy przez `HashSet` (zamiast O(n²)),
   - `sessions.rs`: filtrowanie `needs_suggestion` przez `HashSet`,
   - `import_data.rs`: mapa `app_id -> executable_name` (zamiast O(n*m) `.iter().find(...)`).
4. i18n (brakujące tłumaczenia):
   - `dashboard/src/pages/ProjectPage.tsx`
   - `dashboard/src/components/project/ProjectContextMenu.tsx`
   - `dashboard/src/pages/Help.tsx`
   - `dashboard/src/pages/AI.tsx` (etykiety trybów modelu).

Weryfikacja po wdrożeniu:

- `cargo check` (daemon): OK  
- `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`: OK  
- `npm run build` (dashboard): OK (warning o dużym chunku nadal obecny)  
- `cargo test --manifest-path dashboard/src-tauri/Cargo.toml --no-run`: nadal FAIL na istniejącym wcześniej błędzie testu `dashboard.rs` (niedopasowanie krotki 3 vs 4).

## 10. Plan naprawczy krok po kroku (dalsze domknięcie)

1. Naprawić niedziałający test `dashboard/src-tauri/src/commands/dashboard.rs` (tuple mismatch).
2. Rozszerzyć uszczelnienie DB o pozostałe moduły (`analysis.rs`, `dashboard.rs`, `estimates.rs`), gdzie nadal występują wzorce `filter_map(|r| r.ok())`.
3. Dodać testy jednostkowe dla walidacji interwałów (`config::intervals`) z przypadkami brzegowymi.
4. Dokończyć i18n cleanup:
   - stopniowe przejście z inline tłumaczeń na klucze i18next,
   - reguła lint/code review: brak nowych hardcoded stringów UI.
5. Domknąć optymalizację bundla frontendu:
   - podział chunków (`manualChunks`),
   - dalszy lazy-loading cięższych widoków.

---

## 11. Re-weryfikacja końcowa (2026-03-03, po poprawkach lint/typowania)

Aktualizacja statusu względem sekcji 8-10:

- wcześniejsza informacja o błędzie testu Tauri (`dashboard.rs`, tuple mismatch) jest **nieaktualna**;
- po obecnym przebiegu walidacji testy i kompilacja przechodzą poprawnie.

Wyniki bieżących kontroli:

- `npm run lint` (dashboard): **OK** (0 errors, 0 warnings).
- `npm run build` (dashboard): **OK**.
  - po podziale chunków (`manualChunks`) i lazy-load `Dashboard`:
    - największy chunk spadł z ~`963 kB` do ~`412 kB` (`index-*.js`),
    - chunk `charts-*.js`: ~`364 kB`,
    - brak ostrzeżenia Vite o chunkach > 500 kB.
- `cargo check` (daemon): **OK**.
- `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`: **OK**.
- `cargo test` (daemon): **OK** (7/7).
- `cargo test --manifest-path dashboard/src-tauri/Cargo.toml`: **OK** (6/6).
- `cargo fmt --check` + `cargo fmt --manifest-path dashboard/src-tauri/Cargo.toml --all --check`: **OK**.

Co zostało do domknięcia (bez blokowania działania aplikacji):

1. Dalsze strojenie chunkingu pod cache/runtime (opcjonalnie, już bez krytycznych warningów).
