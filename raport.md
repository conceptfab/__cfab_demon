# Raport audytu kodu TIMEFLOW

Data audytu: 2026-03-08

## Zakres

Przeanalizowałem:

- daemon w Rust (`src/`)
- dashboard Tauri + React (`dashboard/src-tauri`, `dashboard/src`)
- system tłumaczeń i lokalne ustawienia
- zgodność funkcji z opisem w `Help/Pomoc`
- wyniki automatycznych checków, buildów i testów

## Wynik automatycznych sprawdzeń

Wykonane komendy:

- `cargo check` w katalogu głównym: OK
- `cargo test` w katalogu głównym: OK, 9/9 testów
- `cargo check` w `dashboard/src-tauri`: OK
- `cargo test` w `dashboard/src-tauri`: OK, 12/12 testów
- `npm run test` w `dashboard`: OK
- `npm run lint` w `dashboard`: OK
- `npm run build` w `dashboard`: OK

Wnioski z checków:

- projekt jest w stanie kompilowalnym
- backend Rust ma sensowną bazę testów dla importu, estymacji, dashboardu i podziału sesji
- po stronie frontendu nie ma osobnego zestawu testów automatycznych; w `dashboard/package.json:6` są tylko `build`, `lint`, `preview`, bez `test`
- bundle frontendu jest już zauważalny: główny chunk ok. 454 KB, `charts` ok. 386 KB, `i18n` ok. 65.8 KB, `Help` ok. 53.8 KB

## Wdrożone poprawki po audycie

W dniu 2026-03-08 wdrożyłem poniższe poprawki wynikające z raportu:

### 1. Ograniczenie zbędnych eventów mutacji i odświeżeń

- `dashboard/src/lib/tauri.ts`: `invokeMutation(...)` dostało opcjonalne sterowanie `notify`, dzięki czemu event `emitLocalDataChanged` nie jest już emitowany bezwarunkowo.
- Globalny event jest teraz wysyłany tylko przy realnej zmianie stanu dla operacji typu maintenance/no-op:
  - `refreshToday()` tylko gdy faktycznie upsertowano sesje
  - `autoFreezeProjects()` tylko gdy coś zamrożono lub odmrożono
  - `syncProjectsFromFolders()` tylko gdy wykryto nowe projekty
  - `autoCreateProjectsFromDetection()` tylko gdy coś utworzono
  - `rebuildSessions()` tylko gdy coś scalono
  - `applyDeterministicAssignment()` i `autoRunIfNeeded()` tylko gdy AI naprawdę przypisało sesje
- `dashboard/src/pages/Projects.tsx`: automatyczne `autoFreezeProjects()` zostało odpięte od `refreshKey` i wykonuje się jednokrotnie przy wejściu na ekran zamiast przy każdym globalnym refreshu.

### 2. Ograniczenie pracy usług tła przy ukrytym oknie

- `dashboard/src/components/sync/BackgroundServices.tsx` dostał gating po `document.visibilityState`.
- Przy ukrytym oknie zatrzymywane są:
  - cykliczne `refreshToday()`
  - polling sygnatury pliku dziennego
  - automatyczny online sync
  - reakcje lokalnego listenera na eventy mutacji
- Po ponownym pokazaniu okna wykonywany jest jednorazowy catch-up refresh i reset harmonogramu job poola.

### 3. Odpięcie auto-AI od globalnego `refreshKey`

- `useAutoAiAssignment()` nie reaguje już na każdy `refreshKey`.
- Pipeline `applyDeterministicAssignment()` + `autoRunIfNeeded()` uruchamia się:
  - po zakończeniu startupowego auto-importu
  - po `refreshToday()`, ale tylko wtedy, gdy pojawiły się nowe/upsertowane sesje
- Usunięto część ręcznych `triggerRefresh()` tam, gdzie i tak działa domenowy event mutacji.

### 4. Poprawki i18n

