import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const WeeklyBarChartInner = lazy(() =>
  import('./WeeklyView.impl').then((m) => ({ default: m.WeeklyBarChart }))
);
const WeeklyHeatmapInner = lazy(() =>
  import('./WeeklyView.impl').then((m) => ({ default: m.WeeklyHeatmap }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function WeeklyBarChart(props: ComponentProps<typeof WeeklyBarChartInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <WeeklyBarChartInner {...props} />
    </Suspense>
  );
}

export function WeeklyHeatmap(props: ComponentProps<typeof WeeklyHeatmapInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <WeeklyHeatmapInner {...props} />
    </Suspense>
  );
}

