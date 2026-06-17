# Raport estymacji per klient — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** W panelu Estymacje dodać filtr klientów (multi-select + „bez klienta") i generowanie uproszczonego raportu w dwóch wariantach (uproszczony: projekty+czas+wartość; plus: projekty+dni z godzinami), z zaokrągleniami jak w innych ekranach i szablonami w edytorze szablonów raportów.

**Architecture:**
- Dane raportu i filtra pochodzą z istniejącego RPC `get_project_estimates(dateRange)` → `EstimateProjectRow[]`. RPC rozszerzamy o dwa pola: `client_name` (do filtra/segmentacji) oraz `days` (rozbicie czasu na dni z ETYKIETAMI DAT — `daily_seconds` jest bez dat, więc nie wystarcza dla wariantu „plus"). To jedyna zmiana w backendzie Rust; reszta to frontend.
- Warianty raportu = szablony estymacji. `ReportTemplate` dostaje pole `kind: 'project' | 'estimate'`. Seedujemy dwa domyślne szablony estymacji (`estimate-simple`, `estimate-plus`). Wybór wariantu na ekranie estymacji = wybór szablonu estymacji (selektor jak obecny, ale filtrowany do `kind==='estimate'`). Edytor szablonów przełącza listę sekcji wg `kind`.
- Renderowanie: nowa strona `estimate-report` (mirror `report-view`): pobiera estymacje wg zapisanego configu (klienci+zakres+szablon), składa model przez czystą funkcję `buildEstimateReportModel` (zaokrąglenia z `lib/rounding.ts`), drukuje przez `window.print()` + CSS.

**Tech Stack:** React + TypeScript + Zustand (`ui-store`/`data-store`/`settings-store`), Tauri (Rust `commands/estimates.rs`), i18next (locale `pl`/`en`), Vitest, react-i18next. Lint pilnuje parytetu kluczy locale i braku hardcoded stringów w JSX (wszystko przez `t()`).

---

## File Structure

Backend (Rust):
- Modify `dashboard/src-tauri/src/commands/types.rs` — nowy `EstimateDay`, pola `client_name`+`days` w `EstimateProjectRow`.
- Modify `dashboard/src-tauri/src/commands/time_algorithm.rs` — nowy helper `daily_buckets_by_series`.
- Modify `dashboard/src-tauri/src/commands/estimates.rs` — `client_name` w meta projektów, wpięcie `days`, test schema + nowy test.

Frontend — typy i logika:
- Modify `dashboard/src/lib/db-types.ts` — mirror `EstimateDay`, pola w `EstimateProjectRow`.
- Create `dashboard/src/lib/estimate-report.ts` — czyste funkcje: filtr klientów + budowa modelu raportu z zaokrągleniami.
- Create `dashboard/src/lib/estimate-report.test.ts` — testy jednostkowe.
- Modify `dashboard/src/lib/report-templates.ts` — `kind`, seed szablonów estymacji.
- Create `dashboard/src/lib/report-templates.test.ts` — testy seedu/back-compat.

Frontend — szablony/edytor:
- Create `dashboard/src/pages/reports/estimate-report-sections.tsx` — rejestr `ESTIMATE_REPORT_SECTIONS`.
- Modify `dashboard/src/pages/reports/reports-page-constants.ts` — `ESTIMATE_DEFAULT_SECTION_IDS`.
- Modify `dashboard/src/hooks/useReportsPageController.ts` — rejestr sekcji wg `kind`, nowy szablon dziedziczy `kind`.

Frontend — routing/stan:
- Modify `dashboard/src/store/ui-store.ts` — `estimateReport` config + setter.
- Modify `dashboard/src/App.tsx` — route `estimate-report` + `showChrome`.

Frontend — ekran estymacji:
- Create `dashboard/src/components/estimates/EstimatesClientFilter.tsx` — multi-select klientów.
- Create `dashboard/src/components/estimates/EstimatesReportButton.tsx` — przycisk + selektor szablonu.
- Modify `dashboard/src/hooks/useEstimatesPageController.ts` — stan filtra, filtrowane wiersze i metryki, nawigacja do raportu.
- Modify `dashboard/src/pages/EstimatesView.tsx` — osadzenie filtra+przycisku, metryki z filtrowanych danych.

Frontend — widok raportu:
- Create `dashboard/src/hooks/useEstimateReportController.ts` — kontroler raportu estymacji.
- Create `dashboard/src/pages/estimate-report/EstimateReportPage.tsx` — layout.
- Create `dashboard/src/pages/estimate-report/EstimateReportToolbar.tsx` — wstecz + full/rounded + print.
- Create `dashboard/src/pages/estimate-report/EstimateReportDocument.tsx` — sekcje (header/summary/per-day/footer).
- Create `dashboard/src/pages/EstimateReport.tsx` — entry (mirror `ReportView.tsx`).

i18n / Help:
- Modify `dashboard/src/locales/pl/common.json` + `dashboard/src/locales/en/common.json`.
- Modify `dashboard/src/pages/Help.tsx`.

---

## Task 1: Backend — `client_name` + `days` w wierszu estymacji

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs:213-231`
- Modify: `dashboard/src-tauri/src/commands/time_algorithm.rs:213` (dodanie helpera obok `daily_seconds_by_series`)
- Modify: `dashboard/src-tauri/src/commands/estimates.rs` (linie 11, 15, 58-80, 191-280, schema testów ~378, nowy test)

- [ ] **Step 1: Dodaj typ `EstimateDay` i pola do `EstimateProjectRow` w `types.rs`**

W `types.rs` tuż przed `pub struct EstimateProjectRow {` (linia 214) dodaj nowy typ:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct EstimateDay {
    pub date: String,
    pub seconds: i64,
}
```

Wewnątrz `pub struct EstimateProjectRow { ... }`, po polu `pub daily_seconds: Vec<i64>,` dodaj:

```rust
    /// Klient przypisany do projektu (po `projects.client_name`) — do filtra klientów
    /// w panelu Estymacje i raportu per klient. `None` = projekt bez klienta.
    pub client_name: Option<String>,
    /// Rozbicie czasu na dni z ETYKIETAMI DAT (YYYY-MM-DD), chronologicznie. Dla raportu
    /// estymacji w wariancie „plus" (projekt → dni z godzinami). Pomija dni z 0 s.
    pub days: Vec<EstimateDay>,
```

- [ ] **Step 2: Dodaj helper `daily_buckets_by_series` w `time_algorithm.rs`**

Bezpośrednio po funkcji `daily_seconds_by_series` (kończy się w okolicy linii 226) dodaj:

```rust
/// Jak `daily_seconds_by_series`, ale zachowuje ETYKIETY DAT (YYYY-MM-DD). Do raportu
/// estymacji w wariancie „plus" (projekt → dni z godzinami). Wektor jest chronologiczny,
/// bo `BucketDurations` (BTreeMap) iteruje klucze dat rosnąco. Pomija dni z 0 s.
pub(crate) fn daily_buckets_by_series(
    bucket_project_seconds: &BucketDurations,
) -> HashMap<String, Vec<(String, i64)>> {
    let mut out: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (date_key, day_map) in bucket_project_seconds {
        for (series_key, secs) in day_map {
            let s = secs.round() as i64;
            if s > 0 {
                out.entry(series_key.clone())
                    .or_default()
                    .push((date_key.clone(), s));
            }
        }
    }
    out
}
```

- [ ] **Step 3: Zaktualizuj importy i meta projektów w `estimates.rs`**

W bloku `use super::types::{...}` (linia 11) dodaj `EstimateDay`:

```rust
use super::types::{DateRange, EstimateDay, EstimateProjectRow, EstimateSettings, EstimateSummary};
```

Dodaj import helpera (nowa linia obok pozostałych `use super::...`):

```rust
use super::time_algorithm::daily_buckets_by_series;
```

Zmień alias typu meta (linia 15) — dołóż `Option<String>` (client_name):

```rust
type ProjectMetaRow = (i64, String, String, Option<f64>, Option<String>);
```

W `query_project_meta` (linie 58-80) zmień SQL i mapowanie wiersza:

```rust
fn query_project_meta(conn: &rusqlite::Connection) -> Result<ProjectMetaById, String> {
    let mut stmt = conn
        .prepare_cached("SELECT id, name, color, hourly_rate, client_name FROM projects")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let rate: Option<f64> = row.get(3)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                rate.and_then(sanitize_rate),
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let row = row.map_err(|e| format!("Failed to read project metadata row: {}", e))?;
        out.insert(row.0, row);
    }
    Ok(out)
}
```

- [ ] **Step 4: Wepnij `client_name` + `days` w `build_estimate_rows`**

Po linii `let mut daily_by_series = daily_seconds_by_series(&bucket_project_seconds);` (linia 214) dodaj:

```rust
    let mut daily_buckets = daily_buckets_by_series(&bucket_project_seconds);
```

Zmień destrukturyzację meta (linia 230) na 5-elementową:

```rust
        let Some((project_id, mapped_name, project_color, project_hourly_rate, client_name)) =
            project_meta.get(&project_id)
        else {
```

W `rows.push(EstimateProjectRow { ... })` (linie 252-266) po polu `daily_seconds: ...` dodaj:

```rust
            client_name: client_name.clone(),
            days: daily_buckets
                .remove(&series_key)
                .unwrap_or_default()
                .into_iter()
                .map(|(date, seconds)| EstimateDay { date, seconds })
                .collect(),
```

- [ ] **Step 5: Dodaj kolumnę `client_name` do schematu testowego**

W `setup_conn` (test, `CREATE TABLE projects (...)`, ~linia 378-387) dodaj kolumnę `client_name` przed `excluded_at`:

```rust
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                hourly_rate REAL,
                client_name TEXT,
                excluded_at TEXT,
                frozen_at TEXT,
                merged_into TEXT,
                merged_at TEXT
            );
```

- [ ] **Step 6: Napisz test `days` + `client_name`**

Dodaj nowy test na końcu modułu `tests` (przed zamykającym `}` modułu, ~linia 680):

```rust
    #[test]
    fn estimate_rows_expose_days_with_dates_and_client() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO estimate_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params!["global_hourly_rate", "100"],
        )
        .expect("insert setting");
        conn.execute(
            "INSERT INTO projects (id, name, color, hourly_rate, client_name) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![1i64, "Acme work", "#111111", Option::<f64>::None, "Acme"],
        )
        .expect("insert project");
        // 10 min on 2026-01-04, 1h05m on 2026-01-05.
        conn.execute_batch(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (1, '2026-01-04T09:00:00', '2026-01-04T09:10:00', 600, '2026-01-04', 1, 0);
             INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (1, '2026-01-05T09:00:00', '2026-01-05T10:05:00', 3900, '2026-01-05', 1, 0);",
        )
        .expect("insert sessions");

        let rows = build_estimate_rows(
            &conn,
            &DateRange {
                start: "2026-01-04".to_string(),
                end: "2026-01-05".to_string(),
            },
        )
        .expect("estimate rows");

        let row = rows.first().expect("row");
        assert_eq!(row.client_name.as_deref(), Some("Acme"));
        let days: Vec<(String, i64)> =
            row.days.iter().map(|d| (d.date.clone(), d.seconds)).collect();
        assert_eq!(
            days,
            vec![
                ("2026-01-04".to_string(), 600),
                ("2026-01-05".to_string(), 3900),
            ],
            "days must carry chronological date labels"
        );
    }
```

- [ ] **Step 7: Uruchom testy Rust**

Run: `cd dashboard/src-tauri && cargo test --lib commands::estimates`
Expected: PASS (wszystkie testy estymacji, w tym nowy `estimate_rows_expose_days_with_dates_and_client`).

- [ ] **Step 8: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs dashboard/src-tauri/src/commands/time_algorithm.rs dashboard/src-tauri/src/commands/estimates.rs
git commit -m "feat(estimates): expose client_name + dated day buckets in estimate rows"
```

---

## Task 2: Mirror typów w TypeScript

**Files:**
- Modify: `dashboard/src/lib/db-types.ts:266-281`

- [ ] **Step 1: Dodaj `EstimateDay` i pola w `EstimateProjectRow`**

W `db-types.ts` przed `export interface EstimateProjectRow {` (linia 266) dodaj:

```typescript
export interface EstimateDay {
  date: string;
  seconds: number;
}
```

Wewnątrz `EstimateProjectRow`, po `daily_seconds: number[];` (linia 280) dodaj:

```typescript
  /** Klient projektu (po `projects.client_name`); null = bez klienta. */
  client_name: string | null;
  /** Rozbicie czasu na dni z etykietami dat (YYYY-MM-DD), chronologicznie. */
  days: EstimateDay[];
```

- [ ] **Step 2: Sprawdź typecheck**

Run: `cd dashboard && npx tsc -b`
Expected: PASS (brak błędów typów; nowe pola opcjonalnie nieużywane jeszcze).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/db-types.ts
git commit -m "feat(estimates): mirror client_name + days in TS estimate row type"
```

---

## Task 3: Czysta logika modelu raportu estymacji

**Files:**
- Create: `dashboard/src/lib/estimate-report.ts`
- Test: `dashboard/src/lib/estimate-report.test.ts`

- [ ] **Step 1: Napisz testy (failing)**

Utwórz `dashboard/src/lib/estimate-report.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  NO_CLIENT_KEY,
  buildEstimateReportModel,
  clientFilterOptions,
  filterRowsByClients,
} from '@/lib/estimate-report';
import type { EstimateProjectRow } from '@/lib/db-types';
import type { RoundingSettings } from '@/lib/rounding';

function row(partial: Partial<EstimateProjectRow>): EstimateProjectRow {
  return {
    project_id: 1,
    project_name: 'P',
    project_color: '#111',
    seconds: 3600,
    hours: 1,
    weighted_hours: 1,
    project_hourly_rate: null,
    effective_hourly_rate: 100,
    estimated_value: 100,
    session_count: 1,
    multiplied_session_count: 0,
    multiplier_extra_seconds: 0,
    daily_seconds: [3600],
    client_name: null,
    days: [{ date: '2026-01-01', seconds: 3600 }],
    ...partial,
  };
}

const OFF: RoundingSettings = { enabled: false, intervalMinutes: 15, mode: 'per_total' };
const PER_DAY: RoundingSettings = { enabled: true, intervalMinutes: 60, mode: 'per_day' };

describe('clientFilterOptions', () => {
  it('returns sorted distinct clients and appends NO_CLIENT when an unassigned row exists', () => {
    const opts = clientFilterOptions([
      row({ client_name: 'Beta' }),
      row({ client_name: 'Alpha' }),
      row({ client_name: null }),
    ]);
    expect(opts).toEqual(['Alpha', 'Beta', NO_CLIENT_KEY]);
  });

  it('omits NO_CLIENT when every row has a client', () => {
    expect(clientFilterOptions([row({ client_name: 'Alpha' })])).toEqual(['Alpha']);
  });
});

describe('filterRowsByClients', () => {
  it('returns all rows when selection is empty', () => {
    const rows = [row({ client_name: 'Alpha' }), row({ client_name: null })];
    expect(filterRowsByClients(rows, new Set())).toHaveLength(2);
  });

  it('keeps only selected clients and maps unassigned to NO_CLIENT', () => {
    const rows = [
      row({ project_id: 1, client_name: 'Alpha' }),
      row({ project_id: 2, client_name: 'Beta' }),
      row({ project_id: 3, client_name: null }),
    ];
    const out = filterRowsByClients(rows, new Set(['Alpha', NO_CLIENT_KEY]));
    expect(out.map((r) => r.project_id)).toEqual([1, 3]);
  });
});

describe('buildEstimateReportModel', () => {
  it('passes raw seconds and value through when rounding disabled', () => {
    const model = buildEstimateReportModel([row({ seconds: 5400, estimated_value: 150 })], false, OFF);
    expect(model.totalSeconds).toBe(5400);
    expect(model.totalValue).toBeCloseTo(150);
    expect(model.projects[0].days[0].displaySeconds).toBe(3600);
  });

  it('rounds each day to a full hour in per_day mode and keeps project total = sum of days', () => {
    const r = row({
      seconds: 4500,
      estimated_value: 125,
      daily_seconds: [600, 3900],
      days: [
        { date: '2026-01-04', seconds: 600 },
        { date: '2026-01-05', seconds: 3900 },
      ],
    });
    const model = buildEstimateReportModel([r], true, PER_DAY);
    // 600s -> 3600s, 3900s -> 7200s; sum 10800s.
    expect(model.projects[0].days.map((d) => d.displaySeconds)).toEqual([3600, 7200]);
    expect(model.projects[0].displaySeconds).toBe(10800);
    expect(model.totalSeconds).toBe(10800);
    // Value scaled proportionally to rounded total: 125 * (10800/4500) = 300.
    expect(model.projects[0].displayValue).toBeCloseTo(300);
  });
});
```

- [ ] **Step 2: Uruchom testy (verify fail)**

Run: `cd dashboard && npx vitest run src/lib/estimate-report.test.ts`
Expected: FAIL — `Cannot find module '@/lib/estimate-report'`.

- [ ] **Step 3: Zaimplementuj `estimate-report.ts`**

Utwórz `dashboard/src/lib/estimate-report.ts`:

```typescript
import {
  effectiveIntervalMinutes,
  roundDailyTotals,
  roundSeconds,
  scaleValueToRounded,
  type RoundingSettings,
} from '@/lib/rounding';
import type { EstimateProjectRow } from '@/lib/db-types';

/** Klucz syntetycznej opcji „bez klienta" w filtrze. */
export const NO_CLIENT_KEY = '__no_client__';

function clientKey(row: EstimateProjectRow): string {
  return row.client_name && row.client_name.trim() ? row.client_name : NO_CLIENT_KEY;
}

/** Posortowana lista klientów obecnych w wierszach (+ NO_CLIENT_KEY, gdy istnieje wiersz bez klienta). */
export function clientFilterOptions(rows: readonly EstimateProjectRow[]): string[] {
  const names = new Set<string>();
  let hasNoClient = false;
  for (const r of rows) {
    if (r.client_name && r.client_name.trim()) names.add(r.client_name);
    else hasNoClient = true;
  }
  const sorted = Array.from(names).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return hasNoClient ? [...sorted, NO_CLIENT_KEY] : sorted;
}

/** Filtruje wiersze po zaznaczonych klientach. Pusty zbiór = brak filtra (wszystkie wiersze). */
export function filterRowsByClients(
  rows: readonly EstimateProjectRow[],
  selected: ReadonlySet<string>,
): EstimateProjectRow[] {
  if (selected.size === 0) return [...rows];
  return rows.filter((r) => selected.has(clientKey(r)));
}

export interface EstimateReportDay {
  date: string;
  displaySeconds: number;
  displayValue: number;
}

export interface EstimateReportProject {
  projectId: number;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  displaySeconds: number;
  displayValue: number;
  days: EstimateReportDay[];
}

export interface EstimateReportModel {
  projects: EstimateReportProject[];
  totalSeconds: number;
  totalValue: number;
}

/**
 * Buduje model raportu estymacji z zaokrągleniami. Reguła zaokrąglania jest spójna z
 * raportami projektowymi (`report-view-formatting.ts`):
 * - total projektu: per_day → suma dni zaokrąglonych do pełnej godziny; inaczej → cały total
 *   zaokrąglony do interwału. Wartość skalowana proporcjonalnie (`scaleValueToRounded`).
 * - dzień (wariant „plus"): zaokrąglany do efektywnego interwału (per_day = 60 min), wartość dnia
 *   = udział w wartości projektu, skalowany do zaokrąglonego czasu dnia.
 * W trybie `per_day` suma dni = total projektu (oba liczą po pełnych godzinach).
 */
export function buildEstimateReportModel(
  rows: readonly EstimateProjectRow[],
  rounded: boolean,
  settings: RoundingSettings,
): EstimateReportModel {
  const interval = effectiveIntervalMinutes(settings);
  const usePerDay = settings.mode === 'per_day';

  const projects: EstimateReportProject[] = rows.map((row) => {
    const realTotal = row.seconds;
    const dailySeconds = row.days.map((d) => d.seconds);
    const displaySeconds = rounded
      ? usePerDay && dailySeconds.length > 0
        ? roundDailyTotals(dailySeconds, settings)
        : roundSeconds(realTotal, interval)
      : realTotal;
    const displayValue = rounded
      ? scaleValueToRounded(row.estimated_value, realTotal, displaySeconds)
      : row.estimated_value;

    const days: EstimateReportDay[] = row.days.map((d) => {
      const dayDisplaySeconds = rounded ? roundSeconds(d.seconds, interval) : d.seconds;
      const dayRawValue =
        realTotal > 0 ? row.estimated_value * (d.seconds / realTotal) : 0;
      const dayDisplayValue = rounded
        ? scaleValueToRounded(dayRawValue, d.seconds, dayDisplaySeconds)
        : dayRawValue;
      return { date: d.date, displaySeconds: dayDisplaySeconds, displayValue: dayDisplayValue };
    });

    return {
      projectId: row.project_id,
      projectName: row.project_name,
      projectColor: row.project_color,
      clientName: row.client_name,
      displaySeconds,
      displayValue,
      days,
    };
  });

  const totalSeconds = projects.reduce((acc, p) => acc + p.displaySeconds, 0);
  const totalValue = projects.reduce((acc, p) => acc + p.displayValue, 0);
  return { projects, totalSeconds, totalValue };
}
```

- [ ] **Step 4: Uruchom testy (verify pass)**

Run: `cd dashboard && npx vitest run src/lib/estimate-report.test.ts`
Expected: PASS (wszystkie 7 testów).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/estimate-report.ts dashboard/src/lib/estimate-report.test.ts
git commit -m "feat(estimates): pure model + client filter logic for estimate report"
```

---

## Task 4: `kind` w szablonach + seed szablonów estymacji

**Files:**
- Modify: `dashboard/src/lib/report-templates.ts`
- Test: `dashboard/src/lib/report-templates.test.ts`

- [ ] **Step 1: Napisz testy (failing)**

Utwórz `dashboard/src/lib/report-templates.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { ESTIMATE_PLUS_TEMPLATE_ID, ESTIMATE_SIMPLE_TEMPLATE_ID } from '@/lib/report-templates';

describe('report templates with kind', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('seeds two estimate templates on first load and tags legacy as project kind', async () => {
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    const estimate = all.filter((t) => t.kind === 'estimate');
    expect(estimate.map((t) => t.id).sort()).toEqual(
      [ESTIMATE_PLUS_TEMPLATE_ID, ESTIMATE_SIMPLE_TEMPLATE_ID].sort(),
    );
    const project = all.find((t) => t.id === 'default');
    expect(project?.kind).toBe('project');
  });

  it('keeps existing stored templates without kind as project kind (back-compat)', async () => {
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.kind).toBe('project');
    // estimate defaults still get seeded alongside the legacy template.
    expect(all.some((t) => t.kind === 'estimate')).toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom testy (verify fail)**

Run: `cd dashboard && npx vitest run src/lib/report-templates.test.ts`
Expected: FAIL — brak eksportu `ESTIMATE_SIMPLE_TEMPLATE_ID`.

- [ ] **Step 3: Dodaj `kind`, identyfikatory i seed do `report-templates.ts`**

W `report-templates.ts`:

a) Rozszerz interfejs (linie 3-10):

```typescript
export type ReportTemplateKind = 'project' | 'estimate';

export interface ReportTemplate {
  id: string;
  name: string;
  kind: ReportTemplateKind;
  sections: string[];
  showLogo: boolean;
  createdAt: string;
  updatedAt: string;
}
```

b) Po `const SELECTED_KEY = ...` (linia 13) dodaj stałe i domyślne sekcje estymacji:

```typescript
export const ESTIMATE_SIMPLE_TEMPLATE_ID = 'estimate-simple';
export const ESTIMATE_PLUS_TEMPLATE_ID = 'estimate-plus';

const ESTIMATE_SIMPLE_SECTIONS = ['est_header', 'est_summary', 'est_footer'];
const ESTIMATE_PLUS_SECTIONS = ['est_header', 'est_summary', 'est_per_day', 'est_footer'];
```

c) Zmień `normalizeTemplate` (linie 25-42), dopisując domyślny `kind`:

```typescript
function normalizeTemplate(template: ReportTemplate): ReportTemplate {
  const defaultName = getDefaultTemplateName();
  const normalizedName =
    template.id === 'default' &&
    (!template.name || template.name === 'reports_page.template.default_template')
      ? defaultName
      : template.name;
  const normalizedSections =
    Array.isArray(template.sections) && template.sections.length > 0
      ? template.sections.filter((section) => section !== 'files')
      : [];

  return {
    ...template,
    kind: template.kind === 'estimate' ? 'estimate' : 'project',
    name: normalizedName,
    sections: normalizedSections.length > 0 ? normalizedSections : [...DEFAULT_SECTIONS],
  };
}
```

d) Zmień `createDefaultTemplate` (linie 44-53), dodając `kind: 'project'`:

```typescript
function createDefaultTemplate(): ReportTemplate {
  return {
    id: 'default',
    name: getDefaultTemplateName(),
    kind: 'project',
    sections: [...DEFAULT_SECTIONS],
    showLogo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

e) Dodaj fabrykę domyślnych szablonów estymacji (po `createDefaultTemplate`):

```typescript
function createEstimateTemplates(): ReportTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: ESTIMATE_SIMPLE_TEMPLATE_ID,
      name: i18n.t('reports_page.template.estimate_simple'),
      kind: 'estimate',
      sections: [...ESTIMATE_SIMPLE_SECTIONS],
      showLogo: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ESTIMATE_PLUS_TEMPLATE_ID,
      name: i18n.t('reports_page.template.estimate_plus'),
      kind: 'estimate',
      sections: [...ESTIMATE_PLUS_SECTIONS],
      showLogo: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Dokłada brakujące domyślne szablony estymacji (po id) — idempotentnie. */
function ensureEstimateTemplates(list: ReportTemplate[]): ReportTemplate[] {
  const have = new Set(list.map((t) => t.id));
  const missing = createEstimateTemplates().filter((t) => !have.has(t.id));
  return missing.length > 0 ? [...list, ...missing] : list;
}
```

f) Zmień `loadTemplates` (linie 55-73), aby dosiać szablony estymacji i utrwalić, gdy czegoś brakuje:

```typescript
export function loadTemplates(): ReportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const oldSections = localStorage.getItem('timeflow_report_template');
      const defaultTpl = createDefaultTemplate();
      if (oldSections) {
        try { defaultTpl.sections = JSON.parse(oldSections); } catch { /* ignore */ }
      }
      const seeded = [defaultTpl, ...createEstimateTemplates()];
      saveTemplates(seeded);
      return seeded;
    }
    const parsed = (JSON.parse(raw) as ReportTemplate[]).map(normalizeTemplate);
    const base = parsed.length > 0 ? parsed : [createDefaultTemplate()];
    const withEstimates = ensureEstimateTemplates(base);
    if (withEstimates.length !== base.length) {
      saveTemplates(withEstimates);
    }
    return withEstimates;
  } catch {
    return [createDefaultTemplate(), ...createEstimateTemplates()];
  }
}
```

- [ ] **Step 4: Uruchom testy (verify pass)**

Run: `cd dashboard && npx vitest run src/lib/report-templates.test.ts`
Expected: PASS (oba testy).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/report-templates.ts dashboard/src/lib/report-templates.test.ts
git commit -m "feat(reports): add template kind + seed estimate report templates"
```

