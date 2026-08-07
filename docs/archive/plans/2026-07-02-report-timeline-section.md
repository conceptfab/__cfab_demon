# Sekcja „Oś czasu" (Timeline) w raporcie PDF — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nowa sekcja raportu projektu „Oś czasu", która scala chronologicznie sesje automatyczne, sesje manualne i komentarze (komentarz renderowany bezpośrednio pod sesją, której dotyczy), pogrupowane po dniach rosnąco. Istniejące sekcje (`sessions`, `comments`, `manual_sessions`, …) zostają bez zmian.

**Architecture:** Raport to widok HTML drukowany natywnie do PDF (`ReportViewDocument.tsx` renderuje sekcje sekwencyjnie; szablon steruje tylko widocznością przez `has(id)`). Dane przychodzą jednym obiektem `ProjectReportData` (`sessions: SessionWithApp[]`, `manual_sessions: ManualSessionWithProject[]`). „Komentarz" NIE jest osobną encją — to pole `comment` sesji automatycznej. Timeline budujemy czystą funkcją `buildTimelineDays()` w nowym pliku lib (testowalna bez Reacta), wynik memoizujemy w `useReportViewController` i renderujemy nowym komponentem sekcji. Sekcja `timeline` trafia do `DEFAULT_SECTIONS` **obok** istniejących (decyzja użytkownika) + jednorazowa migracja dopisująca ją do zapisanego w localStorage szablonu `default`.

**Tech Stack:** React 19 + TypeScript, Tailwind (klasy `print:`), date-fns, i18next (pl+en, lint spójności locali), vitest. Backend (Rust/Tauri) — **bez zmian**, dane już zawierają wszystko, co potrzebne.

