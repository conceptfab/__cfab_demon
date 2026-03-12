# Raport analizy dashboardu i demona TIMEFLOW

Data analizy: 2026-03-12

## Zakres

Przejrzane obszary:

- demon Rust w `src/`
- frontend dashboardu w `dashboard/src/`
- backend Tauri w `dashboard/src-tauri/src/`
- tłumaczenia w `dashboard/src/locales/`
- panel pomocy w `dashboard/src/pages/Help.tsx`

## Stan ogólny

Repo jest aktualnie technicznie stabilne, ale ma kilka istotnych rozjazdów między tym, co pokazuje UI, tym co faktycznie liczy backend, a tym co opisuje Help.

Najważniejsze ryzyka:

- opisane w tym raporcie ryzyka zostały wdrożeniowo zamknięte
- dalsze prace to już głównie porządki utrzymaniowe i redukcja powtarzalnego kodu

## Status wdrożeń

Wdrożone w tej iteracji 2026-03-12:

- [x] Sessions pokazuje już tylko `file_activities` nachodzące na realne okno sesji; dodany test regresyjny w `dashboard/src-tauri/src/commands/sessions/query.rs`
- [x] demon rozdziela pliki o tej samej nazwie po `detected_path`, a bez ścieżki preferuje fallback `file_name + window_title`; sama nazwa zostaje tylko jako ostatni fallback gdy oba pola są puste; dodany test regresyjny w `src/tracker.rs`
- [x] agregacje projektowe w dashboardzie, timeline, estimates i statystykach projektów liczą już po `project_id`; timeline dostał stabilne klucze serii i metadane, a duplikaty nazw są rozdzielane w UI; dodany test regresyjny w `dashboard/src-tauri/src/commands/dashboard.rs`
- [x] dashboard dzienny przestał ucinać sesje do limitu `500`
- [x] prefetch score breakdown w `Sessions` działa już tylko w trybie `ai_detailed`
- [x] monitorowane aplikacje zwracają już stabilne kody błędów z backendu, a dashboard mapuje je do tłumaczeń; message box o drugiej instancji demona jest lokalizowany i używa brandingu TIMEFLOW
- [x] `Applications` formatuje `last_used` zgodnie z językiem UI, a `Projects` przestał wypuszczać literalne `View settings saved as default` i `opens -`
- [x] `Help.tsx` i locale zostały zaktualizowane o znacznik duplikatów projektów, akcję `Sync from apps` oraz prawidłowe zachowanie przy pustej liście monitorowanych procesów
- [x] backendowe etykiety `Unassigned` / `Other` zostały zastąpione technicznymi sentinelami, a UI tłumaczy je centralnie; dodany test regresyjny w `dashboard/src-tauri/src/commands/analysis.rs`
- [x] globalny polling statusu demona został odchudzony: sidebar, Help i ReportView używają lekkiego `get_daemon_runtime_status`, a pełne `get_daemon_status` zostało dla ekranu Daemon i jawnych operacji sterujących

Otwarte punkty:

- brak

## Najważniejsze ustalenia

