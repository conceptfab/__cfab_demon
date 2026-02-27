# TIMEFLOW — Raport analizy kodu

> Dokument zawiera wyniki przeglądu kodu projektu pod kątem: poprawności logiki, wydajności, nadmiarowego kodu, brakujących tłumaczeń, AI i propozycji modularyzacji.

---

## 1. Architektura (stan bieżący)

```
__client/
├── src/                     ← Rust daemon (7 plików, ~54 kB)
│   ├── main.rs              – punkt wejścia, logging, restart
│   ├── config.rs            – ładowanie monitored apps z DB + JSON legacy
│   ├── monitor.rs           – foreground detection, PID cache, CPU tracking
│   ├── tracker.rs           – główna pętla monitoringu (run_loop)
│   ├── storage.rs           – zapis/odczyt dziennych JSON (data/ + archive/)
│   ├── tray.rs              – ikona tray, menu, launch dashboard
│   └── single_instance.rs   – Windows Named Mutex
│
├── dashboard/
│   ├── src/                 ← React/Vite frontend (~64 plików)
│   │   ├── App.tsx          – router, auto-importers, auto-refresher, online-sync
│   │   ├── pages/           – 15 stron UI
│   │   ├── components/      – 37 komponentów
│   │   ├── lib/             – tauri.ts, online-sync.ts, db-types.ts, user-settings.ts
│   │   └── store/           – app-store.ts (Zustand)
│   │
│   └── src-tauri/
│       └── src/             ← Tauri backend (19 command files + db.rs, ~300 kB)
│           ├── commands/
│           │   ├── assignment_model.rs   ← AI/ML rdzeń (1213 linii)
│           │   ├── projects.rs           ← zarządzanie projektami
│           │   ├── sessions.rs           ← sesje i sugestie
│           │   └── ...
│           └── db.rs        ← schemat SQLite + połączenie
```

---

## 2. Analiza systemu AI — szczegółowa

### 2.1 Architektura AI (3 warstwy)