**Decyzje użytkownika (z klaryfikacji):**
1. `timeline` dodany do domyślnego szablonu obok istniejących sekcji (nic nie usuwamy z defaults).
2. Grupowanie po dniach, dni i wpisy rosnąco (najstarsze pierwsze), nagłówek dnia z datą i dniem tygodnia, suma czasu dnia.
3. Pozostałe bloki zostają („na wszelki wypadek") — zero zmian w ich kodzie.

**Kluczowe pliki referencyjne (wzorce):**
- Kompozycja dokumentu: `dashboard/src/pages/report-view/ReportViewDocument.tsx`
- Wzorzec sekcji: `dashboard/src/pages/report-view/ReportViewSessionsSection.tsx`
- Controller: `dashboard/src/hooks/useReportViewController.ts` (zwraca obiekt; `ReportViewController = ReturnType<...>`)
- Szablony: `dashboard/src/lib/report-templates.ts` (`DEFAULT_SECTIONS`, `loadTemplates`, `normalizeTemplate`)
- Rejestr sekcji edytora: `dashboard/src/pages/reports/reports-page-sections.tsx` (`REPORT_PAGE_SECTIONS`)
- Typy: `dashboard/src/lib/db-types.ts` (`SessionWithApp` :77, `ManualSessionWithProject` :496, `ProjectReportData` :342)
- Help: `dashboard/src/components/help/sections/HelpReportsSection.tsx`
- Locale: `dashboard/src/locales/pl/common.json`, `dashboard/src/locales/en/common.json`

**Komendy (wszystkie z katalogu `dashboard/`):**
- Testy: `npm test` lub celowane `npx vitest run src/lib/report-timeline.test.ts`
- Typecheck: `npm run typecheck`
- Lint (w tym spójność locali!): `npm run lint`
- React Doctor (z **roota repo**): `npx -y react-doctor@latest . --verbose` — oczekiwany wynik **100/100**

---

## Struktura plików

| Plik | Akcja | Odpowiedzialność |
|---|---|---|
| `dashboard/src/lib/report-timeline.ts` | Create | Typy `TimelineEntry`/`TimelineDay` + czysta funkcja `buildTimelineDays()` (merge + sort + grupowanie po dniach) |
| `dashboard/src/lib/report-timeline.test.ts` | Create | Testy jednostkowe buildera |
| `dashboard/src/hooks/useReportViewController.ts` | Modify | `timelineDays` w `useMemo` + eksport w zwracanym obiekcie |
| `dashboard/src/pages/report-view/ReportViewTimelineSection.tsx` | Create | Render sekcji (dni → wpisy → komentarz pod sesją) |
| `dashboard/src/pages/report-view/ReportViewDocument.tsx` | Modify | Wpięcie sekcji do dokumentu (po sekcji AI, przed `sessions`) |
| `dashboard/src/pages/reports/reports-page-sections.tsx` | Modify | Rejestracja `timeline` w edytorze szablonów (label + preview) |
| `dashboard/src/lib/report-templates.ts` | Modify | `'timeline'` w `DEFAULT_SECTIONS` + jednorazowa migracja szablonu `default` |
| `dashboard/src/lib/report-templates.test.ts` | Modify | Testy migracji |
| `dashboard/src/locales/pl/common.json` + `en/common.json` | Modify | Klucze `report_view.*`, `reports_page.sections.timeline`, `reports_page.preview.timeline.*`, `help_page.*` |
| `dashboard/src/components/help/sections/HelpReportsSection.tsx` | Modify | Wpis o nowej sekcji (wymóg CLAUDE.md) |

---

### Task 1: Builder danych timeline (`buildTimelineDays`)

**Files:**
- Create: `dashboard/src/lib/report-timeline.ts`
- Test: `dashboard/src/lib/report-timeline.test.ts`

- [ ] **Step 1: Napisz failujące testy**

Utwórz `dashboard/src/lib/report-timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';
import { buildTimelineDays } from '@/lib/report-timeline';

function makeAuto(over: Partial<SessionWithApp>): SessionWithApp {
  return {
    id: 1,
    app_id: 1,
    project_id: 1,
    start_time: '2026-03-01T09:00:00',
    end_time: '2026-03-01T10:00:00',
    duration_seconds: 3600,
    app_name: 'VS Code',
    ...over,
  } as SessionWithApp;
}

function makeManual(
  over: Partial<ManualSessionWithProject>,
): ManualSessionWithProject {
  return {
    id: 1,
    title: 'Spotkanie',
    session_type: 'meeting',
    project_id: 1,
    project_name: 'P',
    start_time: '2026-03-01T12:00:00',
    end_time: '2026-03-01T13:00:00',
    duration_seconds: 3600,
    date: '2026-03-01',
    ...over,
  } as ManualSessionWithProject;
}

describe('buildTimelineDays', () => {
  it('returns empty array for empty inputs', () => {
    expect(buildTimelineDays([], [])).toEqual([]);
  });

  it('merges auto and manual sessions sorted ascending by start_time', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, start_time: '2026-03-01T14:00:00' }),
        makeAuto({ id: 2, start_time: '2026-03-01T08:00:00' }),
      ],
      [makeManual({ id: 7, start_time: '2026-03-01T10:00:00' })],
    );
    expect(days).toHaveLength(1);
    expect(days[0].entries.map((e) => e.key)).toEqual([
      'auto-2',
      'manual-7',
      'auto-1',
    ]);
  });

  it('groups by day (ascending) and sums day totals', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, start_time: '2026-03-02T09:00:00', duration_seconds: 600 }),
        makeAuto({ id: 2, start_time: '2026-03-01T09:00:00', duration_seconds: 100 }),
      ],
      [makeManual({ id: 3, start_time: '2026-03-01T11:00:00', duration_seconds: 200 })],
    );
    expect(days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(days[0].totalSeconds).toBe(300);
    expect(days[1].totalSeconds).toBe(600);
  });

  it('attaches trimmed comment to auto entries; blank comment becomes null', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, comment: '  refactor raportu  ' }),
        makeAuto({ id: 2, start_time: '2026-03-01T11:00:00', comment: '   ' }),
      ],
      [],
    );
    expect(days[0].entries[0].comment).toBe('refactor raportu');
    expect(days[0].entries[1].comment).toBeNull();
  });

  it('manual entries carry sessionType and never a comment', () => {
    const days = buildTimelineDays([], [makeManual({ id: 5 })]);
    const entry = days[0].entries[0];
    expect(entry.kind).toBe('manual');
    expect(entry.sessionType).toBe('meeting');
    expect(entry.comment).toBeNull();
    expect(entry.label).toBe('Spotkanie');
  });
});
```

- [ ] **Step 2: Uruchom testy — mają failować (brak modułu)**

Run: `cd dashboard && npx vitest run src/lib/report-timeline.test.ts`
Expected: FAIL — `Cannot find module '@/lib/report-timeline'` (lub równoważny błąd resolve).

- [ ] **Step 3: Implementacja**

Utwórz `dashboard/src/lib/report-timeline.ts`:

```ts
import { format, parseISO } from 'date-fns';

import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';

export interface TimelineEntry {
  key: string;
  kind: 'auto' | 'manual';
  startTime: string;
  label: string;
  durationSeconds: number;
  /** Komentarz sesji automatycznej (trimmed) — null gdy brak. Sesje manualne nie mają komentarzy. */
  comment: string | null;
  /** Typ sesji manualnej (np. 'meeting') — null dla sesji automatycznych. */
  sessionType: string | null;
}

export interface TimelineDay {
  /** 'yyyy-MM-dd' */
  date: string;
  totalSeconds: number;
  entries: TimelineEntry[];
}

export function buildTimelineDays(
  sessions: SessionWithApp[],
  manualSessions: ManualSessionWithProject[],
): TimelineDay[] {
  const entries: TimelineEntry[] = [
    ...sessions.map((s) => ({
      key: `auto-${s.id}`,
      kind: 'auto' as const,
      startTime: s.start_time,
      label: s.app_name,
      durationSeconds: s.duration_seconds,
      comment: s.comment?.trim() ? s.comment.trim() : null,
      sessionType: null,
    })),
    ...manualSessions.map((s) => ({
      key: `manual-${s.id}`,
      kind: 'manual' as const,
      startTime: s.start_time,
      label: s.title,
      durationSeconds: s.duration_seconds,
      comment: null,
      sessionType: s.session_type,
    })),
  ].sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime(),
  );

  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const date = format(parseISO(entry.startTime), 'yyyy-MM-dd');
    const last = days[days.length - 1];
    if (last && last.date === date) {
      last.entries.push(entry);
      last.totalSeconds += entry.durationSeconds;
    } else {
      days.push({
        date,
        totalSeconds: entry.durationSeconds,
        entries: [entry],
      });
    }
  }
  return days;
}
```

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `cd dashboard && npx vitest run src/lib/report-timeline.test.ts`
Expected: PASS (5 testów).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/report-timeline.ts dashboard/src/lib/report-timeline.test.ts
git commit -m "feat(report): add buildTimelineDays merging auto/manual sessions chronologically

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `timelineDays` w controllerze

**Files:**
- Modify: `dashboard/src/hooks/useReportViewController.ts` (importy ~linia 5-18, nowe memo po `sessionStats` ~linia 146, return ~linia 150-172)

- [ ] **Step 1: Dodaj import**

W bloku importów (obok `import { getTemplate } from '@/lib/report-templates';`):

```ts
import { buildTimelineDays } from '@/lib/report-timeline';
```

- [ ] **Step 2: Dodaj memo po `sessionStats` (za linią ~146, przed `const goToProject`)**

```ts
const timelineDays = useMemo(() => {
  if (!report) return null;
  return buildTimelineDays(report.sessions, report.manual_sessions);
}, [report]);
```

- [ ] **Step 3: Dodaj `timelineDays` do zwracanego obiektu**

W `return { ... }` dopisz alfabetycznie (po `template` lub po `showAll` — utrzymaj istniejący porządek; obecnie klucze są ~alfabetyczne, więc między `t,` a `template,`):

```ts
    t,
    template,
    timelineDays,
```

- [ ] **Step 4: Typecheck**

Run: `cd dashboard && npm run typecheck`
Expected: PASS (0 błędów). `ReportViewController` to `ReturnType<typeof useReportViewController>`, więc typ propaguje się automatycznie.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/hooks/useReportViewController.ts
git commit -m "feat(report): expose timelineDays from useReportViewController

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Komponent `ReportViewTimelineSection`

**Files:**
- Create: `dashboard/src/pages/report-view/ReportViewTimelineSection.tsx`

Wzorzec stylów skopiowany 1:1 z `ReportViewSessionsSection.tsx` (nagłówek h2, tabela `text-[11px]`, klasy `print:`). Komentarz renderowany jako dodatkowy wiersz tabeli bezpośrednio pod wierszem swojej sesji.

- [ ] **Step 1: Utwórz komponent**

```tsx
import { Fragment } from 'react';
import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';
import i18n from '@/i18n';
import type { TimelineDay } from '@/lib/report-timeline';

type ReportViewTimelineSectionProps = Pick<
  ReportViewController,
  | 'fmtDur'
  | 'has'
  | 'screenLimit'
  | 'setShowAll'
  | 'showAll'
  | 't'
  | 'timelineDays'
>;

function weekdayName(date: string): string {
  return parseISO(date).toLocaleDateString(i18n.language, { weekday: 'long' });
}

export function ReportViewTimelineSection({
  fmtDur,
  has,
  screenLimit,
  setShowAll,
  showAll,
  t,
  timelineDays,
}: ReportViewTimelineSectionProps) {
  if (!timelineDays || !has('timeline') || timelineDays.length === 0) {
    return null;
  }

  const totalEntries = timelineDays.reduce(
    (sum, day) => sum + day.entries.length,
    0,
  );

  // Na ekranie tniemy po liczbie wpisów (pełnymi dniami); print zawsze dostaje
  // całość, bo handlePrint włącza showAll przy dużych raportach.
  const visibleDays: TimelineDay[] = [];
  let shownEntries = 0;
  for (const day of timelineDays) {
    if (!showAll && shownEntries >= screenLimit) break;
    visibleDays.push(day);
    shownEntries += day.entries.length;
  }

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.timeline')} ({totalEntries})
      </h2>
      <div className="space-y-3">
        {visibleDays.map((day) => (
          <div key={day.date}>
            <div className="flex items-baseline justify-between border-b border-border/20 print:border-gray-300 pb-0.5 mb-0.5">
              <span className="text-[10px] font-semibold font-mono text-muted-foreground/70 print:text-gray-700">
                {day.date}{' '}
                <span className="font-normal text-muted-foreground/40 print:text-gray-500">
                  · {weekdayName(day.date)}
                </span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/60 print:text-gray-600">
                {fmtDur(day.totalSeconds)}
              </span>
            </div>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {day.entries.map((entry) => (
                  <Fragment key={entry.key}>
                    <tr className="border-b border-border/10 print:border-gray-100">
                      <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap w-12">
                        {format(parseISO(entry.startTime), 'HH:mm')}
                      </td>
                      <td className="py-1 pr-2 text-muted-foreground/50 print:text-gray-600 whitespace-nowrap w-14">
                        {entry.kind === 'manual'
                          ? t('report_view.timeline_manual')
                          : t('report_view.timeline_auto')}
                      </td>
                      <td className="py-1 pr-2 truncate max-w-[200px] print:text-black">
                        {entry.label}
                        {entry.sessionType ? (
                          <span className="text-muted-foreground/50 print:text-gray-600">
                            {' '}
                            · {entry.sessionType}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 font-mono text-right print:text-black whitespace-nowrap">
                        {fmtDur(entry.durationSeconds)}
                      </td>
                    </tr>
                    {entry.comment && (
                      <tr className="border-b border-border/10 print:border-gray-100">
                        <td />
                        <td
                          colSpan={3}
                          className="py-1 pl-2 text-muted-foreground/50 italic print:text-gray-600"
                        >
                          └ {entry.comment}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {!showAll && totalEntries > screenLimit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
        >
          {t('report_view.show_all')} ({totalEntries})
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npm run typecheck`
Expected: PASS. (Komponent jeszcze nie jest nigdzie używany — to OK, wpinamy w Task 4.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/report-view/ReportViewTimelineSection.tsx
git commit -m "feat(report): add ReportViewTimelineSection component (day-grouped merged timeline)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wpięcie do dokumentu, rejestracja sekcji, DEFAULT_SECTIONS + migracja

**Files:**
- Modify: `dashboard/src/pages/report-view/ReportViewDocument.tsx:1-30`
- Modify: `dashboard/src/pages/reports/reports-page-sections.tsx` (wstawka między `ai` a `sessions`, ~linia 114)
- Modify: `dashboard/src/lib/report-templates.ts:24` + `loadTemplates()`
- Test: `dashboard/src/lib/report-templates.test.ts`

- [ ] **Step 1: Napisz failujące testy migracji**

Dopisz do `dashboard/src/lib/report-templates.test.ts` (wewnątrz istniejącego `describe`, korzysta z istniejącego `beforeEach` czyszczącego localStorage):

```ts
  it('adds timeline to stored default template once (before sessions)', async () => {
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'sessions', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toEqual([
      'header', 'timeline', 'sessions', 'footer',
    ]);
  });

  it('does not re-add timeline after user removed it (migration runs once)', async () => {
    localStorage.setItem('timeflow_report_timeline_added', '1');
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'sessions', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toEqual([
      'header', 'sessions', 'footer',
    ]);
  });

  it('includes timeline in freshly seeded default template', async () => {
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toContain('timeline');
  });
```

- [ ] **Step 2: Uruchom testy — 3 nowe mają failować**

Run: `cd dashboard && npx vitest run src/lib/report-templates.test.ts`
Expected: FAIL (brak `'timeline'` w sekcjach).

- [ ] **Step 3: Zmiany w `report-templates.ts`**

Zmień linię 24:

```ts
const DEFAULT_SECTIONS = ['header', 'stats', 'financials', 'apps', 'timeline', 'sessions', 'comments', 'footer'];
```

Pod stałą `SELECTED_KEY` (linia 16) dodaj:

```ts
const TIMELINE_MIGRATION_KEY = 'timeflow_report_timeline_added';
```

Nad `loadTemplates()` dodaj funkcję migracji:

```ts
/** Jednorazowo dopisuje sekcję 'timeline' do zapisanego szablonu 'default' (przed 'sessions'). */
function ensureTimelineSection(list: ReportTemplate[]): ReportTemplate[] {
  if (localStorage.getItem(TIMELINE_MIGRATION_KEY)) return list;
  localStorage.setItem(TIMELINE_MIGRATION_KEY, '1');
  let changed = false;
  const next = list.map((t) => {
    if (t.id !== 'default' || t.kind !== 'project' || t.sections.includes('timeline')) {
      return t;
    }
    const sections = [...t.sections];
    const idx = sections.indexOf('sessions');
    sections.splice(idx >= 0 ? idx : sections.length, 0, 'timeline');
    changed = true;
    return { ...t, sections };
  });
  return changed ? next : list;
}
```

W `loadTemplates()` zamień końcówkę bloku `try` (obecne linie 112-116):

```ts
    const withEstimates = ensureEstimateTemplates(base);
    const withTimeline = ensureTimelineSection(withEstimates);
    if (withTimeline !== withEstimates || withEstimates.length !== base.length) {
      saveTemplates(withTimeline);
    }
    return withTimeline;
```

Uwaga: w gałęzi świeżego seeda (brak `raw`) `DEFAULT_SECTIONS` już zawiera `'timeline'` — nic więcej nie trzeba; flaga zostanie ustawiona przy kolejnym `loadTemplates`, a warunek `includes('timeline')` chroni przed duplikatem.

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `cd dashboard && npx vitest run src/lib/report-templates.test.ts`
Expected: PASS (2 stare + 3 nowe).

- [ ] **Step 5: Wpięcie do `ReportViewDocument.tsx`**

Dodaj import (alfabetycznie, po `ReportViewStatsSection`):

```tsx
import { ReportViewTimelineSection } from '@/pages/report-view/ReportViewTimelineSection';
```

W JSX wstaw sekcję między `ReportViewAiSection` a `ReportViewSessionsSection` (linie 25-26):

```tsx
        <ReportViewAiSection {...controller} />
        <ReportViewTimelineSection {...controller} />
        <ReportViewSessionsSection {...controller} />
```

- [ ] **Step 6: Rejestracja w edytorze szablonów**

W `dashboard/src/pages/reports/reports-page-sections.tsx` wstaw nowy wpis do `REPORT_PAGE_SECTIONS` między obiekt `id: 'ai'` a `id: 'sessions'` (po ~linii 114):

```tsx
  {
    id: 'timeline',
    labelKey: 'reports_page.sections.timeline',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.timeline.line_1'),
          t('reports_page.preview.timeline.line_2'),
          t('reports_page.preview.timeline.line_3'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
```

- [ ] **Step 7: Typecheck**

Run: `cd dashboard && npm run typecheck`
Expected: PASS. (Lint locali jeszcze failuje — klucze i18n dochodzą w Task 5; NIE uruchamiaj tu pełnego `npm run lint`.)

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/pages/report-view/ReportViewDocument.tsx dashboard/src/pages/reports/reports-page-sections.tsx dashboard/src/lib/report-templates.ts dashboard/src/lib/report-templates.test.ts
git commit -m "feat(report): wire timeline section into document, template editor and defaults with one-time migration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Klucze i18n (pl + en)

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

Skrypt `npm run lint:locales` wymusza identyczny zestaw kluczy w obu plikach — dodawaj parami.

- [ ] **Step 1: PL — `report_view` (blok zaczyna się ~linia 1564)**

Po kluczu `"pdf_prefix": "timeflow_raport"` NIE dodawaj (ostatni klucz) — zamiast tego po `"type": "Typ",` dodaj:

```json
    "timeline": "Oś czasu",
    "timeline_auto": "auto",
    "timeline_manual": "ręczna",
```

- [ ] **Step 2: PL — `reports_page.sections` (blok ~linia 1226 w obrębie `reports_page`)**

Po `"sessions": "Lista sesji",` — a przed `"comments"` — dodaj:

```json
      "timeline": "Oś czasu (sesje + komentarze)",
```

- [ ] **Step 3: PL — `reports_page.preview` — nowy obiekt `timeline`**

Obok istniejących obiektów preview (np. po obiekcie `"sessions"` w `preview`):

```json
      "timeline": {
        "line_1": "2026-03-06 · piątek · 4h 10m",
        "line_2": "09:12  auto  VS Code  1h 30m",
        "line_3": "└ komentarz: refaktoryzacja modułu raportów"
      },
```

- [ ] **Step 4: EN — lustrzane klucze w `dashboard/src/locales/en/common.json`**

`report_view` (po `"type"`):

```json
    "timeline": "Timeline",
    "timeline_auto": "auto",
    "timeline_manual": "manual",
```

`reports_page.sections` (po `"sessions"`):

```json
      "timeline": "Timeline (sessions + comments)",
```

`reports_page.preview` (analogiczna pozycja jak w PL):

```json
      "timeline": {
        "line_1": "2026-03-06 · Friday · 4h 10m",
        "line_2": "09:12  auto  VS Code  1h 30m",
        "line_3": "└ comment: report module refactor"
      },
```

- [ ] **Step 5: Lint locali**

Run: `cd dashboard && npm run lint:locales`
Expected: PASS (spójne klucze pl/en).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "feat(report): add pl/en i18n keys for timeline section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Help.tsx — dokumentacja funkcji (wymóg CLAUDE.md §3)

**Files:**
- Modify: `dashboard/src/components/help/sections/HelpReportsSection.tsx:24` (lista `features`)
- Modify: `dashboard/src/locales/pl/common.json` (namespace `help_page`)
- Modify: `dashboard/src/locales/en/common.json` (namespace `help_page`)

- [ ] **Step 1: Dodaj wpis do listy `features`**

W `HelpReportsSection.tsx`, po linii z kluczem `help_page.additional_sections_boosts_sessions_with_time_multiplier` dodaj:

```tsx
        t18n('help_page.timeline_section_merged_chronological_view'),
```

- [ ] **Step 2: Klucz PL w `help_page` (znajdź blok `"help_page"` w pl/common.json i dodaj obok kluczy o raportach)**

```json
    "timeline_section_merged_chronological_view": "Sekcja „Oś czasu\": łączy sesje automatyczne, sesje ręczne i komentarze w jeden chronologiczny widok pogrupowany po dniach (najstarsze pierwsze). Komentarz wyświetla się bezpośrednio pod sesją, której dotyczy, a każdy dzień ma sumę czasu. Sekcję można włączyć/wyłączyć w edytorze szablonu raportu; dotychczasowe sekcje (Lista sesji, Komentarze, Sesje ręczne) działają bez zmian.",
```

- [ ] **Step 3: Klucz EN w `help_page` (en/common.json, ta sama pozycja)**

```json
    "timeline_section_merged_chronological_view": "\"Timeline\" section: merges automatic sessions, manual sessions and comments into a single chronological view grouped by day (oldest first). Each comment appears directly under the session it belongs to, and every day shows its total time. Toggle the section in the report template editor; the existing sections (Sessions list, Comments, Manual sessions) keep working unchanged.",
```

- [ ] **Step 4: Weryfikacja lint (w tym hardcoded-i18n i locale-consistency)**

Run: `cd dashboard && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/help/sections/HelpReportsSection.tsx dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "docs(help): document report timeline section in Help panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Weryfikacja końcowa

**Files:** brak nowych zmian (tylko weryfikacja; ewentualne poprawki commitowane osobno).

- [ ] **Step 1: Pełne testy**

Run: `cd dashboard && npm test`
Expected: PASS — wszystkie suity, w tym `report-timeline.test.ts` (5) i `report-templates.test.ts` (5).

- [ ] **Step 2: Typecheck + lint**

Run: `cd dashboard && npm run typecheck && npm run lint`
Expected: PASS bez błędów.

- [ ] **Step 3: React Doctor (z roota repo!)**

Run: `cd /Users/micz/__DEV__/__TIMEFLOW/__cfab_demon && npx -y react-doctor@latest . --verbose`
Expected: **100/100**. Jeśli ~49/100 z błędami „security" na `.py` — config się nie załadował (sprawdź root `doctor.config.json`).

- [ ] **Step 4: Test manualny (scenariusze — brak testów E2E w repo)**

1. `cd dashboard && npm run dev` (lub `npm run tauri dev`), otwórz projekt z sesjami auto (część z komentarzami) i sesjami manualnymi, wejdź w widok raportu.
2. Sekcja „Oś czasu" widoczna między „Dane AI" a „Lista sesji" (gdy `ai` wyłączone — między „Top aplikacje" a „Lista sesji"); dni rosnąco, nagłówek dnia = data + dzień tygodnia + suma; komentarze pod swoimi sesjami z „└"; sesje manualne oznaczone „ręczna" + typ.
3. Stare sekcje „Lista sesji", „Komentarze" renderują się jak dotąd (nic nie zniknęło).
4. Edytor szablonów: sekcja „Oś czasu (sesje + komentarze)" na liście z podglądem; wyłączenie usuwa blok z raportu; po wyłączeniu i przeładowaniu apki sekcja NIE wraca sama (flaga migracji).
5. Drukuj/PDF: przy >50 wpisach blok rozwija się w druku w całości (mechanizm `showAll` w `handlePrint`); układ czytelny w czerni (klasy `print:`).
6. Przełącz język PL↔EN — etykiety sekcji, badge „auto/ręczna|manual" i dzień tygodnia zmieniają się.

- [ ] **Step 5: Finalny commit (jeśli były poprawki po weryfikacji)**

```bash
git add -A && git commit -m "fix(report): post-verification adjustments for timeline section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Ryzyka / uwagi dla wykonawcy

- **Backend bez zmian** — `ProjectReportData` już zawiera `sessions` (z `comment`) i `manual_sessions`. Nie dotykaj plików Rust.
- **Kolejność sekcji w dokumencie jest sztywna** w `ReportViewDocument.tsx` — szablon steruje tylko widocznością (`has(id)`). Nie próbuj renderować wg kolejności z szablonu (to zmiana zachowania innych sekcji = poza zakresem).
- **`normalizeTemplate` filtruje sekcję `'files'`** — nie ruszaj tej logiki; `'timeline'` przechodzi przez normalize bez zmian.
- **Migracja jest jednorazowa** (flaga w localStorage), żeby użytkownik mógł trwale wyłączyć sekcję. Duplikatów chroni `includes('timeline')`.
- **Nie zmieniaj** istniejących sekcji `sessions`/`comments`/`manual_sessions` — wymóg użytkownika („pozostałe bloki zostaw na wszelki wypadek").
- `dashboard.pdf` w rocie repo to artefakt wydruku — nie commituj jego zmian.