---

## Task 5: Rejestr sekcji raportu estymacji

**Files:**
- Create: `dashboard/src/pages/reports/estimate-report-sections.tsx`
- Modify: `dashboard/src/pages/reports/reports-page-constants.ts`

- [ ] **Step 1: Dodaj domyślne id sekcji estymacji w `reports-page-constants.ts`**

Po istniejącym `REPORT_DEFAULT_SECTION_IDS` (linia 9) dodaj:

```typescript
export const ESTIMATE_DEFAULT_SECTION_IDS = [
  'est_header',
  'est_summary',
  'est_footer',
];
```

- [ ] **Step 2: Utwórz rejestr `ESTIMATE_REPORT_SECTIONS`**

Utwórz `dashboard/src/pages/reports/estimate-report-sections.tsx` (typ `ReportSectionDef` reużyty z `reports-page-sections.tsx`):

```tsx
import type { ReportSectionDef } from '@/pages/reports/reports-page-sections';

export const ESTIMATE_REPORT_SECTIONS: ReportSectionDef[] = [
  {
    id: 'est_header',
    labelKey: 'reports_page.sections.est_header',
    preview: (t) => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          {t('reports_page.preview.est_header.title')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          {t('reports_page.preview.est_header.meta_line')}
        </div>
      </div>
    ),
  },
  {
    id: 'est_summary',
    labelKey: 'reports_page.sections.est_summary',
    preview: (t) => (
      <div className="space-y-1 text-[10px] text-muted-foreground/50 font-mono">
        <div className="flex justify-between">
          <span>{t('reports_page.preview.est_summary.project_a')}</span>
          <span>12h 30m · 1 250,00 PLN</span>
        </div>
        <div className="flex justify-between">
          <span>{t('reports_page.preview.est_summary.project_b')}</span>
          <span>4h 00m · 400,00 PLN</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-muted-foreground/20 pt-1 font-semibold text-foreground/60">
          <span>{t('reports_page.preview.est_summary.total')}</span>
          <span>16h 30m · 1 650,00 PLN</span>
        </div>
      </div>
    ),
  },
  {
    id: 'est_per_day',
    labelKey: 'reports_page.sections.est_per_day',
    preview: (t) => (
      <div className="space-y-0.5 text-[10px] text-muted-foreground/40 font-mono">
        <div className="font-semibold text-foreground/60">
          {t('reports_page.preview.est_per_day.project_a')}
        </div>
        <div className="flex justify-between pl-2">
          <span>2026-06-10</span>
          <span>3h 00m</span>
        </div>
        <div className="flex justify-between pl-2">
          <span>2026-06-11</span>
          <span>2h 30m</span>
        </div>
      </div>
    ),
  },
  {
    id: 'est_footer',
    labelKey: 'reports_page.sections.est_footer',
    preview: (t) => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        {t('reports_page.preview.est_footer.line')}
      </div>
    ),
  },
];
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/reports/estimate-report-sections.tsx dashboard/src/pages/reports/reports-page-constants.ts
git commit -m "feat(reports): estimate report section registry"
```

