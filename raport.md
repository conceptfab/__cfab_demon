# Raport analizy dashboardu i demona TIMEFLOW

Data analizy: 2026-03-11

## Etapy realizacji

- [x] Ujednolicono tryb listy projektów do przypisywania między `Sessions` i timeline dashboardu.
- [x] Doprecyzowano w UI i Help, że filtr `Tylko nieprzypisane` pokazuje sesje ze wszystkich dat.
- [x] Przeniesiono statusy i opisy online sync do tłumaczeń `i18n`.
- [x] Ograniczono koszt diagnostyki daemona przez rzadsze odświeżanie i cache wersji EXE.
- [x] Zlokalizowano domyślne nazwy szablonów raportów zapisujące się do `localStorage`.
- [x] Architekturalnie odpięto tray demona od dashboardowego `get_daemon_status()`.
- [x] Usunięto martwe ustawienia fontu raportów.

## Status po tej iteracji

Zamknięte w tej iteracji:

- wspólny stan trybu listy projektów dla `Sessions` i dashboardowego timeline
- doprecyzowanie zakresu filtra `Tylko nieprzypisane` w UI i Help
- pełna lokalizacja etykiet i opisów online sync używanych w sidebarze
- lokalizacja domyślnej nazwy szablonu raportu i suffixu kopii
- częściowa optymalizacja diagnostyki daemona: rzadsze odświeżanie i cache wersji EXE
- wspólny zapis progu `minSessionDurationSeconds` do pliku współdzielonego z demonem
- tray demona liczy uwagę samodzielnie z DB i nie zależy już od odpytywania dashboardu
- `get_daemon_status()` przestało mieć efekt uboczny w postaci zapisu pliku sygnałowego
- usunięcie martwego kontraktu `report-font` z `user-settings`

Status etapu:

- wszystkie etapy z sekcji realizacyjnej zostały zamknięte
- w raporcie pozostają dalsze rekomendacje optymalizacyjne i porządkujące, ale nie są już oznaczone jako otwarte punkty tej paczki

## Status po kolejnej iteracji

Zamknięte w tej iteracji:

- startupowe auto-skanowanie projektów dostało prosty cache czasu i nie odpala już pełnego skanu bezwarunkowo przy każdym starcie dashboardu
- `Dashboard` przestał dociągać pełną listę projektów all-time przy każdym refreshu widoku i korzysta teraz ze wspólnego cache projektów
- `Projects` przestał używać jednego szerokiego reloadu pod globalny `refreshKey`; dane rdzeniowe, folderowe i all-time odświeżają się teraz osobnymi ścieżkami
- dodano jawne reguły odświeżania per strona oraz testy dla tych reguł
- Help został dopasowany do nowego, okresowego zachowania skanowania folderów przy starcie

## Status po następnej iteracji

Zamknięte w tej iteracji:

- `Sessions` przestał odpalać hurtową analizę splittability dla całej strony przy każdym odświeżeniu; wyniki są teraz cache'owane per `sessionId + splitSettings`, a brakujące wpisy lecą małymi batchami
- `Sessions` przestał trzymać własny reload listy projektów pod `refreshKey` i korzysta teraz ze wspólnego cache projektów all-time
- `Sessions`, `Applications`, `Estimates` i `ProjectPage` przestały zależeć od globalnego `refreshKey`; reagują teraz na precyzyjne powody zmian z eventów `LOCAL_DATA_CHANGED_EVENT` i `APP_REFRESH_EVENT`
- reguły odświeżania zostały rozszerzone o kolejne ekrany i dostały testy jednostkowe

Pozostały backlog z raportu:

- dalsze porządki `i18n` w `Settings`, `AI`, `ProjectPage` i mniejszych hotspotach
- ewentualne dalsze odchudzanie danych na cięższych ekranach, jeśli pojawią się realne bottlenecki po tej iteracji

Weryfikacja tej iteracji:

- `dashboard`: `npm run lint` -> OK
- `dashboard`: `npm run typecheck` -> OK
- `dashboard`: `npm test` -> OK, 15/15 testów

## Zakres

Przeanalizowane obszary:

