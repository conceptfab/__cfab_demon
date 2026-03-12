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

- część danych sesji jest prezentowana nieprecyzyjnie
- demon gubi rozróżnienie plików przy identycznych nazwach
- agregacje projektowe opierają się na nazwach zamiast na `project_id`
- są jeszcze user-facing stringi poza i18n mimo zielonych lintów locale
- Help nie jest w pełni zgodny z aktualnym zachowaniem aplikacji

## Najważniejsze ustalenia

### 1. Wysokie: widok Sessions pokazuje pliki z całego dnia aplikacji, nie z zakresu konkretnej sesji

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

### Usterki i18n / locale

- `dashboard/src/pages/Projects.tsx:787` używa literalnego `View settings saved as default`, mimo że istnieje klucz `projects.messages.view_settings_saved` w `dashboard/src/locales/pl/common.json:522` i `dashboard/src/locales/en/common.json:522`
- `dashboard/src/pages/Projects.tsx:1581` pokazuje `opens -` bez tłumaczenia
- `dashboard/src/components/dashboard/TopProjectsList.tsx:46-57` rozpoznaje nieprzypisane po literalnym `Unassigned`
- `dashboard/src/components/dashboard/TimelineChart.tsx:138` oraz `dashboard/src-tauri/src/commands/dashboard.rs:209` i `dashboard/src-tauri/src/commands/analysis.rs:520` używają etykiety `Other` poza i18n
- `dashboard/src-tauri/src/commands/analysis.rs:135`, `dashboard/src-tauri/src/commands/dashboard.rs:333` i `dashboard/src-tauri/src/commands/sessions/query.rs:312` wypuszczają surowe `Unassigned`
- `dashboard/src-tauri/src/commands/monitored.rs:154-217` zwraca user-facing błędy po angielsku: `already monitored`, `Monitored app not found`, `exe_name cannot be empty`, `display_name cannot be empty`
- `src/single_instance.rs:50` pokazuje message box `Another instance of TimeFlow Demon is already running.` bez lokalizacji i bez spójnego brandingu TIMEFLOW
- `dashboard/src/pages/Applications.tsx:593` formatuje datę przez gołe `toLocaleDateString()`, więc wynik zależy od systemu, a nie od języka UI

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
3. Przenieść agregacje projektowe z nazwy na `project_id`.
4. Usunąć limit `500` z dziennego dashboardu albo zastąpić go endpointem agregacyjnym.
5. Ograniczyć eager prefetch breakdownów AI.
6. Uporządkować i18n wyciekające z backendu i danych wykresów.
7. Zaktualizować `Help.tsx` i teksty locale sekcji Daemon/Projects/Applications.

## Luki w testach

Brakuje testów, które złapałyby opisane problemy:

- testu na pliki przypisane do konkretnego okna sesji
- testu na dwa pliki o tej samej nazwie i różnych ścieżkach po stronie demona/importu
- testu na dwa projekty o podobnej nazwie, ale różnych `project_id`, w agregacjach dashboardowych
- testu zgodności Help z funkcjami oznaczonymi jako user-facing

## Weryfikacja lokalna

Wykonane komendy:

- `dashboard`: `npm run lint` -> OK
- `dashboard`: `npm run typecheck` -> OK
- `dashboard`: `npm test` -> OK, 15/15 testów
- `repo root / demon`: `cargo test` -> OK, 23/23 testy
- `dashboard/src-tauri`: `cargo test` -> OK, 22/22 testy

## Podsumowanie

Największy problem obecnego stanu nie leży w tym, że TIMEFLOW się wywraca, tylko w tym, że kilka miejsc wygląda wiarygodnie, a zwraca dane uproszczone albo częściowo błędne.

Najpilniejsze są:

- zawężenie plików do realnej sesji
- zachowanie tożsamości pliku po ścieżce
- przejście z agregacji po nazwie projektu na agregację po `project_id`

Po tych trzech punktach warto domknąć i18n oraz Help, bo dziś dokumentacja i część etykiet nie odzwierciedlają już faktycznego zachowania aplikacji.