---

## Task 6: Edytor szablonów — sekcje zależne od `kind`

**Files:**
- Modify: `dashboard/src/hooks/useReportsPageController.ts`

- [ ] **Step 1: Import rejestru estymacji i stałych**

W `useReportsPageController.ts` dodaj importy (po linii 14):

```typescript
import { ESTIMATE_REPORT_SECTIONS } from '@/pages/reports/estimate-report-sections';
import { ESTIMATE_DEFAULT_SECTION_IDS } from '@/pages/reports/reports-page-constants';
```

- [ ] **Step 2: Wybierz rejestr sekcji wg `kind` aktywnego szablonu**

Po wyliczeniu `activeIds` (linia 30) dodaj:

```typescript
  const sectionRegistry =
    activeTemplate?.kind === 'estimate'
      ? ESTIMATE_REPORT_SECTIONS
      : REPORT_PAGE_SECTIONS;
```

- [ ] **Step 3: Użyj rejestru w `availableSections`, `sectionDefById`**

Zmień `availableSections` (linie 93-95):

```typescript
  const availableSections = sectionRegistry.filter(
    (section) => !activeIds.includes(section.id),
  );
```

Zmień `sectionDefById` (linie 115-118) — zależnie od rejestru:

```typescript
  const sectionDefById = useMemo(
    () => new Map(sectionRegistry.map((section) => [section.id, section])),
    [sectionRegistry],
  );
```

