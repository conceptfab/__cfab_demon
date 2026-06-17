import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRechartsAnimationConfig } from '@/lib/chart-animation';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { buildStackedSeriesMetaMap } from '@/lib/stacked-bar-series';
import {
  buildTimelineChartRows,
  buildTimelineSeriesKeys,
  computeTimelineDaySpan,
  timelineChartHasData,
} from '@/lib/timeline-chart-data';
import {
  formatTimelineAxisLabel,
  formatTimelineTooltipLabel,
} from '@/lib/timeline-chart-formatters';
import type { DateRange, StackedBarData } from '@/lib/db-types';

export interface TimelineChartPresentation {
  projectColors?: Record<string, string>;
  granularity?: 'hour' | 'day';
  dateRange?: DateRange;
  trimLeadingToFirstData?: boolean;
  title?: string;
  heightClassName?: string;
  disableAnimation?: boolean;
}

export interface TimelineChartState {
  isLoading?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  loadingMessage?: string;
}

export function useTimelineChartModel(
  data: StackedBarData[],
  presentation: TimelineChartPresentation | undefined,
  state: TimelineChartState | undefined,
) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const {
    projectColors = {},
    granularity = 'day',
    dateRange,
    trimLeadingToFirstData = false,
    title,
    heightClassName,
    disableAnimation = false,
  } = presentation ?? {};
  const {
    isLoading = false,
    errorMessage = null,
    emptyMessage = t('components.timeline_chart.no_data'),
    loadingMessage = t('components.timeline_chart.loading'),
  } = state ?? {};

  const effectiveTitle =
    title ?? t('components.timeline_chart.default_title');
  const seriesMetaByKey = useMemo(() => buildStackedSeriesMetaMap(data), [data]);
  const seriesKeys = useMemo(
    () => buildTimelineSeriesKeys(data, seriesMetaByKey),
    [data, seriesMetaByKey],
  );
  const chartData = useMemo(
    () =>
      buildTimelineChartRows(
        data,
        seriesKeys,
        granularity,
        dateRange,
        trimLeadingToFirstData,
      ),
    [data, seriesKeys, granularity, dateRange, trimLeadingToFirstData],
  );
  const chartDataByDate = useMemo(() => {
    const map = new Map<string, (typeof chartData)[number]>();
    for (const row of chartData) {
      map.set(String(row.date), row);
    }
    return map;
  }, [chartData]);

  const isHourly = granularity === 'hour';
  const chartHeightClassName = heightClassName ?? (isHourly ? 'h-64' : 'h-56');
  const chartComplexity = chartData.length * Math.max(seriesKeys.length, 1);
  const useSimpleRendering = chartComplexity > 180;
  const barAnimation = useRechartsAnimationConfig({
    complexity: chartComplexity,
    maxComplexity: isHourly ? 240 : 300,
    minDuration: isHourly ? 150 : 170,
    maxDuration: isHourly ? 250 : 320,
  });
  const effectiveBarAnimation = useSimpleRendering
    ? {
        isAnimationActive: false,
        animationDuration: 0,
        animationEasing: 'ease-out' as const,
      }
    : barAnimation;
  const finalBarAnimation = disableAnimation
    ? {
        isAnimationActive: false,
        animationDuration: 0,
        animationEasing: 'ease-out' as const,
      }
    : effectiveBarAnimation;
  const daySpan = useMemo(
    () => computeTimelineDaySpan(dateRange),
    [dateRange],
  );

  const xTickFormatter = useCallback(
    (v: unknown) =>
      formatTimelineAxisLabel(String(v), isHourly, daySpan, locale),
    [isHourly, daySpan, locale],
  );
  const xLabelFormatter = useCallback(
    (v: unknown) =>
      formatTimelineTooltipLabel(String(v), isHourly, locale),
    [isHourly, locale],
  );

  const hasChartData = useMemo(
    () => timelineChartHasData(chartData, seriesKeys),
    [chartData, seriesKeys],
  );

  return {
    boostedLabel: t('components.timeline_chart.boosted_activity'),
    chartData,
    chartDataByDate,
    chartHeightClassName,
    effectiveTitle,
    emptyMessage,
    errorMessage,
    finalBarAnimation,
    hasChartData,
    isHourly,
    isLoading,
    loadingMessage,
    manualLabel: t('components.timeline_chart.manual_data_included'),
    projectColors,
    seriesKeys,
    seriesMetaByKey,
    useSimpleRendering,
    xLabelFormatter,
    xTickFormatter,
  };
}

export type TimelineChartModel = ReturnType<typeof useTimelineChartModel>;
