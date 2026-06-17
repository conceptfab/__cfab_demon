import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const DailyBarChartInner = lazy(() =>
  import('./DailyView.impl').then((m) => ({ default: m.DailyBarChart }))
);
const DailyHeatmapInner = lazy(() =>
  import('./DailyView.impl').then((m) => ({ default: m.DailyHeatmap }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function DailyBarChart(props: ComponentProps<typeof DailyBarChartInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <DailyBarChartInner {...props} />
    </Suspense>
  );
}

export function DailyHeatmap(props: ComponentProps<typeof DailyHeatmapInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <DailyHeatmapInner {...props} />
    </Suspense>
  );
}

