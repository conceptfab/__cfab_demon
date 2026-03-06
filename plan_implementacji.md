# Plan implementacji — TIMEFLOW (kolejne funkcjonalności)

> Data: 2026-03-06 | Branch: `next`

## Stan obecny — kluczowe ustalenia z analizy kodu

### System raportów (3 warstwy):
1. **`Reports.tsx`** — edytor szablonu z drag & drop sekcji, live preview, zapis do `localStorage` (`timeflow_report_template`)
2. **`ReportView.tsx`** — interaktywny widok raportu, print-optimized, Tailwind CSS
3. **`report-generator.ts`** — **LEGACY/UNUSED** — generuje standalone HTML do nowego okna, **nie jest importowany nigdzie**. Do usunięcia lub scalenia.

### Dostępne sekcje szablonu (Reports.tsx ALL_SECTIONS):
`header`, `stats`, `financials`, `apps`, `files`, `ai`, `sessions`, `comments`, `footer`

### Sesje — model AI i split:
- 4-warstwowy scoring (file 0.80, app 0.30, time 0.10, token 0.30)
- `SESSION_PROJECT_CTE_ALL_TIME` — CTE wykrywające multi-project overlap w SQL (ranked_overlap z ROW_NUMBER)
- `suggest_session_split` — sugeruje 2 projekty na bazie file_activities
- `split_session` — ukrywa oryginał (is_hidden=1), tworzy 2 nowe sesje

### Splash screen:
- Czysty React overlay (`SplashScreen.tsx`), renderowany w `App.tsx:180` wewnątrz `MainLayout`
- Problem: React musi się załadować zanim splash się pojawi — nie ukrywa procesów startowych

### Wielowątkowość:
- `block_on(db::initialize())` w setup — blokuje wątek UI
- Każdy `#[tauri::command]` otwiera nowe `rusqlite::Connection` (brak poolingu)
- WAL mode + busy_timeout=5000ms
- BackgroundServices: 5 hooków + universal event loop co 1s

---

## 1. Logo aplikacji w headerze raportu z wersją (jak w Help)

**Stan obecny:** Header raportu (`ReportView.tsx:177-197`) pokazuje kolorowe kółko projektu + nazwę + datę. Brak logo TIMEFLOW i wersji. W Help.tsx (linia 76-89) jest logo z `@/assets/logo.png` + wersja z `getDaemonStatus()`. `report-generator.ts` jest **nieużywany** — zmiany tylko w `ReportView.tsx`.

**Plan:**
1. W `ReportView.tsx` — dodać `import logoSrc from '@/assets/logo.png'` i pobrać wersję z `getDaemonStatus()` (jak w Help.tsx:61-64).
2. W sekcji `header` dodać logo TIMEFLOW (img, h-8) + "TIMEFLOW" + "v{version}" po lewej stronie, a po prawej dane projektu (nazwa, kolor, data).
3. Dodać style `@media print` aby logo było widoczne w PDF.
4. Rozważyć usunięcie `report-generator.ts` (legacy, duplikacja).

**Pliki:** `ReportView.tsx`, (opcjonalnie usunąć `report-generator.ts`)

**Test:** Otwórz raport projektu — logo TIMEFLOW i wersja widoczne w nagłówku. Wydruk/PDF zachowuje logo.

---

## 2. Komentarze i boosty jako opcja w raporcie

**Stan obecny:** Sekcja `comments` istnieje w szablonie (`Reports.tsx` ALL_SECTIONS) i można ją włączyć/wyłączyć w edytorze. Brak osobnej sekcji dla boostów. Dane boostów są dostępne — `SessionWithApp` ma pole `rate_multiplier`, a `ProjectDbStats` ma `boosted_session_count`. Edytor szablonów (`Reports.tsx:183-337`) już obsługuje drag & drop sekcji.

**Plan:**
1. Dodać nową sekcję `'boosts'` do `ALL_SECTIONS` w `Reports.tsx` — z opisem, ikoną i wireframe preview.
2. W `ReportView.tsx` — dodać sekcję "Boosty" renderującą sesje z `rate_multiplier > 1` (data, app, czas, mnożnik).
3. Sekcja `comments` już istnieje — wystarczy upewnić się, że działa poprawnie w edytorze.

**Pliki:** `Reports.tsx` (ALL_SECTIONS), `ReportView.tsx`

**Test:** W edytorze szablonu dodaj/usuń sekcje "Boosty" i "Komentarze" — raport odpowiednio się aktualizuje.

---

## 3. Sesje manualne jako opcja w raporcie

