# Plan implementacji: Mrożenie projektów

## Cel funkcjonalny

Projekt, który przez określony czas (domyślnie 14 dni) nie pojawia się w statystykach, automatycznie przechodzi w **tryb zamrożenia**. Efekty mrożenia:

- Projekt wyświetla się na liście Projects ze specjalną ikoną śnieżynki
- Projekt **nie pojawia się** na listach przyporządkowania sesji
- Projekt **nadal figuruje** w historycznych statystykach i wykresach
- Projekt można ręcznie odmrozić lub automatycznie — kiedy pojawi się nowa aktywność

Różnica względem **wykluczenia** (excluded):
| Cecha | Zamrożony | Wykluczony |
|---|---|---|
| Widoczny w Projects | TAK (ze śnieżynką) | TAK (w sekcji Excluded) |
| W listach przyporządkowania | NIE | NIE |
| W statystykach | TAK | NIE |
| Powiązane aplikacje | zachowane | odpinane |
| Blacklist nazwy | NIE | TAK |

---

## Zakres zmian

### 1. Backend — Rust / Tauri

**Pliki do modyfikacji:**
- `dashboard/src-tauri/src/db.rs`
- `dashboard/src-tauri/src/commands/projects.rs`
- `dashboard/src-tauri/src/commands/sessions.rs`
- `dashboard/src-tauri/src/commands/manual_sessions.rs`
- `dashboard/src-tauri/src/commands/analysis.rs`

**Pliki do dodania:**
- (brak nowych plików — zmiany w istniejących)

---

### 2. Frontend — React / TypeScript

**Pliki do modyfikacji:**
- `dashboard/src/lib/db-types.ts`
- `dashboard/src/lib/tauri.ts`
- `dashboard/src/pages/Projects.tsx`
- `dashboard/src/components/ManualSessionDialog.tsx`
- `dashboard/src/pages/Sessions.tsx`

---

## Kroki implementacji

---

### KROK 1 — Migracja bazy danych

**Plik:** `dashboard/src-tauri/src/db.rs`

Dodać kolumnę `frozen_at` do tabeli `projects`:

```sql
ALTER TABLE projects ADD COLUMN frozen_at TEXT DEFAULT NULL;
```

Wzorzec migracji już istnieje w projekcie — dodać kolejny blok `db.execute(...)` w funkcji inicjalizującej schemat lub w bloku migracji. Kolumna jest nullable — `NULL` oznacza projekt aktywny, timestamp oznacza datę zamrożenia.

**Uwaga:** Sprawdzić czy projekt używa wersjonowania schematu (`PRAGMA user_version`). Jeśli tak — inkrementować wersję i dodać migrację warunkową:
```sql
-- Uruchamiać tylko raz, gdy kolumna nie istnieje
ALTER TABLE projects ADD COLUMN frozen_at TEXT DEFAULT NULL;
```

---

### KROK 2 — Typ danych TypeScript

**Plik:** `dashboard/src/lib/db-types.ts`

Dodać pole `frozen_at` do interfejsu `Project`:

```typescript
export interface Project {
  id: number
  name: string
  color: string
  hourly_rate?: number | null
  created_at: string
  excluded_at?: string | null
  frozen_at?: string | null        // NOWE POLE
  assigned_folder_path?: string | null
  is_imported: number
}
```

Pole `frozen_at` dziedziczy `ProjectWithStats` automatycznie (rozszerza `Project`).

---

### KROK 3 — Nowe komendy Tauri (Backend)

**Plik:** `dashboard/src-tauri/src/commands/projects.rs`

#### 3a. Ręczne zamrożenie projektu

```rust
#[tauri::command]
pub async fn freeze_project(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.execute(
        "UPDATE projects SET frozen_at = datetime('now') WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```

#### 3b. Ręczne odmrożenie projektu

```rust
#[tauri::command]
pub async fn unfreeze_project(
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.execute(
        "UPDATE projects SET frozen_at = NULL WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
```

#### 3c. Automatyczne mrożenie i odmrażanie