- [ ] **Step 4: Nowy szablon dziedziczy `kind` aktywnego i jego domyślne sekcje**

Zmień `handleNewTemplate` (linie 61-73):

```typescript
  const handleNewTemplate = () => {
    const kind = activeTemplate?.kind ?? 'project';
    const sections =
      kind === 'estimate'
        ? [...ESTIMATE_DEFAULT_SECTION_IDS]
        : [...REPORT_DEFAULT_SECTION_IDS];
    const newTpl: ReportTemplate = {
      id: crypto.randomUUID(),
      name: t('reports_page.template.new_template'),
      kind,
      sections,
      showLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newList = saveTemplate(newTpl);
    setTemplates(newList);
    handleSelectTemplate(newTpl.id);
  };
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd dashboard && npx tsc -b && npx eslint src/hooks/useReportsPageController.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/hooks/useReportsPageController.ts
git commit -m "feat(reports): kind-aware section registry in template editor"
```

---

## Task 7: UI store — konfiguracja raportu estymacji + routing

**Files:**
- Modify: `dashboard/src/store/ui-store.ts`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Dodaj typ configu i stan w `ui-store.ts`**

Po imporcie `DateRange` (linia 2) typ jest już dostępny. W interfejsie `UIState` (po `setReportTemplateId`, linia 79) dodaj:

```typescript
  estimateReport: EstimateReportConfig | null;
  setEstimateReport: (config: EstimateReportConfig | null) => void;
```

Nad `interface UIState` dodaj typ:

```typescript
export interface EstimateReportConfig {
  /** Zaznaczeni klienci (klucze z `clientFilterOptions`, w tym NO_CLIENT_KEY). Pusty = wszyscy. */
  clients: string[];
  /** Snapshot zakresu dat w momencie generowania (data-store może się zmienić). */
  dateRange: DateRange;
  /** Id szablonu estymacji (kind==='estimate'). */
  templateId: string;
}
```

W implementacji store (po `setReportTemplateId`, linia 126) dodaj:

```typescript
  estimateReport: null,
  setEstimateReport: (config) => set({ estimateReport: config }),
```

- [ ] **Step 2: Zarejestruj stronę `estimate-report` w `App.tsx`**

Po deklaracji `ReportView` (linie 64-66) dodaj lazy import:

```typescript
const EstimateReport = lazy(() =>
  import('@/pages/EstimateReport').then((m) => ({ default: m.EstimateReport })),
);
```

W `switch` po `case 'report-view':` (linie 110-111) dodaj:

```typescript
      case 'estimate-report':
        return <EstimateReport />;
```

Zmień warunek `showChrome` (linia 182), aby ukrywał chrome także dla raportu estymacji:

```typescript
  const showChrome = useUIStore(
    (s) => s.currentPage !== 'report-view' && s.currentPage !== 'estimate-report',
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard && npx tsc -b`
Expected: PASS (strona `EstimateReport` jeszcze nie istnieje → tsc zgłosi brak modułu; jeśli tak, ten krok przejdzie dopiero po Task 10. Dopuszczalne: zakończ Task 7 commitem dopiero po Task 10, albo tymczasowo pomiń `case`. Zalecane: wykonaj Step 2 `case`/import w tym samym kroku co Task 10.)

> Uwaga wykonawcza: aby uniknąć stanu niekompilującego się między taskami, dodaj lazy import + `case 'estimate-report'` z Step 2 **dopiero w Task 10 Step 6** (gdy `EstimateReport.tsx` już istnieje). W Task 7 commitujemy wyłącznie zmiany w `ui-store.ts` oraz zmianę `showChrome` (która nie zależy od nowego modułu).

- [ ] **Step 4: Typecheck (tylko store + showChrome)**

Run: `cd dashboard && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/store/ui-store.ts dashboard/src/App.tsx
git commit -m "feat(estimates): ui-store estimate report config + hide chrome on estimate-report"
```

---

## Task 8: Ekran Estymacje — filtr klientów + przycisk raportu

**Files:**
- Modify: `dashboard/src/hooks/useEstimatesPageController.ts`
- Create: `dashboard/src/components/estimates/EstimatesClientFilter.tsx`
- Create: `dashboard/src/components/estimates/EstimatesReportButton.tsx`
- Modify: `dashboard/src/pages/EstimatesView.tsx`

- [ ] **Step 1: Rozszerz kontroler estymacji o filtr i metryki z filtrowanych wierszy**

W `useEstimatesPageController.ts`:

a) Dodaj importy (po linii 17):

```typescript
import { useMemo as useReactMemo } from 'react';
import {
  buildEstimateReportModel,
  clientFilterOptions,
  filterRowsByClients,
} from '@/lib/estimate-report';
import { useUIStore } from '@/store/ui-store';
```

> `useUIStore` jest już importowany na górze pliku (linia 4) — nie duplikuj importu; użyj istniejącego. `useReactMemo` to alias, ale `useMemo` jest już importowany (linia 1) — użyj istniejącego `useMemo` i NIE dodawaj aliasu. (Pozostaw w tym kroku tylko import z `@/lib/estimate-report`.)

Poprawny dodatek importów (jedna linia):

```typescript
import {
  buildEstimateReportModel,
  clientFilterOptions,
  filterRowsByClients,
} from '@/lib/estimate-report';
```

b) Dodaj setter nawigacji z `ui-store` (po linii 31, obok innych selektorów store):

```typescript
  const setEstimateReport = useUIStore((s) => s.setEstimateReport);
```

c) Dodaj stan zaznaczenia klientów (po `const reloadEstimatesRef = ...`, linia 59):

```typescript
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
```

d) Po destrukturyzacji `rows` z `page.data` (linia 51) dodaj wyliczenia (memo) — opcje filtra, filtrowane wiersze, metryki:

```typescript
  const clientOptions = useMemo(() => clientFilterOptions(rows), [rows]);
  const filteredRows = useMemo(
    () => filterRowsByClients(rows, selectedClients),
    [rows, selectedClients],
  );
  const filteredSummary = useMemo(() => {
    const totalSeconds = filteredRows.reduce((acc, r) => acc + r.seconds, 0);
    return {
      total_hours: totalSeconds / 3600,
      total_value: filteredRows.reduce((acc, r) => acc + r.estimated_value, 0),
      projects_count: filteredRows.length,
      overrides_count: filteredRows.filter((r) => r.project_hourly_rate != null).length,
    };
  }, [filteredRows]);
```

> `buildEstimateReportModel` nie jest tu potrzebne — usuń je z importu, jeśli ESLint zgłosi nieużyty (zostaw tylko `clientFilterOptions`, `filterRowsByClients`). Model buduje kontroler raportu (Task 9).

e) Dodaj handler toggle i generowania (przed `return`, po `openBoostedSessions`, linia 236):

```typescript
  const toggleClient = (key: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearClientFilter = () => setSelectedClients(new Set());

  const generateEstimateReport = (templateId: string) => {
    setEstimateReport({
      clients: Array.from(selectedClients),
      dateRange,
      templateId,
    });
    setCurrentPage('estimate-report');
  };
```

f) Dodaj do zwracanego obiektu (po `summary`, linia 260):

```typescript
    clientOptions,
    selectedClients,
    toggleClient,
    clearClientFilter,
    filteredSummary,
    generateEstimateReport,
```

- [ ] **Step 2: Komponent filtra klientów**

Utwórz `dashboard/src/components/estimates/EstimatesClientFilter.tsx`:

```tsx
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NO_CLIENT_KEY } from '@/lib/estimate-report';

interface EstimatesClientFilterProps {
  clientOptions: string[];
  selectedClients: Set<string>;
  toggleClient: (key: string) => void;
  clearClientFilter: () => void;
}

export function EstimatesClientFilter({
  clientOptions,
  selectedClients,
  toggleClient,
  clearClientFilter,
}: EstimatesClientFilterProps) {
  const { t } = useTranslation();
  if (clientOptions.length === 0) return null;

  const label = (key: string) =>
    key === NO_CLIENT_KEY ? t('estimates_page.client_filter.no_client') : key;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Users className="size-4" />
          {t('estimates_page.client_filter.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {clientOptions.map((key) => {
            const active = selectedClients.size === 0 || selectedClients.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleClient(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-500/60 bg-sky-500/10 text-foreground'
                    : 'border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                {label(key)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedClients.size === 0
              ? t('estimates_page.client_filter.all_selected')
              : t('estimates_page.client_filter.selected_count', {
                  count: selectedClients.size,
                })}
          </span>
          {selectedClients.size > 0 && (
            <Button variant="ghost" size="sm" onClick={clearClientFilter}>
              {t('estimates_page.client_filter.clear')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Komponent przycisku raportu + selektor szablonu estymacji**

Utwórz `dashboard/src/components/estimates/EstimatesReportButton.tsx`:

```tsx
import { useState } from 'react';
import { FileText, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { loadTemplates } from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';
import { useUIStore } from '@/store/ui-store';

interface EstimatesReportButtonProps {
  onGenerate: (templateId: string) => void;
}

export function EstimatesReportButton({ onGenerate }: EstimatesReportButtonProps) {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  const openSelector = () => {
    const estimateTemplates = loadTemplates().filter((tpl) => tpl.kind === 'estimate');
    setTemplates(estimateTemplates);
    setSelectedId(estimateTemplates[0]?.id ?? '');
    setOpen(true);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={openSelector}>
        <FileText className="mr-1.5 size-4" />
        {t('estimates_page.report.generate')}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-popover p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {t('estimates_page.report.choose_variant')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="size-7 p-0"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedId === tpl.id
                      ? 'border-sky-500/50 bg-sky-500/10'
                      : 'border-border/30 hover:border-border/60 hover:bg-secondary/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedId === tpl.id && (
                      <Check className="size-4 shrink-0 text-sky-400" />
                    )}
                    <span className="text-sm font-medium">{tpl.name}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setCurrentPage('reports');
                }}
              >
                {t('estimates_page.report.edit_templates')}
              </Button>
              <Button
                size="sm"
                disabled={!selectedId}
                onClick={() => {
                  setOpen(false);
                  onGenerate(selectedId);
                }}
                className="bg-sky-600 text-white hover:bg-sky-700"
              >
                {t('estimates_page.report.generate_action')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Osadź filtr + przycisk w `EstimatesView.tsx` i podłącz metryki**

W `EstimatesView.tsx`:

a) Dodaj importy (po linii 16):

```typescript
import { EstimatesClientFilter } from '@/components/estimates/EstimatesClientFilter';
import { EstimatesReportButton } from '@/components/estimates/EstimatesReportButton';
```

b) Rozszerz destrukturyzację kontrolera (po `summary`, w bloku `const { ... } = controller;`, linie 25-42) o nowe pola:

```typescript
    clientOptions,
    selectedClients,
    toggleClient,
    clearClientFilter,
    filteredSummary,
    generateEstimateReport,
```

c) Pod `DateRangeToolbar` (po linii 52) dodaj pasek akcji z przyciskiem raportu:

```tsx
      <div className="flex justify-end">
        <EstimatesReportButton onGenerate={generateEstimateReport} />
      </div>
```

d) Zmień metryki, by używały `filteredSummary` zamiast `summary` (linie 54-91). Zamień cztery `MetricCard` na wersję opartą o `filteredSummary` (zachowując stany loading):