**Stan obecny:** Dane `manualSessions` są pobierane w `ReportView.tsx:92` (`getManualSessions`), ale **nie są renderowane nigdzie w raporcie**. Typ `ManualSessionWithProject` (db-types.ts:347-359) ma pola: title, session_type, project_name, project_color, start_time, end_time, duration_seconds. `ProjectDbStats` ma `manual_session_count`.

**Plan:**
1. Dodać sekcję `'manual_sessions'` do `ALL_SECTIONS` w `Reports.tsx` — z opisem i preview.
2. W `ReportView.tsx` — dodać tabelę sesji manualnych (data, tytuł, typ sesji, czas trwania) po sekcji zwykłych sesji.
3. Dodać do statystyk (sekcja `stats`) informację o liczbie sesji manualnych.

**Pliki:** `Reports.tsx`, `ReportView.tsx`

**Test:** Utwórz sesję manualną dla projektu, wygeneruj raport — sesja manualna widoczna w dedykowanej sekcji.

---

## 4. Przycisk "Wygeneruj raport" w lepszym miejscu

**Stan obecny:** Przycisk jest w `ProjectPage.tsx:809-820`, wewnątrz `CardHeader` obok przycisków zamrożenia/wykluczenia, na pełną szerokość (`w-full mt-2`). Jest to mało widoczne i nieintuicyjne miejsce.

**Plan:**
1. Przenieść przycisk "Generuj raport" na górny toolbar strony projektu (obok przycisku "Powrót") — tam gdzie jest najlepiej widoczny.
2. Alternatywnie: dodać go do sekcji akcji w nagłówku karty projektu, jako wyraźny przycisk z ikoną `FileText`.
3. Rozważyć dodanie przycisku również na stronie `Projects.tsx` (lista projektów) — w menu kontekstowym lub przy każdym projekcie.
4. Usunąć stary przycisk z `CardHeader` aby uniknąć duplikacji.

**Pliki:** `ProjectPage.tsx`, opcjonalnie `Projects.tsx`

**Test:** Przycisk widoczny i łatwo dostępny na stronie projektu. Kliknięcie otwiera widok raportu.

---

## 5. Wybór fontu i skalowanie proporcjonalne fontów

**Stan obecny:** Raport używa `font-family: 'Segoe UI', system-ui, -apple-system, sans-serif` (report-generator.ts:134) i stałego `font-size: 13px`. W `ReportView.tsx` używane są klasy Tailwind z predefiniowanymi rozmiarami. Brak ustawień fontów.

**Plan:**
1. Dodać nowe ustawienia raportów w `user-settings.ts`:
   ```ts
   interface ReportFontSettings {
     fontFamily: 'system' | 'serif' | 'mono' | 'inter' | 'roboto';
     baseFontSize: number; // 10-18, domyślnie 13
   }
   ```
2. W `ReportView.tsx` — zastosować wybrany font jako styl inline na kontenerze raportu + CSS `rem`-based sizing ze zmienną `--report-base-font`.
3. W `report-generator.ts` — wstrzyknąć wybrany font i rozmiar do wygenerowanego CSS.
4. Dodać panel ustawień fontu w widoku raportu (toolbar) — select fontu + slider rozmiaru (10-18px).
5. Skalowanie proporcjonalne: wszystkie rozmiary w raporcie zdefiniować jako `em` lub `rem` relatywne do bazowego rozmiaru — nagłówki, etykiety, tabele zachowują proporcje.

**Pliki:** `user-settings.ts`, `ReportView.tsx`, `report-generator.ts`

**Test:** Zmiana fontu i rozmiaru — raport natychmiast się przerysowuje. Proporcje zachowane przy drukowaniu.

---

## 6. System szablonów raportów + wybór szablonu przed generowaniem

**Stan obecny:** Szablon jest prostą tablicą sekcji (`string[]`) w `localStorage` pod kluczem `timeflow_report_template`. Edytor szablonów (`Reports.tsx`) obsługuje jedno aktywne ustawienie — brak możliwości zapisu wielu szablonów. `loadTemplate()` zduplikowana w `Reports.tsx` i `ReportView.tsx`. `report-generator.ts` jest nieużywany (legacy).

**Plan:**
1. Zdefiniować typ szablonu:
   ```ts
   interface ReportTemplate {
     id: string;           // UUID
     name: string;         // nazwa widoczna
     sections: string[];   // lista sekcji do renderowania
     fontFamily: string;
     baseFontSize: number;
     showLogo: boolean;
     createdAt: string;
     updatedAt: string;
   }
   ```
