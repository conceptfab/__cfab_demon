import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PromptModal } from '@/components/ui/prompt-modal';
import { cn } from '@/lib/utils';
import { ProjectDayTimelineAssignMenu } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineAssignMenu';
import { ProjectDayTimelineClusterDialog } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineClusterDialog';
import { ProjectDayTimelineHeader } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineHeader';
import { ProjectDayTimelineManualMenu } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineManualMenu';
import { ProjectDayTimelineRows } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineRows';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

interface ProjectDayTimelineViewProps {
  controller: ProjectDayTimelineController;
  title?: string;
  minHeightClassName?: string;
}

export function ProjectDayTimelineView({
  controller,
  title,
  minHeightClassName,
}: ProjectDayTimelineViewProps) {
  const { model, promptConfig, setPromptConfig, t } = controller;

  return (
    <Card>
      <CardHeader className="gap-2 space-y-0 p-3 pb-2 sm:p-4">
        <ProjectDayTimelineHeader {...controller} title={title} />
      </CardHeader>
      <CardContent className={cn('p-3 sm:p-4', minHeightClassName)}>
        {!model && (
          <p className="text-sm text-muted-foreground py-6">
            {t('project_day_timeline.text.no_project_activity_in_selected_day')}
          </p>
        )}
        {model && <ProjectDayTimelineRows {...controller} />}
      </CardContent>

      <ProjectDayTimelineAssignMenu {...controller} />
      <ProjectDayTimelineManualMenu {...controller} />
      <ProjectDayTimelineClusterDialog {...controller} />

      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => {
          if (!open) {
            promptConfig?.onCancel?.();
            setPromptConfig(null);
          }
        }}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
      />
    </Card>
  );
}
