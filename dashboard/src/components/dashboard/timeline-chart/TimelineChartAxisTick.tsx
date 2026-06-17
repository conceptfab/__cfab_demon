import { Flame, MessageSquare, PenLine } from 'lucide-react';

import { CHART_AXIS_COLOR } from '@/lib/chart-styles';
import type { StackedBarData } from '@/lib/db-types';

type TimelineChartAxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  chartDataByDate: Map<string, StackedBarData>;
  xTickFormatter: (value: unknown) => string;
};

export function TimelineChartAxisTick({
  x = 0,
  y = 0,
  payload,
  chartDataByDate,
  xTickFormatter,
}: TimelineChartAxisTickProps) {
  const dateKey = String(payload?.value ?? '');
  const row = chartDataByDate.get(dateKey);
  if (!row) return null;

  const hasComments = Array.isArray(row.comments) && row.comments.length > 0;
  const hasBoost = row.has_boost;
  const hasManual = row.has_manual;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <text
        x={0}
        y={10}
        dy={4}
        textAnchor="middle"
        fill={CHART_AXIS_COLOR}
        fontSize={12}
      >
        {xTickFormatter(dateKey)}
      </text>

      {(hasComments || hasBoost || hasManual) && (
        <foreignObject
          x="-40"
          y={22}
          width="80"
          height="20"
          style={{ pointerEvents: 'none' }}
        >
          <div className="flex items-center justify-center gap-1.5 overflow-visible">
            {hasBoost && (
              <Flame
                size={12}
                className="text-red-400 fill-red-400/20 drop-shadow-sm"
              />
            )}
            {hasComments && (
              <MessageSquare
                size={12}
                className="text-sky-400 fill-sky-400/30 drop-shadow-sm"
              />
            )}
            {hasManual && (
              <PenLine size={12} className="text-emerald-400 drop-shadow-sm" />
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}
