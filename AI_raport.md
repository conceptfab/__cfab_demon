# TIMEFLOW — Raport analizy systemu AI (assignment model)

## Problem

Aplikacja zawsze przypisuje sesje Photoshopa do jednego i tego samego projektu, niezależnie od kontekstu pracy.

---

## Architektura systemu AI

System AI **nie jest siecią neuronową** — to deterministyczny system scoringowy z 4 warstwami dowodów (evidence layers), trenowany na danych historycznych z feedbacku użytkownika.

### Pliki kluczowe

| Warstwa | Plik | Rola |
|---------|------|------|
| Frontend | `dashboard/src/pages/AI.tsx` | Strona konfiguracji modelu |
| API | `dashboard/src/lib/tauri/ai.ts` | Tauri IPC commands |
| Orchestrator | `dashboard/src-tauri/src/commands/assignment_model/mod.rs` | Komendy Tauri, typy, status |
| Scoring | `dashboard/src-tauri/src/commands/assignment_model/scoring.rs` | Obliczanie score per projekt |
| Context | `dashboard/src-tauri/src/commands/assignment_model/context.rs` | Budowa kontekstu sesji (tokeny, pliki) |
| Training | `dashboard/src-tauri/src/commands/assignment_model/training.rs` | Trening modelu z danych historycznych |
| Auto-safe | `dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs` | Auto-przypisanie + **deterministic rules** |
| Config | `dashboard/src-tauri/src/commands/assignment_model/config.rs` | Stałe, parsery stanu |
| Demon | `src/monitor.rs`, `src/tracker.rs` | Zbieranie danych (WMI, window title) |
| Klasyfikacja | `shared/activity_classification.rs` | Mapowanie exe → typ aktywności |

### Warstwy scoringowe (scoring.rs)

1. **Layer 0 — File (waga 0.80)**: Projekty powiązane z file_activities na podstawie `project_id` w rekordach `file_activities` + overlap czasowy z sesją.
2. **Layer 1 — App (waga 0.30)**: Ile razy dany `app_id` był przypisany do danego projektu (`assignment_model_app`).
3. **Layer 2 — Time (waga 0.10)**: Korelacja app+godzina+dzień tygodnia z projektem (`assignment_model_time`).
4. **Layer 3 — Token (waga 0.30)**: Tokeny z nazw plików, ścieżek, tytułów okien (`assignment_model_token`).

Confidence = `sigmoid(margin) × evidence_factor`, gdzie margin = różnica score między 1. a 2. kandydatem.

---

## Diagnoza: dlaczego Photoshop trafia zawsze do jednego projektu

### Przyczyna główna: Deterministic Assignment

**Plik**: `auto_safe.rs:415-442` — funkcja `deterministic_sync()`

```rust
SELECT app_id, project_id
FROM (
    SELECT app_id, project_id, COUNT(*) as cnt,
           COUNT(DISTINCT project_id) as distinct_projects
    FROM sessions
    WHERE project_id IS NOT NULL AND duration_seconds > 10
    GROUP BY app_id
    HAVING distinct_projects = 1 AND cnt >= ?1  -- domyślnie 5
)
```

**Logika**: Jeśli WSZYSTKIE dotychczasowe sesje danej aplikacji (np. Photoshopa) zostały przypisane do jednego projektu, i jest ich ≥5, system tworzy **regułę deterministyczną** — od tego momentu każda nowa sesja Photoshopa jest automatycznie przypisywana do tego projektu, BEZ udziału modelu AI.

**To jest uruchamiane automatycznie** w `background-helpers.ts:105`:
```typescript
const det = await aiApi.applyDeterministicAssignment();
```
Wywoływane PRZED AI auto-assignment, w każdym cyklu background.

### Przyczyna wspomagająca: brak `detected_path` dla Photoshopa

**Problem zbierania danych przez demona**:

W `monitor/wmi_detection.rs:302-331`, `extract_path_from_command_line()` próbuje wyciągnąć ścieżkę z linii poleceń procesu (WMI). Jednak Photoshop zazwyczaj:
- Nie otrzymuje ścieżki do pliku jako argument command-line (pliki otwierane przez GUI)
- Albo ścieżka jest w formacie, który `normalize_path_candidate()` odrzuca

Skutek: `detected_path` jest `None` dla większości sesji Photoshopa → **Layer 0 (file) nie generuje dowodów** → model opiera się głównie na Layer 1 (app), który jest jednokierunkowy.

### Przyczyna wspomagająca: dominacja Layer 1 (app model)

