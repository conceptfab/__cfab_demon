import { lazy, Suspense } from 'react';

const TimeAnalysisInner = lazy(() =>
  import('./TimeAnalysis.impl').then((m) => ({ default: m.TimeAnalysis }))
);

const PageSkeleton = () => (
  <div className="space-y-6">
    <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
  </div>
);

export function TimeAnalysis() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TimeAnalysisInner />
    </Suspense>
  );
}
