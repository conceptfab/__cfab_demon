# React Performance Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate two O(n²) `indexOf` hot paths in the PM projects list, defer search filtering off the keystroke path, and collapse a double-pass reduce in the estimate report — all behavior-preserving.

**Architecture:** Introduce one pure, unit-tested helper (`buildProjectIndexMap`) that turns reference lookups into an O(1) `Map`, and reuse it in both the `sortPmProjects` "global" branch and the controller's `originalIndices`. Search inputs stay bound to immediate state for UI responsiveness while the expensive filtering reads a `useDeferredValue`. The estimate-report totals become a single reduce.

**Tech Stack:** React 19, TypeScript, Vite, Vitest (`vitest run`). Commands run from `dashboard/`.

**Scope note:** This is a refactor of existing behavior — no new UI, no new feature, so `Help.tsx` does NOT need updating (per CLAUDE.md §3). Pure functions get real red→green tests; React-hook wiring (which the project has no `renderHook` infra for) is verified by typecheck + build + manual checks, stated honestly per task. These fixes are unrelated to the current `feature/estimate-client-report` branch work — see "Execution Handoff" for branch/worktree guidance.

**Out of scope (documented follow-ups, deliberately NOT in this plan):**
- AI controller `Promise.all` parallelization (`useAiPageController.ts:383-384`, `:411-412`) — independent fetches, but these fire on admin button clicks (train / rollback) where the user already waits; low perceived impact, hook-handler code with no unit-test infra. Revisit only if AI actions feel slow.
- `PmProjectsDesktopTable` virtualization (`:143`) — bounded to <200 rows today; virtualizing a `<table>` is a real UI change with regression risk and deserves its own decision.
- Sessions inline-props / `memo` on `SessionsToolbar`/`SessionsVirtualList` — cosmetic: the hot path (`Virtuoso` + memoized `SessionRow`) is already protected, so there is no memo boundary to gain from.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `dashboard/src/lib/pm-projects-list-utils.ts` | Pure PM list helpers (sort/format) | Add `buildProjectIndexMap`; refactor `sortPmProjects` global branch |
| `dashboard/src/lib/pm-projects-list-utils.test.ts` | Unit tests for the above | **Create** |
| `dashboard/src/hooks/usePmProjectsListController.ts` | PM list state/controller | Use `buildProjectIndexMap` for `originalIndices`; defer `search` in `displayed` |
| `dashboard/src/hooks/useProjectsPageController.tsx` | Projects page state/controller | Defer `search` in `filteredProjects` / `filteredExcludedProjects` |
| `dashboard/src/lib/estimate-report.ts` | Estimate report model builder | Collapse two `reduce` passes into one |
| `dashboard/src/lib/estimate-report.test.ts` | Estimate report tests | Add totals characterization test |

---

## Task 1: `buildProjectIndexMap` helper + O(1) `sortPmProjects` global sort

**Why:** `sortPmProjects` global branch calls `allProjects.indexOf(a) - allProjects.indexOf(b)` inside the sort comparator → O(n² log n) on the PM list (up to ~200 projects). Replace the reference scan with a one-time `Map<PmProject, number>`. Keying by object reference exactly matches `indexOf`'s `===` semantics (no assumption about `prj_code` uniqueness).

**Files:**
- Create: `dashboard/src/lib/pm-projects-list-utils.test.ts`
- Modify: `dashboard/src/lib/pm-projects-list-utils.ts` (add helper; rewrite global branch at lines 43-48)

- [ ] **Step 1: Write the test file (pins current global-sort order + drives the new helper)**

Create `dashboard/src/lib/pm-projects-list-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildProjectIndexMap,
  sortPmProjects,
} from '@/lib/pm-projects-list-utils';
import type { PmProject } from '@/lib/pm-types';

function proj(partial: Partial<PmProject>): PmProject {
  return {
    prj_folder: '',
    prj_number: '001',
    prj_year: '2026',
    prj_code: 'C001',
    prj_client: 'ACME',
    prj_name: 'Name',
    prj_desc: '',
    prj_full_name: '',
    prj_budget: '',
    prj_term: '',
    prj_status: 'active',
    ...partial,
  };
}

describe('buildProjectIndexMap', () => {
  it('maps each project reference to its index', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const c = proj({ prj_code: 'C' });
    const map = buildProjectIndexMap([a, b, c]);
    expect(map.get(a)).toBe(0);
    expect(map.get(b)).toBe(1);
    expect(map.get(c)).toBe(2);
  });

  it('returns an empty map for an empty list', () => {
    expect(buildProjectIndexMap([]).size).toBe(0);
  });
});

describe('sortPmProjects global', () => {
  it('orders a filtered subset by original allProjects index (asc) and reverses (desc)', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const c = proj({ prj_code: 'C' });
    const all = [a, b, c];
    const subset = [c, a]; // intentionally out of original order

    expect(sortPmProjects(subset, all, 'global', 'asc')).toEqual([a, c]);
    expect(sortPmProjects(subset, all, 'global', 'desc')).toEqual([c, a]);
  });

  it('does not mutate the input list', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const all = [a, b];
    const subset = [b, a];
    sortPmProjects(subset, all, 'global', 'asc');
    expect(subset).toEqual([b, a]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/pm-projects-list-utils.test.ts`
