# Plan implementacji funkcjonalnosci `Estimates`

## 1. Cel funkcji
- Dodac nowa zakladke `Estimates` w dashboardzie.
- Pokazac ile wart jest kazdy projekt na bazie przepracowanych godzin.
- Wspierac:
  - globalna stawke godzinowa (domyslnie `100`, edytowalna),
  - stawke per-projekt (nadpisanie globalnej, opcjonalne).
- Wartosc projektu:
  - `wartosc = przepracowane_godziny * efektywna_stawka`.
  - `efektywna_stawka = project.hourly_rate ?? global_hourly_rate`.

## 2. Zakres MVP (co ma wejsc w pierwszej wersji)
- Nowa karta w nawigacji: `Estimates`.
- Widok listy projektow z polami:
  - nazwa projektu,
  - czas (godziny),
  - stawka efektywna,
  - wartosc projektu.
- Edycja globalnej stawki.
- Edycja stawki per projekt (ustaw / wyczysc override).
- Filtrowanie po zakresie dat z istniejacego store (`today/week/month/all` + przesuwanie okresu).
- Podsumowanie na gorze:
  - suma godzin,
  - suma wartosci,
  - liczba projektow z aktywnym czasem,
  - liczba projektow z override stawki.

## 3. Model danych i migracje

### 3.1 Zmiany w DB
- `projects`:
  - dodac kolumne `hourly_rate REAL NULL`.
- nowa tabela ustawien estymacji:
  - `estimate_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`.
  - klucz MVP: `global_hourly_rate`.

### 3.2 Migracje w `dashboard/src-tauri/src/db.rs`
- W `run_migrations`:
  - dodac check `pragma_table_info('projects')` dla `hourly_rate`.
  - wykonac `ALTER TABLE projects ADD COLUMN hourly_rate REAL` jesli brak.
  - dodac `CREATE TABLE IF NOT EXISTS estimate_settings (...)`.
  - seed domyslnej stawki:
    - `INSERT OR IGNORE INTO estimate_settings (key, value, updated_at) VALUES ('global_hourly_rate', '100', datetime('now'))`.
- Utrzymac kompatybilnosc wstecz: stare DB maja ruszyc bez recznej interwencji.

## 4. Backend Tauri (Rust)

### 4.1 Nowy modul komend
- Dodac `dashboard/src-tauri/src/commands/estimates.rs`.
- Dodac eksport w `dashboard/src-tauri/src/commands/mod.rs`.
- Dodac komendy do `tauri::generate_handler!` w `dashboard/src-tauri/src/lib.rs`.

### 4.2 Nowe typy (`dashboard/src-tauri/src/commands/types.rs`)
- `EstimateSettings`:
  - `global_hourly_rate: f64`.
- `EstimateProjectRow`:
  - `project_id: i64`,
  - `project_name: String`,
  - `project_color: String`,
  - `seconds: i64`,
  - `hours: f64`,
  - `project_hourly_rate: Option<f64>`,
  - `effective_hourly_rate: f64`,
  - `estimated_value: f64`,
  - `session_count: i64`.
- `EstimateSummary`:
  - `total_seconds: i64`,
  - `total_hours: f64`,
  - `total_value: f64`,
  - `projects_count: i64`,
  - `overrides_count: i64`.

### 4.3 Komendy API
- `get_estimate_settings(app) -> EstimateSettings`
- `update_global_hourly_rate(app, rate: f64) -> Result<(), String>`
  - walidacja: `rate >= 0`, sensowny upper-limit (np. `<= 100000`).
- `update_project_hourly_rate(app, project_id: i64, rate: Option<f64>) -> Result<(), String>`
  - `None` = usuniecie override.
- `get_project_estimates(app, date_range: DateRange) -> Vec<EstimateProjectRow>`
- `get_estimates_summary(app, date_range: DateRange) -> EstimateSummary`

### 4.4 Logika agregacji czasu
- Uzyc istniejacej logiki `compute_project_activity_unique(...)` z `analysis.rs`:
  - zapewnia spojnosc z dashboardem i uwzglednia manual sessions,
  - unika podwojnego liczenia przy nakladajacych sie sesjach.
- Mapowanie `project_name -> project_id/color/hourly_rate` po `lower(name)`.
- `Unassigned`:
  - w MVP nie wyceniac,
  - pokazywac osobno jako info (opcjonalnie) lub pominac z wartosci sumarycznej.

## 5. Frontend (React/TS)

### 5.1 Nawigacja i routing
- `dashboard/src/components/layout/Sidebar.tsx`:
  - dodac item `estimates`.
- `dashboard/src/App.tsx`:
  - lazy-load nowej strony `Estimates`,
  - case w `PageRouter`.
- `dashboard/src/components/layout/TopBar.tsx`:
  - tytul `Estimates`.

### 5.2 Typy i klient Tauri
- `dashboard/src/lib/db-types.ts`:
  - dodac TS odpowiedniki nowych typow backendu.
