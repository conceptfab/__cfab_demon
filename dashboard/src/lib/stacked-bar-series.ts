import type { StackedBarData, StackedSeriesMeta } from '@/lib/db-types';
import { localizeProjectLabel } from '@/lib/project-labels';

export const OTHER_STACKED_SERIES_KEY = '__other__';
export const UNASSIGNED_STACKED_SERIES_KEY = '__unassigned__';

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
  return getStackedSeriesKeys(row)
    .map((key) => [key, row[key]] as const)
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' &&
        Number.isFinite(entry[1]) &&
        entry[1] > 0,
    );
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