W `training.rs:132-161`, trening Layer 1 agreguje:
```sql
SELECT s.app_id, s.project_id, SUM(decay_weight * duration_factor) as cnt
FROM sessions s WHERE s.project_id IS NOT NULL
GROUP BY s.app_id, s.project_id
```

Jeśli Photoshop był 20× przypisany do projektu A i 2× do projektu B, Layer 1 daje ogromną przewagę projektowi A. Feedback (z `feedback_weight=5.0`) dodatkowo wzmacnia ten bias.

### Przyczyna wspomagająca: Photoshop = brak tokenów rozróżniających

W `context.rs:37-57`, tokenizer wyciąga tokeny z:
- `file_name` (ale Photoshop nie ma typowych plików jak IDE)
- `file_path`, `detected_path` (często `None`)
- `window_title` (np. `"projekt.psd @ 100% (RGB/8)"`)

Tytuł okna Photoshopa daje słabe sygnały:
- `"@"` jest separatorem, więc po lewej zostaje nazwa pliku PSD
- Jeśli użytkownik pracuje na różnych PSD, tokeny mogą się różnić, ale Layer 3 ma niską wagę (0.30) i wymaga match z danymi treningowymi

---

## Podsumowanie przyczyn

| # | Przyczyna | Wpływ | Typ |
|---|-----------|-------|-----|
| 0 | **AI nie korzysta z `project_folders`** — gotowa logika `infer_project_from_path()` istnieje, ale scoring jej nie wywołuje | **KRYTYCZNY** — najlepsza heurystyka jest niewykorzystana | Architektura |
| 1 | **Deterministic Assignment** automatycznie przypisuje wszystkie sesje aplikacji, która historycznie miała 1 projekt | **KRYTYCZNY** — omija cały model AI | Logika |
| 2 | Brak `detected_path` (WMI nie wyciąga ścieżki z Photoshopa) | WYSOKI — Layer 0 (file) nie działa | Zbieranie danych |
| 3 | Dominacja Layer 1 (app) po wielokrotnym ręcznym przypisaniu | ŚREDNI — self-reinforcing bias | Interpretacja |
| 4 | Słabe sygnały tokenowe z tytułów okien Photoshopa | NISKI — Layer 3 nie kompensuje | Zbieranie danych |

---

## Kluczowa luka: AI nie korzysta z project_folders