- Naprawiono brakujące tłumaczenia w:
  - `dashboard/src/components/dashboard/ProjectDayTimeline.tsx`
  - `dashboard/src/pages/Projects.tsx`
- Dodatkowo poprawiono jeden user-facing hardcoded English string przy banerze nieprzypisanych sesji w `ProjectDayTimeline`.
- `dashboard/scripts/check-hardcoded-i18n.cjs` nie wyklucza już `Help.tsx` i `QuickStart.tsx`.
- Skrypt i18n został ulepszony tak, aby poprawnie rozpoznawał wieloliniowe wywołania `t(...)` / `tt(...)` i nie zgłaszał fałszywych alarmów w `Help`.

### 5. Uzupełnienie dokumentacji `Help` / `QuickStart`

Do `Help` i `QuickStart` dopisałem brakujące informacje o:

- saved view / zapisie preferowanego widoku
- status indicators w sidebarze jako centrum sterowania
- `Device ID` i secure storage tokenu synchronizacji
- trybie demo i kontrakcie `fake_data` / `*_fake.json`
- ręcznych sesjach wielodniowych
- fallbacku `monitor-all`, gdy lista monitorowanych aplikacji jest pusta

### 6. Walidacja po wdrożeniu

Po wprowadzeniu zmian ponownie uruchomiłem:

- `npm run lint` w `dashboard`: OK
- `npm run build` w `dashboard`: OK

### 7. Pozycje nadal otwarte

Nie wdrażałem jeszcze poniższych większych tematów z raportu:

- zmiany formatu zapisu dziennego JSON po stronie daemona
- pełnego wygaszania `useInlineT()`

## Wdrożone poprawki po audycie: II tura

W drugiej turze wdrożeń z 2026-03-08 domknąłem kolejne punkty z raportu:

### 1. Selektywny cache i invalidation dla `Projects`

- `dashboard/src/pages/Projects.tsx` nie pobiera już `getDetectedProjects(ALL_TIME_DATE_RANGE)` i `getProjectEstimates(ALL_TIME_DATE_RANGE)` przy każdym `refreshKey`.
- Zamiast tego dodałem osobny mechanizm `allTimeRefreshKey`, który odświeża ciężkie dane tylko po mutacjach realnie wpływających na dane all-time.
- `ProjectExtraInfo` dostało prosty cache per `projectId`, dzięki czemu ponowne otwarcie tego samego dialogu nie robi od razu kolejnego kosztownego zapytania.
- Dla online sync dodałem osobny event invalidacji danych all-time, aby pull z serwera także czyścił cache `Projects`.

### 2. Dalsze usuwanie zdublowanych `triggerRefresh()`

Usunąłem kolejne ręczne refresh’e tam, gdzie stan i tak odświeża się przez event mutacji:

- `dashboard/src/pages/Projects.tsx`
- `dashboard/src/pages/ProjectPage.tsx`
- `dashboard/src/pages/Settings.tsx`
- `dashboard/src/components/data/ImportPanel.tsx`

To dalej upraszcza przepływ odświeżania i zmniejsza liczbę dubli po mutacjach lokalnych.

### 3. Domknięcie źródeł mutacji bez eventów

- `dashboard/src/lib/tauri.ts`: `setDemoMode(...)` zostało przepięte na `invokeMutation(...)`, więc zmiana bazy demo też trafia do wspólnego mechanizmu invalidacji.
- `dashboard/src/lib/tauri.ts`: `importData(...)` zostało przepięte na `invokeMutation(...)` z warunkowym notify tylko przy realnym imporcie.
- Online sync pull invaliduje teraz dane all-time używane na ekranie `Projects`.

### 4. Frontend testy: pierwszy zestaw

- Dodałem `vitest` do `dashboard/package.json`.
- Dodałem skrypt `npm run test`.
- Dodałem pierwszy test jednostkowy dla nowej logiki invalidacji/cachowania:
  - `dashboard/src/lib/projects-all-time.test.ts`

