import { eachDayOfInterval, format, parseISO } from 'date-fns';

import type { DateRange, StackedBarData, StackedSeriesMeta } from '@/lib/db-types';
import {
  getStackedSeriesKeys,
  getStackedSeriesLabel,
  OTHER_STACKED_SERIES_KEY,
} from '@/lib/stacked-bar-series';

type ChartInteractionState = {
  activeLabel?: string | number;
  activePayload?: Array<{ payload?: { date?: string } }>;
};

export function extractTimelineChartDate(state: unknown): string | null {
  const chartState = (state ?? {}) as ChartInteractionState;
  const activeLabel =
    typeof chartState.activeLabel === 'string' ? chartState.activeLabel : null;
  const payloadDate = chartState.activePayload?.[0]?.payload?.date;
  const date = activeLabel ?? payloadDate ?? null;
  return typeof date === 'string' && date.length > 0 ? date : null;
}

export function buildTimelineSeriesKeys(
  data: StackedBarData[],
  seriesMetaByKey: Map<string, StackedSeriesMeta>,
): string[] {
  const keys = new Set<string>();
  const totals = new Map<string, number>();
  for (const row of data) {
    for (const key of getStackedSeriesKeys(row)) {
      keys.add(key);
      const value = row[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        totals.set(key, (totals.get(key) ?? 0) + value);
      }
    }
  }
  return Array.from(keys).sort((a, b) => {
    if (a === OTHER_STACKED_SERIES_KEY) return 1;
    if (b === OTHER_STACKED_SERIES_KEY) return -1;
    const diff = (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
    if (Math.abs(diff) > 0.001) return diff;
    return getStackedSeriesLabel(seriesMetaByKey, a).localeCompare(
      getStackedSeriesLabel(seriesMetaByKey, b),
      undefined,
      { sensitivity: 'base' },
    );
  });
}

export function buildTimelineChartRows(
  data: StackedBarData[],
  seriesKeys: string[],
  granularity: 'hour' | 'day',
  dateRange: DateRange | undefined,
  trimLeadingToFirstData: boolean,
): StackedBarData[] {
  if (granularity === 'day' && dateRange?.start && dateRange?.end) {
    let fillStart = dateRange.start;
    if (trimLeadingToFirstData && data.length > 0) {
      const firstDataDate = data.reduce<string | undefined>((acc, row) => {
        const d = row.date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!acc || d < acc)) return d;
        return acc;
      }, undefined);
      if (firstDataDate && firstDataDate > fillStart) {
        fillStart = firstDataDate;
      }
    }

    let days: Date[] = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(`${fillStart}T00:00:00`),
        end: parseISO(`${dateRange.end}T00:00:00`),
      });
    } catch {
      days = [];
    }
    if (days.length > 0) {
      const byDate = new Map<string, StackedBarData>();
      for (const row of data) byDate.set(row.date, row);
      return days.map((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const row = byDate.get(dateKey);
        const out: StackedBarData = { date: dateKey };
        for (const key of seriesKeys) {
          const val = row?.[key];
          out[key] = typeof val === 'number' ? val : 0;
        }
        out.comments = row?.comments;
        out.has_boost = row?.has_boost;
        out.has_manual = row?.has_manual;
        out.series_meta = row?.series_meta;
        return out;
      });
    }
  }

  return data.map((row) => {
    const out: StackedBarData = { date: row.date };
    for (const key of seriesKeys) {
      const val = row[key];
      out[key] = typeof val === 'number' ? val : 0;
    }
    out.comments = row.comments;
    out.has_boost = row.has_boost;
    out.has_manual = row.has_manual;
    out.series_meta = row.series_meta;
    return out;
  });
}

export function timelineChartHasData(
  chartData: StackedBarData[],
  seriesKeys: string[],
): boolean {
  if (seriesKeys.length === 0) return false;
  return chartData.some((row) =>
    seriesKeys.some((key) => {
      const value = row[key];
      return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }),
  );
}

export function computeTimelineDaySpan(dateRange: DateRange | undefined): number {
  if (!dateRange?.start || !dateRange?.end) return 0;
  try {
    return eachDayOfInterval({
      start: parseISO(`${dateRange.start}T00:00:00`),
      end: parseISO(`${dateRange.end}T00:00:00`),
    }).length;
  } catch {
    return 0;
  }
}