2. Utworzyć `report-templates.ts` — CRUD szablonów w localStorage pod kluczem `timeflow_report_templates` (tablica). Domyślny szablon "Standard" wbudowany. Migracja ze starego `timeflow_report_template`.
3. Rozszerzyć istniejący edytor `Reports.tsx` — dodać: lista szablonów (sidebar), przycisk "Nowy"/"Duplikuj"/"Usuń", wybór fontu, skalowanie. Zachować obecny drag & drop + preview.
4. **Przed generowaniem raportu** (klik w ProjectPage.tsx) — wyświetlić modal wyboru szablonu:
   - Lista zapisanych szablonów z podglądem (ikona + nazwa + lista sekcji)
   - Przycisk "Edytuj" (przejście do Reports.tsx)
   - Przycisk "Generuj" który uruchamia generowanie z wybranym szablonem
5. `ReportView` przyjmuje `templateId` jako parametr (przekazany przez UI store) zamiast czytać globalny template.
6. Usunąć `report-generator.ts` (legacy). Usunąć duplikację `loadTemplate()`.

**Pliki (nowe):** `dashboard/src/lib/report-templates.ts`, `dashboard/src/components/reports/ReportTemplateSelector.tsx`
**Pliki (zmiany):** `Reports.tsx`, `ReportView.tsx`, `ProjectPage.tsx`, `ui-store.ts`
**Pliki (usunąć):** `report-generator.ts`

**Test:** Utwórz 2 szablony z różnymi sekcjami. Przy generowaniu raportu pojawia się modal wyboru. Wybrany szablon determinuje zawartość raportu.

---

## 7. Zmiana logiki podziału sesji — wieloprojektowy split z AI scoring

**Stan obecny:**
- `SplitSessionModal.tsx` — dzieli sesję na **2 części** z suwakiem ratio (5-95%).
- `suggest_session_split` (sessions.rs:1219-1312) — analizuje file_activities, sugeruje 2 projekty + ratio.
- `split_session` (sessions.rs:1096-1204) — ukrywa oryginalną sesję, tworzy 2 nowe.
- `CandidateScore` i `ScoreBreakdown` (db-types.ts:125-156) — istniejąca infrastruktura scoringu AI.
- Podział jest czysto manualny — użytkownik sam decyduje kiedy dzielić.

**Nowa logika (5 kroków):**

### 7a. Backend: wykrywanie sesji wieloprojektowych
1. Nowa komenda Rust `analyze_session_projects(session_id) -> MultiProjectAnalysis`:
   ```rust
   struct MultiProjectAnalysis {
     session_id: i64,
     candidates: Vec<ProjectCandidate>,  // max 5
     is_splittable: bool,
     leader_project_id: Option<i64>,
     leader_score: f64,
   }
   struct ProjectCandidate {
     project_id: i64,
     project_name: String,
     score: f64,           // punktacja AI
     ratio_to_leader: f64, // stosunek do lidera
   }
   ```
2. Logika: **rozszerzyć istniejący** `SESSION_PROJECT_CTE_ALL_TIME` (sql_fragments.rs) — ten CTE już oblicza `ranked_overlap` z `project_count` per sesji. Obecnie bierze tylko `rn=1` (lidera). Nowa komenda pobierze wszystkich kandydatów (rn ≤ 5) z ich overlap_seconds.
3. Dodatkowo wykorzystać scoring z `assignment_model.rs` (4 warstwy: file 0.80, app 0.30, time 0.10, token 0.30) aby policzyć confidence. Jeśli ≥2 kandydatów ma `ratio_to_leader >= tolerance_threshold` — sesja jest "splittable".
4. Nowa komenda batch: `analyze_sessions_splittable(session_ids: Vec<i64>) -> Vec<(i64, bool)>` — dla wydajności na liście sesji.

### 7b. Backend: rozszerzenie split na N projektów
1. Rozszerzyć `split_session` na N-way split:
   ```rust
   split_session_multi(session_id, splits: Vec<SplitPart>)
   struct SplitPart { project_id: Option<i64>, ratio: f64 }
   ```
2. Walidacja: suma ratios = 1.0, max 5 części.

### 7c. Frontend: ikona nożyczek na liście sesji
1. W `Sessions.tsx` — przy każdej sesji, jeśli `is_splittable == true`, wyświetlić ikonę `Scissors` (lucide).
2. Batch-analiza: przy ładowaniu sesji, wywołać `analyze_session_projects` dla sesji bez przypisania lub z niskim confidence.
3. Kliknięcie nożyczek otwiera nowy `MultiSplitSessionModal`.

