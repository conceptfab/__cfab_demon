# PM Save Default View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zastąpić auto-zapis filtrów/sortowania na ekranie PM jawnym przyciskiem „zapisz domyślny widok" (jak na ekranie Projects) — z toastem potwierdzającym.

**Architecture:** Trwałość widoku wydzielona do nowego modułu `pm-view-defaults.ts` (`loadPmViewDefaults` / `savePmViewDefaults` + stałe kluczy localStorage). `PmProjectsList.tsx` inicjalizuje stan z `loadPmViewDefaults()` przez zwykłe `useState`, a zapis następuje tylko po kliknięciu dyskietki w toolbarze. Reużycie istniejących kluczy `timeflow-pm-*` zapewnia płynną migrację.

**Tech Stack:** React + TypeScript, react-i18next, vitest, lucide-react, localStorage.

**Spec:** `docs/superpowers/specs/2026-05-14-pm-save-default-view-design.md`

**Konwencje projektu:**
- vitest działa w środowisku **node** (brak jsdom/happy-dom) — `window` NIE istnieje domyślnie; testy muszą stubować `window` przez `vi.stubGlobal`.
- Komendy z katalogu `dashboard/`: `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm test`.
- i18n: te same klucze do `pl/common.json` i `en/common.json` (lint `lint:locales` sprawdza parzystość).
- Commity: prefiks `feat:` / `test:`, stopka `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Nowe:**
- `dashboard/src/components/pm/pm-view-defaults.ts` — typ `PmViewDefaults`, stałe kluczy, `loadPmViewDefaults()`, `savePmViewDefaults()`. Jeden cel: trwałość domyślnego widoku PM.
- `dashboard/src/components/pm/pm-view-defaults.test.ts` — testy vitest dla powyższego.

**Modyfikowane:**
- `dashboard/src/components/pm/PmProjectsList.tsx` — zamiana `usePersistedState` → `useState` z inicjalizacją z modułu; przycisk zapisu + toast.
- `dashboard/src/locales/pl/common.json`, `dashboard/src/locales/en/common.json` — klucze `pm.save_view_as_default`, `pm.messages.view_settings_saved`, `help_page.pm_feature_save_view`.
- `dashboard/src/components/help/sections/HelpSimpleSections.tsx` — wpis pomocy w `HelpPmSection`.

Brak nowych zależności.

---

## Task 1: Moduł `pm-view-defaults.ts` + testy (TDD)

**Files:**
- Create: `dashboard/src/components/pm/pm-view-defaults.ts`
- Test: `dashboard/src/components/pm/pm-view-defaults.test.ts`

- [ ] **Step 1: Write the failing tests**

Utwórz `dashboard/src/components/pm/pm-view-defaults.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPmViewDefaults,
  savePmViewDefaults,
  PM_VIEW_DEFAULTS,
  PM_VIEW_STORAGE_KEYS,
  type PmViewDefaults,
} from './pm-view-defaults';

function makeLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe('pm-view-defaults', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: makeLocalStorageMock() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns defaults when localStorage is empty', () => {
    expect(loadPmViewDefaults()).toEqual(PM_VIEW_DEFAULTS);
  });

  it('round-trips a saved view', () => {
    const view: PmViewDefaults = {
      filterYear: '26',
      filterClient: 'METRO',
      filterStatus: 'active',
      sortField: 'client',
      sortDir: 'asc',
    };
    savePmViewDefaults(view);
    expect(loadPmViewDefaults()).toEqual(view);
  });

  it('falls back on invalid sortField / sortDir, keeps other fields', () => {
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.year, '25');
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.sortField, 'bogus');
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.sortDir, 'sideways');
    const result = loadPmViewDefaults();
    expect(result.filterYear).toBe('25');
    expect(result.sortField).toBe('number');
    expect(result.sortDir).toBe('desc');
  });

  it('returns defaults when localStorage.getItem throws', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => { throw new Error('blocked'); } },
    });
    expect(loadPmViewDefaults()).toEqual(PM_VIEW_DEFAULTS);
  });

  it('savePmViewDefaults does not throw when setItem throws', () => {
    vi.stubGlobal('window', {
      localStorage: { setItem: () => { throw new Error('blocked'); } },
    });
    expect(() => savePmViewDefaults(PM_VIEW_DEFAULTS)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npx vitest run src/components/pm/pm-view-defaults.test.ts 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './pm-view-defaults'` (file doesn't exist yet).

- [ ] **Step 3: Implement the module**

Utwórz `dashboard/src/components/pm/pm-view-defaults.ts`:

```ts
import type { PmSortField } from '@/lib/pm-types';

export type PmSortDir = 'asc' | 'desc';

export interface PmViewDefaults {
  filterYear: string;
  filterClient: string;
  filterStatus: string;
  sortField: PmSortField;
  sortDir: PmSortDir;
}

/** localStorage keys — reused from the previous usePersistedState wiring for a smooth migration. */
export const PM_VIEW_STORAGE_KEYS = {
  year: 'timeflow-pm-filter-year',
  client: 'timeflow-pm-filter-client',
  status: 'timeflow-pm-filter-status',
  sortField: 'timeflow-pm-sort-field',
  sortDir: 'timeflow-pm-sort-dir',
} as const;

export const PM_VIEW_DEFAULTS: PmViewDefaults = {
  filterYear: '',
  filterClient: '',
  filterStatus: '',
  sortField: 'number',
  sortDir: 'desc',
};

const VALID_SORT_FIELDS: PmSortField[] = [
  'global', 'number', 'year', 'client', 'name', 'status',
];
const VALID_SORT_DIRS: PmSortDir[] = ['asc', 'desc'];

/** Read the saved default PM view from localStorage. Returns full defaults on any failure. */
export function loadPmViewDefaults(): PmViewDefaults {
  if (typeof window === 'undefined') return { ...PM_VIEW_DEFAULTS };
  try {
    const ls = window.localStorage;
    const sortFieldRaw = ls.getItem(PM_VIEW_STORAGE_KEYS.sortField);
    const sortDirRaw = ls.getItem(PM_VIEW_STORAGE_KEYS.sortDir);
    return {
      filterYear: ls.getItem(PM_VIEW_STORAGE_KEYS.year) ?? PM_VIEW_DEFAULTS.filterYear,
      filterClient: ls.getItem(PM_VIEW_STORAGE_KEYS.client) ?? PM_VIEW_DEFAULTS.filterClient,
      filterStatus: ls.getItem(PM_VIEW_STORAGE_KEYS.status) ?? PM_VIEW_DEFAULTS.filterStatus,
      sortField: VALID_SORT_FIELDS.includes(sortFieldRaw as PmSortField)
        ? (sortFieldRaw as PmSortField)
        : PM_VIEW_DEFAULTS.sortField,
      sortDir: VALID_SORT_DIRS.includes(sortDirRaw as PmSortDir)
        ? (sortDirRaw as PmSortDir)
        : PM_VIEW_DEFAULTS.sortDir,
    };
  } catch {
    return { ...PM_VIEW_DEFAULTS };
  }
}

/** Persist the given PM view as the default. Silently ignores localStorage failures. */
export function savePmViewDefaults(view: PmViewDefaults): void {
  if (typeof window === 'undefined') return;
  try {
    const ls = window.localStorage;
    ls.setItem(PM_VIEW_STORAGE_KEYS.year, view.filterYear);
    ls.setItem(PM_VIEW_STORAGE_KEYS.client, view.filterClient);
    ls.setItem(PM_VIEW_STORAGE_KEYS.status, view.filterStatus);
    ls.setItem(PM_VIEW_STORAGE_KEYS.sortField, view.sortField);
    ls.setItem(PM_VIEW_STORAGE_KEYS.sortDir, view.sortDir);
  } catch {
    // ignore storage failures
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard && npx vitest run src/components/pm/pm-view-defaults.test.ts 2>&1 | tail -15`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/pm/pm-view-defaults.ts dashboard/src/components/pm/pm-view-defaults.test.ts
git commit -m "$(cat <<'EOF'
feat: add pm-view-defaults module for explicit PM view persistence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `PmProjectsList.tsx` to explicit save

**Files:**
- Modify: `dashboard/src/components/pm/PmProjectsList.tsx`

- [ ] **Step 1: Update imports**

Replace line 1:
```tsx
import { useMemo, useState } from 'react';
```
with:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
```

Replace line 3:
```tsx
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Search, Monitor, Trophy, Euro, Pencil, LayoutDashboard } from 'lucide-react';
```
with:
```tsx
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Search, Monitor, Trophy, Euro, Pencil, LayoutDashboard, Save } from 'lucide-react';
```

Replace line 9:
```tsx
import { usePersistedState } from '@/hooks/usePersistedState';
```
with:
```tsx
import { AppTooltip } from '@/components/ui/app-tooltip';
import { loadPmViewDefaults, savePmViewDefaults } from './pm-view-defaults';
```

- [ ] **Step 2: Remove the obsolete STORAGE_KEY constants**

Replace this block (lines 91-97):
```tsx
const STORAGE_KEY_YEAR = 'timeflow-pm-filter-year';
const STORAGE_KEY_CLIENT = 'timeflow-pm-filter-client';
const STORAGE_KEY_STATUS = 'timeflow-pm-filter-status';
const STORAGE_KEY_SORT_FIELD = 'timeflow-pm-sort-field';
const STORAGE_KEY_SORT_DIR = 'timeflow-pm-sort-dir';

export function PmProjectsList
```
with:
```tsx
export function PmProjectsList
```

- [ ] **Step 3: Replace the state hooks**

Replace this block (lines 100-116):
```tsx
  // Search
  const [search, setSearch] = useState('');

  // Filters
  const [filterYear, setFilterYear] = usePersistedState(STORAGE_KEY_YEAR, '');
  const [filterClient, setFilterClient] = usePersistedState(STORAGE_KEY_CLIENT, '');
  const [filterStatus, setFilterStatus] = usePersistedState(STORAGE_KEY_STATUS, '');

  // Sort
  const [sortField, setSortField] = usePersistedState<PmSortField>(
    STORAGE_KEY_SORT_FIELD,
    'number',
  );
  const [sortDir, setSortDir] = usePersistedState<SortDir>(
    STORAGE_KEY_SORT_DIR,
    'desc',
  );
```
with:
```tsx
  // Search (never persisted)
  const [search, setSearch] = useState('');

  // Filters + sort — initialized from the saved default view, persisted only on explicit Save
  const initialView = useMemo(() => loadPmViewDefaults(), []);
  const [filterYear, setFilterYear] = useState(initialView.filterYear);
  const [filterClient, setFilterClient] = useState(initialView.filterClient);
  const [filterStatus, setFilterStatus] = useState(initialView.filterStatus);
  const [sortField, setSortField] = useState<PmSortField>(initialView.sortField);
  const [sortDir, setSortDir] = useState<SortDir>(initialView.sortDir);

  // Transient "view saved" confirmation
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const savedMsgTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedMsgTimeoutRef.current !== null) {
        window.clearTimeout(savedMsgTimeoutRef.current);
      }
    };
  }, []);
```

- [ ] **Step 4: Add the `handleSaveView` handler**

Find the `clearFilters` function (lines 191-196):
```tsx
  const clearFilters = () => {
    setSearch('');
    setFilterYear('');
    setFilterClient('');
    setFilterStatus('');
  };
```
Insert the new handler immediately AFTER it:
```tsx

  const handleSaveView = () => {
    savePmViewDefaults({ filterYear, filterClient, filterStatus, sortField, sortDir });
    setSavedMsg(t('pm.messages.view_settings_saved'));
    if (savedMsgTimeoutRef.current !== null) {
      window.clearTimeout(savedMsgTimeoutRef.current);
    }
    savedMsgTimeoutRef.current = window.setTimeout(() => {
      setSavedMsg(null);
      savedMsgTimeoutRef.current = null;
    }, 3000);
  };
```

- [ ] **Step 5: Add the Save button to the toolbar**

Find the clear-filters button block (lines 263-268):
```tsx
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={clearFilters}>
            <X className="mr-1 size-3" />
            {t('pm.filter.clear')}
          </Button>
        )}
      </div>
```
Replace it with (adds the Save button right after, before the toolbar's closing `</div>`):
```tsx
        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={clearFilters}>
            <X className="mr-1 size-3" />
            {t('pm.filter.clear')}
          </Button>
        )}

        <AppTooltip content={t('pm.save_view_as_default')}>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label={t('pm.save_view_as_default')}
            onClick={handleSaveView}
          >
            <Save className="size-3.5" />
          </Button>
        </AppTooltip>
      </div>
```

- [ ] **Step 6: Render the transient confirmation message**

Find the Count block (lines 271-276):
```tsx
      {/* Count */}
      {hasAnyFilter && (
        <p className="text-[10px] text-muted-foreground shrink-0">
          {t('pm.filter.showing')}: {displayed.length} / {projects.length}
        </p>
      )}
```
Insert immediately AFTER it:
```tsx

      {savedMsg && (
        <p className="text-[10px] text-green-400 shrink-0">{savedMsg}</p>
      )}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -15`
Expected: zero errors. (`t('pm.save_view_as_default')` / `t('pm.messages.view_settings_saved')` are plain string literals — tsc does not validate i18n keys; they are added in Task 3.)

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/pm/PmProjectsList.tsx
git commit -m "$(cat <<'EOF'
feat: explicit save-default-view button in PM projects list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: i18n keys + Help entry

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/components/help/sections/HelpSimpleSections.tsx`

- [ ] **Step 1: Add `pm.save_view_as_default` + `pm.messages` (PL)**

In `dashboard/src/locales/pl/common.json`, replace:
```json
      "search_placeholder": "Szukaj klienta, nazwy, kodu..."
    },
    "statusbar": {
```
with:
```json
      "search_placeholder": "Szukaj klienta, nazwy, kodu..."
    },
    "save_view_as_default": "Zapisz widok jako domyślny",
    "messages": {
      "view_settings_saved": "Ustawienia widoku zapisane jako domyślne"
    },
    "statusbar": {
```

- [ ] **Step 2: Add `help_page.pm_feature_save_view` (PL)**

In `dashboard/src/locales/pl/common.json`, replace:
```json
    "pm_feature_filters": "Filtry — filtruj listę projektów wg roku, klienta i statusu (aktywny / nieaktywny / zarchiwizowany).",
    "pm_feature_folder_size":
```
with:
```json
    "pm_feature_filters": "Filtry — filtruj listę projektów wg roku, klienta i statusu (aktywny / nieaktywny / zarchiwizowany).",
    "pm_feature_save_view": "Zapisz domyślny widok — przycisk dyskietki w pasku listy zapisuje bieżące filtry i sortowanie jako domyślny widok; bez kliknięcia zmiany nie są pamiętane po ponownym otwarciu.",
    "pm_feature_folder_size":
```

- [ ] **Step 3: Add `pm.save_view_as_default` + `pm.messages` (EN)**

In `dashboard/src/locales/en/common.json`, replace:
```json
      "search_placeholder": "Search client, name, code..."
    },
    "statusbar": {
```
with:
```json
      "search_placeholder": "Search client, name, code..."
    },
    "save_view_as_default": "Save view as default",
    "messages": {
      "view_settings_saved": "View settings saved as default"
    },
    "statusbar": {
```

- [ ] **Step 4: Add `help_page.pm_feature_save_view` (EN)**

In `dashboard/src/locales/en/common.json`, replace:
```json
    "pm_feature_filters": "Filters — filter the project list by year, client, and status (active / inactive / archived).",
    "pm_feature_folder_size":
```
with:
```json
    "pm_feature_filters": "Filters — filter the project list by year, client, and status (active / inactive / archived).",
    "pm_feature_save_view": "Save default view — the disk button in the list toolbar saves the current filters and sort as the default view; without clicking, changes are not remembered after reopening.",
    "pm_feature_folder_size":
```

- [ ] **Step 5: Add the Help entry to `HelpPmSection`**

In `dashboard/src/components/help/sections/HelpSimpleSections.tsx`, replace:
```tsx
        t18n('help_page.pm_feature_filters'),
        t18n('help_page.pm_feature_folder_size'),
```
with:
```tsx
        t18n('help_page.pm_feature_filters'),
        t18n('help_page.pm_feature_save_view'),
        t18n('help_page.pm_feature_folder_size'),
```

- [ ] **Step 6: Verify JSON validity and locale parity**

Run:
```bash
cd dashboard && node -e "JSON.parse(require('fs').readFileSync('src/locales/pl/common.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en/common.json','utf8')); console.log('JSON OK')" && npm run lint:locales 2>&1 | tail -8
```
Expected: `JSON OK` and `[locale-consistency] OK` (PL/EN parity holds).

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json dashboard/src/components/help/sections/HelpSimpleSections.tsx
git commit -m "$(cat <<'EOF'
feat: i18n keys + Help entry for PM save-default-view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Final verification

**Files:** none — verification only.

- [ ] **Step 1: Frontend typecheck**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -12`
Expected: zero errors.

- [ ] **Step 2: Frontend build**

Run: `cd dashboard && npm run build 2>&1 | tail -15`
Expected: `vite build` completes (bundle-size warnings acceptable).

- [ ] **Step 3: Lint (touched files)**

Run: `cd dashboard && npx eslint src/components/pm/pm-view-defaults.ts src/components/pm/pm-view-defaults.test.ts src/components/pm/PmProjectsList.tsx src/components/help/sections/HelpSimpleSections.tsx 2>&1 | tail -12`
Expected: clean (exit 0). Note: a full-repo `npm run lint` has ~44 pre-existing unrelated problems — only the touched files must be clean.

- [ ] **Step 4: Run the test suite**

Run: `cd dashboard && npm test 2>&1 | tail -15`
Expected: all vitest tests pass — the 18 pre-existing plus 5 new in `pm-view-defaults.test.ts` (23 total).

- [ ] **Step 5: Manual test scenario (for the user — describe in summary)**

1. Otwórz ekran PM → lista pokazuje ostatnio zapisany widok (lub domyślny przy pierwszym uruchomieniu).
2. Zmień rok/klienta/status/sortowanie → NIE klikaj dyskietki → przeładuj ekran → wraca poprzedni *zapisany* widok (nie niezapisana zmiana).
3. Ustaw widok → kliknij dyskietkę → pojawia się komunikat „Ustawienia widoku zapisane jako domyślne" na ~3 s → przeładuj → przywrócony nowy widok.
4. Kliknij „Wyczyść filtry" → przeładuj → nadal zapisany domyślny widok (Clear nic nie zapisał).
5. Wpisz coś w „Szukaj" → przeładuj → pole wyszukiwania puste (nigdy nie zapisywane).

---

## Self-Review

**1. Spec coverage:**
- „Zastąpić auto-zapis jawnym zapisem" → Task 2 Step 3 (`usePersistedState` → `useState`), Task 2 Step 4-5 (`handleSaveView` + przycisk).
- „Zakres: rok, klient, status, pole+kierunek sortowania; search ulotny" → `PmViewDefaults` (Task 1), `handleSaveView` przekazuje dokładnie te 5 pól; `search` pozostaje osobnym `useState('')`.
- „Reużycie kluczy `timeflow-pm-*`" → `PM_VIEW_STORAGE_KEYS` (Task 1) używa identycznych nazw.
- „Toast 3 s" → Task 2 Step 4 (`setTimeout(..., 3000)`), Step 6 (render).
- „Clear filters bez zmian" → blok `clearFilters` nietknięty; Task 2 Step 5 dodaje przycisk PO nim, nie modyfikując go.
- „Moduł `pm-view-defaults.ts` z load/save + walidacja + try/catch" → Task 1 Step 3.
- „i18n `pm.save_view_as_default`, `pm.messages.view_settings_saved`" → Task 3 Steps 1, 3.
- „Help — `HelpPmSection` + `help_page.pm_feature_save_view`" → Task 3 Steps 2, 4, 5.
- „Testy vitest: pusty LS, round-trip, fallback, wyjątki" → Task 1 Step 1 (5 testów).
- Edge: brak zapisu → defaulty; niepoprawny sortField/sortDir → fallback; localStorage rzuca → defaulty/no-op — wszystkie pokryte testami w Task 1.

**2. Placeholder scan:** Brak „TBD/TODO/handle edge cases" — każdy krok ma pełny kod lub konkretną komendę z oczekiwanym wynikiem.

**3. Type consistency:**
- `PmViewDefaults` (Task 1) — pola `filterYear/filterClient/filterStatus: string`, `sortField: PmSortField`, `sortDir: PmSortDir`. `handleSaveView` (Task 2) buduje obiekt z tych samych 5 pól; `loadPmViewDefaults()` zwraca ten typ, używany do inicjalizacji `useState`.
- `PmSortDir` ('asc'|'desc') z modułu jest strukturalnie identyczny z lokalnym `type SortDir` w `PmProjectsList.tsx` (linia 47, pozostaje bez zmian) — przypisania `initialView.sortDir` → `useState<SortDir>` i `sortDir` → `savePmViewDefaults` są poprawne dzięki strukturalnemu typowaniu.
- `loadPmViewDefaults` / `savePmViewDefaults` — sygnatury spójne między Task 1 (definicja), Task 1 testem i Task 2 (wywołania).
- Klucze i18n `pm.save_view_as_default`, `pm.messages.view_settings_saved` — używane w Task 2, definiowane w Task 3 (PL+EN).
- `help_page.pm_feature_save_view` — definiowany w Task 3 Steps 2/4, używany w Task 3 Step 5.

**Uwaga wykonawcza:** Task 2 odwołuje się do kluczy i18n dodawanych w Task 3 — to tylko literały stringów, nie łamie `tsc`/`build`. Kolejność Task 1 → 2 → 3 → 4.
