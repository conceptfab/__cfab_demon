import { Flame, PenLine } from 'lucide-react';

import {
  CHART_GRID_COLOR,
  CHART_MUTED_SERIES_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
  TOOLTIP_CONTENT_STYLE,
} from '@/lib/chart-styles';
import { formatDuration } from '@/lib/utils';
import type { StackedBarData, StackedSeriesMeta } from '@/lib/db-types';
import { getStackedSeriesLabel } from '@/lib/stacked-bar-series';

interface TimelineChartTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: Array<{
    name?: string;
    color?: string;
    value?: number | string;
    payload: StackedBarData;
  }>;
  seriesMetaByKey: Map<string, StackedSeriesMeta>;
  xLabelFormatter: (value: unknown) => string;
  boostedLabel: string;
  manualLabel: string;
}

export function TimelineChartTooltip({
  active,
  label,
  payload,
  seriesMetaByKey,
  xLabelFormatter,
  boostedLabel,
  manualLabel,
}: TimelineChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const items = payload
    .reduce<Array<{ name: string; color: string; value: number }>>(
      (acc, entry) => {
        const value = Number(entry.value ?? 0);
        if (Number.isFinite(value) && value > 0) {
          acc.push({
            name: getStackedSeriesLabel(
              seriesMetaByKey,
              String(entry.name ?? ''),
            ),
            color: entry.color ?? CHART_MUTED_SERIES_COLOR,
            value,
          });
        }
        return acc;
      },
      [],
    )
    .sort((a, b) => b.value - a.value);

  const row = payload[0]?.payload;
  const comments = row?.comments;

  if (items.length === 0 && (!comments || comments.length === 0)) return null;

  return (
    <div style={{ ...TOOLTIP_CONTENT_STYLE, pointerEvents: 'none' }}>
      <div
        style={{
          color: CHART_TOOLTIP_TITLE_COLOR,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {xLabelFormatter(label)}
      </div>
      {items.map((item) => (
        <div
          key={item.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: CHART_TOOLTIP_TEXT_COLOR,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              backgroundColor: item.color,
              flexShrink: 0,
            }}
          />
          <span>{item.name}</span>
          <span style={{ marginLeft: 'auto' }}>
            {formatDuration(item.value)}
          </span>
        </div>
      ))}
      {comments && comments.length > 0 && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: `1px dashed ${CHART_GRID_COLOR}`,
          }}
        >
          {comments.map((c) => (
            <div
              key={`comment-${c}`}
              style={{
                color: CHART_TOOLTIP_TITLE_COLOR,
                fontSize: 12,
                fontStyle: 'italic',
                marginBottom: 2,
              }}
            >
              &quot;{c}&quot;
            </div>
          ))}
        </div>
      )}
      {row?.has_boost && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#f87171',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Flame className="size-3" />
          {boostedLabel}
        </div>
      )}
      {row?.has_manual && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#34d399',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <PenLine className="size-3" />
          {manualLabel}
        </div>
      )}
    </div>
  );
}