```tsx
      <div className={mobileLayout.metricGrid}>
        <MetricCard
          title={t('estimates_page.metrics.total_hours')}
          value={
            loading
              ? '...'
              : `${decimal.format(filteredSummary.total_hours)} ${t('estimates_page.units.hours_short')}`
          }
          icon={Clock3}
        />
        <MetricCard
          title={t('estimates_page.metrics.estimated_value')}
          value={loading ? '...' : currency.format(filteredSummary.total_value)}
          icon={CircleDollarSign}
        />
        <MetricCard
          title={t('estimates_page.metrics.active_projects')}
          value={loading ? '...' : String(filteredSummary.projects_count)}
          icon={FolderOpen}
        />
        <MetricCard
          title={t('estimates_page.metrics.rate_overrides')}
          value={loading ? '...' : String(filteredSummary.overrides_count)}
          icon={SlidersHorizontal}
        />
      </div>
```

e) Nad `<EstimatesProjectsSection .../>` (linia 136) dodaj filtr klientów:

```tsx
      <EstimatesClientFilter
        clientOptions={clientOptions}
        selectedClients={selectedClients}
        toggleClient={toggleClient}
        clearClientFilter={clearClientFilter}
      />
```

> Uwaga: `summary` przestaje być używane bezpośrednio w widoku (zastąpione `filteredSummary`). Usuń `summary` z destrukturyzacji w `EstimatesView`, jeśli ESLint zgłosi nieużyte. Lista projektów (`EstimatesProjectsSection`) nadal pokazuje pełne `rows` — filtr klientów wpływa na metryki i zakres raportu (zgodnie ze spec); jeśli chcesz filtrować również listę, przekaż `filteredRows` w osobnym, późniejszym kroku (poza zakresem tego planu — domyślnie lista bez zmian).

- [ ] **Step 5: Typecheck + lint (w tym i18n-hardcoded)**

Run: `cd dashboard && npx tsc -b && npx eslint src/components/estimates src/pages/EstimatesView.tsx src/hooks/useEstimatesPageController.ts`
Expected: PASS. (Jeśli lint zgłosi brak kluczy i18n — dodasz je w Task 11; na tym etapie klucze muszą istnieć, więc wykonaj Task 11 przed finalnym lintem lub dodaj klucze równolegle.)

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/hooks/useEstimatesPageController.ts dashboard/src/components/estimates/EstimatesClientFilter.tsx dashboard/src/components/estimates/EstimatesReportButton.tsx dashboard/src/pages/EstimatesView.tsx
git commit -m "feat(estimates): client multi-select filter + report generation entry"
```

---

## Task 9: Kontroler raportu estymacji

**Files:**
- Create: `dashboard/src/hooks/useEstimateReportController.ts`

- [ ] **Step 1: Zaimplementuj kontroler**

Utwórz `dashboard/src/hooks/useEstimateReportController.ts`:

```typescript
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { useCancellableAsync } from '@/lib/async-utils';
import { formatDurationRaw, formatMoney } from '@/lib/utils';
import {
  buildEstimateReportModel,
  filterRowsByClients,
  NO_CLIENT_KEY,
  type EstimateReportModel,
} from '@/lib/estimate-report';
import { getTemplate } from '@/lib/report-templates';
import { getDaemonRuntimeStatus, getProjectEstimates } from '@/lib/tauri';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import type { EstimateProjectRow } from '@/lib/db-types';

export function useEstimateReportController() {
  const { t, i18n } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const config = useUIStore((s) => s.estimateReport);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const roundingSettings = useSettingsStore((s) => s.roundingSettings);
  const [rounded, setRounded] = useState(roundingSettings.enabled);
  const runRequest = useCancellableAsync();
  const runDaemonRequest = useCancellableAsync();

  const [rows, setRows] = useState<EstimateProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [generatedAt] = useState(() => format(new Date(), 'yyyy-MM-dd HH:mm'));

  const template = useMemo(
    () => (config ? getTemplate(config.templateId) : null),
    [config],
  );
  const has = useCallback(
    (id: string) => !!template && template.sections.includes(id),
    [template],
  );

  const locale = i18n.resolvedLanguage;
  const fmtMoney = useCallback(
    (v: number) => formatMoney(v, currencyCode, locale),
    [currencyCode, locale],
  );
  const fmtDur = useCallback((seconds: number) => formatDurationRaw(seconds), []);

  useEffect(() => {
    if (!config) return;
    void runRequest(() => getProjectEstimates(config.dateRange), {
      onSuccess: (data) => {
        startTransition(() => {
          setRows(data);
          setError(null);
        });
      },
      onError: (err) => {
        startTransition(() => {
          setRows(null);
          setError(String(err));
        });
      },
    });
  }, [config, runRequest]);

  useEffect(() => {
    void runDaemonRequest(() => getDaemonRuntimeStatus(), {
      onSuccess: (status) => setAppVersion(status.dashboard_version ?? ''),
    });
  }, [runDaemonRequest]);

  const model: EstimateReportModel | null = useMemo(() => {
    if (!rows || !config) return null;
    const selected = new Set(config.clients);
    const filtered = filterRowsByClients(rows, selected);
    return buildEstimateReportModel(filtered, rounded, roundingSettings);
  }, [rows, config, rounded, roundingSettings]);

  const clientLabels = useMemo(() => {
    if (!config || config.clients.length === 0) {
      return [t('estimate_report.all_clients')];
    }
    return config.clients.map((key) =>
      key === NO_CLIENT_KEY ? t('estimate_report.no_client') : key,
    );
  }, [config, t]);

  const goBack = () => setCurrentPage('estimates');

  const handlePrint = useCallback(() => {
    const originalTitle = document.title;
    document.title = t('estimate_report.pdf_filename');
    window.print();
    document.title = originalTitle;
  }, [t]);

  return {
    appVersion,
    clientLabels,
    config,
    error,
    fmtDur,
    fmtMoney,
    generatedAt,
    goBack,
    handlePrint,
    has,
    interval: roundingSettings.mode === 'per_day' ? 60 : roundingSettings.intervalMinutes,
    model,
    rounded,
    setRounded,
    t,
    template,
  };
}

export type EstimateReportController = ReturnType<typeof useEstimateReportController>;
```

> Weryfikacja API: `useCancellableAsync`, `getDaemonRuntimeStatus`, `getProjectEstimates`, `formatMoney`, `formatDurationRaw`, `useSettingsStore` z polami `currencyCode`/`roundingSettings` — wszystkie użyte tak jak w `useReportViewController.ts` i `useEstimatesPageController.ts`. Jeśli `getDaemonRuntimeStatus` zwraca inną nazwę pola wersji niż `dashboard_version`, użyj tej samej co w `useReportViewController.ts:105`.

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useEstimateReportController.ts
git commit -m "feat(estimates): estimate report controller (fetch + filter + model)"
```

---

## Task 10: Widok raportu estymacji (strona, toolbar, sekcje)

**Files:**
- Create: `dashboard/src/pages/estimate-report/EstimateReportToolbar.tsx`
- Create: `dashboard/src/pages/estimate-report/EstimateReportDocument.tsx`
- Create: `dashboard/src/pages/estimate-report/EstimateReportPage.tsx`
- Create: `dashboard/src/pages/EstimateReport.tsx`
- Modify: `dashboard/src/App.tsx` (lazy import + `case 'estimate-report'` — patrz Task 7 Step 3)

- [ ] **Step 1: Toolbar (wstecz + full/rounded + print)**

Utwórz `dashboard/src/pages/estimate-report/EstimateReportToolbar.tsx`:

```tsx
import { ChevronLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { EstimateReportController } from '@/hooks/useEstimateReportController';

type Props = Pick<
  EstimateReportController,
  'goBack' | 'handlePrint' | 'rounded' | 'setRounded' | 'interval' | 't'
>;

export function EstimateReportToolbar({
  goBack,
  handlePrint,
  rounded,
  setRounded,
  interval,
  t,
}: Props) {
  return (
    <div className="shrink-0 border-b border-border/30 px-4 print:hidden">
      <div className="mx-auto flex w-full max-w-[700px] flex-wrap items-center justify-between gap-2 pb-3">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ChevronLeft className="mr-1 size-4" />
          {t('estimate_report.back')}
        </Button>

        <div className="flex items-center gap-2">
          <fieldset
            className="m-0 flex overflow-hidden rounded-md border border-border/60 p-0 text-xs"
            aria-label={t('report_view.rounding_mode')}
          >
            <legend className="sr-only">{t('report_view.rounding_mode')}</legend>
            <button
              type="button"
              aria-pressed={!rounded}
              onClick={() => setRounded(false)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                !rounded ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_full')}
            </button>
            <button
              type="button"
              aria-pressed={rounded}
              onClick={() => setRounded(true)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                rounded ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_rounded', { value: interval })}
            </button>
          </fieldset>

          <Button
            size="sm"
            onClick={handlePrint}
            className="bg-sky-600 text-white hover:bg-sky-700"
          >
            <Printer className="mr-1.5 size-4" />
            {t('report_view.print_pdf')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Dokument (sekcje header/summary/per-day/footer)**

Utwórz `dashboard/src/pages/estimate-report/EstimateReportDocument.tsx`:

```tsx
import type { EstimateReportController } from '@/hooks/useEstimateReportController';

