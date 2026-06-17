import { Clock3, Save, Type } from 'lucide-react';

import { CardTitle } from '@/components/ui/card';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { formatDuration } from '@/lib/utils';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

type ProjectDayTimelineHeaderProps = Pick<
  ProjectDayTimelineController,
  'model' | 'saveView' | 'sortMode' | 't' | 'toggleSaveView' | 'updateSortMode'
> & {
  title?: string;
};

export function ProjectDayTimelineHeader({
  model,
  saveView,
  sortMode,
  t,
  title,
  toggleSaveView,
  updateSortMode,
}: ProjectDayTimelineHeaderProps) {
  return (
    <>
      <CardTitle className="flex flex-col gap-2 text-sm font-medium sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span>{title ?? t('project_day_timeline.text.activity_timeline')}</span>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
            <AppTooltip content={t('project_day_timeline.text.sort_by_time')}>
              <button
                type="button"
                className={`inline-flex size-9 items-center justify-center rounded-sm transition-colors cursor-pointer md:size-6 ${
                  sortMode === 'time_desc'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSortMode('time_desc')}
                aria-label={t('project_day_timeline.text.sort_by_time')}
              >
                <Clock3 className="size-4 md:size-3.5" />
              </button>
            </AppTooltip>
            <AppTooltip
              content={t('project_day_timeline.text.sort_alphabetically')}
            >
              <button
                type="button"
                className={`inline-flex size-9 items-center justify-center rounded-sm transition-colors cursor-pointer md:size-6 ${
                  sortMode === 'alpha_asc'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => updateSortMode('alpha_asc')}
                aria-label={t('project_day_timeline.text.sort_alphabetically')}
              >
                <Type className="size-4 md:size-3.5" />
              </button>
            </AppTooltip>
          </div>
          <AppTooltip
            content={
              saveView
                ? t('project_day_timeline.text.saved_view_enabled')
                : t('project_day_timeline.text.saved_view_disabled')
            }
          >
            <button
              type="button"
              className={`inline-flex size-9 items-center justify-center rounded-sm border transition-colors cursor-pointer md:size-7 ${
                saveView
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-border/70 bg-secondary/20 text-muted-foreground hover:text-foreground'
              }`}
              onClick={toggleSaveView}
              aria-label={
                saveView
                  ? t('project_day_timeline.text.saved_view_enabled')
                  : t('project_day_timeline.text.saved_view_disabled')
              }
            >
              <Save className="size-4 md:size-3.5" />
            </button>
          </AppTooltip>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {model
              ? t('project_day_timeline.text.total', {
                  duration: formatDuration(model.totalSeconds),
                })
              : t('project_day_timeline.text.no_data')}
          </span>
        </div>
      </CardTitle>
      {model && (
        <p className="text-[11px] text-muted-foreground sm:hidden">
          {t('project_day_timeline.text.total', {
            duration: formatDuration(model.totalSeconds),
          })}
        </p>
      )}
    </>
  );
}
