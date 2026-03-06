# Raport analizy kodu TIMEFLOW
Data: 2026-03-06
Zakres: `dashboard/src` (React/TS) + `dashboard/src-tauri/src` (Rust/Tauri)

## 1) Metodyka
- Przegląd ręczny kluczowych ścieżek logiki (sesje, projekty, raporty, i18n, help).
- Weryfikacja statyczna:
  - `npm --prefix dashboard run lint`
  - `cargo clippy --lib -p timeflow-dashboard -- -W clippy::all` (w `dashboard/src-tauri`)
  - `cargo test --lib -p timeflow-dashboard` (w `dashboard/src-tauri`)
- Weryfikacja spójności tłumaczeń en/pl i używanych kluczy `t('...')`.

## 2) Executive summary
- Największe ryzyka logiczne:
  - Filtrowanie sesji per projekt działa na poziomie `(app_id, date)` zamiast realnego overlapu czasowego.
  - Licznik „Pliki” jest oparty o `DISTINCT file_name` i może zaniżać/wypaczać wynik.
  - Statystyka `session_count` dla projektu ma inną logikę niż lista sesji i może dawać inne liczby.
- Wydajność:
  - Dużo zapytań „all-time” (`1970..2100`, `2000..2100`, `2020..2100`) + miejscami `limit: 10000`.
  - Niespójne definicje zakresu „all-time” między modułami.
- Jakość:
  - Frontend lint: 3 błędy.
  - Rust clippy: 12 ostrzeżeń.
  - Testy Rust: 6/6 PASS.
- i18n/help:
  - Brakuje 13 kluczy i18n używanych w kodzie.
  - Help nie pokrywa części funkcji (np. Reports, BugHunter, split sesji).

## 3) Kluczowe problemy logiki

### 3.1 Filtrowanie sesji per projekt oparte o dzień aplikacji, nie overlap
**Dowody**
- `dashboard/src-tauri/src/commands/sessions.rs:282`-`289`
- `dashboard/src-tauri/src/commands/sessions.rs:638`-`643`

**Opis**
- W `get_sessions` i `get_session_count` sesja wpada do projektu, jeśli istnieje `file_activities` dla tej samej aplikacji i daty (`app_id + date`), bez warunku overlapu `first_seen/last_seen` z czasem sesji.

**Skutek**
- Możliwe zawyżenia/zafałszowania listy i liczników sesji per projekt (szczególnie przy wielu sesjach jednej aplikacji tego samego dnia).

**Rekomendacja**
- Ujednolicić logikę na overlap czasowy (jak w przypisywaniu ręcznym i inferencji), np. warunki:
  - `fa.last_seen > s.start_time`
  - `fa.first_seen < s.end_time`
- Docelowo: wspólna CTE/funkcja SQL do „membership sesji w projekcie”, używana we wszystkich endpointach.

### 3.2 Zliczanie „Pliki” może być zaniżone i semantycznie mylące
**Dowody**
- Schema: `dashboard/src-tauri/src/db.rs:131`-`143` (`file_activities` ma `file_name`, bez `file_path`)
- Unikalność: `UNIQUE(app_id, date, file_name)` w `dashboard/src-tauri/src/db.rs:142`
- Import: `dashboard/src-tauri/src/commands/import.rs:201`-`207`
- Licznik: `dashboard/src-tauri/src/commands/projects.rs:1237`-`1239`

**Opis**
- Obecna metryka to `COUNT(DISTINCT LOWER(TRIM(fa.file_name)))`.
- Ten sam `file_name` w różnych katalogach jest traktowany jak ten sam plik.

**Skutek**
- Licznik „Pliki” dla projektu może być zaniżony względem realnej liczby plików, nad którymi pracowano.

**Rekomendacja**
- Minimum: doprecyzować etykietę metryki na „unikalne nazwy plików”.
- Docelowo: migracja modelu na identyfikator pliku (`file_path`/`normalized_path`/hash) i zliczanie po nim.

### 3.3 `session_count` projektu ma inną semantykę niż lista sesji
**Dowody**
- `dashboard/src-tauri/src/commands/projects.rs:1229` (licznik oparty o `a.project_id OR s.project_id`)
- `dashboard/src-tauri/src/commands/sessions.rs:276` (lista sesji filtruje `is_hidden`)

