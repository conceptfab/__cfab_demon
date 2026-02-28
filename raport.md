# Raport analizy kodu projektu TIMEFLOW

Data analizy: 2026-02-28  
Zakres: logika biznesowa, wydajność, optymalizacje, nadmiarowy kod, i18n/tłumaczenia.

## 1) Podsumowanie wykonawcze

Najważniejsze wnioski:

1. Logika uczenia modelu przypisań AI jest niespójna z rzeczywistymi źródłami feedbacku (P0).
2. Tryb `auto_safe` może wzmacniać własne decyzje bez potwierdzenia użytkownika (P0).
3. Sugestie AI mogą wskazywać projekt już wykluczony/zamrożony (P0).
4. Klucz manual override oparty o `(executable_name,start_time,end_time)` jest kruchy i może nie działać po scalaniu sesji/importach (P1).
5. Wydajność listy sesji: sekwencyjne wywołania AI + masowe preloady score breakdown + częste odświeżanie (P1).
6. Testy backendu Tauri są obecnie czerwone przez drift schematu testowego (P1).
7. i18n jest dopiero częściowo wdrożone; duża część UI pozostaje hardcoded (P2).

### Aktualizacja wdrożeniowa (2026-02-28)

- Naprawiono regresję Time Analysis: wykres kołowy ponownie renderuje się we wszystkich widokach (daily/weekly/monthly).
- Zmieniono źródło danych pie chart na agregację z `get_project_timeline`, co usuwa wąskie gardło i eliminuje zależność od osobnego wywołania `get_top_projects`.
- Rozszerzono parser czasu po stronie backendu (`analysis.rs`) o formaty legacy ze spacją i częścią ułamkową sekund, aby nie gubić historycznych sesji przy agregacjach.

## 2) Wyniki krytyczne (P0)

### P0.1 Niespójny feedback loop AI (część korekt użytkownika nie trafia do reinforcement)

**Obserwacja**  
Reinforcement w retrain bierze tylko `source IN ('manual_session_assign', 'ai_suggestion_reject')`, podczas gdy UI zapisuje wiele innych źródeł korekt.

**Dowody**

- `dashboard/src-tauri/src/commands/assignment_model.rs:704-709`  
  filtr źródeł feedbacku podczas retrainingu.
- `dashboard/src-tauri/src/commands/sessions.rs:645-650`  
  `assign_session_to_project` zapisuje `source` z parametru (lub domyślne `manual_session_assign`).
- `dashboard/src/pages/Sessions.tsx:976`  
  `ai_suggestion_accept`.
- `dashboard/src/pages/Sessions.tsx:1564`, `dashboard/src/pages/Sessions.tsx:1580`  
  `manual_session_unassign`, `manual_session_change`.
- `dashboard/src/pages/ProjectPage.tsx:456`, `dashboard/src/pages/ProjectPage.tsx:542`  
  `bulk_unassign`, `manual_project_card_change`.
- `dashboard/src-tauri/src/commands/projects.rs:803-804`  
  `manual_app_assign`.

**Ryzyko**

- Model nie uczy się z istotnej części realnych korekt użytkownika.
- Efekt: słaba poprawa jakości sugestii mimo aktywnego użycia UI.

**Rekomendacja**

1. Ujednolicić słownik `source` (enum/konstanta współdzielona FE/BE).
2. Zastąpić listę hardcoded w retrain polityką opartą o typ feedbacku (np. `is_human_feedback=1`).
3. Dodać testy integracyjne: każde źródło korekty użytkownika zwiększa wpływ na model.

---

### P0.2 Ryzyko samoutwardzania modelu (`auto_safe` uczy się na własnych auto-przypisaniach)

**Obserwacja**

- Trening bazowy bierze wszystkie sesje z `project_id IS NOT NULL`, niezależnie czy to przypisanie manualne czy auto.
- `run_auto_safe_assignment` po przypisaniu zapisuje feedback typu `auto_accept` i podnosi licznik `feedback_since_train`.

**Dowody**

- `dashboard/src-tauri/src/commands/assignment_model.rs:680-695`  
  źródło danych treningowych.
- `dashboard/src-tauri/src/commands/assignment_model.rs:988-992`  
  auto-przypisanie `sessions.project_id`.
- `dashboard/src-tauri/src/commands/assignment_model.rs:1039-1043`  
  zapis `assignment_feedback` z `source='auto_accept'`.