- demon Rust w `src/`
- dashboard React/Tauri w `dashboard/src` i `dashboard/src-tauri`
- tłumaczenia w `dashboard/src/locales`
- opis funkcji w `dashboard/src/pages/Help.tsx`

Weryfikacja wykonana lokalnie:

- `dashboard`: `npm run lint` -> OK
- `dashboard`: `npm run typecheck` -> OK
- `dashboard`: `npm test` -> OK, 7/7 testów
- `demon`: `cargo test` -> OK, 23/23 testy
- `dashboard/src-tauri`: `cargo test` -> OK, 22/22 testy

## Podsumowanie

Poniższe ustalenia opisują stan zastany z momentu analizy. Bieżący status wdrożeń jest utrzymywany wyżej w sekcjach `Etapy realizacji` i `Status po tej iteracji`.

Kod jest ogólnie spójny i aplikacja wygląda na funkcjonalnie rozwiniętą, ale znalazłem kilka realnych problemów architektonicznych i logicznych:

- tray demona pokazuje licznik nieprzypisanych sesji tylko wtedy, gdy dashboard cyklicznie odpyta backend
- diagnostyka daemona jest odświeżana bardzo często i robi kosztowne subprocessy z efektem ubocznym zapisu pliku sygnałowego
- ta sama funkcja wyboru trybu listy projektów do przypisywania działa w dwóch widokach, ale ma dwa niezależne stany i dwa różne klucze `localStorage`
- część ekranów odświeża duże porcje danych przy każdej zmianie `refreshKey`, nawet gdy zmiana dotyczy innego fragmentu systemu
- i18n jest formalnie "zielone", ale repo nadal ma duży baseline twardych stringów oraz kilka ścieżek user-facing poza i18n

## Najważniejsze ustalenia

### 1. Tray demona jest zależny od dashboardu przy liczniku nieprzypisanych sesji

Dowody:

- `src/tray.rs:35-60` odczytuje licznik z pliku `assignment_attention.txt`
- `dashboard/src-tauri/src/commands/daemon.rs:129-193` zapisuje ten plik tylko w `get_daemon_status()`
- `dashboard/src/components/sync/job-pool-helpers.ts:167-169` wymusza `refreshDiagnostics()` co 10 s
- `dashboard/src/store/background-status-store.ts:55` w `refreshDiagnostics()` woła `getDaemonStatus()`

Skutek:

- jeśli dashboard nie działa albo jest długo nieotwierany, tray może pokazywać stary licznik albo `0`
- demon nie liczy swojego stanu samodzielnie; tylko konsumuje sygnał wyprodukowany przez dashboard
- licznik w trayu jest więc semantycznie "cache dashboardu", a nie stanem demona

Ocena:

- to jest błąd logiki/odpowiedzialności modułów, nie tylko kwestia optymalizacji

Rekomendacja:

- przenieść wyliczanie licznika do demona albo do współdzielonego modułu wywoływanego bez udziału dashboardu
- alternatywnie: demon powinien sam okresowo odczytywać DB i sam aktualizować plik sygnałowy
- `get_daemon_status()` nie powinno mieć efektu ubocznego w postaci zapisu pliku, bo to zaciera odpowiedzialność komendy diagnostycznej

### 2. Diagnostyka daemona jest zbyt kosztowna jak na odświeżanie co 10 sekund

Dowody:

- `dashboard/src/components/sync/job-pool-helpers.ts:167-169` odświeża diagnostykę co 10 s
- `dashboard/src-tauri/src/commands/daemon.rs:154-176` wykrywa proces przez `tasklist`
- `dashboard/src-tauri/src/commands/daemon.rs:196-204` uruchamia `timeflow-demon.exe --version`

Skutek:

- UI w tle stale generuje koszt systemowy niezależnie od tego, czy użytkownik jest na ekranie demona
- każde odświeżenie robi subprocessy Windows zamiast korzystać z lżejszego cache albo prostszego sprawdzenia PID/ścieżki
- do tego dochodzi zapis `assignment_attention.txt`, więc "odczyt statusu" jest też "zapytaniem z mutacją"

Rekomendacja:

- rozdzielić lekką diagnostykę sidebaru od pełnej diagnostyki ekranu demona
- wersję demona pobierać raz na sesję lub cache'ować po ścieżce EXE
- status procesu trzymać w krótkotrwałym cache, np. 30-60 s
- odświeżanie logów i pełnego statusu zostawić ekranowi `DaemonControl`

