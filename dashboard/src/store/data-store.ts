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
import { ALL_TIME_START } from '@/lib/date-ranges';
import { emitAppRefresh } from '@/lib/sync-events';

export type TimePreset = 'today' | 'week' | 'month' | 'all' | 'custom';
type RefreshReason = string;

interface DataState {
  dateRange: DateRange;
  timePreset: TimePreset;
  setDateRange: (range: DateRange) => void;
  setTimePreset: (preset: TimePreset) => void;
  shiftDateRange: (direction: -1 | 1) => void;
  canShiftForward: () => boolean;
  refreshKey: number;
  triggerRefresh: (reason?: RefreshReason) => void;
  autoImportDone: boolean;
  autoImportResult: AutoImportResult | null;
  setAutoImportDone: (done: boolean, result?: AutoImportResult | null) => void;
  discoveredProjects: { projects: string[]; dismissed: boolean };
  setDiscoveredProjects: (names: string[]) => void;
  dismissDiscoveredProjects: () => void;
}

const REFRESH_THROTTLE_MS = 250;
const REASON_REFRESH_DEDUPE_MS = 1_000;
let lastRefreshAtMs = 0;
let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRefreshReasons = new Set<RefreshReason>();
const lastRefreshAtByReason = new Map<RefreshReason, number>();
let hasPendingAnonymousRefresh = false;

function flushPendingRefresh(increment: () => void) {
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
}

function scheduleThrottledRefresh(
  reason: RefreshReason | undefined,
  increment: () => void,
) {
  const now = Date.now();
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
}

function presetToRange(preset: TimePreset): DateRange {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
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
  const today = format(now, 'yyyy-MM-dd');
  if (range.start === ALL_TIME_START) return 'all';
  if (range.start === today && range.end === today) return 'today';
  if (
    range.start === format(subDays(now, 6), 'yyyy-MM-dd') &&
    range.end === today
  )
    return 'week';
  if (
    range.start === format(startOfMonth(now), 'yyyy-MM-dd') &&
    range.end === today
  )
    return 'month';
  return 'custom';
}

export const useDataStore = create<DataState>((set, get) => ({
  dateRange: presetToRange('today'),
  timePreset: 'today',
  setDateRange: (range) =>
    set({ dateRange: range, timePreset: inferPreset(range) }),
  setTimePreset: (preset) =>
    set({ timePreset: preset, dateRange: presetToRange(preset) }),

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

      const cappedEnd = minDate([newEnd, today]);
      if (newStart > today) return {};

      return {
        dateRange: {
          start: format(newStart, 'yyyy-MM-dd'),
          end: format(cappedEnd, 'yyyy-MM-dd'),
        },
      };
    }),

  canShiftForward: (): boolean => {
    if (get().timePreset === 'custom') return false;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return get().dateRange.end < todayStr;
  },

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
}));
