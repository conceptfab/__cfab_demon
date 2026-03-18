import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarPlus,
  CircleOff,
  LayoutDashboard,
  MessageSquare,
  MousePointerClick,
  Save,
  Snowflake,
  TimerReset,
  Trash2,
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
import { PROJECT_COLORS } from '@/lib/project-colors';
import { cn, formatMoney } from '@/lib/utils';

type ProjectCardProps = {
  project: ProjectWithStats;
  currencyCode: string;
  estimateValue: number;
  isNew: boolean;
  isDeleting: boolean;
  isHotProject: boolean;
  inDialog?: boolean;
  duplicateMarker?: ReactNode;
  extraInfo: ProjectExtraInfo | null;
  loadingExtra: boolean;
  apps: AppWithStats[];
  assignOpen: boolean;
  isColorEditorOpen: boolean;
  pendingColor: string | null;
  renderDuration: (seconds: number) => ReactNode;
  onToggleColorEditor: () => void;
  onPendingColorChange: (color: string) => void;
  onSavePendingColor: () => void;
  onSelectPresetColor: (color: string) => void;
  onResetProjectTime: () => void;
  onToggleFreeze: () => void;
  onExclude: () => void;
  onDelete: () => void | Promise<void>;
  onOpenManualSession: () => void;
  onOpenProjectPage: () => void;
  onToggleAssignOpen: () => void;
  onAssignApp: (appId: number, projectId: number | null) => void | Promise<void>;
  onCompactProject: () => void;
};

