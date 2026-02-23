# Time Analysis — Code Review Report

## 1. HEATMAP — Strange Values — DONE

### Root Cause (Critical Bug)

The heatmaps display **project time proportions within each cell** rather than **actual registered work time** for a given time slot. The visual representation uses **percentage of the cell** (`proj.seconds / slot.totalSeconds * 100`) for each project's height, but the **opacity** is based on `proj.seconds / maxVal`. This creates confusing visual output:

**Problem in Daily Heatmap** (line 501-509):
```tsx
// Height = percentage of cell (proportion within the hour)
const pct = (proj.seconds / slot.totalSeconds) * 100;
// Opacity = relative to max across all hours
opacity: 0.7 + (proj.seconds / dailyHourlyGrid.maxVal) * 0.3,
```

If an hour has only 2 minutes of work, the bar fills 100% of the cell height — identical to an hour with 60 minutes of work. **The cell gives no visual indication of HOW MUCH time was registered**, only the project split within that slot.

**Same problem in Weekly Heatmap** (line 651-659):
```tsx
const pct = (proj.seconds / slot.totalSeconds) * 100;
opacity: 0.7 + (proj.seconds / weeklyHourlyGrid.maxVal) * 0.3,
```

### Suggested Fix

The main timeline bar (lines 484-518, 634-668) should show **actual time fill** relative to the slot capacity (3600 seconds = 1 hour). Each cell should have:
- **Total bar height** proportional to `slot.totalSeconds / 3600` (how much of the hour was used)
- **Within that bar**, project segments proportional to their share

Example fix for daily heatmap:
```tsx
// Overall fill percentage of the hour
const fillPct = Math.min(100, (slot.totalSeconds / 3600) * 100);
// Then inside the filled portion, split by project proportion
```

For the detailed rows (lines 522-553), the width calculation is correct (`proj.seconds / 3600 * 100`) — this view works properly.

### Monthly Calendar Heatmap

The monthly heatmap (lines 571-614) works correctly — it uses `day.seconds / monthCalendar.maxVal` for color intensity, which properly shows relative daily totals.

---

## 2. TIME DISTRIBUTION — Shows Apps Instead of Projects — DONE

### Problem

The pie chart "Time Distribution" (lines 96-104, 422-457) shows **applications** (`apps` = `AppWithStats[]`), not **projects**. The data comes from `getApplications()` which returns per-application stats.

```tsx
const pieData = useMemo(() => {
  const sorted = [...apps].sort((a, b) => b.total_seconds - a.total_seconds).slice(0, 8);
  return sorted.map((a, i) => ({
    name: a.display_name,  // <-- application name, not project
    value: a.total_seconds,
    fill: a.color ?? CHART_COLORS[i % CHART_COLORS.length],
  }));
}, [apps]);
```

### Expected Behavior

Time Distribution should show **project breakdown** (matching the heatmap legend colors). This way:
- The pie chart shows project time distribution
- The heatmap shows project time per hour/day
- **One shared legend** (project colors) describes both visualizations

### Suggested Fix

Use project-level data instead of application data. Options:
1. Use `getTopProjects(dateRange)` which returns `ProjectTimeRow[]` with `name`, `seconds`, `color`
2. Or aggregate from `hourlyProjects` data which already has project breakdown

```tsx
// Option 1: Fetch project data
const [projectTime, setProjectTime] = useState<ProjectTimeRow[]>([]);
// In useEffect: getTopProjects(activeDateRange).then(setProjectTime)

const pieData = useMemo(() => {
  return projectTime.map((p, i) => ({
    name: p.name,
    value: p.seconds,
    fill: p.color || CHART_COLORS[i % CHART_COLORS.length],
  }));
}, [projectTime]);
```

---

## 3. TODAY VIEW Assessment — DONE (minor fixes applied)

The **Daily view** ("Today") is indeed the most polished view. Analysis:

### What works well:
- Hourly stacked bar chart with project breakdown — clear and informative
- Detailed rows per hour with proportional project bars — good UX
- Project legend with consistent colors
- Tooltip with minute breakdown (`value * 60` → minutes)
- Hour labels (00-23) are clear

