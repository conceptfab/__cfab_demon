import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, MessageSquare, PenLine } from 'lucide-react';

import { CHART_AXIS_COLOR } from '@/lib/chart-styles';
import type { StackedBarData } from '@/lib/db-types';

type TimelineChartAxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  chartDataByDate: Map<string, StackedBarData>;
  xTickFormatter: (value: unknown) => string;
  boostedLabel?: string;
  manualLabel?: string;
  onBarClick?: (date: string) => void;
};

export function TimelineChartAxisTick({
  x = 0,
  y = 0,
  payload,
  chartDataByDate,
  xTickFormatter,
  boostedLabel,
  manualLabel,
  onBarClick,
}: TimelineChartAxisTickProps) {
  const { t } = useTranslation();
  const dateKey = String(payload?.value ?? '');
  const row = chartDataByDate.get(dateKey);
  if (!row || !Number.isFinite(x) || !Number.isFinite(y) || y < 50 || x <= 0) return null;

  const hasComments = Array.isArray(row.comments) && row.comments.length > 0;
  const hasBoost = Boolean(row.has_boost);
  const hasManual = Boolean(row.has_manual);

  const effectiveBoostLabel =
    boostedLabel || t('components.timeline_chart.boosted_activity', 'AKTYWNOŚĆ Z MNOŻNIKIEM');
  const effectiveManualLabel =
    manualLabel || t('components.timeline_chart.manual_data_included', 'DANE RĘCZNE UWZGLĘDNIONE');

  const commentsList = hasComments ? (row.comments as string[]) : [];
  const commentsTooltip =
    commentsList.length > 1
      ? `${t('common.comments', 'Komentarze')}:\n${commentsList.map((c) => `• "${c}"`).join('\n')}`
      : `${t('common.comment', 'Komentarz')}: "${commentsList[0] ?? ''}"`;

  const icons: Array<{ key: string; title: string; element: ReactNode }> = [];
  if (hasBoost) {
    icons.push({
      key: 'boost',
      title: effectiveBoostLabel,
      element: (
        <Flame
          size={12}
          className="text-red-400 fill-red-400/20 drop-shadow-sm"
        />
      ),
    });
  }
  if (hasComments) {
    icons.push({
      key: 'comments',
      title: commentsTooltip,
      element: (
        <MessageSquare
          size={12}
          className="text-sky-400 fill-sky-400/30 drop-shadow-sm"
        />
      ),
    });
  }
  if (hasManual) {
    icons.push({
      key: 'manual',
      title: effectiveManualLabel,
      element: <PenLine size={12} className="text-emerald-400 drop-shadow-sm" />,
    });
  }

  const iconSize = 12;
  const iconGap = 4;
  const totalWidth = icons.length * iconSize + (icons.length - 1) * iconGap;
  const startX = -totalWidth / 2;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <g
        className={onBarClick ? 'cursor-pointer' : undefined}
        onClick={onBarClick ? () => onBarClick(dateKey) : undefined}
      >
        <title>{dateKey}</title>
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
      </g>

      {icons.length > 0 && (
        <g style={{ pointerEvents: 'auto' }}>
          {icons.map((item, idx) => (
            <g
              key={item.key}
              transform={`translate(${startX + idx * (iconSize + iconGap)}, 20)`}
              className={onBarClick ? 'cursor-pointer' : undefined}
              role="img"
              aria-label={item.title}
              onClick={
                onBarClick
                  ? (e) => {
                      e.stopPropagation();
                      onBarClick(dateKey);
                    }
                  : undefined
              }
            >
              <title>{item.title}</title>
              <rect
                x={-3}
                y={-3}
                width={iconSize + 6}
                height={iconSize + 6}
                fill="transparent"
              />
              {item.element}
            </g>
          ))}
        </g>
      )}
    </g>
  );
}
