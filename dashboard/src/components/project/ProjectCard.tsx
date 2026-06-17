import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarPlus,
  GitMerge,
  LayoutDashboard,
  MessageSquare,
  MousePointerClick,
  Snowflake,
  Trophy,
} from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  AppWithStats,
  ProjectExtraInfo,
  ProjectWithStats,
} from '@/lib/db-types';
import { cn, formatMoney } from '@/lib/utils';
import {
  DuplicateMarkerBadge,
  type DuplicateInfo,
} from '@/components/project/DuplicateMarkerBadge';
import { ProjectCardAssignList } from '@/components/project/ProjectCardAssignList';
import { ProjectCardColorPicker } from '@/components/project/ProjectCardColorPicker';
import { ProjectCardDialogPanel } from '@/components/project/ProjectCardDialogPanel';
import { ProjectCardDurationDisplay } from '@/components/project/project-card-duration';

export type ProjectCardFlags = {
  isNew: boolean;
  isDeleting: boolean;
  isHotProject: boolean;
  inDialog?: boolean;
  minimal?: boolean;
  assignOpen: boolean;
  isColorEditorOpen: boolean;
};

export type ProjectCardProps = {
  project: ProjectWithStats;
  currencyCode: string;
  estimateValue: number;
  flags: ProjectCardFlags;
  duplicateInfo?: DuplicateInfo | null;
  extraInfo: ProjectExtraInfo | null;
  loadingExtra: boolean;
  apps: AppWithStats[];
  pendingColor: string | null;
  onToggleColorEditor: () => void;
  onPendingColorChange: (color: string) => void;
  onSavePendingColor: () => void;
  onSelectPresetColor: (color: string) => void;
  onResetProjectTime: () => void;
  onToggleFreeze: () => void;
  onOpenMergeDialog: () => void;
  onExclude: () => void;
  onDelete: () => void | Promise<void>;
  onOpenManualSession: () => void;
  onOpenProjectPage: () => void;
  onToggleAssignOpen: () => void;
  onAssignApp: (appId: number, projectId: number | null) => void | Promise<void>;
  onCompactProject: () => void;
};