- `dashboard/src-tauri/src/commands/assignment_model.rs:1048-1050`  
  inkrementacja `feedback_since_train`.

**Ryzyko**

- Błędne auto-decyzje mogą się utrwalać i wzmacniać.
- Model może dryfować od danych potwierdzonych przez użytkownika.

**Rekomendacja**

1. Rozdzielić etykiety treningowe: `manual_verified` vs `auto_assigned`.
2. Domyślnie trenować wyłącznie na manualnie potwierdzonych danych.
3. `auto_accept` traktować jako sygnał pomocniczy o niższej wadze lub całkowicie wyłączyć z retrain.

---

### P0.3 Brak pełnej walidacji aktywności projektu w sugestii AI

**Obserwacja**  
W `compute_raw_suggestion` weryfikacja aktywności projektu (`excluded_at`, `frozen_at`) jest wykonywana tylko dla warstwy 0 (file evidence), ale nie dla warstw 1/2/3. Końcowy wybór zwycięzcy nie ma dodatkowego filtra aktywności.

**Dowody**

- `dashboard/src-tauri/src/commands/assignment_model.rs:364-381`  
  walidacja aktywności tylko dla Layer 0.
- `dashboard/src-tauri/src/commands/assignment_model.rs:384-456`  
  Layer 1/2/3 bez analogicznej walidacji.
- `dashboard/src-tauri/src/commands/assignment_model.rs:476-481`  
  zwrot finalnego `project_id` bez końcowej walidacji.
- `dashboard/src-tauri/src/commands/assignment_model.rs:988-992`  
  auto-safe aplikuje tę sugestię bez dodatkowego guardu.

**Ryzyko**

- Auto-przypisanie do projektów wykluczonych/zamrożonych.

**Rekomendacja**

1. Dodać uniwersalny filtr `is_active_project(project_id)` przed dodaniem kandydata z każdej warstwy.
2. Dodać finalny guard przed zapisem (`UPDATE sessions`).
3. Dodać test regresyjny: model nigdy nie proponuje `excluded_at != NULL` ani `frozen_at != NULL`.

## 3) Wyniki wysokie (P1)

### P1.1 Manual override jest kruchy po przebudowie/scalaniu sesji

**Obserwacja**  
Override jest kluczowany po dokładnych `start_time` i `end_time`. Gdy sesje są scalane/zmieniane, klucz przestaje pasować.

**Dowody**

- `dashboard/src-tauri/src/commands/sessions.rs:47-57`, `dashboard/src-tauri/src/commands/sessions.rs:94-99`  
  unikalność i zapis override po `(executable_name,start_time,end_time)`.
- `dashboard/src-tauri/src/commands/assignment_model.rs:217-223`  
  odczyt override po exact match czasu.
- `dashboard/src-tauri/src/commands/sessions.rs:876-929`, `dashboard/src-tauri/src/commands/sessions.rs:937-941`  
  przebudowa zmienia `end_time` i usuwa scałkowane rekordy.

**Ryzyko**

- Użytkownik ręcznie poprawia sesję, a później przypisanie „wraca” do poprzedniego projektu.

**Rekomendacja**

1. Oprzeć override o stabilny identyfikator (`session_id`) lub trwały fingerprint.
2. Dodać proces migracji override podczas `rebuild_sessions`.
3. Dodać test e2e: manual assign -> rebuild -> assign stays.

---

### P1.2 `merge_or_insert_session` ma wybór `project_id` zależny od kolejności rekordów

**Obserwacja**  
Wykrywanie overlapów nie ma `ORDER BY`; pierwszy napotkany `project_id` wygrywa.

**Dowody**

- `dashboard/src-tauri/src/commands/import_data.rs:548-553`  
  SELECT overlapów bez `ORDER BY`.
- `dashboard/src-tauri/src/commands/import_data.rs:581-583`  
  przypisanie `merged_project_id` tylko gdy `None`.

**Ryzyko**

- Niedeterministyczne zachowanie przy sprzecznych overlapach.
- Możliwe „odbijanie” przypisań po imporcie/synchronizacji.

**Rekomendacja**

1. Wprowadzić deterministyczną regułę wyboru (np. najnowsza sesja, max overlap, priorytet manual).
2. Dodać `ORDER BY` zgodny z tą regułą.
3. Dodać test na konflikt dwóch różnych `project_id` w overlapach.