### 7d. Frontend: nowy MultiSplitSessionModal
1. Wyświetla listę kandydatów AI z punktacją (bar chart).
2. Suwaki ratio dla każdego kandydata (suma = 100%).
3. Podgląd wizualny podziału (stacked bar).
4. Przycisk "Podziel" — po podziale sesje mogą być przypisywane.
5. **Blokada przypisania**: dopóki sesja nie zostanie podzielona, nie można zmieniać jej przypisania (jeśli spełnia warunek podziału). Feedback z podziału trafia do uczenia AI.

### 7e. Ustawienia podziału sesji
1. Nowe ustawienia w `user-settings.ts`:
   ```ts
   interface SplitSettings {
     maxProjectsPerSession: number;  // 2-5, domyślnie 5
     toleranceThreshold: number;     // 0.2-1.0, domyślnie 0.8
     autoSplitEnabled: boolean;      // domyślnie false
   }
   ```
2. **Slider tolerancji** (0.2 — 1.0, krok 0.05):
   - `1.0` = podział tylko gdy projekty mają identyczne punkty
   - `0.8` = podział gdy drugi projekt ma ≥80% punktów lidera
   - `0.2` = podział nawet przy dużej dysproporcji
3. W `Settings.tsx` — sekcja "Podział sesji" z:
   - Slider tolerancji z wizualizacją (etykieta: "1:0.8 — podział gdy projekt ma ≥80% punktów lidera")
   - Max projektów na sesję (select: 2-5)
   - Toggle "Automatyczny podział" — jeśli włączony, sesje spełniające warunki są dzielone automatycznie w BackgroundServices
4. **Auto-split**: w `BackgroundServices.tsx` — cykliczne sprawdzanie sesji bez przypisania, jeśli spełniają warunki → automatyczny podział.

**Pliki (nowe):** `dashboard/src/components/sessions/MultiSplitSessionModal.tsx`
**Pliki (zmiany):** `sessions.rs`, `SplitSessionModal.tsx` (ewentualny merge z Multi), `Sessions.tsx`, `user-settings.ts`, `Settings.tsx`, `BackgroundServices.tsx`, `tauri.ts` (nowe wrappery), `db-types.ts` (nowe typy)

**Test:**
1. Sesja z aktywnością na plikach 2+ projektów → pojawia się ikona nożyczek.
2. Kliknięcie → modal z kandydatami i suwakami.
3. Zmiana tolerancji w ustawieniach wpływa na liczbę sesji z ikoną nożyczek.
4. Auto-split: włącz, poczekaj — sesje spełniające warunki podzielone automatycznie.

---

## 8. Poprawienie splash screen

**Stan obecny:** `SplashScreen.tsx` — czysty React overlay z `z-[9999]`, fade po 1.4s, ukrycie po 2s. Jest montowany w `App.tsx:180` **obok** `MainLayout` (nie wewnątrz), ale wciąż w React tree, co oznacza, że:
- React musi się załadować zanim splash się pojawi
- Inicjalizacja bazy danych (`block_on` w `lib.rs:setup()`) dzieje się **przed** załadowaniem frontendu — splash nie ukrywa tego etapu
- Okno Tauri (`decorations: false`) jest widoczne ale puste do momentu załadowania React
- `tauri.conf.json` definiuje jedno okno bez splashscreen

**Plan:**
1. **Natywny splash screen Tauri** — dodać w `tauri.conf.json` konfigurację splashscreen window:
   ```json
   {
     "windows": [
       {
         "label": "splashscreen",
         "url": "splashscreen.html",
         "width": 400,
         "height": 300,
         "decorations": false,
         "transparent": true,
         "alwaysOnTop": true,
         "center": true
       },
       {
         "label": "main",
         "visible": false,
         ...
       }
     ]
   }
   ```
2. Utworzyć `dashboard/src/splashscreen.html` — statyczny HTML (nie React) z logo, "TIMEFLOW", animowanym paskiem. Ładuje się natychmiastowo.
3. W `lib.rs` `setup()` — po inicjalizacji bazy danych, zamknąć okno splash i pokazać okno main:
   ```rust
   if let Some(splash) = app.get_webview_window("splashscreen") {
     splash.close().ok();
   }
   if let Some(main) = app.get_webview_window("main") {
     main.show().ok();
   }
   ```
4. Usunąć komponent `SplashScreen.tsx` i jego import z `App.tsx`.
5. Ustawić minimalne opóźnienie splash (np. 1.5s) aby nie migał przy szybkim starcie.

**Pliki (nowe):** `dashboard/src/splashscreen.html`
**Pliki (zmiany):** `tauri.conf.json`, `lib.rs`, `App.tsx`, usunąć `SplashScreen.tsx`

