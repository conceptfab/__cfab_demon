import type { StackedBarData, StackedSeriesMeta } from '@/lib/db-types';
import {
  localizeProjectLabel,
  OTHER_PROJECT_SENTINEL,
  UNASSIGNED_PROJECT_SENTINEL,
} from '@/lib/project-labels';

export const OTHER_STACKED_SERIES_KEY = OTHER_PROJECT_SENTINEL;
export const UNASSIGNED_STACKED_SERIES_KEY = UNASSIGNED_PROJECT_SENTINEL;

const STACKED_BAR_RESERVED_KEYS = new Set([
  'date',
  'comments',
  'has_boost',
  'has_manual',
  'series_meta',
]);

export function buildStackedSeriesMetaMap(
  rows: StackedBarData[],
): Map<string, StackedSeriesMeta> {
  const out = new Map<string, StackedSeriesMeta>();
  for (const row of rows) {
    for (const series of row.series_meta ?? []) {
      if (!out.has(series.key)) {
        out.set(series.key, series);
      }
    }
  }
  return out;
}

export function getStackedSeriesKeys(row: StackedBarData): string[] {
  return Object.keys(row).filter((key) => !STACKED_BAR_RESERVED_KEYS.has(key));
}

export function getStackedSeriesEntries(
  row: StackedBarData,
): Array<[string, number]> {
  return getStackedSeriesKeys(row).reduce<Array<[string, number]>>((acc, key) => {
    const val = row[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      acc.push([key, val]);
    }
    return acc;
  }, []);
}

export function getStackedSeriesLabel(
  metaByKey: Map<string, StackedSeriesMeta>,
  key: string,
): string {
  const series = metaByKey.get(key);
  return localizeProjectLabel(series?.label ?? key, {
    projectId: series?.project_id ?? null,
    seriesKey: key,
  });
}

export function getStackedSeriesColor(
  metaByKey: Map<string, StackedSeriesMeta>,
  key: string,
): string | undefined {
  return metaByKey.get(key)?.color;
}