### Minor issues in Today view:
1. **Bar chart interval** (line 370): `interval={1}` shows every other hour label. With 24 hours and narrow charts this may skip labels. Consider `interval={2}` or `interval="preserveStartEnd"`.
2. **Tooltip formatter** has `as any` cast (line 383) — could be properly typed.
3. **Detailed row width** (line 530): `Math.max(3, (proj.seconds / 3600) * 100)` — the minimum 3% is good for visibility, but can make very short activities appear larger than they are.

---

## 4. WEEKLY VIEW Issues — DONE

### Problem: Bar chart is not stacked by project
In weekly mode, the bar chart (lines 396-415) shows simple total-hours bars (single color). It should show **stacked project bars** like the daily view, since `hourlyProjects` data is already fetched for weekly mode (line 80).

### Suggested Fix
Create a weekly stacked bar dataset (aggregate hourly data to daily by project) and render as stacked bars, matching the daily view pattern.

---

## 5. LOGIC ISSUES — DONE

### 5.1 Stale `today` value (line 37)
```tsx
const today = format(new Date(), "yyyy-MM-dd");
```
This is calculated on every render but is **not memoized** and **not in a ref**. For a component that might stay open across midnight, this will update on re-render but could cause subtle issues. Consider:
```tsx
const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
```
Or use a ref that updates on a timer if needed.

### 5.2 `canShiftForward` comparison (line 38)
```tsx
const canShiftForward = anchorDate < today;
```
String comparison of dates works for `yyyy-MM-dd` format, so this is technically correct. But for monthly mode, the anchor is the first of the month, so `anchorDate < today` could allow shifting into the future month if today is not the last day. This actually works because `shiftDateRange` has a guard (`if (next > today) return`), but the button enabled/disabled state might be misleading.

### 5.3 Export only exports timeline totals (lines 306-315)
The CSV export only includes `Date,Hours` from the `timeline` data. For daily view, it exports a single row. It doesn't include project breakdown, which would be much more useful. Consider exporting:
- Daily: hourly × project breakdown
- Weekly: daily × project breakdown
- Monthly: daily totals with project split