**Test:** Uruchom aplikację — splash pojawia się natychmiast (przed React). Główne okno pojawia się dopiero po pełnej inicjalizacji.

---

## 9. Sprawdzenie wielowątkowości

**Stan obecny (z analizy agenta):**
- `lib.rs` — `block_on(db::initialize())` w `setup()` — **blokujący** call async w wątku UI.
- `db.rs` — `get_connection()` tworzy **nowe** `rusqlite::Connection` za każdym razem (brak poolingu). Ścieżka DB w `Mutex<String>` (DbPath state). Pragmy: `WAL`, `busy_timeout=5000`, `synchronous=NORMAL`.
- Komendy Tauri — async, na tokio thread pool. Brak `tokio::spawn` — każda komenda blokuje swój wątek do zakończenia.
- `BackgroundServices.tsx` — 5 hooków + universal event loop co 1s. Interwały: refresh 30s, file sig check 5s, sync poll 120s. Debounce: 120ms na `LOCAL_DATA_CHANGED_EVENT`. Brak throttlingu ciężkich operacji.
- Brak `Promise.allSettled` w batch operacjach — failure isolation jest słaba.

**Plan audytu:**
1. **`db.rs`** — obecny model (nowe Connection per command) jest OK dla SQLite WAL (concurrent readers), ale:
   - `block_on` w `setup()` może deadlockować tokio runtime jeśli db::initialize jest naprawdę async
   - Brak limitu na równoległe zapytania — przy ciężkim obciążeniu (batch AI scoring + import + refresh) SQLite writer lock może powodować `busy_timeout` errors
2. **Ciężkie operacje** — `train_assignment_model`, `rebuild_sessions`, `import_data_archive`:
   - Sprawdzić czy mają transakcje (mogą blokować writer lock na długo)
   - Rozważyć `tokio::spawn_blocking` dla operacji >1s
3. **BackgroundServices** — potencjalne race conditions:
   - `useAutoAiAssignment` + `useJobPool` mogą jednocześnie wywołać `applyDeterministicAssignment`
   - `autoImportDone` flag łagodzi to, ale brak ogólnego lock/queue
4. **Rekomendacje:**
   - Zamienić `block_on` w setup na natywny sync init (rusqlite jest sync — nie potrzebuje async wrapper)
   - Dodać semaphore/queue w BackgroundServices (max 1 ciężka operacja jednocześnie)
   - Rozważyć connection pooling (r2d2-sqlite) dla operacji read-heavy
   - Dodać progress reporting (Tauri events) dla długich operacji (training, import)

**Pliki do audytu:** `db.rs`, `lib.rs`, `assignment_model.rs`, `import_data.rs`, `BackgroundServices.tsx`

**Deliverable:** Raport z audytu + PR z poprawkami krytycznych problemów.

---

## Kolejność implementacji (sugerowana)

| Priorytet | Funkcjonalność | Złożoność | Zależności |
|-----------|---------------|-----------|------------|
| 1 | 8. Splash screen | Średnia | Brak |
| 2 | 9. Audyt wielowątkowości | Średnia | Brak |
| 3 | 1. Logo + wersja w headerze raportu | Niska | Brak |
| 4 | 4. Lepsze miejsce przycisku raportu | Niska | Brak |
| 5 | 2. Komentarze i boosty jako opcja | Niska | Brak |
| 6 | 3. Sesje manualne w raporcie | Niska | Brak |
| 7 | 5. Wybór fontu + skalowanie | Średnia | Brak |
| 8 | 6. System szablonów raportów | Wysoka | Pkt 1-5 |
| 9 | 7. Wieloprojektowy split sesji | Bardzo wysoka | Audyt (pkt 9) |

> Punkty 1-5 mogą być realizowane równolegle. Punkt 6 integruje je w system szablonów. Punkt 7 wymaga zmian backend + frontend + ustawienia i powinien być realizowany po audycie wielowątkowości (pkt 9).

---

## Aktualizacja Help.tsx

Każda z powyższych funkcjonalności wymaga aktualizacji `Help.tsx` zgodnie z CLAUDE.md:
- Pkt 1-6: sekcja "Raporty" — opisać: logo, szablony, sekcje, fonty, generowanie
- Pkt 7: sekcja "Sesje" — opisać: podział wieloprojektowy, ikona nożyczek, tolerancja, auto-split
- Pkt 8: brak zmian (splash to wewnętrzna mechanika)
- Pkt 9: brak zmian (audyt wewnętrzny)