To nie jest jeszcze pełne pokrycie UI/e2e, ale zamyka wcześniejszy brak całkowitego braku testów po stronie frontendu.

### 5. Walidacja po II turze

Po tej turze zmian uruchomiłem:

- `npm run test` w `dashboard`: OK
- `npm run lint` w `dashboard`: OK
- `npm run build` w `dashboard`: OK

## Najważniejsze ustalenia

### P1. Mechanizm odświeżania i automatyzacji jest nadmiernie sprzężony i może generować pętle pracy w tle

Najpoważniejszy problem architektoniczny to połączenie trzech mechanizmów:

- każda mutacja Tauri emituje globalny event `emitLocalDataChanged` (`dashboard/src/lib/tauri.ts:69`)
- `BackgroundServices` nasłuchuje tego eventu i wymusza `triggerRefresh()` oraz sync (`dashboard/src/components/sync/BackgroundServices.tsx:424`)
- część automatyzacji jest uruchamiana na zmianie `refreshKey`, czyli na każdym globalnym odświeżeniu (`dashboard/src/components/sync/BackgroundServices.tsx:169`, `dashboard/src/pages/Projects.tsx:285`)

Praktyczny skutek:

- operacje, które są w istocie maintenance/no-op, nadal zachowują się jak pełne mutacje
- ekran `Projects` uruchamia `autoFreezeProjects(...)` przy każdej zmianie `refreshKey` (`dashboard/src/pages/Projects.tsx:285`), a to samo wywołanie jest mutacją, więc znów emituje globalny event
- `useAutoAiAssignment()` reaguje na każdy nowy `refreshKey`, więc może ponownie odpalać `applyDeterministicAssignment()` i `autoRunIfNeeded()` dużo częściej niż to potrzebne (`dashboard/src/components/sync/BackgroundServices.tsx:173`)

Ryzyko:

- zbędne zapytania do backendu
- niepotrzebne przebiegi AI i auto-assign
- gorsza responsywność UI
- trudne do przewidzenia zachowanie po każdej mutacji

Rekomendacja:

- rozdzielić `invokeMutation` od `invokeAndNotify`
- emitować event tylko wtedy, gdy backend faktycznie zmienił stan
- automatyzacje AI/freeze odpinać od `refreshKey` i uruchamiać na precyzyjnych triggerach domenowych

### P1. Część usług tła działa stale, nawet gdy okno nie jest aktywne

`useJobPool()` wykonuje:

- `refreshToday()` co 60 s (`dashboard/src/components/sync/BackgroundServices.tsx:381`)
- sprawdzanie sygnatury pliku co 5 s (`dashboard/src/components/sync/BackgroundServices.tsx:385`)
- periodyczny sync (`dashboard/src/components/sync/BackgroundServices.tsx:393`)

W tym hooku nie ma ochrony podobnej do tej, która istnieje np. w sidebarze lub w auto-refreshu sesji. Oznacza to, że aplikacja może generować backendowe odczyty i mutacje także wtedy, gdy użytkownik nie pracuje aktywnie z oknem dashboardu.

Rekomendacja:

- dodać gating po `document.visibilityState`
- rozważyć osobne tryby: `foreground`, `background-light`, `idle`
- nie wywoływać `refreshToday()` jako mutacji w stałym interwale, jeśli nie ma zmian sygnatury pliku

### P2. Strona `Projects` robi kosztowny zestaw zapytań przy każdym odświeżeniu

Na każde `refreshKey` strona `Projects` odpytuje równolegle kilka źródeł:

- projekty, wykluczone projekty, aplikacje, demo mode (`dashboard/src/pages/Projects.tsx:305`)
- foldery + kandydatów (`dashboard/src/pages/Projects.tsx:335`)
- wykryte projekty z `ALL_TIME_DATE_RANGE` (`dashboard/src/pages/Projects.tsx:362`)
- estymacje z `ALL_TIME_DATE_RANGE` (`dashboard/src/pages/Projects.tsx:377`)
- auto-freeze (`dashboard/src/pages/Projects.tsx:285`)

