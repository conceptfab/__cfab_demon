/* eslint-disable react-doctor/prefer-dynamic-import -- lazy-loaded by sibling wrapper (.tsx → .impl.tsx) */
import { ProjectDayTimelineView } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineView';
import {
  EMPTY_MANUAL_SESSIONS,
  type ProjectDayTimelineProps,
} from '@/components/dashboard/project-day-timeline/project-day-timeline-types';
import { useProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

export type { ProjectDayTimelineProps };

export function ProjectDayTimeline({
  sessions,
  manualSessions = EMPTY_MANUAL_SESSIONS,
  workingHours,
  title,
  minHeightClassName,
  projects,
  onAssignSession,
  onUpdateSessionRateMultiplier,
  onUpdateSessionComment,
  onAddManualSession,
  onEditManualSession,
}: ProjectDayTimelineProps) {
  const controller = useProjectDayTimelineController({
    sessions,
    manualSessions,
    workingHours,
    projects,
    onAssignSession,
    onUpdateSessionRateMultiplier,
    onUpdateSessionComment,
    onAddManualSession,
    onEditManualSession,
  });

  return (
    <ProjectDayTimelineView
      controller={controller}
      title={title}
      minHeightClassName={minHeightClassName}
    />
  );
}