System posiada gotową infrastrukturę:
- **Tabela `project_folders`** — lista root-folderów projektów (np. `C:\Projects\`)
- **Funkcja `infer_project_from_path()`** w `projects.rs:230-268` — bierze ścieżkę pliku, sprawdza czy leży pod którymś `project_folder`, i zwraca nazwę projektu z pierwszego podfolderu
- **`ensure_app_project_from_file_hint()`** — resolves inferred name → `project_id`

**Te funkcje są używane TYLKO przy imporcie danych** (`import.rs`).

**Moduł AI (`assignment_model/`) w ogóle z nich nie korzysta** — zero odwołań do `project_folders`, `infer_project_from_path`, ani `assigned_folder_path`.

To oznacza, że nawet gdy Photoshop otwiera plik `C:\Projects\ClientX\banner.psd`, a `C:\Projects\` jest zarejestrowany jako project folder, AI tego **kompletnie ignoruje**. Zamiast tego polega na:
- Layer 0: `file_activities.project_id` (wymaga wcześniejszego ręcznego przypisania)
- Layer 1-3: historyczne statystyki (self-reinforcing)

### Wpływ na problem z Photoshopem

Photoshop ma `detected_path = None` (WMI nie wyciąga ścieżki), ale nawet gdyby miał `detected_path`, AI i tak by go nie wykorzystał do inferowania projektu — bo ta logika po prostu nie istnieje w module AI.

Natomiast `file_activities` **przechowuje** `detected_path` (gdy jest dostępne) i `file_path` (wyciągane z window_title) — te dane leżą w bazie, ale AI je tokenizuje zamiast porównywać z project_folders.

---

## Sugestie poprawek

### 0. [KRYTYCZNE] Dodać Layer oparty na project_folders (path-matching)

**Problem**: AI nie sprawdza `detected_path` / `file_path` / `window_title` względem `project_folders` — informacja jest w bazie, ale niewykorzystana.

**Rozwiązanie**: Dodać nową warstwę (Layer 0b) w `scoring.rs`, PRZED istniejącymi layers:

```rust
// Layer 0b: path-based project inference (project_folders)
// Sprawdza detected_path i file_path z file_activities
// względem project_folders → bezpośrednie przypisanie z wysoką wagą
let project_roots = load_project_folders_from_db(conn)?;
for file_activity in session_files {
    if let Some(path) = &file_activity.detected_path {
        if let Some(project_name) = infer_project_from_path(path, &project_roots) {
            // Resolve project_name → project_id
            // Dodaj do layer0 z wagą ~0.90 (wyższą niż obecne 0.80)
        }
    }
    // Analogicznie dla file_path (z window_title)
}
```

**Gdzie**: `context.rs:build_session_context()` — wzbogacić `file_project_weights` o projekty inferowane z path, nie tylko te z `file_activities.project_id`.

**Korzyść**: Dla Photoshopa z `detected_path = C:\Projects\ClientX\banner.psd` system natychmiast wie, że to projekt ClientX — bez potrzeby wcześniejszego ręcznego przypisania.

**Uwaga**: Wymaga też poprawy detection ścieżki dla Photoshopa (patrz punkt 2).

### 1. [KRYTYCZNE] Wyłączyć deterministic rules dla aplikacji wieloprojektowych

**Problem**: `deterministic_sync()` patrzy tylko na `COUNT(DISTINCT project_id)` w ISTNIEJĄCYCH przypisaniach. Jeśli użytkownik zaczął od jednego projektu, reguła „zamraża" tę aplikację.

**Rozwiązanie A** (minimalne): Dodać opcję wyłączenia deterministic assignment dla wybranych aplikacji (blacklista).

**Rozwiązanie B** (lepsze): Zmienić heurystykę tak, by nie tworzyła reguł dla aplikacji „ogólnego przeznaczenia" (design tools, browsery itp.):
```rust
// Nie twórz reguły deterministycznej jeśli aplikacja jest typu Design/Browsing
// — te aplikacje z natury obsługują wiele projektów
```

**Rozwiązanie C** (najlepsze): Dodać wymóg recency — reguła tylko jeśli sesje z ostatnich N dni nadal wskazują na 1 projekt:
```sql
HAVING distinct_projects = 1 AND cnt >= ?1
  AND date(MAX(start_time)) >= date('now', '-30 days')
```

### 2. [WAŻNE] Lepsze wyciąganie ścieżki z Photoshopa

**Problem**: `extract_path_from_command_line()` nie działa z Photoshopem.

**Rozwiązanie**: Parsować `window_title` Photoshopa jako dodatkowe źródło detected_path:
```
"projekt.psd @ 100% (RGB/8)" → extracted file: "projekt.psd"
```
W `monitor.rs:extract_file_from_title()` to już działa (separator `" @ "`), ale wynik trafia do `file_name`, nie do `detected_path`. Można rozszerzyć logikę:
- Jeśli `detected_path` jest `None` i window_title zawiera rozpoznawane rozszerzenie pliku (.psd, .ai, .blend), spróbować odzyskać informacje z title.

### 3. [ŚREDNIE] Decay bias w Layer 1

**Problem**: Historyczne przypisania akumulują się i tworzą self-reinforcing loop.

**Rozwiązanie**: W `training.rs`, dodać normalizację per-app — zamiast surowej sumy, użyć proporcji:
```
normalized_score = cnt_for_project / total_cnt_for_app
```
To zapobiegłoby sytuacji, gdzie 20 historycznych sesji dominuje 2 nowe.

### 4. [NISKIE] Lepsze tokeny dla aplikacji graficznych

Rozważyć dodanie nazwy pliku PSD (z window_title) jako silnego tokena w Layer 3, z wyższą wagą niż standardowe tokeny.

---

## Szybka naprawa (quick fix)

Najprostsze rozwiązanie bez zmian w kodzie:
1. **Reset knowledge** na stronie AI → wyczyści assignment_model_app/time/token
2. **Ręcznie przypisać** kilka sesji Photoshopa do RÓŻNYCH projektów
3. **Retrenować model** → teraz `deterministic_sync()` nie utworzy reguły (distinct_projects > 1)

Ale to obejście — problem wróci jeśli nowa aplikacja będzie miała podobny pattern.

---

## Rekomendowana kolejność implementacji

1. **Rozwiązanie 0** (Layer 0b: path-matching z project_folders) — największy impact, korzysta z istniejącej infrastruktury
2. **Rozwiązanie 1C** (recency w deterministic rules) — mała zmiana, duży efekt
3. **Rozwiązanie 2** (ścieżka z window_title dla Photoshopa) — poprawa jakości danych, synergia z #1
4. **Rozwiązanie 3** (normalizacja Layer 1) — zapobiega bias long-term
5. **Rozwiązanie 1B** (blacklista typów w deterministic) — dodatkowe zabezpieczenie