Expected: FAIL — `buildProjectIndexMap` is not exported (`"buildProjectIndexMap" is not exported by "src/lib/pm-projects-list-utils.ts"` or `is not a function`).

- [ ] **Step 3: Add the `buildProjectIndexMap` helper**

In `dashboard/src/lib/pm-projects-list-utils.ts`, add this exported function immediately before `sortPmProjects` (i.e. after line 35, before line 37):

```ts
/**
 * O(1) reference→index lookup for a project list. Keyed by object identity to
 * exactly match `Array.prototype.indexOf` semantics (no prj_code uniqueness
 * assumption). Build once, reuse instead of repeated `indexOf` scans.
 */
export function buildProjectIndexMap(
  projects: PmProject[],
): Map<PmProject, number> {
  const map = new Map<PmProject, number>();
  for (let i = 0; i < projects.length; i++) {
    map.set(projects[i], i);
  }
  return map;
}
```

- [ ] **Step 4: Run the test to verify the helper passes (global-sort tests already pass — characterization)**

Run: `npx vitest run src/lib/pm-projects-list-utils.test.ts`
Expected: PASS — all 5 tests green. (`sortPmProjects global` tests pass against the still-`indexOf` implementation; they are the safety net for Step 5.)

- [ ] **Step 5: Refactor the `sortPmProjects` global branch to use the map**

In `dashboard/src/lib/pm-projects-list-utils.ts`, replace the global branch (current lines 43-48):

```ts
  if (field === 'global') {
    const sorted = [...list];
    const mul = dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => (allProjects.indexOf(a) - allProjects.indexOf(b)) * mul);
    return sorted;
  }
```

with:

```ts
  if (field === 'global') {
    const indexMap = buildProjectIndexMap(allProjects);
    const sorted = [...list];
    const mul = dir === 'asc' ? 1 : -1;
    sorted.sort(
      (a, b) => ((indexMap.get(a) ?? -1) - (indexMap.get(b) ?? -1)) * mul,
    );
    return sorted;
  }
```

- [ ] **Step 6: Run the test to verify behavior is unchanged**

Run: `npx vitest run src/lib/pm-projects-list-utils.test.ts`
Expected: PASS — all 5 tests still green.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/lib/pm-projects-list-utils.ts dashboard/src/lib/pm-projects-list-utils.test.ts
git commit -m "perf(pm): O(1) project index map for global sort (was O(n^2) indexOf)"
```

---

## Task 2: O(1) `originalIndices` in PM list controller

**Why:** `usePmProjectsListController` recomputes `displayed.map((dp) => projects.indexOf(dp))` on every filter/sort change → O(n·m). Reuse the same `buildProjectIndexMap` helper, memoized on `projects`.

**Files:**
- Modify: `dashboard/src/hooks/usePmProjectsListController.ts` (import at lines 8-11; `originalIndices` at lines 108-111)

**Verification note:** This is hook wiring; the project has no `renderHook` test infra and adding one is out of scope. Correctness rests on Task 1's tested helper plus typecheck + manual check. Verified honestly below.

- [ ] **Step 1: Import the helper**

In `dashboard/src/hooks/usePmProjectsListController.ts`, update the import block (current lines 8-11):

```ts
import {
  sortPmProjects,
  type PmSortDir,
} from '@/lib/pm-projects-list-utils';
```

to:

```ts
import {
  buildProjectIndexMap,
  sortPmProjects,
  type PmSortDir,
} from '@/lib/pm-projects-list-utils';
```

- [ ] **Step 2: Replace the `indexOf` map with the helper-backed lookup**

Replace the `originalIndices` memo (current lines 108-111):

```ts
  const originalIndices = useMemo(
    () => displayed.map((dp) => projects.indexOf(dp)),
    [displayed, projects],
  );
