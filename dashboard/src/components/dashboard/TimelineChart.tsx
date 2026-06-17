import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const TimelineChartInner = lazy(() =>
  import('./TimelineChart.impl').then((m) => ({ default: m.TimelineChart }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function TimelineChart(props: ComponentProps<typeof TimelineChartInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <TimelineChartInner {...props} />
    </Suspense>
  );
}
