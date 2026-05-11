import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const HourlyBreakdownInner = lazy(() =>
  import('./HourlyBreakdown.impl').then((m) => ({ default: m.HourlyBreakdown }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function HourlyBreakdown(props: ComponentProps<typeof HourlyBreakdownInner>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <HourlyBreakdownInner {...props} />
    </Suspense>
  );
}
