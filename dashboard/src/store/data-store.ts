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

type TimePreset = 'today' | 'week' | 'month' | 'all';

interface DataState {
  dateRange: DateRange;
  timePreset: TimePreset;
  setDateRange: (range: DateRange) => void;
  setTimePreset: (preset: TimePreset) => void;
  shiftDateRange: (direction: -1 | 1) => void;
  canShiftForward: () => boolean;
  refreshKey: number;
  triggerRefresh: () => void;
  autoImportDone: boolean;
  autoImportResult: AutoImportResult | null;
  setAutoImportDone: (done: boolean, result?: AutoImportResult | null) => void;
}

const REFRESH_THROTTLE_MS = 250;
let lastRefreshAtMs = 0;
let scheduledRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleThrottledRefresh(increment: () => void) {
  const now = Date.now();
  const elapsed = now - lastRefreshAtMs;
  if (elapsed >= REFRESH_THROTTLE_MS) {
    lastRefreshAtMs = now;
    increment();
    return;
  }

  const delay = REFRESH_THROTTLE_MS - elapsed;
  if (scheduledRefreshTimer !== null) {
    clearTimeout(scheduledRefreshTimer);
  }
  scheduledRefreshTimer = setTimeout(() => {
    lastRefreshAtMs = Date.now();
    scheduledRefreshTimer = null;
    increment();
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
      return { start: '2020-01-01', end };
  }
}

function inferPreset(range: DateRange): TimePreset {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
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
  if (range.start === '2020-01-01' && range.end === today) return 'all';
  return 'week';
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
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return get().dateRange.end < todayStr;
  },

  refreshKey: 0,
  triggerRefresh: () =>
    scheduleThrottledRefresh(() =>
      set((s) => ({ refreshKey: s.refreshKey + 1 })),
    ),

  autoImportDone: false,
  autoImportResult: null,
  setAutoImportDone: (done, result) =>
    set({ autoImportDone: done, autoImportResult: result ?? null }),
}));
