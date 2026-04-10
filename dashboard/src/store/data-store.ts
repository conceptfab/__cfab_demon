import { create } from 'zustand';
import {
  format,
  subDays,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  parseISO,
  min as minDate,
} from 'date-fns';
import type { AutoImportResult, DateRange } from '@/lib/db-types';
import { ALL_TIME_START } from '@/lib/date-helpers';
import { buildTodayDate } from '@/lib/date-helpers';
import { emitAppRefresh } from '@/lib/sync-events';

export type TimePreset = 'today' | 'week' | 'month' | 'all' | 'custom';
type RefreshReason = string;

interface DataState {
  dateRange: DateRange;
  timePreset: TimePreset;
  setDateRange: (range: DateRange) => void;
  setTimePreset: (preset: TimePreset) => void;
  shiftDateRange: (direction: -1 | 1) => void;
  canShiftForward: boolean;
  refreshKey: number;
  triggerRefresh: (reason?: RefreshReason) => void;
  autoImportDone: boolean;
  autoImportResult: AutoImportResult | null;
  setAutoImportDone: (done: boolean, result?: AutoImportResult | null) => void;
  discoveredProjects: { projects: string[]; dismissed: boolean };
  setDiscoveredProjects: (names: string[]) => void;
  dismissDiscoveredProjects: () => void;
}

// Minimum interval between consecutive data refreshes (prevents UI flicker)
const REFRESH_THROTTLE_MS = 150;
// Same-reason refresh dedup window (e.g. rapid file-change events from daemon)
const REASON_REFRESH_DEDUPE_MS = 1_000;

function presetToRange(preset: TimePreset): DateRange {
  const now = new Date();
  const today = buildTodayDate();
  const end = today;
  switch (preset) {
    case 'today':
      return { start: today, end };
    case 'week':
      return { start: format(subDays(now, 6), 'yyyy-MM-dd'), end };
    case 'month':
      return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end };
    case 'all':
      return { start: ALL_TIME_START, end };
    case 'custom':
      return { start: today, end };
  }
}

function inferPreset(range: DateRange): TimePreset {
  const now = new Date();
  const today = buildTodayDate();
  if (range.start === ALL_TIME_START) return 'all';
  if (range.start === today && range.end === today) return 'today';
  if (
    range.start === format(subDays(now, 6), 'yyyy-MM-dd') &&
    range.end === today
  )
    return 'week';
  const rangeEnd = parseISO(range.end);
  if (
    range.start === format(startOfMonth(rangeEnd), 'yyyy-MM-dd') &&
    (range.end === today ||
      range.end === format(endOfMonth(rangeEnd), 'yyyy-MM-dd'))
  )
    return 'month';
  return 'custom';
}

function computeCanShiftForward(range: DateRange, preset: TimePreset): boolean {
  if (preset === 'custom' || preset === 'all') return false;
  return range.end < buildTodayDate();
}

export const useDataStore = create<DataState>((set) => {
  let lastRefreshAtMs = 0;
  let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingRefreshReasons = new Set<RefreshReason>();
  const lastRefreshAtByReason = new Map<RefreshReason, number>();
  let hasPendingAnonymousRefresh = false;

  const flushPendingRefresh = (increment: () => void) => {
    if (!hasPendingAnonymousRefresh && pendingRefreshReasons.size === 0) {
      scheduledRefreshTimer = null;
      return;
    }
    const now = Date.now();
    const reasons = Array.from(pendingRefreshReasons);
    lastRefreshAtMs = now;
    pendingRefreshReasons.forEach((reason) => {
      lastRefreshAtByReason.set(reason, now);
    });
    pendingRefreshReasons.clear();
    emitAppRefresh(reasons, hasPendingAnonymousRefresh);
    hasPendingAnonymousRefresh = false;
    scheduledRefreshTimer = null;
    increment();
  };

  const scheduleThrottledRefresh = (
    reason: RefreshReason | undefined,
    increment: () => void,
  ) => {
    const now = Date.now();
    // Clean up stale dedup entries (older than 10 minutes)
    const TEN_MINUTES = 10 * 60 * 1000;
    for (const [key, timestamp] of lastRefreshAtByReason) {
      if (now - timestamp > TEN_MINUTES) {
        lastRefreshAtByReason.delete(key);
      }
    }

    if (reason) {
      const lastReasonRefreshAt = lastRefreshAtByReason.get(reason);
      if (
        lastReasonRefreshAt !== undefined &&
        now - lastReasonRefreshAt < REASON_REFRESH_DEDUPE_MS
      ) {
        return;
      }
      pendingRefreshReasons.add(reason);
    } else {
      hasPendingAnonymousRefresh = true;
    }

    const elapsed = now - lastRefreshAtMs;
    if (elapsed >= REFRESH_THROTTLE_MS) {
      flushPendingRefresh(increment);
      return;
    }

    const delay = REFRESH_THROTTLE_MS - elapsed;
    if (scheduledRefreshTimer !== null) {
      return;
    }
    scheduledRefreshTimer = setTimeout(() => {
      flushPendingRefresh(increment);
    }, delay);
  };

  return {
    dateRange: presetToRange('today'),
    timePreset: 'today',
    setDateRange: (range) =>
      set(() => {
        const timePreset = inferPreset(range);
        return {
          dateRange: range,
          timePreset,
          canShiftForward: computeCanShiftForward(range, timePreset),
        };
      }),
    setTimePreset: (preset) =>
      set((state) => {
        const dateRange =
          preset === 'custom' ? state.dateRange : presetToRange(preset);
        return {
          timePreset: preset,
          dateRange,
          canShiftForward: computeCanShiftForward(dateRange, preset),
        };
      }),

    shiftDateRange: (direction) =>
      set((s) => {
        const { dateRange, timePreset } = s;
        if (timePreset === 'all') return {};
        const today = new Date();
        const start = parseISO(dateRange.start);
        const end = parseISO(dateRange.end);

        let newStart: Date;
        let newEnd: Date;

        switch (timePreset) {
          case 'today': {
            newStart = addDays(start, direction);
            newEnd = addDays(end, direction);
            break;
          }
          case 'week': {
            newStart = addDays(start, direction * 7);
            newEnd = addDays(end, direction * 7);
            break;
          }
          case 'month': {
            newStart = startOfMonth(addMonths(start, direction));
            newEnd = endOfMonth(newStart);
            break;
          }
          case 'custom':
          default:
            return {};
        }

        if (newStart > today) return {};
        const cappedEnd = minDate([newEnd, today]);

        const nextDateRange = {
          start: format(newStart, 'yyyy-MM-dd'),
          end: format(cappedEnd, 'yyyy-MM-dd'),
        };
        return {
          dateRange: nextDateRange,
          canShiftForward: computeCanShiftForward(nextDateRange, timePreset),
        };
      }),

    canShiftForward: false,

    refreshKey: 0,
    triggerRefresh: (reason) =>
      scheduleThrottledRefresh(reason, () =>
        set((s) => ({ refreshKey: s.refreshKey + 1 })),
      ),

    autoImportDone: false,
    autoImportResult: null,
    setAutoImportDone: (done, result) =>
      set({ autoImportDone: done, autoImportResult: result ?? null }),

    discoveredProjects: { projects: [], dismissed: false },
    setDiscoveredProjects: (names) =>
      set({ discoveredProjects: { projects: names, dismissed: false } }),
    dismissDiscoveredProjects: () =>
      set((s) => ({
        discoveredProjects: { ...s.discoveredProjects, dismissed: true },
      })),
  };
});