Przy większej bazie to będzie drogie, zwłaszcza w połączeniu z problemem P1.

Rekomendacja:

- rozdzielić dane stałe od danych zmiennych
- cache’ować `ALL_TIME` tam, gdzie to możliwe
- auto-freeze wykonywać tylko przy starcie, zmianie ustawień freeze albo ręcznym triggerze

### P2. Daemon zapisuje cały dzienny JSON atomowo przy każdym cyklu zapisu

Daemon przechowuje dzień jako jeden obiekt `DailyData` (`src/storage.rs:12`) i zapisuje go przez `serde_json::to_string_pretty(...)` oraz pełny replace pliku (`src/storage.rs:193`, `src/storage.rs:205`).

W połączeniu z:

- listą sesji
- listą plików
- `window_title`
- `title_history`
- `detected_path`

oznacza to rosnący koszt serializacji i I/O wraz z długością dnia pracy. Sam tracker deklaruje zapis cykliczny i trzyma wszystko w pamięci (`src/tracker.rs:1`, `src/tracker.rs:223`, `src/tracker.rs:237`).

To nie jest jeszcze bug funkcjonalny, ale jest to wyraźne ograniczenie skalowalności.

Rekomendacja:

- średni termin: przejść z pełnego dziennego JSON do append-only / SQLite / snapshot+delta
- krótki termin: rozważyć zapis skompresowany lub bez `pretty`, oraz limity dla `title_history`

### P2. Brak osobnych testów frontendu

Front ma `lint` i `build`, ale nie ma testów komponentów ani e2e (`dashboard/package.json:6`).

To jest szczególnie ryzykowne przy:

- rozbudowanych automatyzacjach tła
- wielu stanach lokalnych w `localStorage`
- dużej liczbie widoków warunkowych
- krytycznych ekranach typu `Sessions`, `Projects`, `Settings`, `ReportView`

Rekomendacja:

- minimum: Vitest dla logiki helperów/store
- najlepiej: Playwright dla głównych przepływów użytkownika

### P3. Domyślne przejście na `monitor-all` nie jest jasno komunikowane użytkownikowi

Jeśli lista monitorowanych aplikacji jest pusta, daemon przełącza się na śledzenie wszystkiego (`src/tracker.rs:213`).

To może być sensowny fallback developerski, ale z perspektywy produktu ma wpływ na:

- prywatność
- oczekiwania użytkownika
- zgodność z opisem onboardingowym

W `Help` i `QuickStart` warto to nazwać wprost.

## Logika i architektura: dodatkowe obserwacje

- `useInlineT()` jest oznaczone jako warstwa migracyjna/deprecated (`dashboard/src/lib/inline-i18n.ts:37`), ale nadal jest szeroko używane. To wydłuża migrację i utrudnia kontrolę jakości tłumaczeń.
- `Help.tsx` jest bardzo duże i zawiera dużo wiedzy produktowej bezpośrednio w kodzie. To zwiększa ryzyko rozjazdu między implementacją i dokumentacją.
- Jeden z testów backendu (`prune_does_not_delete_manual_projects`) trwał ponad 60 s podczas uruchomienia `cargo test` dla `dashboard/src-tauri`. Same testy przechodzą, ale warto profilować ścieżki związane z pruningiem projektów.

## Nadmiarowy lub dublujący się kod

Najbardziej widoczny nadmiar dotyczy odświeżania:

- globalny event z `invokeMutation`
- ręczne `triggerRefresh()` po mutacjach w stronach
- dodatkowy `triggerRefresh()` w `BackgroundServices`