```

with:

```ts
  const projectIndexMap = useMemo(
    () => buildProjectIndexMap(projects),
    [projects],
  );

  const originalIndices = useMemo(
    () => displayed.map((dp) => projectIndexMap.get(dp) ?? -1),
    [displayed, projectIndexMap],
  );
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Full test suite (guards against accidental import/type breakage)**

Run: `npm test`
Expected: all tests pass (no PM-controller tests exist; this confirms nothing else regressed).

- [ ] **Step 5: Manual verification (the part no unit test covers)**

Run the dashboard (`npm run dev`, or the running app), open the **PM** page, and confirm:
1. Sort by the "global" column (default order) toggles asc/desc and rows reorder correctly.
2. Type in the PM search box, apply a year/client/status filter — rows filter correctly.
3. Click a row to select / open a project card — the correct project opens (this exercises `originalIndices` → `onSelect(index)`).

Expected: identical behavior to before; selection opens the right project.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/hooks/usePmProjectsListController.ts
git commit -m "perf(pm): O(1) originalIndices via shared project index map"
```

---

## Task 3: Defer search filtering off the keystroke path (PM + Projects)

**Why:** Both controllers recompute a full list filter synchronously on every keystroke (`search` drives the `useMemo` directly). Wrap the value the *filter* reads in `useDeferredValue` so the input stays responsive while filtering happens at lower priority. The input itself stays bound to immediate `search` (no change to typing UX). The Reports page already uses this pattern (`useReportsPageController.ts:39`).

**Files:**
- Modify: `dashboard/src/hooks/usePmProjectsListController.ts` (import line 1; state line 31; `displayed` memo lines 76-104)
- Modify: `dashboard/src/hooks/useProjectsPageController.tsx` (import line 1; state line 78; two memos lines 452-460)

**Verification note:** Hook wiring; behavior is timing-only and behavior-preserving. Verified by typecheck + build + manual.

### Part A — `usePmProjectsListController.ts`

- [ ] **Step 1: Add `useDeferredValue` to the React import**

Change line 1 from:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
```

to:

```ts
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Create the deferred search value**

Immediately after the `search` state (current line 31):

```ts
  const [search, setSearch] = useState('');
```

add:

```ts
  const deferredSearch = useDeferredValue(search);
```

- [ ] **Step 3: Read the deferred value inside the `displayed` filter**

In the `displayed` memo (current lines 76-104), change the search block. Replace:

```ts
    let list = projects;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
```

with:

```ts
    let list = projects;
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
```

and in the dependency array (current line 97) change `search` to `deferredSearch`:

```ts
  }, [
    projects,
    deferredSearch,
    filterYear,
    filterClient,
    filterStatus,
    sortField,
    sortDir,
    clientGroupOf,
  ]);
```

Leave `hasAnyFilter` (line 106) reading immediate `search` — the "clear filters" affordance must appear on the first keystroke, not deferred.

### Part B — `useProjectsPageController.tsx`

- [ ] **Step 4: Add `useDeferredValue` to the React import**

Change line 1 from:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

to:

```ts
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
```

- [ ] **Step 5: Create the deferred search value**

Immediately after the `search` state (current line 78):

```ts
  const [search, setSearch] = useState('');
```

add:

```ts
  const deferredSearch = useDeferredValue(search);
```

- [ ] **Step 6: Read the deferred value in the two filter memos**

Replace the two memos (current lines 452-460):

```ts
  const filteredProjects = useMemo(
    () => filterProjectList(sortedProjects, search),
    [sortedProjects, search],
  );

  const filteredExcludedProjects = useMemo(
    () => filterProjectList(sortedExcludedProjects, search),
    [sortedExcludedProjects, search],
  );
```

with:

```ts
  const filteredProjects = useMemo(
    () => filterProjectList(sortedProjects, deferredSearch),
    [sortedProjects, deferredSearch],
  );

  const filteredExcludedProjects = useMemo(
    () => filterProjectList(sortedExcludedProjects, deferredSearch),
    [sortedExcludedProjects, deferredSearch],
  );
```

Leave the other `search` references unchanged: `projectListScopeKey` (lines 112/122) and the returned `search`/`setSearch` for input binding (lines 784-785) keep immediate state.

### Verify Part A + B together

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 8: Lint (catches stale hook-deps; project lints exhaustive-deps via eslint-plugin-react-hooks)**

Run: `npm run lint`
Expected: exits 0, no errors/warnings about `deferredSearch` deps.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 10: Manual verification**

Run the dashboard. On both the **Projects** page and the **PM** page:
1. Type quickly in the search box — characters appear immediately (input not blocked).
2. The list narrows to matches (after the deferred pass) and matches the pre-change result for the same query.
3. Clearing the search restores the full list.

Expected: typing feels at least as smooth as before; final filtered results are identical.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/hooks/usePmProjectsListController.ts dashboard/src/hooks/useProjectsPageController.tsx
git commit -m "perf(projects,pm): defer search filtering with useDeferredValue"
```

