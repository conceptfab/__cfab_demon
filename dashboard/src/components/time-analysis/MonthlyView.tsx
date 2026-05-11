import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const MonthlyBarChartInner = lazy(() =>
  import('./MonthlyView.impl').then((m) => ({ default: m.MonthlyBarChart }))
);
const MonthlyHeatmapInner = lazy(() =>
  import('./MonthlyView.impl').then((m) => ({ default: m.MonthlyHeatmap }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function MonthlyBarChart(props: ComponentProps<typeof MonthlyBarChartInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <MonthlyBarChartInner {...props} />
    </Suspense>
  );
}

export function MonthlyHeatmap(props: ComponentProps<typeof MonthlyHeatmapInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <MonthlyHeatmapInner {...props} />
    </Suspense>
  );
}

