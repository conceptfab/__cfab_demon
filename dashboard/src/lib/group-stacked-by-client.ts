import type { StackedBarData, StackedSeriesMeta } from '@/lib/db-types';
import {
  buildStackedSeriesMetaMap,
  getStackedSeriesEntries,
} from '@/lib/stacked-bar-series';

export interface ClientGroupingMaps {
  /** project_id → client name */
  projectIdToClient: Map<number, string>;
  /** project name (series label) → client name */
  projectNameToClient: Map<string, string>;
  /** resolve a color for a client name */
  clientColor: (client: string) => string;
  /** label/key used for projects without a client */
  noClientLabel: string;
}

/**
 * Collapses project-keyed stacked-bar rows into CLIENT-keyed rows: every project
 * series is folded into its client (by project_id, then by name), summing seconds.
 * The result is a valid StackedBarData[] that flows through the existing pipeline
 * (meta map, pie, grids) unchanged — only now grouped by client.
 */
export function groupStackedByClient(
  rows: StackedBarData[],
  maps: ClientGroupingMaps,
): StackedBarData[] {
  const metaByKey = buildStackedSeriesMetaMap(rows);
  return rows.map((row) => {
    const acc = new Map<string, number>();
    for (const [key, val] of getStackedSeriesEntries(row)) {
      const meta = metaByKey.get(key);
      const client =
        (meta?.project_id != null
          ? maps.projectIdToClient.get(meta.project_id)
          : undefined) ??
        maps.projectNameToClient.get(meta?.label ?? key) ??
        maps.noClientLabel;
      acc.set(client, (acc.get(client) ?? 0) + val);
    }

    const out: StackedBarData = {
      date: row.date,
      has_boost: row.has_boost,
      has_manual: row.has_manual,
      comments: row.comments,
      series_meta: [],
    };
    const meta: StackedSeriesMeta[] = [];
    for (const [client, seconds] of acc) {
      (out as Record<string, number>)[client] = seconds;
      meta.push({
        key: client,
        label: client,
        color: maps.clientColor(client),
        project_id: null,
      });
    }
    out.series_meta = meta;
    return out;
  });
}