function ProjectCardComponent({
  project,
  currencyCode,
  estimateValue,
  flags,
  duplicateInfo,
  extraInfo,
  loadingExtra,
  apps,
  pendingColor,
  onToggleColorEditor,
  onPendingColorChange,
  onSavePendingColor,
  onSelectPresetColor,
  onToggleFreeze,
  onOpenMergeDialog,
  onOpenManualSession,
  onOpenProjectPage,
  onToggleAssignOpen,
  onAssignApp,
  onCompactProject,
}: ProjectCardProps) {
  const { t } = useTranslation();
  const {
    assignOpen,
    inDialog,
    isColorEditorOpen,
    isDeleting,
    isHotProject,
    isNew,
    minimal,
  } = flags;

  return (
    <Card
      data-project-id={project.id}
      data-project-name={project.name}
      className={isNew ? 'border-yellow-400/70' : undefined}
    >
      <CardHeader
        className={cn(
          'flex flex-row items-center justify-between gap-2 pb-2',
          inDialog && 'pr-12 max-sm:pr-14',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ProjectCardColorPicker
            projectColor={project.color}
            pendingColor={pendingColor}
            isOpen={isColorEditorOpen}
            onPendingColorChange={onPendingColorChange}
            onSavePendingColor={onSavePendingColor}
            onSelectPresetColor={onSelectPresetColor}
            onToggle={onToggleColorEditor}
          />
          <CardTitle
            className={cn(
              'flex items-center gap-2',
              project.name.length > 50
                ? 'text-xs leading-tight'
                : project.name.length > 30
                  ? 'text-sm'
                  : 'text-base',
            )}
          >
            {project.name}
            {duplicateInfo ? <DuplicateMarkerBadge duplicateInfo={duplicateInfo} /> : null}
            {project.is_imported === 1 && (
              <Badge
                variant="secondary"
                className="h-4 border-orange-500/20 bg-orange-500/10 px-1 py-0 text-[10px] text-orange-500"
              >
                {t('projects.labels.imported')}
              </Badge>
            )}
          </CardTitle>
        </div>
        <div className={cn('flex shrink-0 gap-1', inDialog && 'mr-0')}>
          {!project.frozen_at && !project.excluded_at && !project.merged_into && (
            <AppTooltip content={t('projects.labels.merge_project')}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('projects.labels.merge_project')}
                className="size-11 text-muted-foreground sm:size-7"
                onClick={onOpenMergeDialog}
                disabled={isDeleting}
              >
                <GitMerge className="size-3.5" />
              </Button>
            </AppTooltip>
          )}
          <AppTooltip
            content={
              project.frozen_at
                ? t('projects.labels.frozen_since_click_unfreeze', {
                    date: project.frozen_at.slice(0, 10),
                  })
                : t('projects.labels.freeze_project')
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                project.frozen_at
                  ? t('projects.labels.frozen_since_click_unfreeze', {
                      date: project.frozen_at.slice(0, 10),
                    })
                  : t('projects.labels.freeze_project')
              }
              className={cn(
                'size-11 sm:size-7',
                project.frozen_at
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'text-muted-foreground',
              )}
              onClick={onToggleFreeze}
              disabled={isDeleting}
            >
              <Snowflake className="size-3.5" />
            </Button>
          </AppTooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t('projects.labels.total_time_value')}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-1 text-lg leading-none font-[200] text-emerald-400 sm:text-xl">
              <ProjectCardDurationDisplay seconds={project.total_seconds} />
              <span className="text-[1em] font-[600] opacity-30">/</span>
              <span className="text-[0.8em] font-[200] opacity-90">
                {formatMoney(estimateValue, currencyCode)}
              </span>
              <span className="ml-1 flex items-center gap-2">
                {isHotProject && (
                  <AppTooltip content={t('projects.labels.hot_project')}>
                    <span>
                      <Trophy className="size-4 fill-amber-500/10 text-amber-500" />
                    </span>
                  </AppTooltip>
                )}
                {extraInfo && extraInfo.db_stats.manual_session_count > 0 && (
                  <AppTooltip
                    content={t('layout.tooltips.manual_sessions', {
                      count: extraInfo.db_stats.manual_session_count,
                    })}
                  >
                    <span>
                      <MousePointerClick className="size-4 fill-sky-400/10 text-sky-400" />
                    </span>
                  </AppTooltip>
                )}
                {extraInfo && extraInfo.db_stats.comment_count > 0 && (
                  <AppTooltip
                    content={`${t('projects.labels.comments')} ${extraInfo.db_stats.comment_count}`}
                  >
                    <span>
                      <MessageSquare className="size-4 fill-blue-400/20 text-blue-400" />
                    </span>
                  </AppTooltip>
                )}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-end">
            <AppTooltip content={t('projects.labels.add_manual_session')}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('projects.labels.add_manual_session')}
                onClick={onOpenManualSession}
                className="size-11 shrink-0 sm:size-9"
                disabled={isDeleting}
              >
                <CalendarPlus className="size-4" />
              </Button>
            </AppTooltip>

            <AppTooltip content={t('projects.labels.project_card')}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('projects.labels.project_card')}
                onClick={onOpenProjectPage}
                className="size-11 shrink-0 sm:size-9"
                disabled={isDeleting}
              >
                <LayoutDashboard className="size-4" />
              </Button>
            </AppTooltip>
          </div>
        </div>

        {inDialog && (
          <ProjectCardDialogPanel
            project={project}
            extraInfo={extraInfo}
            loadingExtra={loadingExtra}
            isDeleting={isDeleting}
            onToggleAssignOpen={onToggleAssignOpen}
            onCompactProject={onCompactProject}
          />
        )}

        {assignOpen && (
          <ProjectCardAssignList
            apps={apps}
            project={project}
            isDeleting={isDeleting}
            onAssignApp={onAssignApp}
          />
        )}
      </CardContent>
    </Card>
  );
}

export const ProjectCard = memo(ProjectCardComponent);