**Opis**
- `session_count` w `get_project_extra_info` nie filtruje `is_hidden` i nie używa tej samej logiki membership co lista sesji.

**Skutek**
- Rozjazdy między statystykami projektu a tym, co użytkownik widzi na liście sesji.

**Rekomendacja**
- Zastąpić query wspólną logiką (ta sama CTE/warunki co w endpointach sesji), dodać filtr `is_hidden`.

### 3.4 Status „nowy projekt” jest zaszyty na stałe (7 dni)
**Dowody**
- `dashboard/src/pages/Projects.tsx:98`-`100`

**Opis**
- `isNewProject` używa stałego 7-dniowego okna od `created_at`.

**Skutek**
- Zachowanie może odbiegać od oczekiwań konfiguracji „nieaktywności” (w praktyce to osobna logika i oddzielny próg).

**Rekomendacja**
- Albo jawnie opisać rozdział tych pojęć (nowość vs nieaktywność), albo spiąć z konfiguracją użytkownika.

## 4) Wydajność i optymalizacje

### 4.1 Ciężkie zapytania all-time + wysokie limity
**Dowody**
- `dashboard/src/pages/ProjectPage.tsx:263`-`279`
- `dashboard/src/pages/ReportView.tsx:73`-`83`
- `dashboard/src/pages/Projects.tsx:96`, `373`, `396`, `493`

**Opis**
- Częste pobieranie pełnego zakresu historycznego.
- Dla sesji: `limit: 10000` (potencjalne obcięcie danych przy dużych projektach).

**Rekomendacja**
- Paginate/stream dla sesji i danych raportowych.
- Dodać backendowy endpoint agregujący dane raportu (jedno zapytanie zamiast wielu).
- Wprowadzić cache na poziomie store dla all-time stats.

### 4.2 Niespójny „all-time range” w różnych miejscach
**Dowody**
- `dashboard/src/store/data-store.ts:70`
- `dashboard/src/pages/Projects.tsx:96`
- `dashboard/src/components/sync/BackgroundServices.tsx:61`
- `dashboard/src/pages/ProjectPage.tsx:264`
- `dashboard/src/pages/ReportView.tsx:73`

**Opis**
- Różne moduły używają różnych startów: `1970`, `2000`, `2020`.

**Skutek**
- Niespójne wyniki pomiędzy ekranami.

**Rekomendacja**
- Jedna stała np. `ALL_TIME_START` w centralnym module + użycie wszędzie.

### 4.3 Pętla background 1s i częste odczyty ustawień
**Dowody**
- `dashboard/src/components/sync/BackgroundServices.tsx:211` (tick 1s)
- `dashboard/src/components/sync/BackgroundServices.tsx:224` (`loadOnlineSyncSettings()` w pętli)

**Opis**
- Harmonogram oparty o 1-sekundowy loop obsługuje zadania minutowe/sekundowe.

**Rekomendacja**
- Rozbić na osobne timery per job lub scheduler oparty o „next timeout”.
- Cache ustawień sync i aktualizacja cache po eventach.

## 5) Kod nadmiarowy / dług techniczny

### 5.1 Nieużywany generator raportu
**Dowód**
- Definicja: `dashboard/src/lib/report-generator.ts:45`
- Brak użyć `generateProjectReport` w innych plikach.

**Rekomendacja**
- Usunąć lub zintegrować z aktualnym flow `Reports`/`ReportView`.

### 5.2 Duplikacja logiki raportowej
**Dowody**
- `dashboard/src/lib/report-generator.ts` (ładowanie template + pobieranie danych)
- `dashboard/src/pages/ReportView.tsx:31`-`56`, `73`-`87` (analogicznie)

**Rekomendacja**
- Wydzielić wspólny serwis `report-data-service.ts` i używać go w jednym miejscu.

## 6) Tłumaczenia (i18n)

### 6.1 Spójność en/pl
- Parzystość kluczy en/pl jest dobra (brak asymetrii plików).

### 6.2 Brakujące klucze używane w kodzie (13)
- `common.cancel`
- `projects.labels.save`
- `sessions.menu.accept_suggestion`
- `sessions.menu.reject_suggestion`
- `sessions.menu.split_session`
- `sessions.split.ai_suggestion`
- `sessions.split.confirm`
- `sessions.split.description`
- `sessions.split.part_a`
- `sessions.split.part_b`
- `sessions.split.splitting`
- `sessions.split.title`
- `sessions.split.unassigned`

