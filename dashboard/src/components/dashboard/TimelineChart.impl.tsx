import { lazy } from 'react';
import type { DateRange, StackedBarData } from '@/lib/db-types';
import { useTimelineChartModel } from '@/hooks/useTimelineChartModel';

const TimelineChartView = lazy(() =>
  import('@/components/dashboard/timeline-chart/TimelineChartView').then((module) => ({
    default: module.TimelineChartView,
  })),
);

interface TimelineChartPresentationProps {
  projectColors?: Record<string, string>;
  granularity?: 'hour' | 'day';
  dateRange?: DateRange;
  trimLeadingToFirstData?: boolean;
  title?: string;
  heightClassName?: string;
  disableAnimation?: boolean;
}

interface TimelineChartInteractionProps {
  onBarClick?: (date: string) => void;
  onBarContextMenu?: (date: string, x: number, y: number) => void;
}

interface TimelineChartStateProps {
  isLoading?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  loadingMessage?: string;
}

interface TimelineChartProps {
  data: StackedBarData[];
  presentation?: TimelineChartPresentationProps;
  interaction?: TimelineChartInteractionProps;
  state?: TimelineChartStateProps;
}

export function TimelineChart({
  data,
  presentation,
  interaction,
  state,
}: TimelineChartProps) {
  const model = useTimelineChartModel(data, presentation, state);
  const { onBarClick, onBarContextMenu } = interaction ?? {};

  return (
    <TimelineChartView
      model={model}
      onBarClick={onBarClick}
      onBarContextMenu={onBarContextMenu}
    />
  );
}
