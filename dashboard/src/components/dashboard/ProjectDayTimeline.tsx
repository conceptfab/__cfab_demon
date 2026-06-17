import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const ProjectDayTimelineInner = lazy(() =>
  import('./ProjectDayTimeline.impl').then((m) => ({ default: m.ProjectDayTimeline }))
);

const ChartSkeleton = () => (
  <div className="size-full animate-pulse bg-muted rounded min-h-[200px]" />
);

export function ProjectDayTimeline(
  props: ComponentProps<typeof ProjectDayTimelineInner>
) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <ProjectDayTimelineInner {...props} />
    </Suspense>
  );
}
