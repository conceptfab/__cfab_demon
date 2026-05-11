import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const AllProjectsChartInner = lazy(() =>
  import('./AllProjectsChart.impl').then((m) => ({ default: m.AllProjectsChart }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function AllProjectsChart(props: ComponentProps<typeof AllProjectsChartInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <AllProjectsChartInner {...props} />
    </Suspense>
  );
}