interface Props {
  controller: EstimateReportController;
}

export function EstimateReportDocument({ controller }: Props) {
  const {
    appVersion,
    clientLabels,
    config,
    fmtDur,
    fmtMoney,
    generatedAt,
    has,
    model,
    t,
    template,
  } = controller;

  if (!model || !config || !template) return null;

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 print:overflow-visible print:bg-white print:px-0 print:pt-0 print:text-black">
      <div className="mx-auto max-w-[700px] space-y-6 print:space-y-5">
        {has('est_header') && (
          <header className="border-b border-dashed border-muted-foreground/20 pb-4 text-center">
            {template.showLogo && (
              <div className="mb-1 text-xs font-semibold tracking-widest text-sky-500">
                TIMEFLOW
              </div>
            )}
            <h1 className="text-xl font-bold">{t('estimate_report.title')}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('estimate_report.range', {
                start: config.dateRange.start,
                end: config.dateRange.end,
              })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('estimate_report.clients_label')}: {clientLabels.join(', ')}
            </p>
          </header>
        )}

        {has('est_summary') && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              {t('estimate_report.summary_heading')}
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="py-1.5">{t('estimate_report.col_project')}</th>
                  <th className="py-1.5 text-right">{t('estimate_report.col_time')}</th>
                  <th className="py-1.5 text-right">{t('estimate_report.col_value')}</th>
                </tr>
              </thead>
              <tbody>
                {model.projects.map((p) => (
                  <tr key={p.projectId} className="border-b border-border/20">
                    <td className="py-1.5">{p.projectName}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtDur(p.displaySeconds)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtMoney(p.displayValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-1.5">{t('estimate_report.total')}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtDur(model.totalSeconds)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtMoney(model.totalValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {has('est_per_day') && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">
              {t('estimate_report.per_day_heading')}
            </h2>
            {model.projects.map((p) => (
              <div key={p.projectId}>
                <div className="mb-1 flex items-center justify-between text-sm font-medium">
                  <span>{p.projectName}</span>
                  <span className="tabular-nums">{fmtDur(p.displaySeconds)}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {p.days.map((d) => (
                      <tr key={d.date} className="border-b border-border/10">
                        <td className="py-1 text-muted-foreground">{d.date}</td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtDur(d.displaySeconds)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtMoney(d.displayValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {has('est_footer') && (
          <footer className="border-t border-dashed border-muted-foreground/10 pt-3 text-center text-[10px] text-muted-foreground/60">
            {t('estimate_report.footer', { version: appVersion, generatedAt })}
          </footer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Strona (gate + toolbar + dokument)**

Utwórz `dashboard/src/pages/estimate-report/EstimateReportPage.tsx`:

```tsx
import type { EstimateReportController } from '@/hooks/useEstimateReportController';
import { EstimateReportDocument } from '@/pages/estimate-report/EstimateReportDocument';
import { EstimateReportToolbar } from '@/pages/estimate-report/EstimateReportToolbar';

interface Props {
  controller: EstimateReportController;
}

export function EstimateReportPage({ controller }: Props) {
  const { config, error, goBack, model, t } = controller;

  if (!config || error || !model) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          {error ? t('estimate_report.error') : t('estimate_report.empty')}
        </p>
        <button
          type="button"
          onClick={goBack}
          className="text-sm font-medium text-sky-500 hover:underline"
        >
          {t('estimate_report.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background pt-8 print:h-auto print:bg-white print:pt-0">
      <EstimateReportToolbar {...controller} />
      <EstimateReportDocument controller={controller} />
    </div>
  );
}
```

- [ ] **Step 4: Entry component**

Utwórz `dashboard/src/pages/EstimateReport.tsx`:

```tsx
import { useEstimateReportController } from '@/hooks/useEstimateReportController';
import { EstimateReportPage } from '@/pages/estimate-report/EstimateReportPage';

export function EstimateReport() {
  const controller = useEstimateReportController();
  return <EstimateReportPage controller={controller} />;
}
```

- [ ] **Step 5: Podłącz routing w `App.tsx`**

Wykonaj zmianę z Task 7 Step 3 (lazy import `EstimateReport` + `case 'estimate-report'`). Po linii deklaracji `ReportView` (linie 64-66) dodaj:

```typescript
const EstimateReport = lazy(() =>
  import('@/pages/EstimateReport').then((m) => ({ default: m.EstimateReport })),
);
```

W `switch` po `case 'report-view': return <ReportView />;` dodaj:

```typescript
      case 'estimate-report':
        return <EstimateReport />;
```

- [ ] **Step 6: Typecheck + lint**

Run: `cd dashboard && npx tsc -b && npx eslint src/pages/estimate-report src/pages/EstimateReport.tsx src/App.tsx`
Expected: PASS (zakładając klucze i18n z Task 11 obecne).

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/estimate-report dashboard/src/pages/EstimateReport.tsx dashboard/src/App.tsx
git commit -m "feat(estimates): estimate report view (toolbar, document, routing)"
```

---

## Task 11: Klucze i18n (pl + en)

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

> Lint `check-locale-consistency.cjs` wymaga IDENTYCZNEGO zbioru kluczy w pl i en. Dodaj te same ścieżki w obu plikach.

- [ ] **Step 1: Dodaj klucze do `pl/common.json`**

W odpowiednich gałęziach (scal z istniejącymi obiektami `estimates_page`, `reports_page`, dodaj nową gałąź `estimate_report`):

```jsonc
// estimates_page.* (dodaj do istniejącego obiektu estimates_page)
"client_filter": {
  "title": "Klienci w estymacjach",
  "no_client": "Bez klienta",
  "all_selected": "Wszyscy klienci",
  "selected_count": "Zaznaczono: {{count}}",
  "clear": "Wyczyść"
},
"report": {
  "generate": "Generuj raport",
  "choose_variant": "Wybierz wariant raportu",
  "edit_templates": "Edytuj szablony",
  "generate_action": "Generuj"
},

// reports_page.sections.* (dodaj do istniejącego obiektu)
"est_header": "Nagłówek (estymacje)",
"est_summary": "Podsumowanie projektów",
"est_per_day": "Rozbicie na dni",
"est_footer": "Stopka (estymacje)",

// reports_page.template.* (dodaj do istniejącego obiektu)
"estimate_simple": "Estymacje — uproszczony",
"estimate_plus": "Estymacje — plus (dni)",

// reports_page.preview.* (dodaj nowe podobiekty)
"est_header": { "title": "Raport estymacji", "meta_line": "Zakres dat · klienci" },
"est_summary": { "project_a": "Projekt A", "project_b": "Projekt B", "total": "Razem" },
"est_per_day": { "project_a": "Projekt A" },
"est_footer": { "line": "TIMEFLOW · wygenerowano" },

// nowa gałąź najwyższego poziomu: estimate_report
"estimate_report": {
  "title": "Raport estymacji",
  "range": "Zakres: {{start}} — {{end}}",
  "clients_label": "Klienci",
  "all_clients": "Wszyscy klienci",
  "no_client": "Bez klienta",
  "summary_heading": "Projekty i czas",
  "per_day_heading": "Rozbicie na dni",
  "col_project": "Projekt",
  "col_time": "Czas",
  "col_value": "Wartość",
  "total": "Razem",
  "back": "Wróć do estymacji",
  "footer": "TIMEFLOW {{version}} · wygenerowano {{generatedAt}}",
  "pdf_filename": "timeflow_raport_estymacji",
  "error": "Nie udało się wczytać danych raportu.",
  "empty": "Brak danych do raportu."
}
```

- [ ] **Step 2: Dodaj te same klucze do `en/common.json`**

```jsonc
"client_filter": {
  "title": "Clients in estimates",
  "no_client": "No client",
  "all_selected": "All clients",
  "selected_count": "Selected: {{count}}",
  "clear": "Clear"
},
"report": {
  "generate": "Generate report",
  "choose_variant": "Choose report variant",
  "edit_templates": "Edit templates",
  "generate_action": "Generate"
},

"est_header": "Header (estimates)",
"est_summary": "Projects summary",
"est_per_day": "Per-day breakdown",
"est_footer": "Footer (estimates)",

"estimate_simple": "Estimates — simple",
"estimate_plus": "Estimates — plus (days)",

"est_header": { "title": "Estimate report", "meta_line": "Date range · clients" },
"est_summary": { "project_a": "Project A", "project_b": "Project B", "total": "Total" },
"est_per_day": { "project_a": "Project A" },
"est_footer": { "line": "TIMEFLOW · generated" },

"estimate_report": {
  "title": "Estimate report",
  "range": "Range: {{start}} — {{end}}",
  "clients_label": "Clients",
  "all_clients": "All clients",
  "no_client": "No client",
  "summary_heading": "Projects & time",
  "per_day_heading": "Per-day breakdown",
  "col_project": "Project",
  "col_time": "Time",
  "col_value": "Value",
  "total": "Total",
  "back": "Back to estimates",
  "footer": "TIMEFLOW {{version}} · generated {{generatedAt}}",
  "pdf_filename": "timeflow_estimate_report",
  "error": "Failed to load report data.",
  "empty": "No data for the report."
}
```

> Uwaga: powyżej dwa różne klucze `est_header`/`est_summary` itd. żyją w RÓŻNYCH gałęziach (`reports_page.sections.*` to stringi, `reports_page.preview.*` to obiekty). Umieść każdy we właściwym obiekcie nadrzędnym — nie w jednym.

- [ ] **Step 3: Walidacja parytetu locale**

Run: `cd dashboard && npm run lint:locales`
Expected: PASS (pl i en mają identyczny zbiór kluczy).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "i18n(estimates): keys for client filter + estimate report"
```

---

## Task 12: Help.tsx — nowa sekcja (wymóg CLAUDE.md)

**Files:**
- Modify: `dashboard/src/pages/Help.tsx`

- [ ] **Step 1: Zlokalizuj sekcję pomocy dla estymacji**

Run: `cd dashboard && grep -n "estimates" src/pages/Help.tsx`
Cel: znaleźć istniejący blok pomocy o panelu Estymacje (sekcja/akordeon), by dopisać treść w tym samym formacie.

- [ ] **Step 2: Dodaj treść pomocy**

W bloku pomocy dla Estymacji (zachowując format istniejących sekcji — nagłówek + lista) dodaj opis nowych funkcji. Tekst (PL; jeśli Help.tsx korzysta z `t()`, dodaj klucze do obu locale i użyj `t()`, w przeciwnym razie wpisz literalnie po polsku zgodnie z konwencją pliku):

- „Filtr klientów" — Wybierz, których klientów projekty mają być liczone w metrykach i raporcie. Domyślnie liczeni są wszyscy. Opcja „Bez klienta" obejmuje projekty nieprzypisane.
- „Generuj raport" — Tworzy uproszczony raport z bieżącego zakresu dat i wybranych klientów. Dwa warianty: „uproszczony" (projekty + łączny czas i wartość) oraz „plus" (dodatkowo rozbicie na dni z godzinami i wartością). Warianty to szablony estymacji — edytujesz je w „Edytorze szablonów raportów".
- „Zaokrąglenia" — Raport respektuje ustawienia zaokrąglania (przełącznik „pełny / zaokrąglony"), tak jak raporty projektów.
- „PDF" — Raport drukujesz/zapisujesz jako PDF przyciskiem drukowania (jak pozostałe raporty).

> Jeśli plik używa `t()` — dodaj klucze np. `help.estimates.client_filter_*` do pl i en (parytet) i odwołaj się przez `t()`. Jeśli używa literałów — wpisz polskie zdania. Sprawdź sąsiednie sekcje, by dobrać właściwą metodę.

- [ ] **Step 3: Typecheck + lint**

Run: `cd dashboard && npx tsc -b && npx eslint src/pages/Help.tsx && npm run lint:locales`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Help.tsx dashboard/src/locales
git commit -m "docs(help): document estimate client filter + report variants"
```

---

## Task 13: Weryfikacja końcowa

**Files:** brak zmian (weryfikacja).

- [ ] **Step 1: Pełny typecheck + lint**

Run: `cd dashboard && npm run lint && npx tsc -b`
Expected: PASS (eslint + i18n-hardcoded + inline-i18n-bridge + locales).

- [ ] **Step 2: Testy frontend**

Run: `cd dashboard && npm test`
Expected: PASS (w tym `estimate-report.test.ts`, `report-templates.test.ts`, `rounding.test.ts`).

- [ ] **Step 3: Testy Rust**

Run: `cd dashboard/src-tauri && cargo test --lib commands::estimates`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `cd dashboard && npm run build`
Expected: PASS.

- [ ] **Step 5: React Doctor (z ROOTA repo — patrz CLAUDE.md)**

Run: `cd /Users/micz/__DEV__/__cfab_demon && npx -y react-doctor@latest . --verbose`
Expected: 100/100 (jeśli ~49/100 z „security" na `.py` → config się nie załadował, nie regresja).

- [ ] **Step 6: Test manualny (dev)**

Uruchom dashboard (`npm run dev` lub Tauri). Scenariusze:
1. Panel Estymacje pokazuje pasek filtra klientów z istniejącymi klientami + „Bez klienta". Domyślnie wszystkie aktywne → metryki = pełna suma.
2. Odznaczenie klienta zmienia metryki (czas/wartość/liczba projektów/override'y).
3. „Generuj raport" → selektor pokazuje 2 szablony estymacji. Wybór „uproszczony" → tabela Projekt|Czas|Wartość + Razem; sumy zgodne z metrykami przy tym samym filtrze i trybie „pełny".
4. Wariant „plus" → dla każdego projektu rozbicie Data|Czas|Wartość; suma dni = total projektu w trybie `per_day`.
5. Przełącznik „pełny/zaokrąglony" zmienia czasy i wartości; w trybie `per_day` każdy dzień zaokrąglony do pełnej godziny.
6. Druk → PDF: tytuł `timeflow_raport_estymacji`, logo wg `showLogo` szablonu, brak chrome aplikacji.
7. Edytor szablonów (`reports`): aktywując szablon estymacji widać sekcje est_* (nie projektowe); „Nowy" przy aktywnym szablonie estymacji tworzy szablon `kind='estimate'`.
8. Istniejące szablony projektowe i raport projektu działają bez zmian (back-compat).

- [ ] **Step 7: Commit wersji (jeśli repo bumpuje wersję)**

> Opcjonalnie/jeśli wymagane: `cd dashboard && node scripts/sync-version.cjs` jest wpięte w `pretauri`. Bump wersji rób zgodnie z konwencją repo tylko jeśli o to poproszono.

---

## Self-Review (autor planu)

- **Spec coverage:**
  - Filtr klientów (multi-select + „bez klienta") → Task 1 (`client_name`), Task 3 (`clientFilterOptions`/`filterRowsByClients`), Task 8 (UI). ✓
  - Raport z ekranu estymacji → Task 8 (przycisk+selektor), Task 9-10 (widok). ✓
  - Wariant uproszczony (projekty + łączny czas + wartość) → sekcja `est_summary` (Task 5, 10). ✓
  - Wariant plus (dni z godzinami) → `days` (Task 1), `est_per_day` (Task 5, 10). ✓
  - Zaokrąglenia jak w innych ekranach → Task 3 (`buildEstimateReportModel` reużywa `rounding.ts`), Task 9-10 (toggle). ✓
  - Wartość ($) → `estimated_value`/`scaleValueToRounded` (Task 3). ✓
  - Generowanie jak obecnie (window.print → PDF) → Task 9 `handlePrint`, Task 10 CSS print. ✓
  - Szablony w edytorze jako dodatkowa opcja → Task 4 (`kind` + seed), Task 6 (edytor wg `kind`). ✓
  - Help.tsx → Task 12. ✓
- **Placeholder scan:** brak TBD/TODO; każdy krok z kodem ma kod, każdy krok z komendą ma komendę i oczekiwany wynik. ✓
- **Type consistency:** `EstimateDay{date,seconds}` spójne Rust↔TS↔model; `EstimateReportConfig{clients,dateRange,templateId}` użyte w ui-store (Task 7), zapisie (Task 8) i odczycie (Task 9); `EstimateReportModel.projects[].days[].{displaySeconds,displayValue,date}` używane w dokumencie (Task 10); klucze sekcji `est_header/est_summary/est_per_day/est_footer` spójne między rejestrem (Task 5), seedem szablonów (Task 4), domyślnymi id (Task 5) i dokumentem (Task 10). ✓
- **Znana subtelność:** w trybach innych niż `per_day` suma zaokrąglonych dni w wariancie „plus" może przewyższać zaokrąglony total projektu (każdy total liczony własną regułą). Udokumentowane w `estimate-report.ts`; wariant „plus" jest najbardziej spójny z trybem `per_day`.
