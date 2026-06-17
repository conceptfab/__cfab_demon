import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const AiMetricsChartsInner = lazy(() =>
  import('./AiMetricsCharts.impl').then((m) => ({ default: m.AiMetricsCharts }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function AiMetricsCharts(props: ComponentProps<typeof AiMetricsChartsInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <AiMetricsChartsInner {...props} />
    </Suspense>
  );
}