| Warstwa | Plik | Opis |
|---------|------|------|
| **Layer 1** — Regułowy | [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) → [suggest_project_for_session()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#653-682) | Podpowiedzi oparte na wyuczonym modelu |
| **Layer 2** — Deterministyczny | [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) → [apply_deterministic_assignment()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#1043-1188) | Jeśli 100% sesji danej apki trafiło wcześniej do jednego projektu → automatycznie przypisuj |
| **Layer 3** — Auto-safe ML | [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) → [run_auto_safe_assignment()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#683-904) | Automatyczne przypisanie jeśli confidence + evidence + margin wystarczające |

### 2.2 Model ML — jak działa

Model zbiera **3 sygnały** do wyliczenia `confidence`:

1. **App signal** (waga 0.50): `ln(1 + count)` — ile razy ta apka → ten projekt
2. **Time signal** (waga 0.15): `ln(1 + count)` — ile razy ta apka + godzina + dzień tygodnia → ten projekt
3. **Token signal** (waga 0.30): `avg_log × (matches/total)` — tokeny z nazw plików

Wynikowy `confidence` = `sigmoid(margin) × evidence_factor`, gdzie:
- `margin` = różnica score najlepszego vs drugiego kandydata
- `evidence_factor` = [min(evidence_count / 4, 1.0)](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/db-types.ts#119-124)

### 2.3 Znalezione problemy w logice AI

> [!CAUTION]
> **Problem 1: Confidence NIGDY nie osiągnie 1.0 w praktyce**

Wzór `sigmoid(margin) × (evidence/4)` ma ograniczenie:
- `sigmoid(x)` → asymptotycznie do 1.0 ale nigdy == 1.0
- Dla `evidence_count = 3` (domyślny próg auto_safe): `evidence_factor = 3/4 = 0.75`
- To oznacza, że przy domyślnych ustawieniach **max confidence ≈ 0.75**, a próg auto to **0.85**
- **Konsekwencja**: auto-safe z domyślnymi ustawieniami (`min_evidence_auto=3`, `min_confidence_auto=0.85`) **praktycznie nigdy nie zadziała**, chyba że margin będzie astronomicznie wysoki

**Rekomendacja**: Zwiększyć domyślny `min_evidence_auto` z 3 na **4** lub zmniejszyć `min_confidence_auto` z 0.85 na **0.75**. Alternatywnie zmienić wzór na `evidence_factor = min(evidence/3, 1.0)`.

> [!WARNING]
> **Problem 2: Deterministic assignment zapisuje feedback, który zawyża model ML**

Funkcja [apply_deterministic_assignment()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#1043-1188) przy każdym przypisaniu wywołuje [increment_feedback_counter()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#152-162) i wstawia `assignment_feedback` z `source='deterministic_rule'`. Te dane trafią do treningu modelu — ale **nie są prawdziwą korektą użytkownika**. To błędne koło: im więcej sesji deterministic assignuje, tym bardziej model jest pewien, ale to pewność oparta na automatyce, nie na inteligentnym procesie uczenia.

**Rekomendacja**: Nie inkrementować `feedback_since_train` dla `deterministic_rule`. Ewentualnie filtrować te dane przy treningu.

> [!WARNING]
> **Problem 3: Trening (Layer 3) NIE używa danych z Layer 2 feedbacku jako negatywnych przykładów**

Trening modelu ([train_assignment_model](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#538-652)) wykonuje:
```sql
INSERT INTO assignment_model_app SELECT ... FROM sessions WHERE project_id IS NOT NULL
```
To traktuje KAŻDĄ przypisaną sesję jako pozytywny przykład, niezależnie od źródła przypisania. Nie ma mechanizmu **negatywnego feedbacku** — odrzucenia sugestii nie są uwzględniane w treningu.

**Rekomendacja**: Dodać filtrowanie: sesje z rollbackiem (`assignment_feedback.source = 'auto_reject'`) powinny obniżać `cnt` w tabelach modelu.

> [!IMPORTANT]
> **Problem 4: Brak komunikatu UI "dlaczego AI to sugerowała"**

Użytkownik widzi sugestię `suggested_project_name` przy sesji, ale **nie wie dlaczego** (app match? token? czas?). To uniemożliwia świadome "trenowanie" AI przez użytkownika.

**Rekomendacja**: Zwracać w [SessionWithApp](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/db-types.ts#68-82) pole `suggestion_reason: string` z opisem np. _"App match: 15×, Token: main.rs, psd"_.

> [!NOTE]
> **Problem 5: `auto_accept` count = feedback count — systematyczny fałszywy wzrost**

Każde auto-safe przypisanie inkrementuje `feedback_since_train`. Przy 500 sesjach auto = 500 feedbacków → natychmiast wymusza retrenowanie. To niepotrzebny szum.

**Rekomendacja**: Nie liczyć `auto_accept` jako feedbacku per-sesja, lecz per-run (jeden run = jeden increment).

---

## 3. Brakujące tłumaczenia (UI powinno być po angielsku)

> [!IMPORTANT]
> Pomoc ([Help.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Help.tsx)) i Quick Start ([QuickStart.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/QuickStart.tsx)) używają funkcji [t()](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs#77-88) i są bilingwalne — to **wyjątek OK**. Poniżej wylistowane pliki z polskim tekstem w normalnym UI.

### 3.1 Frontend — pliki wymagające tłumaczenia

| Plik | Linia | Tekst PL | Propozycja EN |
|------|-------|----------|---------------|
| [Sessions.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Sessions.tsx#L892) | 892 | `"Brak powiazanej karty projektu"` / `"Przejdz do karty projektu"` | `"No linked project card"` / `"Go to project card"` |
| [Projects.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Projects.tsx#L1161) | 1161 | `title="Zapisz widok jako domyślny"` | `title="Save view as default"` |
| [prompt-modal.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/ui/prompt-modal.tsx#L31) | 31 | `cancelLabel = "Anuluj"` | `cancelLabel = "Cancel"` |
| [ProjectContextMenu.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/project/ProjectContextMenu.tsx#L118) | 118 | `"Przejdz do karty projektu"` | `"Go to project card"` |

### 3.2 Rust daemon — polskie komentarze i komunikaty logów

Nie są widoczne dla użytkownika, ale warto ujednolicić do angielskiego. Dotyczy **20+ miejsc** w:
- [config.rs](file:///c:/_cloud/__cfab_demon/__client/src/config.rs) — komentarze doc, `log::warn`, [context()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#211-259) messages
- [storage.rs](file:///c:/_cloud/__cfab_demon/__client/src/storage.rs) — komentarze, nazwy funkcji w logach
- [monitor.rs](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs) — komentarze w kodzie

---

## 4. Wydajność i optymalizacje

### 4.1 Daemon ([tracker.rs](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs))

| # | Problem | Zalecenie |
|---|---------|-----------|
| 1 | [check_dashboard_compatibility()](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs#42-76) blokuje wątek monitora MessageBoxem (l.57-66) | Przenieść sprawdzenie do tray thread lub użyć `MessageBoxW` z `MB_TOPMOST`. Obecnie monitor stoi do czasu zamknięcia okna dialogowego |
| 2 | [build_process_snapshot()](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs#250-284) robi pełny snapshot procesów **co 10 sekund** nawet gdy [monitored](file:///c:/_cloud/__cfab_demon/__client/src/config.rs#223-232) jest puste (monitor_all=true z CPU tracking wyłączonym) | Skipować [build_process_snapshot()](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs#250-284) gdy `monitor_all == true` (już jest warunek, OK) |
| 3 | `file_index_cache` rebuilt po midnight — duplikacja kodu z init (l.182-187 vs l.216-221) | Wyciągnąć helper `rebuild_file_index_cache(&daily_data)` |

### 4.2 Frontend ([online-sync.ts](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts))

| # | Problem | Zalecenie |
|---|---------|-----------|
| 1 | Plik ma **1470 linii** — za duży na jeden moduł | Podzielić na: `sync-settings.ts`, `sync-state.ts`, `sync-indicator.ts`, `sync-engine.ts` |
| 2 | [loadOnlineSyncSettings()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts#601-634) zawsze **zapisuje** settings (l.631) — nawet przy read-only operacji | Generować i zapisywać `deviceId` tylko raz, nie przy każdym load |
| 3 | Poll sync co 20s + file watcher co 5s + interval co 30s — **3 timery** robią de facto to samo | Uprościć do 2: file watcher + interval. Poll sync jest redundantny |

### 4.3 Tauri backend

| # | Problem | Plik | Zalecenie |
|---|---------|------|-----------|
| 1 | [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) — 1213 linii w jednym pliku | [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) | Podzielić na: `model_types.rs`, `model_training.rs`, `model_inference.rs`, `deterministic.rs`, `auto_safe.rs` |
| 2 | Tokenizer ([tokenize()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#163-173)) filtruje tokeny < 3 znaków — gubimy [ui](file:///c:/_cloud/__cfab_demon/__client/src/single_instance.rs#30-56), `ux`, `3d`, [ai](file:///c:/_cloud/__cfab_demon/__client/icons.ai) | l.169 | Zmniejszyć min do 2 znaków |
| 3 | Token query buduje IN clause dynamicznie — brak cache prepared statement | l.306 | Dla typowej sesji (10-30 tokenów) wpływ minimalny, akceptowalne |

---

## 5. Nadmiarowy / martwy kod

| Plik | Problem |
|------|---------|
| [dashboard/debug.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/debug.js) (270B) | Plik debugowy — usunąć z projektu |
| [dashboard/debug2.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/debug2.js) (798B) | Plik debugowy — usunąć |
| [dashboard/fix_dash.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/fix_dash.js) (296B) | Skrypt naprawczy — przenieść do `/scripts` lub usunąć |
| [dashboard/test_dates.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/test_dates.py) (279B) | Testowy skrypt Python — nie należy do produkcji |
| [dashboard/test_db.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/test_db.js) (915B) | Test bazy danych — przenieść |
| [dashboard/update_filter.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_filter.py) (5.8 kB) | Skrypt migracyjny — archiwum |
| [dashboard/update_sessions.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_sessions.py) (939B) | Skrypt migracyjny — archiwum |
| [dashboard/update_sessions_ts.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_sessions_ts.py) (3.8 kB) | Skrypt migracyjny — archiwum |
| [Projects.tsx (fixing imports)](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Projects.tsx%20(fixing%20imports)) (1.6 kB) | Plik-duplikat z przestrzenią w nazwie! Usunąć |
| [problems.md](file:///c:/_cloud/__cfab_demon/__client/problems.md) | Notatki robocze — przenieść lub usunąć |

---

## 6. Logika i poprawność

### 6.1 Daemon

| # | Problem | Plik:Linia |
|---|---------|------------|
| 1 | [is_dashboard_running()](file:///c:/_cloud/__cfab_demon/__client/src/tray.rs#207-221) sprawdza `p.name()` jako [String](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts#246-249) — sysinfo v0.30+ zwraca `OsStr`. Może nie kompilować się po aktualizacji crate | [tray.rs:213](file:///c:/_cloud/__cfab_demon/__client/src/tray.rs#L213) |
| 2 | [normalizeServerUrl()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts#201-210) mapuje nowy URL TimeFlow na legacy CfabServer — to blokuje migrację na nowy serwer | [online-sync.ts:205-208](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts#L205) |

### 6.2 Frontend

| # | Problem | Plik |
|---|---------|------|
| 1 | [AutoProjectSync](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/App.tsx#210-231) — hardcoded date range `"2020-01-01"` do `"2100-01-01"` — traci dane sprzed 2020 | [App.tsx:216](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/App.tsx#L216) |
| 2 | [autoRunIfNeeded](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/tauri.ts#231-233) zwraca `null` gdy `scanned=0 && assigned=0` — to poprawne, ale brak logu | [assignment_model.rs:1208](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#L1208) |

---

## 7. Propozycja modularyzacji

### 7.1 Daemon (Rust) — obecna struktura jest OK

7 plików, jasny podział. Jedyny refaktor:
- Wyciągnąć [check_dashboard_compatibility()](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs#42-76) z [tracker.rs](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs) do [tray.rs](file:///c:/_cloud/__cfab_demon/__client/src/tray.rs) (bo dotyczy UI, nie trackingu)

### 7.2 Tauri backend — kluczowa modularyzacja

Obecny `commands/` ma 19 plików, ale kilka jest zbyt dużych:

```
commands/
├── assignment/              ← NOWY PODMODUŁ
│   ├── mod.rs
│   ├── types.rs             ← structs (AssignmentModelStatus, etc.)
│   ├── state.rs             ← load_state_map, upsert_state, helpers
│   ├── training.rs          ← train_assignment_model
│   ├── inference.rs         ← compute_raw_suggestion, suggest_project_for_session
│   ├── auto_safe.rs         ← run_auto_safe_assignment, auto_run_if_needed, rollback
│   └── deterministic.rs     ← apply_deterministic_assignment
│
├── projects.rs              (47 kB → rozważyć podział: crud / sync / detection)
├── sessions.rs              (28 kB → OK)
├── import_data.rs           (30 kB → OK)
└── ...
```

### 7.3 Frontend — rekomendowana struktura

```
lib/
├── sync/                    ← NOWY MODUŁ (z obecnego online-sync.ts)
│   ├── settings.ts          ← load/save settings, normalizacja
│   ├── state.ts             ← sync state, scoped storage
│   ├── indicator.ts         ← snapshot, listeners, UI status
│   ├── engine.ts            ← runOnlineSyncOnce, push/pull/ack
│   └── logger.ts            ← SyncFileLogger
│
├── ai/                      ← NOWY MODUŁ
│   ├── types.ts             ← AssignmentMode, Status, Results
│   ├── commands.ts          ← Tauri invoke wrappers
│   └── reminder.ts          ← buildTrainingReminder logic
│
├── tauri.ts                 ← pozostaje jako centralny hub (bez AI commands)
├── db-types.ts              ← podzielić na: project-types, session-types, etc.
└── user-settings.ts         ← OK
```

---

## 8. Podsumowanie priorytetów

| Priorytet | Kategoria | Opis |
|-----------|-----------|------|
| 🔴 Krytyczny | AI Logic | Confidence math uniemożliwia auto-safe przy domyślnych parametrach (§2.3 Problem 1) |
| 🔴 Krytyczny | AI Logic | Deterministic feedback zawyża model (§2.3 Problem 2) |
| 🟡 Ważny | UX/AI | Brak wyjaśnienia "dlaczego AI to sugeruje" (§2.3 Problem 4) |
| 🟡 Ważny | Tłumaczenia | 4 pliki z polskim tekstem w UI (§3.1) |
| 🟡 Ważny | Czystość | Plik-duplikat `Projects.tsx (fixing imports)` (§5) |
| 🟢 Opcjonalny | Modularyzacja | Podział [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) i [online-sync.ts](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts) na podmoduły (§7) |
| 🟢 Opcjonalny | Czystość | Usunięcie plików debug/test/migracyjnych (§5) |
| 🟢 Opcjonalny | Wydajność | Redukcja timerów sync (§4.2) |

---

*Raport wygenerowany 2026-02-27 na podstawie analizy pełnego kodu projektu.*