### 3. Tryb listy projektów do przypisywania jest niespójny między widokami

Dowody:

- `dashboard/src/store/ui-store.ts:27-45` używa klucza `timeflow-sessions-assign-project-list-mode`
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:80,153-162,356-373` używa osobnego klucza `timeflow-dashboard-assign-project-list-mode`
- `dashboard/src/pages/Sessions.tsx:1571-1616` steruje trybem z poziomu store
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:1281-1313` steruje podobnym trybem lokalnie

Skutek:

- użytkownik może ustawić jeden tryb na ekranie `Sessions` i inny na dashboardzie
- Help opisuje funkcję jako jedną koncepcję, ale implementacja utrzymuje dwa niezależne źródła prawdy
- logika sortowania i grupowania jest skopiowana, więc łatwo o drift przy dalszym rozwoju

Rekomendacja:

- wydzielić wspólny model tej preferencji do jednego store/utila
- używać jednego klucza storage i jednego typu helperów
- jeśli różne tryby mają być świadomie niezależne, trzeba to jasno nazwać w UI i Help

### 4. Filtr "nieprzypisane" w sesjach ignoruje zakres dat i nie jest to jasno opisane

Dowody:

- `dashboard/src/pages/Sessions.tsx:368-380`
- komentarz w kodzie explicite mówi, że dla `unassigned` `dateRange` jest pomijany

Skutek:

- użytkownik może wejść w widok dzienny/tygodniowy, a mimo to zobaczyć nieprzypisane sesje ze wszystkich dat
- to może wyglądać jak błąd filtrowania, choć jest świadomą decyzją implementacyjną

Ocena:

- zachowanie może być sensowne operacyjnie, ale jest zaskakujące i powinno być wyraźnie pokazane w UI i Help

Rekomendacja:

- dodać wyraźny badge/tekst typu "wszystkie daty"
- albo dodać przełącznik: `bieżący zakres` / `wszystkie daty`
- uzupełnić Help o dokładny opis tej różnicy

## Wydajność i optymalizacje

### 5. Startup dashboardu uruchamia szerokie automatyczne skany

Dowody:

- `dashboard/src/components/sync/BackgroundServices.tsx:117-123`
- `syncProjectsFromFolders()`
- `autoCreateProjectsFromDetection(ALL_TIME_DATE_RANGE, 2)`

Skutek:

- każdy start dashboardu może skanować foldery i analizować cały zakres danych
- przy większej bazie będzie to rosło liniowo z historią użytkownika

Rekomendacja:

- ograniczyć autowykrywanie projektów do zmian od ostatniego importu albo do ostatnich N dni
- rozdzielić "scan folders" od "analyze all detected file names" i dać im osobne harmonogramy
- dodać prosty cache znaku czasu ostatniego sukcesu

### 6. `Projects` odświeża zbyt szeroki zestaw danych przy zmianach nie tylko projektowych

Dowody:

- `dashboard/src/pages/Projects.tsx:373-379` ładuje równolegle:
  - `loadProjectsAllTime()`
  - `getExcludedProjects()`
  - `getApplications()`
  - `getProjectFolders()`
  - `getFolderProjectCandidates()`
- efekt jest podpięty pod `refreshKey`
- dodatkowo `dashboard/src/pages/Projects.tsx:421` i `:436` osobno dociąga wykryte projekty i estymacje

Skutek:

- zwykła mutacja sesji może odpalać ciężkie odświeżenie całego ekranu projektów
- dużo zapytań wraca nawet wtedy, gdy użytkownik nie odwiedza tej strony

Rekomendacja:

- rozdzielić dane "always fresh" od danych "stale-tolerant"
- oprzeć odświeżenie o powody zmian (`reason`) zamiast globalny `refreshKey`
- folder candidates i detected projects odświeżać tylko po import/sync/pracy na folderach

### 7. `Dashboard` dociąga pełną listę projektów all-time przy każdym odświeżeniu widoku

Dowody:

- `dashboard/src/pages/Dashboard.tsx:314-321`

Skutek:

- nawet dla widoku dziennego pobierana jest lista all-time tylko po to, by policzyć projekty i zasilić timeline/manual session dialog
- to zwiększa koszt każdej zmiany zakresu i każdego manual refresh

Rekomendacja:

- rozdzielić:
  - lekki endpoint z liczbą projektów / minimalną listą
  - cięższy endpoint pełnych projektów tylko dla komponentów, które tego potrzebują

### 8. `Sessions` analizuje splittability hurtowo dla widocznej strony po każdej zmianie listy

Dowody:

- `dashboard/src/pages/Sessions.tsx:527`
- `PAGE_SIZE = 100`

Skutek:

- dla każdej strony sesji wykonywana jest dodatkowa analiza backendowa
- przy częstych zmianach filtrów i odświeżeń to może być jeden z droższych elementów UI

Rekomendacja:

- robić analizę leniwie tylko dla rozwiniętych wierszy / elementów w viewport
- cache'ować wynik po `sessionId + splitSettings`
- odświeżać tylko sesje, których dane faktycznie się zmieniły

## Nadmiarowy lub martwy kod

### 9. Ustawienia fontu raportów są zdefiniowane, ale nigdzie nieużywane

Dowody:

- `dashboard/src/lib/user-settings.ts:337-364`
- `rg` po `loadReportFontSettings` i `saveReportFontSettings` nie zwraca użyć poza definicją

Skutek:

- utrzymywany jest martwy kontrakt konfiguracyjny
- łatwo uznać tę funkcję za gotową, choć nie ma UI, integracji z `ReportView` ani opisu w Help

Rekomendacja:

- albo usunąć tę ścieżkę do czasu realnego wdrożenia
- albo dokończyć feature end-to-end: UI + użycie w `ReportView` + Help

### 10. W raportach są user-facing defaulty poza i18n

Dowody:

- `dashboard/src/lib/report-templates.ts:22` -> domyślna nazwa `Standard`
- `dashboard/src/lib/report-templates.ts:90` -> domyślny suffix `copy`

Skutek:

- część UI raportów nie będzie pełni lokalizowalna
- problem pojawi się szczególnie przy migracji/pierwszym uruchomieniu, bo nazwy zapisują się bezpośrednio do `localStorage`

Rekomendacja:

- generować default template dopiero w warstwie UI z użyciem `t(...)`
- albo wprowadzić słowniki/migrację nazw na poziomie warstwy storage

## Tłumaczenia

### 11. Online sync ma user-facing etykiety i opisy na sztywno po angielsku

Dowody:

- `dashboard/src/lib/online-sync.ts:293-350`
- `dashboard/src/lib/online-sync.ts:376-413`
- `dashboard/src/lib/online-sync.ts:1195`

Przykłady:

- `No sync yet`
- `Last sync ...`
- `Sync Off`
- `Sync Ready`
- `ACK Pending`
- `Syncing...`

Skutek:

- sidebar i status synchronizacji mogą być częściowo po angielsku nawet przy polskim UI
- te stringi omijają standardowe słowniki `i18next`

Rekomendacja:

- zwracać z modułu status jako enum + parametry, a label/detail składać dopiero w warstwie UI
- ewentualnie wstrzyknąć translator, ale lepszy będzie model "dane + tłumaczenie w komponencie"

### 12. Słowniki nie są idealnie zsynchronizowane

Dowody:

- `python compare_locales.py`

Wynik:

- brak kluczy PL względem EN: brak
- brak kluczy EN względem PL:
  - `ai_page.text.train_after_a_larger_series_of_manual_correction`

Ocena:

- to mały drift, ale pokazuje, że w słownikach zaczynają pojawiać się duplikaty i stare warianty nazw

Rekomendacja:

- usunąć nieużywany wariant klucza z PL albo dodać spójny odpowiednik do EN
- do CI dorzucić walidację "missing + orphan keys"

### 13. Repo ma duży baseline twardych stringów poza i18n

Dowody:

- `dashboard/scripts/check-hardcoded-i18n-baseline.json`
- `npm run lint` przechodzi, ale tylko dlatego, że nowe naruszenia nie przekraczają istniejącego baseline

Największe hotspoty:

- `src/pages/Settings.tsx` -> 39 wpisów
- `src/pages/AI.tsx` -> 30 wpisów
- `src/pages/ProjectPage.tsx` -> 18 wpisów
- `src/pages/Applications.tsx` -> 4 wpisy
- `src/pages/Estimates.tsx` -> 4 wpisy

Ocena:

- lint nie chroni jeszcze przed starym długiem lokalizacyjnym
- największa część braków siedzi w ekranach, które użytkownik odwiedza często

Rekomendacja:

- spłacać baseline modułami, zaczynając od `Settings`, `AI`, `ProjectPage`
- nie odkładać tego na później, bo każdy nowy opis Help i każda nowa funkcja zwiększa koszt migracji

## Help / Pomoc

### Co jest dobrze

`Help.tsx` jest zaskakująco kompletne i obejmuje większość realnych funkcji:

- raporty
- daemon control
- online sync
- backup/restore
- bughunter
- split sesji
- manual sessions
- projekty, foldery i wykrywanie

### Luki i rozjazdy

#### 14. Nieopisane dokładnie zachowanie filtra `unassigned`

Dowody:

- implementacja: `dashboard/src/pages/Sessions.tsx:368-380`
- Help opisuje filtr ogólnie w `dashboard/src/pages/Help.tsx:323-339`, ale nie doprecyzowuje, że filtr może ignorować bieżący zakres dat

Skutek:

- użytkownik może odebrać to jako błąd, a nie intencjonalny tryb roboczy

Rekomendacja:

- dopisać do Help: "widok nieprzypisanych może pokazywać wszystkie daty"

#### 15. Help nie odzwierciedla rozdzielonych preferencji listy przypisań między dashboardem i sessions

Dowody:

- `dashboard/src/pages/Sessions.tsx:1571-1616`
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:1281-1313`

Skutek:

- z perspektywy użytkownika to wygląda jak jedna funkcja, ale zachowuje się jak dwie różne preferencje

Rekomendacja:

- po ujednoliceniu implementacji zaktualizować Help jednym, spójnym opisem
- jeśli preferencje mają pozostać oddzielne, trzeba to nazwać explicite

## Propozycje priorytetów

### Priorytet 1

- odpiąć tray od dashboardowego `get_daemon_status()`
- usunąć efekt uboczny `write_assignment_signal()` z komendy statusowej
- zmniejszyć koszt diagnostyki daemona w sidebarze

### Priorytet 2

- ujednolicić `assignProjectListMode` między `Sessions` i `ProjectDayTimeline`
- doprecyzować zachowanie filtra `unassigned`
- przenieść online sync labels/details do i18n

### Priorytet 3

- ograniczyć pełne reloady na `Projects` i `Dashboard`
- zoptymalizować hurtową analizę splittability w `Sessions`
- zdecydować: wdrażamy ustawienia fontu raportu czy usuwamy martwy kod

### Priorytet 4

- zacząć redukcję `i18n` baseline od `Settings` i `AI`
- usunąć osierocone klucze locale
- dopiąć Help dla niuansów, nie tylko dla ekranów

## Sugerowany plan naprawczy

1. Wydzielić "lekki status demona" bez subprocessów i bez efektów ubocznych.
2. Przenieść licznik tray attention do demona lub do współdzielonej usługi bez udziału dashboardu.
3. Zunifikować preferencje przypisywania projektów w jednym store i jednym kluczu storage.
4. Rozbić globalne `refreshKey` na odświeżenia per domena albo mocniej oprzeć się na `reason`.
5. Zmienić online sync na model `enum status + dane`, a nie gotowe napisy.
6. Usunąć lub dokończyć martwe feature flags/ustawienia raportów.
7. Spłacać baseline i18n modułami, nie hurtowo.

## Wniosek końcowy

Największy problem nie leży dziś w "czy działa", tylko w tym, że kilka ważnych funkcji działa dzięki pośrednim zależnościom między modułami. Najbardziej ryzykowny przykład to tray demona zależny od dashboardowego odpytywania statusu. Jeśli te zależności nie zostaną uproszczone, kolejne funkcje będą działały poprawnie tylko w części scenariuszy, a koszt utrzymania wzrośnie szybciej niż sam zakres produktu.