**Dowody użyć**
- `dashboard/src/components/sessions/SplitSessionModal.tsx:81`, `87`, `96`, `129`, `139`, `150`, `160`, `191`, `200`, `201`
- `dashboard/src/components/sessions/SessionRow.tsx:136`, `148`, `419`, `430`
- `dashboard/src/pages/Sessions.tsx:1216`
- `dashboard/src/pages/Projects.tsx:1102`

**Dodatkowa obserwacja**
- `common.cancel` prawdopodobnie powinno być `ui.buttons.cancel` (istnieje: `dashboard/src/locales/en/common.json:6`-`10`).

### 6.3 Hardcoded stringi poza i18n
**Dowody**
- `dashboard/src/pages/Projects.tsx:457` (hardcoded EN confirm)
- `dashboard/src/App.tsx:164` (`Loading...`)

**Rekomendacja**
- Przenieść do i18n i używać jednolitego namespace.

## 7) Funkcjonalności nieopisane w Help/Pomoc

### 7.1 Brak sekcji Help dla modułu Reports
**Dowody**
- Nawigacja ma Reports: `dashboard/src/components/layout/Sidebar.tsx:71`
- Routing ma Reports: `dashboard/src/App.tsx:94`-`95`
- Help tabs nie mają `reports`: `dashboard/src/lib/help-navigation.ts:1`-`13`, `21`-`33`, `35`-`49`
- W `Help.tsx` brak `value="reports"` w zakładkach.

### 7.2 Brak opisu BugHunter w Help
**Dowody**
- Funkcja dostępna z sidebara: `dashboard/src/components/layout/Sidebar.tsx:441`-`449`
- Brak dedykowanego opisu w `Help.tsx`.

### 7.3 Brak opisu „split session” w sekcji Sessions Help
**Dowody**
- Funkcja dostępna: `dashboard/src/pages/Sessions.tsx:1216`
- Modal i logika split: `dashboard/src/components/sessions/SplitSessionModal.tsx`
- Sekcja help dla sessions nie wymienia splitu: `dashboard/src/pages/Help.tsx:397`-`425`

## 8) Wyniki statycznej weryfikacji

### 8.1 Frontend lint
Polecenie: `npm --prefix dashboard run lint`

Wynik: 3 błędy
- `dashboard/src/pages/ReportView.tsx:72` (`setState` w `useEffect`)
- `dashboard/src/pages/Sessions.tsx:918` (dostęp do `ref.current` podczas renderu; zgłoszone 2x)

### 8.2 Rust clippy
Polecenie: `cargo clippy --lib -p timeflow-dashboard -- -W clippy::all`

Wynik: 12 ostrzeżeń
- Główne pliki: `analysis.rs`, `assignment_model.rs`, `estimates.rs`, `projects.rs`, `secure_store.rs`, `sessions.rs`, `lib.rs`.

### 8.3 Rust testy
Polecenie: `cargo test --lib -p timeflow-dashboard`

Wynik: PASS (6/6)

## 9) Priorytety napraw (proponowana kolejność)

### P1 (najpierw)
1. Ujednolicić logikę membership sesji->projekt na overlap czasowy (backend).
2. Poprawić metrykę plików (minimum: etykieta; docelowo: model danych z identyfikatorem pliku).
3. Naprawić brakujące klucze i18n (13) i hardcoded stringi.
4. Dodać sekcje Help dla: Reports, BugHunter, Split Session.

### P2
1. Ujednolicić ALL_TIME range i usunąć rozjazdy 1970/2000/2020.
2. Ograniczyć ciężkie all-time fetch (agregacje + paginacja).
3. Naprawić błędy lint (`ReportView`, `Sessions`).

### P3
1. Usunąć/scalać `report-generator.ts` z `ReportView`.
2. Posprzątać ostrzeżenia clippy.

## 10) Uwagi końcowe
- Aplikacja jest funkcjonalnie używalna, ale obecnie ma kilka miejsc, gdzie liczby i przypisania mogą być niespójne między widokami.
- Największy wpływ na jakość danych użytkownika będzie miało ujednolicenie logiki przypisywania sesji do projektów oraz doprecyzowanie metryki „Pliki”.