- `dashboard/src/lib/tauri.ts`:
  - dodac wrappery:
    - `getEstimateSettings`,
    - `updateGlobalHourlyRate`,
    - `updateProjectHourlyRate`,
    - `getProjectEstimates`,
    - `getEstimatesSummary`.

### 5.3 Strona `Estimates`
- Nowy plik: `dashboard/src/pages/Estimates.tsx`.
- Sekcje UI:
  - gorny pasek: presety czasu (`today/week/month/all`) + nawigacja okresu (jak w Dashboard),
  - karta ustawien globalnych:
    - input numeric global stawka,
    - akcja save,
    - komunikat o walidacji i zapisie,
  - tabela projektow:
    - projekt / czas / stawka projektu / stawka efektywna / wartosc,
    - inline edit stawki projektu,
    - `Reset to global` (ustaw `null`),
  - podsumowanie (KPI cards).
- Sortowanie:
  - domyslnie po `estimated_value DESC`.
- Formatowanie:
  - godziny: 2 miejsca po przecinku,
  - kwota: `Intl.NumberFormat`.

### 5.4 Zachowanie stanu
- Korzystac z `useAppStore` dla `dateRange`, `timePreset`, `shiftDateRange`, `canShiftForward`, `refreshKey`.
- Po zapisie stawek:
  - odswiezyc dane przez `triggerRefresh()` albo lokalny refetch.

## 6. Integracja z import/export i kompatybilnosc

### 6.1 Export (`dashboard/src-tauri/src/commands/export.rs`)
- Rozszerzyc eksport projektu o `hourly_rate`.
- Rozwazyc bump wersji archiwum z `1.0` na `1.1`.

### 6.2 Import (`dashboard/src-tauri/src/commands/import_data.rs`)
- Przy tworzeniu projektu z archiwum zapisac `hourly_rate`.
- Przy projekcie juz istniejacym:
  - strategia MVP: nie nadpisywac lokalnej stawki jesli jest ustawiona,
  - opcjonalnie: nadpisac tylko gdy lokalnie `NULL`.

### 6.3 Clear data
- Ustalic decyzje:
  - czy `estimate_settings` ma byc kasowane przez `clear_all_data`.
- Rekomendacja:
  - NIE kasowac globalnej stawki przy czyszczeniu danych sesji (to ustawienie UI).

## 7. Walidacje i edge-case
- Niedozwolone stawki:
  - `NaN`, `Infinity`, wartosci ujemne.
- Projekty bez czasu w okresie:
  - domyslnie ukryte w tabeli (MVP) albo pokazywane z `0.00`.
- Bardzo duze wartosci:
  - limit inputu, bezpieczne formatowanie, brak overflow.
- Brak projektow:
  - pusty stan z komunikatem i CTA do zakladki `Projects`.

## 8. Testy

### 8.1 Rust (unit/integration)
- migracja dodaje `projects.hourly_rate`.
- migracja tworzy `estimate_settings` i seed global rate.
- fallback rate:
  - projekt bez override dziedziczy global.
- override rate:
  - projekt z override uzywa swojej stawki.
- agregacja:
  - poprawna wartosc dla sesji + manual sessions.

### 8.2 Frontend
- render pustego stanu.
- zmiana globalnej stawki i odswiezenie wartosci.
- zmiana stawki projektu (set/reset override).
- poprawne sortowanie po wartosci.

### 8.3 Test manualny (checklista)
1. Ustaw globalna stawke `100`.
2. Projekt A: 10h bez override -> wartosc `1000`.
3. Projekt B: 10h z override `150` -> wartosc `1500`.
4. Zmien zakres dat -> wartosci aktualizuja sie.
5. Restart aplikacji -> stawki sa zachowane.

## 9. Plan wdrozenia (etapy)

### Etap 1: Backend foundation
- migracje DB (`hourly_rate`, `estimate_settings`).
- nowe typy i komendy estimates.
- rejestracja komend w `lib.rs`.
- testy Rust dla logiki stawek.

### Etap 2: Integracja TS i routing
- db-types + tauri.ts.
- dodanie zakladki i routingu (`Sidebar`, `App.tsx`, `TopBar.tsx`).

### Etap 3: Widok Estimates
- implementacja strony i podsumowan.
- inline edycja stawek.
- obsloga pustych stanow i bledow.

### Etap 4: Kompatybilnosc danych
- export/import hourly_rate.
- decyzja i implementacja zachowania dla clear data.

### Etap 5: Hardening
- testy manualne + poprawki UX.
- drobne optymalizacje (memoizacja, debounce save jesli potrzebne).

## 10. Kryteria akceptacji (Definition of Done)
- Jest nowa karta `Estimates` widoczna w sidebarze.
- Uzytkownik moze ustawic globalna stawke i zapisac ja trwale.
- Uzytkownik moze ustawic lub wyczyscic stawke per-projekt.
- Wartosc projektu liczy sie poprawnie dla wybranego zakresu dat.
- Podsumowanie pokazuje laczna wartosc i godziny.
- Zmiany przetrwaja restart aplikacji.
- Brak regresji w obecnych widokach Dashboard/Projects/Sessions.