---

## Task 4: Single-pass totals in the estimate report

**Why:** `buildEstimateReportModel` walks the projects array twice (`reduce` for `totalSeconds`, again for `totalValue`). One pass suffices (`js-combine-iterations`). Low impact (10-50 rows) but trivial and guarded by an existing test file.

**Files:**
- Modify: `dashboard/src/lib/estimate-report.ts:112-114`
- Test: `dashboard/src/lib/estimate-report.test.ts` (add a totals characterization test)

- [ ] **Step 1: Add a totals characterization test**

Append to `dashboard/src/lib/estimate-report.test.ts` (the `row`, `OFF` helpers already exist at the top of that file):

```ts
describe('buildEstimateReportModel totals', () => {
  it('totalSeconds and totalValue equal the sum of the project rows', () => {
    const model = buildEstimateReportModel(
      [
        row({ seconds: 3600, estimated_value: 100 }),
        row({ seconds: 1800, estimated_value: 50 }),
      ],
      false,
      OFF,
    );

    const sumSeconds = model.projects.reduce(
      (acc, p) => acc + p.displaySeconds,
      0,
    );
    const sumValue = model.projects.reduce(
      (acc, p) => acc + p.displayValue,
      0,
    );

    expect(model.totalSeconds).toBe(sumSeconds);
    expect(model.totalValue).toBe(sumValue);
    expect(model.totalSeconds).toBe(5400);
    expect(model.totalValue).toBe(150);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against current code (characterization baseline)**

Run: `npx vitest run src/lib/estimate-report.test.ts`
Expected: PASS — the new test is green against the existing two-pass implementation. (This is the guard for Step 3.)

- [ ] **Step 3: Collapse the two reduces into one pass**

In `dashboard/src/lib/estimate-report.ts`, replace current lines 112-114:

```ts
  const totalSeconds = projects.reduce((acc, p) => acc + p.displaySeconds, 0);
  const totalValue = projects.reduce((acc, p) => acc + p.displayValue, 0);
  return { projects, totalSeconds, totalValue };
```

with:

```ts
  const { totalSeconds, totalValue } = projects.reduce(
    (acc, p) => {
      acc.totalSeconds += p.displaySeconds;
      acc.totalValue += p.displayValue;
      return acc;
    },
    { totalSeconds: 0, totalValue: 0 },
  );
  return { projects, totalSeconds, totalValue };
```

- [ ] **Step 4: Run the test to verify behavior is unchanged**

Run: `npx vitest run src/lib/estimate-report.test.ts`
Expected: PASS — all estimate-report tests still green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/estimate-report.ts dashboard/src/lib/estimate-report.test.ts
git commit -m "perf(estimates): single-pass totals in estimate report model"
```

---

## Final verification (after all tasks)

- [ ] **Run the full test suite**

Run (from `dashboard/`): `npm test`
Expected: all tests pass, including the new `pm-projects-list-utils.test.ts` and the added estimate-report totals test.

- [ ] **Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **React Doctor regression check (project convention — run from repo root)**

Run (from repo root `/Users/micz/__DEV__/__cfab_demon`): `npx -y react-doctor@latest . --verbose`
Expected: **100 / 100**, no issues. (If it shows ~49/100 with "security" on `.py` files, the root `doctor.config.json` didn't load — that's a config issue, not a regression.)

---

## Self-Review

**Spec coverage:** Audit findings → tasks:
- HIGH `indexOf` in `sortPmProjects` (pm-projects-list-utils.ts:46) → Task 1 ✓
- HIGH `indexOf` in `originalIndices` (usePmProjectsListController.ts:109) → Task 2 ✓
- MEDIUM search not deferred (useProjectsPageController + usePmProjectsListController) → Task 3 ✓
- LOW double reduce (estimate-report.ts:112-113) → Task 4 ✓
- AI parallelization / PM virtualization / Sessions memo → explicitly out of scope with rationale ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full before/after code; every command states expected output.

**Type consistency:** `buildProjectIndexMap(projects: PmProject[]): Map<PmProject, number>` defined in Task 1, imported and called identically in Task 2. `sortPmProjects` signature unchanged (internal-only refactor) so all existing callers stay valid. `buildEstimateReportModel(rows, rounded, settings)` matches the existing test's call convention.