export function ProjectCard({
  project,
  currencyCode,
  estimateValue,
  isNew,
  isDeleting,
  isHotProject,
  inDialog,
  duplicateMarker,
  extraInfo,
  loadingExtra,
  apps,
  assignOpen,
  isColorEditorOpen,
  pendingColor,
  renderDuration,
  onToggleColorEditor,
  onPendingColorChange,
  onSavePendingColor,
  onSelectPresetColor,
  onResetProjectTime,
  onToggleFreeze,
  onExclude,
  onDelete,
  onOpenManualSession,
  onOpenProjectPage,
  onToggleAssignOpen,
  onAssignApp,
  onCompactProject,
}: ProjectCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      data-project-id={project.id}
      data-project-name={project.name}
      className={isNew ? 'border-yellow-400/70' : undefined}
    >
      <CardHeader
        className={cn(
          'flex flex-row items-center justify-between pb-2',
          inDialog && 'pr-10',
        )}
      >
        <div className="flex items-center gap-2">
          <div className="relative group">
            <AppTooltip content={t('projects.labels.change_color')}>
              <div
                className="h-3 w-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                style={{
                  backgroundColor:
                    isColorEditorOpen && pendingColor ? pendingColor : project.color,
                }}
                onClick={onToggleColorEditor}
              />
            </AppTooltip>
            {isColorEditorOpen && (
              <div className="absolute top-full left-0 z-50 mt-1 rounded border bg-popover p-2 shadow-md">
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    defaultValue={project.color}
                    className="h-8 w-16 cursor-pointer rounded border border-border"
                    onChange={(event) => onPendingColorChange(event.target.value)}
                    title={t('projects.labels.choose_color')}
                  />
                  {pendingColor && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-500 hover:text-green-400"
                      onClick={onSavePendingColor}
                      title={t('projects.labels.save')}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex gap-1">
                  {PROJECT_COLORS.map((color) => (
                    <AppTooltip key={color} content={color}>
                      <button
                        type="button"
                        className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                        style={{ backgroundColor: color }}
                        onClick={() => onSelectPresetColor(color)}
                      />
                    </AppTooltip>
                  ))}
                </div>
              </div>
            )}
          </div>
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
            {duplicateMarker}
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
        <div className={cn('flex gap-1', inDialog && 'mr-8')}>
          <AppTooltip content={t('projects.labels.reset_time')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onResetProjectTime}
              disabled={isDeleting}
            >
              <TimerReset className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
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
              className={cn(
                'h-7 w-7',
                project.frozen_at
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'text-muted-foreground',
              )}
              onClick={onToggleFreeze}
              disabled={isDeleting}
            >
              <Snowflake className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
          <AppTooltip content={t('projects.labels.exclude_project')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={onExclude}
              disabled={isDeleting}
            >
              <CircleOff className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
          <AppTooltip content={t('projects.labels.delete_project_permanently')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => void onDelete()}
              disabled={isDeleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t('projects.labels.total_time_value')}
            </p>
            <p className="flex items-baseline gap-x-1 text-xl leading-none font-[200] text-emerald-400">
              {renderDuration(project.total_seconds)}
              <span className="text-[1em] font-[600] opacity-30">/</span>
              <span className="text-[0.8em] font-[200] opacity-90">
                {formatMoney(estimateValue, currencyCode)}
              </span>
              <span className="ml-1 flex items-center gap-2">
                {isHotProject && (
                  <AppTooltip content={t('projects.labels.hot_project')}>
                    <span>
                      <Trophy className="h-4 w-4 fill-amber-500/10 text-amber-500" />
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
                      <MousePointerClick className="h-4 w-4 fill-sky-400/10 text-sky-400" />
                    </span>
                  </AppTooltip>
                )}
                {extraInfo && extraInfo.db_stats.comment_count > 0 && (
                  <AppTooltip
                    content={`${t('projects.labels.comments')} ${extraInfo.db_stats.comment_count}`}
                  >
                    <span>
                      <MessageSquare className="h-4 w-4 fill-blue-400/20 text-blue-400" />
                    </span>
                  </AppTooltip>
                )}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <AppTooltip content={t('projects.labels.add_manual_session')}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenManualSession}
                className="h-9 w-9 shrink-0"
                disabled={isDeleting}
              >
                <CalendarPlus className="h-4 w-4" />
              </Button>
            </AppTooltip>

            <AppTooltip content={t('projects.labels.project_card')}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenProjectPage}
                className="h-9 w-9 shrink-0"
                disabled={isDeleting}
              >
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            </AppTooltip>
          </div>
        </div>

        {inDialog && (
          <div className="mt-4 animate-in space-y-4 border-t pt-4 text-sm fade-in duration-500">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Top 3 Applications
              </p>
              {loadingExtra ? (
                <p className="text-xs italic text-muted-foreground">
                  {t('ui.app.loading')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {extraInfo?.top_apps.map((app, index) => (
                    <div key={index} className="flex items-center gap-2 text-xs">
                      <div
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: app.color || '#64748b' }}
                      />
                      <span className="flex-1 truncate">{app.name}</span>
                      <span className="shrink-0 font-mono text-emerald-400">
                        {renderDuration(app.seconds)}
                      </span>
                    </div>
                  ))}
                  {extraInfo?.top_apps.length === 0 && (
                    <p className="text-xs italic text-muted-foreground">
                      {t('projects_page.no_data')}
                    </p>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-muted-foreground/20 pt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-tight text-muted-foreground">
                        {t('projects_page.apps_linked')}
                      </span>
                      <span className="text-xs font-bold text-emerald-400">
                        {project.app_count}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-1/2 text-[11px]"
                      onClick={onToggleAssignOpen}
                      disabled={isDeleting}
                    >
                      {t('projects_page.manage_apps')}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg bg-secondary/30 p-3">
              <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('projects_page.database_statistics')}
                {extraInfo && (
                  <span className="text-[10px] font-normal lowercase opacity-70">
                    ~{(extraInfo.db_stats.estimated_size_bytes / 1024).toFixed(1)} KB
                  </span>
                )}
              </p>
              {loadingExtra ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  {t('projects_page.loading_statistics')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('projects_page.sessions')}
                    </span>
                    <span className="font-medium">
                      {extraInfo?.db_stats.session_count || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('projects_page.manual')}
                    </span>
                    <span className="font-medium">
                      {extraInfo?.db_stats.manual_session_count || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t('projects.labels.comments')}
                    </span>
                    <span className="font-medium">
                      {extraInfo?.db_stats.comment_count || 0}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 w-full border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-500 hover:bg-amber-500/20"
                  onClick={onCompactProject}
                  disabled={
                    loadingExtra ||
                    !extraInfo ||
                    extraInfo.db_stats.file_activity_count === 0 ||
                    isDeleting
                  }
                >
                  {isDeleting
                    ? t('projects.labels.compacting')
                    : t('projects.labels.compact_project_data')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {assignOpen && (
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {apps.map((app) => (
              <label
                key={app.id}
                className="flex items-center gap-2 rounded p-1 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={app.project_id === project.id}
                  onChange={() =>
                    void onAssignApp(
                      app.id,
                      app.project_id === project.id ? null : project.id,
                    )
                  }
                  className="accent-primary"
                  disabled={isDeleting}
                />
                <span className="truncate">{app.display_name}</span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