To jest klasyczny przypadek zdublowanej odpowiedzialności. Nawet jeśli pojedyncze miejsca są poprawne, razem zwiększają koszt działania i zaciemniają przyczynę odświeżenia.

Drugi obszar nadmiaru:

- tłumaczenia są rozbite między `useTranslation`, `useInlineT`, ręczne teksty w daemonie i wygenerowane klucze `inline.*`

## Audyt tłumaczeń

### Stan obecny

- `npm run lint` nie wykazał nowych polskich hardcodów
- baseline skryptu i18n ma już 118 wpisów legacy
- dashboard ma działający system i18n, ale nadal miesza dwa style: klucze i18next oraz pary PL/EN inline

### Realne braki / niespójności

Znalazłem konkretne, user-facing stringi nadal nieobjęte tłumaczeniem:

- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:992` -> `Total: ...`
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:1000` -> `No project activity in selected day.`
- `dashboard/src/pages/Projects.tsx:1309` -> `No data`

To są drobne rzeczy, ale pokazują, że obecny lint nie łapie pełnego problemu, bo skupia się na polskich tekstach.

### Luki procesu i18n

- skrypt `check-hardcoded-i18n.cjs` jawnie wyklucza `Help.tsx` i `QuickStart.tsx` (`dashboard/scripts/check-hardcoded-i18n.cjs:14`)
- czyli dwa najbardziej tekstowe widoki nie są chronione tym samym audytem co reszta UI
- `useInlineT()` nadal działa jako most migracyjny (`dashboard/src/lib/inline-i18n.ts:37`), więc tłumaczenia są poprawne funkcjonalnie, ale trudniejsze do utrzymania
- daemon ma osobny mikro-system tłumaczeń, niezależny od dashboardowego i18next (`src/i18n.rs`)

### Rekomendacja i18n

1. Naprawić realne brakujące teksty z `ProjectDayTimeline` i `Projects`.
2. Rozszerzyć lint także o angielskie hardcody user-facing, nie tylko polskie.
3. Dodać osobny audyt dla `Help.tsx` i `QuickStart.tsx`, zamiast ich wykluczania.
4. Docelowo wygasić `useInlineT()` i przenieść treści do jawnych kluczy.

## Funkcje niedostatecznie opisane w `Help/Pomoc`

Poniżej rzeczy, które działają w aplikacji, ale nie są wystarczająco jasno opisane w `Help.tsx` albo w ogóle tam nie występują:

### 1. Zapisany widok / zapis preferencji widoku

Kod:

- `dashboard/src/pages/Projects.tsx:1538`
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:977`

W UI istnieje zapis preferowanego widoku, ale w `Help` nie ma jasnej instrukcji, że użytkownik może utrwalać stan widoku.

### 2. Wskaźniki statusu w sidebarze jako aktywne centrum sterowania

Kod:

- `dashboard/src/components/layout/Sidebar.tsx:317`
- `dashboard/src/components/layout/Sidebar.tsx:336`
- `dashboard/src/components/layout/Sidebar.tsx:354`
- `dashboard/src/components/layout/Sidebar.tsx:393`

Sidebar nie jest tylko nawigacją. Pokazuje i obsługuje:

- status demona
- status synchronizacji
- status AI/treningu
- status backupu

Te wskaźniki są klikalne i uruchamiają akcje. `Help` wspomina pojedyncze moduły, ale nie opisuje samego paska statusów jako ważnego elementu pracy.

### 3. `Device ID` i sposób przechowywania tokenu synchronizacji

Kod:

- `dashboard/src/pages/Settings.tsx:692`
- `dashboard/src/pages/Settings.tsx:703`
- `dashboard/src/lib/online-sync.ts:619`
- `dashboard/src/lib/online-sync.ts:650`
- `dashboard/src/lib/online-sync.ts:682`

`Help` opisuje URL, User ID i token, ale nie wyjaśnia:

- że `Device ID` jest częścią modelu synchronizacji
- że token nie jest trzymany w `localStorage`, tylko w secure storage po stronie Rust
- że istnieje migracja starego tokenu z `localStorage`

To jest ważne zarówno użytkowo, jak i bezpieczeństwowo.

### 4. Kontrakt trybu demo z plikami `fake_data` / `*_fake.json`

Kod:

- `dashboard/src/pages/Settings.tsx:823`

To zachowanie jest opisane w samym UI ustawień, ale nie trafiło do `Help`. Dla użytkownika technicznego to kluczowa informacja.

### 5. Ręczne sesje wielodniowe

Kod:

- `dashboard/src/components/ManualSessionDialog.tsx:292`

Opcja „pozwól rozciągnąć sesję na wiele dni” jest realną funkcją, a nie widzę jej w `Help`.

### 6. Fallback `monitor-all`

Kod:

- `src/tracker.rs:213`

To powinno być opisane przynajmniej w `QuickStart` lub `Help > Aplikacje/Daemon`, bo ma wpływ na to, co aplikacja śledzi, gdy konfiguracja monitorowanych procesów jest pusta.

## Funkcje opisane w `Help`, które mają pokrycie w kodzie

Żeby raport był uczciwy: spora część `Help` jest zgodna z implementacją. Potwierdzone zostały m.in.:

- multi-split sesji i auto-split (`dashboard/src/components/sync/BackgroundServices.tsx:206`, `dashboard/src/pages/Sessions.tsx:1779`)
- wskaźniki sesji AI (`dashboard/src/pages/AI.tsx:503`)
- online sync z ACK/reseed/logowaniem (`dashboard/src/pages/Settings.tsx:681`, `dashboard/src/lib/online-sync.ts`)
- backup/restore i optymalizacja DB
- raporty z szablonami i widokiem do PDF

To ważne, bo problemem nie jest brak funkcji, tylko głównie nadmiarowe sprzężenie stanów, koszty tła i kilka luk w dokumentacji/i18n.

## Priorytet wdrożenia poprawek

### Etap 1: stabilność i wydajność

1. Rozdzielić globalne eventy mutacji od lokalnego `triggerRefresh()`.
2. Odpiąć `useAutoAiAssignment()` od `refreshKey`.
3. Ograniczyć `useJobPool()` przy niewidocznym oknie.
4. Zmienić `autoFreezeProjects()` tak, by nie było odpalane przy każdym refreshu widoku `Projects`.

### Etap 2: i18n i UX

1. Poprawić brakujące tłumaczenia w `ProjectDayTimeline` i `Projects`.
2. Rozszerzyć lint i18n na angielskie hardcody.
3. Włączyć `Help` i `QuickStart` do osobnego audytu tłumaczeń.
4. Zacząć wygaszanie `useInlineT()`.

### Etap 3: dokumentacja użytkownika

1. Dopisać do `Help` zapis widoku.
2. Dopisać opis status indicators w sidebarze.
3. Dopisać `Device ID`, secure token storage i demo-mode `fake_data`.
4. Dopisać opcję manual session multi-day.
5. Jasno opisać fallback `monitor-all`.

### Etap 4: architektura danych

1. Zaprojektować lżejszy format zapisu dziennej aktywności.
2. Ograniczyć pełne zapisy JSON i rozmiar przechowywanego kontekstu okien.
3. Profilować najwolniejsze ścieżki backendu i testów.

## Podsumowanie

Projekt jest funkcjonalny i technicznie stabilny na poziomie kompilacji/testów, ale ma trzy wyraźne obszary długu:

- za mocno sprzężone odświeżanie i automatyzacje tła
- niedokończona migracja i18n
- dokumentacja `Help` nie nadąża za bardziej zaawansowanymi funkcjami i szczegółami operacyjnymi

Największy zysk da uporządkowanie mechanizmu refresh/eventów. Dopiero po tym warto inwestować w dalsze strojenie wydajności i porządki dokumentacyjne.