```rust
#[tauri::command]
pub async fn auto_freeze_projects(
    state: State<'_, AppState>,
    threshold_days: Option<i64>,   // None = domyślnie 14 dni
) -> Result<AutoFreezeResult, String> {
    let days = threshold_days.unwrap_or(14);
    let db = state.db.lock().await;

    // Zamroź projekty bez aktywności przez N dni
    // last_activity pobierane z get_projects() — tu liczymy inline
    let frozen = db.execute(
        "UPDATE projects
         SET frozen_at = datetime('now')
         WHERE excluded_at IS NULL
           AND frozen_at IS NULL
           AND id NOT IN (
               SELECT DISTINCT p.id FROM projects p
               LEFT JOIN applications a ON a.project_id = p.id
               LEFT JOIN sessions s ON s.application_id = a.id
                 AND s.end_time >= datetime('now', '-' || ?1 || ' days')
               LEFT JOIN manual_sessions ms ON ms.project_id = p.id
                 AND ms.end_time >= datetime('now', '-' || ?1 || ' days')
               WHERE s.id IS NOT NULL OR ms.id IS NOT NULL
           )",
        params![days],
    ).map_err(|e| e.to_string())?;

    // Odmroź projekty, które znowu mają aktywność
    let unfrozen = db.execute(
        "UPDATE projects
         SET frozen_at = NULL
         WHERE frozen_at IS NOT NULL
           AND id IN (
               SELECT DISTINCT p.id FROM projects p
               LEFT JOIN applications a ON a.project_id = p.id
               LEFT JOIN sessions s ON s.application_id = a.id
                 AND s.end_time >= datetime('now', '-' || ?1 || ' days')
               LEFT JOIN manual_sessions ms ON ms.project_id = p.id
                 AND ms.end_time >= datetime('now', '-' || ?1 || ' days')
               WHERE s.id IS NOT NULL OR ms.id IS NOT NULL
           )",
        params![days],
    ).map_err(|e| e.to_string())?;

    Ok(AutoFreezeResult {
        frozen_count: frozen as i64,
        unfrozen_count: unfrozen as i64,
    })
}

#[derive(Serialize)]
pub struct AutoFreezeResult {
    pub frozen_count: i64,
    pub unfrozen_count: i64,
}
```

#### 3d. Modyfikacja `get_projects()`

Dodać `frozen_at` do SELECT w istniejącym zapytaniu:

```sql
-- W istniejącym zapytaniu get_projects dodać do SELECT:
p.frozen_at,
```

Upewnić się, że `get_projects()` zwraca zarówno zamrożone, jak i aktywne projekty (filtr `excluded_at IS NULL` pozostaje, `frozen_at IS NULL` **NIE** jest filtrowany).

---

### KROK 4 — Rejestracja komend w Tauri

**Plik:** `dashboard/src-tauri/src/main.rs` (lub `lib.rs`)

Dodać nowe komendy do `.invoke_handler(tauri::generate_handler![...])`:

```rust
freeze_project,
unfreeze_project,
auto_freeze_projects,
```

---

### KROK 5 — Wykluczenie zamrożonych projektów z przyporządkowania

#### 5a. Manual Sessions

**Plik:** `dashboard/src-tauri/src/commands/manual_sessions.rs`

Przy tworzeniu/edycji sesji manualnej — opcjonalnie walidować, że `project_id` nie jest zamrożony. Alternatywnie: frontendowy select nie pokaże zamrożonych, ale backend może pominąć walidację dla uproszczenia.

#### 5b. Przyporządkowanie sesji

**Plik:** `dashboard/src-tauri/src/commands/sessions.rs` (komenda `assign_session_to_project`)

Opcjonalnie — walidacja na backendzie. Główne zabezpieczenie po stronie frontendu (filtrowanie listy projektów).

---

### KROK 6 — Wrapper Tauri w TypeScript

**Plik:** `dashboard/src/lib/tauri.ts`

Dodać nowe funkcje:

```typescript
export async function freezeProject(id: number): Promise<void> {
  return invoke('freeze_project', { id })
}

export async function unfreezeProject(id: number): Promise<void> {
  return invoke('unfreeze_project', { id })
}

export async function autoFreezeProjects(thresholdDays?: number): Promise<{
  frozen_count: number
  unfrozen_count: number
}> {
  return invoke('auto_freeze_projects', {
    thresholdDays: thresholdDays ?? null,
  })
}
```

---