---

### P1.3 N+1 i sekwencyjne wywołania AI podczas ładowania sesji

**Obserwacja**

- Backend `get_sessions` odpala `suggest_project_for_session` dla każdej sesji osobno i sekwencyjnie.
- Dodatkowo dla każdej sugestii otwiera nowe połączenie DB tylko po nazwę projektu.
- Frontend preloaduje score breakdown dla wszystkich sesji.

**Dowody**

- `dashboard/src-tauri/src/commands/sessions.rs:509-531`  
  pętla sekwencyjna + lookup nazwy projektu per rekord.
- `dashboard/src/pages/Sessions.tsx:1038-1076`  
  auto-load score breakdown dla całej listy.
- `dashboard/src/pages/Sessions.tsx:767-788`  
  auto-refresh co 15s.

**Ryzyko**

- Wysokie zużycie CPU/IO, wolniejsze renderowanie i responsywność UI.

**Rekomendacja**

1. Dodać endpoint batchowy: sugestie dla listy sesji jedną operacją SQL/AI.
2. Dołączać nazwę sugerowanego projektu w tym samym zapytaniu (bez dodatkowego `db::get_connection`).
3. Ograniczyć preload score breakdown do widocznych elementów (viewport/lazy on expand).

---

### P1.4 Nadmierna presja odświeżania i synchronizacji

**Obserwacja**

- App ma kilka niezależnych timerów (refresh, file watcher, sync poll, local-change sync).
- Dashboard przy `refreshKey` odpala ciężki zestaw równoległych fetchy.

**Dowody**

- `dashboard/src/App.tsx:227-233`  
  okresowy refresh + watcher.
- `dashboard/src/App.tsx:439-473`, `dashboard/src/App.tsx:475-485`  
  interwał online sync + polling + sync po local change.
- `dashboard/src/pages/Dashboard.tsx:215-260`  
  wielokrotne równoległe pobrania danych przy każdym refreshu.

**Ryzyko**

- „Skakanie” wykresów i okresowe przycięcia UI.

**Rekomendacja**

1. Wprowadzić centralny scheduler refreshy z deduplikacją zdarzeń.
2. Wprowadzić cooldown/coalescing dla triggerów.
3. Rozdzielić priorytety odświeżania (krytyczne vs tło).

---

### P1.5 Czerwone testy backendu Tauri (drift schematu fixture’ów)

**Status testów**

- `cargo test` (repo root): 7/7 OK.
- `cargo test` (`dashboard/src-tauri`): 3 OK, 2 FAIL.

**Failujące testy**

1. `commands::dashboard::tests::dashboard_counters_use_manual_session_days`
2. `commands::estimates::tests::estimate_rows_use_project_override_or_global`

**Przyczyna**  
Testowe tabele nie zawierają kolumn, których oczekuje wspólna ścieżka SQL:

- `projects.excluded_at`
- `manual_sessions.title`

**Dowody**

- `dashboard/src-tauri/src/commands/dashboard.rs:535-540`  
  testowe `projects` bez `excluded_at`.
- `dashboard/src-tauri/src/commands/estimates.rs:423-428`, `dashboard/src-tauri/src/commands/estimates.rs:448-455`  
  testowe `projects` bez `excluded_at` i `manual_sessions` bez `title`.
- Wykonanie `cargo test` w `dashboard/src-tauri`: błędy `no such column: p.excluded_at`, `no such column: ms.title`.

**Rekomendacja**

1. Ujednolicić helper test-schema ze schematem runtime (jedno źródło prawdy).
2. Dodać test „schema parity” dla in-memory fixtures.

## 4) Wyniki średnie (P2)

### P2.1 Niepełne i18n / brakujące tłumaczenia

**Obserwacja**

- `useTranslation` występuje tylko na części ekranów.
- Zasoby locale są bardzo małe i obejmują głównie sekcję Language + hints dla Help/QuickStart.
- W `Settings` duża część treści nadal hardcoded.

**Dowody**

- `dashboard/src/i18n.ts:3-4`  
  tylko `en/common.json` i `pl/common.json`.
- `dashboard/src/pages/Help.tsx:32`, `dashboard/src/pages/QuickStart.tsx:21`, `dashboard/src/pages/Settings.tsx:50`  
  strony używające `useTranslation`.