### 1. Wysokie: widok Sessions pokazuje pliki z całego dnia aplikacji, nie z zakresu konkretnej sesji

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src-tauri/src/commands/sessions/query.rs:218` pobiera `file_activities` tylko po `(app_id, date)`
- `dashboard/src-tauri/src/commands/sessions/query.rs:281` przypisuje ten sam zestaw plików do każdej sesji z danego dnia
- `dashboard/src/components/sessions/SessionRow.tsx:121` i `dashboard/src/components/sessions/SessionRow.tsx:332` renderują `s.files` bez dodatkowego filtrowania po czasie sesji

Skutek:

- użytkownik w szczegółach sesji może zobaczyć pliki z wcześniejszych albo późniejszych bloków dnia
- opis `detailed / full file logs` staje się mylący, bo to nie jest rzeczywisty log tej jednej sesji
- AI split / ręczna analiza sesji jest w UI prezentowana na szerszym zbiorze niż sama sesja

Rekomendacja:

- filtrować `file_activities` do przedziału `[session.start_time, session.end_time]`
- jeśli pełne filtrowanie SQL byłoby za ciężkie, dodać osobny endpoint do ładowania plików per sesja tylko po rozwinięciu wiersza
- dopisać test, który udowadnia, że sesja nie dostaje plików spoza własnego okna czasowego

### 2. Wysokie: demon scala aktywność różnych plików po samej nazwie pliku

Status: wdrożone 2026-03-12.

Dowody:

- `src/tracker.rs:22-29` buduje cache indeksów plików tylko po `file_entry.name`
- `src/tracker.rs:226-259` aktualizuje lub tworzy wpisy też wyłącznie po `normalized_file_name`
- `src/tracker.rs:239` nadpisuje `detected_path` najnowszą wartością dla już istniejącego wpisu
- `dashboard/src-tauri/src/commands/import.rs:300-308` później traktuje `detected_path` albo `file.name` jako bazę `file_path`
- `dashboard/src-tauri/src/commands/import.rs:224` zakłada unikalność po `file_path`

Skutek:

- dwa różne pliki typu `index.ts`, `main.rs`, `README.md` w różnych repo mogą zostać zlane w jeden rekord
- przy kolejnych aktualizacjach demon nadpisuje ostatnio wykrytą ścieżkę i traci poprzedni kontekst
- projekt detection, split i AI dostają zanieczyszczone dane wejściowe

Rekomendacja:

- kluczować wpisy najpierw po `detected_path`, a dopiero fallbackowo po nazwie
- jeśli `detected_path` nie istnieje, rozważyć klucz złożony z `file_name + sanitized_window_title`
- dopisać test dla dwóch plików o tej samej nazwie i różnych ścieżkach

### 3. Wysokie: agregacje projektowe bazują na nazwie projektu zamiast na `project_id`

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src-tauri/src/commands/analysis.rs:37` definiuje `ProjectTotals = HashMap<String, f64>`
- `dashboard/src-tauri/src/commands/analysis.rs:135` i `dashboard/src-tauri/src/commands/dashboard.rs:333` pobierają `project_name`
- `dashboard/src-tauri/src/commands/analysis.rs:335` akumuluje czas do `total_by_project.entry(name)`
- `dashboard/src-tauri/src/commands/analysis.rs:346` ma komentarz `last mult wins` dla nakładających się wpisów tego samego projektu
- `dashboard/src/pages/Projects.tsx:906-991` ma osobny mechanizm wykrywania możliwych duplikatów nazw, więc sam produkt już sygnalizuje że takie przypadki są realne

Skutek:

- dwa projekty o tej samej albo prawie tej samej nazwie mogą być wizualnie odrębne, ale w agregacjach czasowych zostać zlane
- dotyczy to Dashboardu, Time Analysis i części zestawień projektowych korzystających z `compute_project_activity_unique`
- przy nakładaniu kilku bloków tego samego projektu, ale z różnym mnożnikiem, wynik może być liczony z ostatnim mnożnikiem zamiast z poprawnym rozkładem

Rekomendacja:

- przenieść agregację na `project_id` i dopiero przy wyjściu mapować do etykiety/koloru
- `Unassigned` trzymać jako jawny sentinel techniczny, nie jako zwykły string projektu
- dopisać test z dwoma projektami o zbliżonych nazwach i różnym `id`

### 4. Średnie: dashboard dzienny ucina sesje do pierwszych 500 rekordów

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src/pages/Dashboard.tsx:217-218` liczy banner nieprzypisanych z `todaySessions`
- `dashboard/src/pages/Dashboard.tsx:374` pobiera dzienne sesje z limitem `500`
- `dashboard/src/pages/Dashboard.tsx:474-536` na tej samej próbce buduje banner oraz `ProjectDayTimeline`

Skutek:

- przy bardziej rozdrobnionych dniach roboczych banner nieprzypisanych i timeline mogą zaniżać dane
- problem będzie częstszy po auto-split i przy krótkich sesjach
- użytkownik nie dostaje żadnego sygnału, że widzi obcięty obraz dnia

Rekomendacja:

- dla dashboardu dziennego pobierać wszystkie sesje albo osobny endpoint agregacyjny bez twardego limitu
- jeśli limit ma zostać, UI powinno jasno sygnalizować `partial data`

### 5. Średnie: Sessions prefetchuje score breakdown dla wszystkich widocznych sesji, także poza trybem AI

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src/pages/Sessions.tsx:1135-1180` buduje prefetch dla całego zestawu widocznych sesji
- `dashboard/src/pages/Sessions.tsx:1164` ustawia `batchSize = missingIds.length` poza `ai_detailed`
- `dashboard/src/pages/Sessions.tsx:1170-1171` odpala cały batch przez `Promise.allSettled`