### 5.4 `activeDateRange` dependency on `today` (line 60)
```tsx
}, [rangeMode, anchorDate, today]);
```
Since `today` is recalculated on every render, this memo will recalculate every render. Either memoize `today` or remove it from the dependency (it's only a fallback for `anchorDate || today`, and `anchorDate` is always set).

### 5.5 Type assertion in Promise.all (lines 84-86) — DONE
Replaced `Promise<unknown>[]` with properly typed `Promise.all([...])` using individual typed promises. TypeScript now infers each element's type from `getTopProjects`, `getTimeline`, `getProjectTimeline`, `getProjects`. No more `as` casts.

---

## 6. PERFORMANCE OPTIMIZATIONS — DONE

### 6.1 Redundant data fetching
`getApplications(activeDateRange)` is fetched for all modes but only used for the pie chart. If the pie chart switches to project data (as suggested in #2), this fetch can be removed entirely, reducing API calls.

### 6.2 Large useMemo computations
`weeklyHourlyGrid` (lines 113-181) and `dailyHourlyGrid` (lines 184-235) contain near-identical logic for parsing `hourlyProjects`. This should be extracted into a shared utility function.

### 6.3 Unnecessary re-renders — DONE
Combined `projectTime`, `timeline`, `hourlyProjects`, `projectColors` into single `data` state object. One `setData` call updates all at once — eliminates 3 extra re-renders per data fetch.

### 6.4 `projectColors` fetched independently — DONE
Moved `getProjects()` into the main `Promise.all`. All 4 API calls now run in parallel and resolve in a single state update.

---

## 7. REDUNDANT / DEAD CODE — DONE

### 7.1 Unused imports
- `CHART_GRID_COLOR` is imported (line 13, via chart-styles) but **never used** in this file.

### 7.2 Duplicated project parsing logic
`dailyHourlyGrid` and `weeklyHourlyGrid` both contain identical patterns:
- Collecting project names from `hourlyProjects`
- Building `projectColorMap`
- Parsing `row.date.split("T")` to extract date/hour
- Building `{ name, seconds, color }[]` arrays

This ~120 lines of duplicated logic should be extracted into a helper like:
```tsx
function parseHourlyProjectData(
  hourlyProjects: StackedBarData[],
  projectColors: Map<string, string>
): { byDateHour: Map<string, Map<number, ProjectSlot[]>>, allProjects: string[] }
```

### 7.3 `CHART_COLORS` alias (line 24)
```tsx
const CHART_COLORS = TOKYO_NIGHT_CHART_PALETTE;
```
This alias adds no value. Use `TOKYO_NIGHT_CHART_PALETTE` directly or rename the import.

### 7.4 `apps` state may become unused
If the pie chart switches to project data (recommendation #2), the `apps` state and `getApplications` call become entirely unused and should be removed.

---

## 8. MISSING / INCORRECT TRANSLATIONS — OK (no issues)

The entire UI is in English. No i18n framework is used in the project. All strings are hardcoded. This is consistent across the app, so there's no translation infrastructure to integrate with.

### Strings that ARE in English (correct):
All UI strings are already in English. No Polish or other language strings found.

### Potential locale-sensitive formatting:
- `format(d, "EEE")` → produces English day abbreviations (Mon, Tue...) — **correct** by default with date-fns
- `format(d, "MMM d")` → English month abbreviations — **correct**
- `WEEK_DAYS = ["Mon", "Tue", ...]` — hardcoded English — **correct**

### No translation issues found.
The UI is consistently in English throughout.

---

## 9. SUGGESTED IMPROVEMENTS SUMMARY

| # | Priority | Area | Issue | Suggestion | Status |
|---|----------|------|-------|------------|--------|
| 1 | **Critical** | Heatmap | Cells show proportions, not actual time | Make cell fill proportional to `totalSeconds / 3600` | DONE |
| 2 | **Critical** | Pie Chart | Shows apps instead of projects | Switch to `getTopProjects()` data source | DONE |
| 3 | **High** | Weekly Bar | Not stacked by project | Add project stacking like daily view | DONE |
| 4 | **High** | Shared Legend | Each view has its own legend | Pie + heatmap now both show projects with consistent colors | DONE |
| 5 | **Medium** | Performance | `today` causes memo recalc every render | Memoized with `useMemo`, removed from `activeDateRange` deps | DONE |
| 5.5 | **Medium** | Type Safety | `as` casts in `Promise.all` | Typed `Promise.all` with individual typed promises, no casts | DONE |
| 6 | **Medium** | Code Quality | ~120 lines duplicated parsing logic | Extracted `parseHourlyProjects()` + `buildDaySlots()` helpers | DONE |
| 6.3 | **Medium** | Performance | 4 separate `useState` → 4 re-renders | Combined into single `data` state object | DONE |
| 6.4 | **Medium** | Performance | `projectColors` fetched separately | Merged into main `Promise.all` — all 4 API calls parallel | DONE |
| 7 | **Medium** | Export | CSV only has daily totals | Daily/weekly export now includes project breakdown columns | DONE |
| 8 | **Low** | Type Safety | `as any` cast on tooltip formatter | Removed cast, using `(value, name) =>` without explicit types | DONE |
| 9 | **Low** | Dead Code | Unused `CHART_GRID_COLOR` import | Removed | DONE |
| 10 | **Low** | Code Style | `CHART_COLORS` unnecessary alias | Renamed to `PALETTE` for brevity, used consistently | DONE |

---

## 10. ARCHITECTURE NOTES — DONE

### File size
Original: 695 lines in a single file. Split into modular components:

```
components/time-analysis/
  types.ts              — shared types (ProjectSlot, HourSlot, etc.) + helper functions
  useTimeAnalysisData.ts — custom hook: state, fetching, all computed memos, export
  DailyView.tsx          — DailyBarChart + DailyHeatmap components
  WeeklyView.tsx         — WeeklyBarChart + WeeklyHeatmap components
  MonthlyView.tsx        — MonthlyBarChart + MonthlyHeatmap components

pages/
  TimeAnalysis.tsx       — toolbar, pie chart, layout shell (~100 lines)
```

Each view component receives only the props it needs. The hook encapsulates all data logic.