- Brak `useTranslation` m.in. w:  
  `AI.tsx`, `Applications.tsx`, `DaemonControl.tsx`, `Dashboard.tsx`, `Data.tsx`, `Estimates.tsx`, `ImportPage.tsx`, `ProjectPage.tsx`, `Projects.tsx`, `Sessions.tsx`, `TimeAnalysis.tsx`.
- `dashboard/src/locales/en/common.json:1-20` i `dashboard/src/locales/pl/common.json:1-20`  
  bardzo ograniczony zakres kluczy.
- `dashboard/src/pages/Settings.tsx:141-147`, `184-205`, `257-260`  
  przykłady hardcoded komunikatów.

**Ryzyko**

- Niespójny UX językowy; część interfejsu niepodlegająca zmianie języka.

**Rekomendacja**

1. Ustalić plan migracji per ekran (Dashboard/Sessions/Projects jako pierwsze).
2. Wymusić zasadę: nowe stringi wyłącznie przez `t(...)`.
3. Dodać test/skrypt wykrywający hardcoded UI strings.

---

### P2.2 Nadmiarowy / potencjalnie martwy kod

**Obserwacja**

- Komendy `confirm_session_assignment` i `reject_session_assignment` są wystawione w API, ale nieużywane przez obecny frontend.
- W repo jest dodatkowy plik `Projects.tsx (fixing imports)` (artefakt roboczy), śledzony przez git.

**Dowody**

- `dashboard/src-tauri/src/commands/assignment_model.rs:1574-1633`
- `dashboard/src/lib/tauri.ts:243-247`
- brak użyć w `dashboard/src/pages` i `dashboard/src/components` (wyszukiwanie po symbolach).
- plik: `dashboard/src/pages/Projects.tsx (fixing imports)`

**Ryzyko**

- Rozjazd między utrzymywanym API a realnym flow UI.
- Szum w repo i większe ryzyko pomyłek podczas refaktoryzacji.

**Rekomendacja**

1. Usunąć lub włączyć te komendy do aktywnego flow.
2. Usunąć plik artefaktowy z repo (po potwierdzeniu, że nie jest potrzebny).

---

### P2.3 Miejsca potencjalnej optymalizacji indeksów SQL

**Obserwacja**  
Wiele krytycznych zapytań używa warunków zakresowych po czasie (`first_seen/last_seen`, `start_time/end_time`), a obecne indeksy są głównie ogólne (`app_id`, `date`, `start_time`).

**Dowody**

- Zapytania zakresowe:  
  `dashboard/src-tauri/src/commands/assignment_model.rs:322`, `1009-1010`, `1176-1177`, `1335-1336`  
  `dashboard/src-tauri/src/commands/sessions.rs:211-212`, `626-627`  
  `dashboard/src-tauri/src/commands/import_data.rs:552-553`
- Aktualne indeksy:  
  `dashboard/src-tauri/src/db.rs:168-170`, `dashboard/src-tauri/src/db.rs:1142-1144`

**Rekomendacja**

1. Rozważyć indeksy złożone pod realne filtry (np. `file_activities(app_id,date,last_seen,first_seen)` oraz `sessions(app_id,date,start_time,end_time)`).
2. Zweryfikować decyzję przez `EXPLAIN QUERY PLAN` na produkcyjnych wolumenach.

## 5) Priorytetowy plan naprawczy (proponowana kolejność)

1. Naprawić P0.1, P0.2, P0.3 w jednym cyklu zmian modelu AI.
2. Naprawić P1.5 (test fixtures), aby przywrócić wiarygodny pipeline testowy.
3. Zmniejszyć koszt listy sesji (P1.3) przez batch suggestions i lazy breakdown.
4. Ustabilizować manual override (P1.1) i deterministykę merge (P1.2).
5. Zredukować presję refresh/sync (P1.4) przez scheduler z deduplikacją.
6. Rozpocząć etapową migrację i18n (P2.1), zaczynając od najczęściej używanych ekranów.
7. Posprzątać artefakty/unused API (P2.2) i ewentualnie dodać indeksy po profilowaniu (P2.3).

## 6) Wniosek końcowy

Aplikacja działa, ale ma kilka istotnych ryzyk logicznych i jakościowych w obszarze AI-assignments oraz wydajności odświeżania. Największy wpływ na stabilność i jakość predykcji da naprawa pętli feedbacku, odseparowanie danych auto/manual w treningu i przywrócenie pełnej wiarygodności testów backendu.