### KROK 7 — Widok Projects.tsx

**Plik:** `dashboard/src/pages/Projects.tsx`

#### 7a. Wywoływanie auto-freeze przy wejściu na stronę

```typescript
useEffect(() => {
  autoFreezeProjects().then(({ frozen_count, unfrozen_count }) => {
    if (frozen_count > 0 || unfrozen_count > 0) {
      triggerRefresh()
    }
  })
}, [])
```

#### 7b. Ikona śnieżynki w widoku kompaktowym i kartach

W renderowaniu każdego projektu — dodać warunkowy element obok nazwy:

```tsx
{project.frozen_at && (
  <span title={`Zamrożony od ${formatDate(project.frozen_at)}`}>
    ❄️  {/* lub komponent ikony Snowflake z lucide-react */}
  </span>
)}
```

Zalecana ikona: `Snowflake` z `lucide-react` (już używane w projekcie).

#### 7c. Przyciski akcji dla zamrożonego projektu

W menu kontekstowym / zestawie przycisków dla projektu:

```tsx
{project.frozen_at ? (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => handleUnfreeze(project.id)}
    title="Odmroź projekt"
  >
    <Flame className="h-4 w-4" />
    Odmroź
  </Button>
) : (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => handleFreeze(project.id)}
    title="Zamroź projekt"
  >
    <Snowflake className="h-4 w-4" />
    Zamroź
  </Button>
)}
```

#### 7d. Handlery akcji

```typescript
const handleFreeze = async (id: number) => {
  await freezeProject(id)
  triggerRefresh()
}

const handleUnfreeze = async (id: number) => {
  await unfreezeProject(id)
  triggerRefresh()
}
```

#### 7e. Wizualne wyróżnienie zamrożonych projektów

Zamrożone projekty:
- Lekki niebieski tint tła karty (np. `bg-blue-50 dark:bg-blue-950/20`)
- Subtelny border niebieski (`border-blue-200 dark:border-blue-800`)
- Ikona śnieżynki przy nazwie (niebieska, `text-blue-400`)
- Tooltip z datą zamrożenia i informacją że nie pojawia się w listach

---

### KROK 8 — Filtrowanie w ManualSessionDialog

**Plik:** `dashboard/src/components/ManualSessionDialog.tsx`

Odfiltrować zamrożone projekty z listy SelectItem:

```typescript
// Zamiast:
{projects.map((p) => (...))}

// Używać:
{projects
  .filter((p) => !p.frozen_at)
  .map((p) => (...))}
```

---

### KROK 9 — Filtrowanie w Sessions.tsx

**Plik:** `dashboard/src/pages/Sessions.tsx`

W dropdownie filtrowania sesji po projekcie — odfiltrować zamrożone projekty:

```typescript
.filter((p) => !p.frozen_at)
```

---

### KROK 10 — Ustawienie progu mrożenia

Projekt już ma ustalony wzorzec dla ustawień użytkownika: `user-settings.ts` + `localStorage`.
Czas mrożenia ustawiamy w dwóch miejscach.

#### 10a. Dodać do `dashboard/src/lib/user-settings.ts`

```typescript
export interface FreezeSettings {
  thresholdDays: number   // liczba dni bez aktywności → zamrożenie
}

const FREEZE_STORAGE_KEY = "timeflow.settings.freeze"

export const DEFAULT_FREEZE_SETTINGS: FreezeSettings = {
  thresholdDays: 14,
}

function normalizeThresholdDays(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_FREEZE_SETTINGS.thresholdDays
  }
  return Math.min(365, Math.max(1, Math.round(value)))
}

export function loadFreezeSettings(): FreezeSettings {
  if (typeof window === "undefined") return { ...DEFAULT_FREEZE_SETTINGS }
  try {
    const raw = window.localStorage.getItem(FREEZE_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_FREEZE_SETTINGS }
    const parsed = JSON.parse(raw)
    return {
      thresholdDays: normalizeThresholdDays(parsed.thresholdDays),
    }
  } catch {
    return { ...DEFAULT_FREEZE_SETTINGS }
  }
}

export function saveFreezeSettings(next: FreezeSettings): FreezeSettings {
  const normalized: FreezeSettings = {
    thresholdDays: normalizeThresholdDays(next.thresholdDays),
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FREEZE_STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}
```