Skutek:

- wejście na ekran Sessions może wygenerować falę kosztownych zapytań AI nawet wtedy, gdy użytkownik nie ogląda jeszcze danych AI
- rośnie koszt CPU/IO w backendzie i koszt serializacji przez Tauri
- użytkownik płaci wydajnością za dane, których jeszcze nie potrzebuje

Rekomendacja:

- prefetch uruchamiać tylko w `ai_detailed` albo tylko dla wierszy widocznych w viewport
- w innych trybach ładować breakdown on-demand po kliknięciu
- rozważyć wspólny batch endpoint zamiast wielu wywołań `get_session_score_breakdown`

### 6. Średnie: odświeżanie statusu demona nadal jest globalnym pollingiem z kosztownym backendem

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src/components/sync/job-pool-helpers.ts:9` ustawia diagnostykę na cykl 30 s
- `dashboard/src/store/background-status-store.ts:46-62` za każdym razem woła równolegle `getDaemonStatus()` i dwa liczniki sesji
- `dashboard/src-tauri/src/commands/daemon.rs:204-244` w `get_daemon_status()` odpala m.in. `tasklist`
- `dashboard/src-tauri/src/commands/daemon.rs:209` używa zewnętrznego procesu `tasklist`

Skutek:

- sidebar stale odpyta backend nawet poza ekranem Daemon
- status procesu jest zbierany ciężej niż trzeba, mimo że to informacja o małej dynamice
- przy wolniejszych systemach i większej bazie to będzie generowało zbędne obciążenie w tle

Rekomendacja:

- rozdzielić lekki status sidebaru od pełnej diagnostyki ekranu Daemon
- cache'ować wynik detekcji procesu krótkoterminowo albo sprawdzać proces bez `tasklist`
- liczniki nieprzypisanych odświeżać tylko gdy są realne zmiany danych albo gdy ekran Daemon/Sidebar jest widoczny

## i18n i lokalizacja

Stan locale jako plików jest dobry, ale to nie oznacza pełnej lokalizacji produktu.

Status: wdrożone 2026-03-12. Zamknięte zostały błędy monitorowanych aplikacji, message box drugiej instancji demona, literalne teksty w `Projects`, formatowanie daty `last_used` w `Applications` oraz backendowe etykiety `Unassigned` / `Other`.

### Usterki i18n / locale

- zamknięte: serie projektowe i fallbacki backendowe przestały wypuszczać user-facing `Unassigned` / `Other`
- zamknięte: UI tłumaczy teraz etykiety specjalne centralnie, zamiast polegać na angielskich labelach z Tauri

### Wniosek

`npm run lint` jest zielony, bo pilnuje głównie plików locale i hardcoded stringów we frontendzie objętym baseline. Nie łapie:

- tekstów budowanych po stronie Rust
- etykiet danych zwracanych z backendu
- części stringów przepuszczanych jako wynik błędu
- niespójności formatowania dat/liczb

### Rekomendacja

- wszystkie etykiety typu `Unassigned` i `Other` wystawiać jako neutralne wartości techniczne i tłumaczyć dopiero w UI
- backendowe komunikaty użytkownika opakować w kody błędów albo w enum mapowany w UI
- dodać osobny check dla user-facing stringów w Rust/Tauri

## Help / zgodność dokumentacji

### 1. Błąd merytoryczny w Help: opisany fallback `monitor-all`, którego kod już nie robi

Status: wdrożone 2026-03-12.

Dowody:

- `dashboard/src/pages/Help.tsx:738` opisuje `monitor_all_fallback_if_the_monitored_process_list_is_em`
- `dashboard/src/locales/pl/common.json:1566` i `dashboard/src/locales/en/common.json:1566` mówią, że pusty monitoring przełącza się na śledzenie wszystkich aplikacji
- `src/tracker.rs:270` loguje `No monitored applications configured - tracking paused`

Skutek:

- użytkownik może celowo zostawić pustą listę monitorowanych aplikacji i oczekiwać śledzenia wszystkiego
- realne zachowanie jest odwrotne: demon nic nie śledzi

Rekomendacja:

- poprawić Help i locale sekcji Daemon
- jeśli produktowo ma wrócić `monitor-all`, trzeba to wdrożyć w trackerze, a nie tylko w opisie

### 2. Funkcje obecne w UI, ale nieopisane w Help

Status: wdrożone 2026-03-12.

Braki po porównaniu widoków z `Help.tsx`:

- marker możliwego duplikatu projektu `D` i zbiorczy komunikat o duplikatach na ekranie Projects
  - implementacja: `dashboard/src/pages/Projects.tsx:906-991` oraz `dashboard/src/pages/Projects.tsx:1184-1192`
  - sekcja Help Projects (`dashboard/src/pages/Help.tsx:391-411`) tego nie opisuje
- akcja `Sync from apps` w sekcji monitorowanych aplikacji
  - implementacja: `dashboard/src/pages/Applications.tsx:189-197` oraz `dashboard/src/pages/Applications.tsx:342-353`
  - sekcja Help Applications (`dashboard/src/pages/Help.tsx:463-475`) opisuje zarządzanie monitorowanymi aplikacjami ogólnie, ale nie tę konkretną funkcję i jej konsekwencje

Rekomendacja:

- dopisać te funkcje do `Help.tsx` w odpowiednich sekcjach
- przy opisie `Sync from apps` dopisać, że akcja dodaje brakujące procesy do listy monitorowanej, ale nie usuwa już istniejących

## Nadmiarowy / powtarzalny kod

To nie są błędy krytyczne, ale zwiększają koszt utrzymania:

- Dashboard, Sessions, Projects i Applications mają powtarzalne nasłuchiwanie `LOCAL_DATA_CHANGED_EVENT` i `APP_REFRESH_EVENT` oraz własne liczniki reloadów
- kilka ekranów ręcznie miesza `console.error`, `logTauriError`, lokalne `showError` i ciche `catch(() => {})`
- logika stanu odświeżania strony jest już częściowo zunifikowana w `page-refresh-reasons`, ale sam wiring w komponentach nadal jest wielokrotnie kopiowany

Sugestia:

- wydzielić wspólny hook typu `usePageRefreshSignals({ shouldRefresh, onRefresh, onSettingsRefresh })`
- ujednolicić strategię obsługi błędów async

## Priorytet napraw

Rekomendowana kolejność prac:

1. Naprawić zakres plików w Sessions.
2. Zmienić kluczowanie plików w demonie z `file_name` na ścieżkę lub klucz złożony.
3. Uporządkować i18n wyciekające z backendu i danych wykresów.
4. Zaktualizować `Help.tsx` i teksty locale sekcji Daemon/Projects/Applications.

## Luki w testach

Brakuje testów, które złapałyby opisane problemy:

- testu na pliki przypisane do konkretnego okna sesji
- testu na dwa pliki o tej samej nazwie i różnych ścieżkach po stronie demona/importu
- testu zgodności Help z funkcjami oznaczonymi jako user-facing

## Weryfikacja lokalna

Wykonane komendy:

- `dashboard`: `npm run lint` -> OK
- `dashboard`: `npm run typecheck` -> OK
- `dashboard`: `npm test` -> OK, 15/15 testów
- `repo root / demon`: `cargo test` -> OK, 24/24 testy
- `dashboard/src-tauri`: `cargo test` -> OK, 26/26 testów

## Podsumowanie

Największy problem obecnego stanu nie leży w tym, że TIMEFLOW się wywraca, tylko w tym, że kilka miejsc wygląda wiarygodnie, a zwraca dane uproszczone albo częściowo błędne.

Najpilniejsze są:

- zawężenie plików do realnej sesji
- zachowanie tożsamości pliku po ścieżce
- przejście z agregacji po nazwie projektu na agregację po `project_id`

Opisane w raporcie poprawki zostały wdrożone; kolejne kroki są już optymalizacyjne, nie naprawcze.