#### 10b. Dodać kontrolkę w `dashboard/src/pages/Settings.tsx`

Istniejąca strona Settings ma sekcje (Working Hours, Sessions, itd.).
Dodać nową sekcję "Projekty" lub "Zamrażanie projektów":

```tsx
// Import na górze pliku:
import {
  loadFreezeSettings,
  saveFreezeSettings,
  DEFAULT_FREEZE_SETTINGS,
} from "@/lib/user-settings"

// Stan lokalny w komponencie:
const [freezeSettings, setFreezeSettings] = useState(loadFreezeSettings)

// Handler zapisu:
const handleFreezeSettingsSave = () => {
  saveFreezeSettings(freezeSettings)
  // opcjonalnie: toast("Zapisano")
}

// JSX — nowa sekcja w formularzu ustawień:
<section>
  <h3 className="text-sm font-medium">Zamrażanie projektów</h3>
  <p className="text-xs text-muted-foreground mb-3">
    Projekt bez aktywności przez podany czas zostanie automatycznie zamrożony
    i zniknie z list przyporządkowania sesji.
  </p>
  <div className="flex items-center gap-3">
    <label className="text-sm">Próg nieaktywności (dni)</label>
    <Input
      type="number"
      min={1}
      max={365}
      value={freezeSettings.thresholdDays}
      onChange={(e) =>
        setFreezeSettings((prev) => ({
          ...prev,
          thresholdDays: Number(e.target.value),
        }))
      }
      className="w-24"
    />
    <Button size="sm" onClick={handleFreezeSettingsSave}>
      Zapisz
    </Button>
  </div>
</section>
```

#### 10c. Użycie w `Projects.tsx`

```typescript
import { loadFreezeSettings } from "@/lib/user-settings"

// W useEffect auto-freeze:
useEffect(() => {
  const { thresholdDays } = loadFreezeSettings()
  autoFreezeProjects(thresholdDays).then(({ frozen_count, unfrozen_count }) => {
    if (frozen_count > 0 || unfrozen_count > 0) {
      triggerRefresh()
    }
  })
}, [])

---

## Kolejność wdrożenia

1. `db.rs` — migracja (frozen_at column)
2. `projects.rs` — freeze_project, unfreeze_project, auto_freeze_projects + frozen_at w get_projects()
3. `main.rs` — rejestracja komend
4. `db-types.ts` — frozen_at w interfejsie Project
5. `tauri.ts` — wrappers freezeProject, unfreezeProject, autoFreezeProjects
6. `user-settings.ts` — FreezeSettings, loadFreezeSettings, saveFreezeSettings
7. `Settings.tsx` — kontrolka progu mrożenia
8. `Projects.tsx` — auto-freeze on load, ikona, przyciski
9. `ManualSessionDialog.tsx` — filtr
10. `Sessions.tsx` — filtr w dropdownie

---

## Zależności i ryzyka

| Ryzyko | Opis | Mitigacja |
|---|---|---|
| Migracja bazy | Istniejące bazy bez kolumny `frozen_at` | Użyć `ALTER TABLE ... ADD COLUMN` z DEFAULT NULL — bezpieczne dla SQLite |
| Demo DB | Projekt ma osobną bazę demo | Migracja musi objąć obie bazy (sprawdzić logikę inicjalizacji w `db.rs`) |
| `last_activity` NULL | Projekty nigdy nieużywane — brak dat aktywności | Dla projektów bez aktywności od dnia stworzenia liczyć od `created_at` |
| Brak tłumaczeń | Projekt może używać i18n | Sprawdzić czy istnieje system tłumaczeń; jeśli tak — dodać klucze |
| Ikona Snowflake | Lucide-react musi ją eksportować | Sprawdzić import: `import { Snowflake } from 'lucide-react'` |

---

## Podsumowanie rozmiaru zmian

- **Pliki backendu (Rust):** 2–3 pliki, ~60–80 linii nowego kodu
- **Pliki frontendu (TypeScript/React):** 4–5 plików, ~50–70 linii zmian
- **Migracja DB:** 1 linijka SQL
- **Łącznie:** ~130–150 linii, brak nowych plików
