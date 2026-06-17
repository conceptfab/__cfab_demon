import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import type { ProjectExtraInfo, ProjectWithStats } from '@/lib/db-types';
import { ProjectCardDurationDisplay } from '@/components/project/project-card-duration';

const TOP_APPS_DIALOG_LIMIT = 5;

type ProjectCardDialogPanelProps = {
  project: ProjectWithStats;
  extraInfo: ProjectExtraInfo | null;
  loadingExtra: boolean;
  isDeleting: boolean;
  onToggleAssignOpen: () => void;
  onCompactProject: () => void;
};

export function ProjectCardDialogPanel({
  project,
  extraInfo,
  loadingExtra,
  isDeleting,
  onToggleAssignOpen,
  onCompactProject,
}: ProjectCardDialogPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-4 animate-in space-y-4 border-t pt-4 text-sm fade-in duration-500">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('projects_page.top_applications')}
        </p>
        {loadingExtra ? (
          <p className="text-xs italic text-muted-foreground">{t('ui.app.loading')}</p>
        ) : (
          <div className="space-y-1.5">
            {extraInfo?.top_apps.slice(0, TOP_APPS_DIALOG_LIMIT).map((app) => (
              <div
                key={app.name}
                className="flex min-h-9 items-center gap-2 text-xs sm:min-h-0"
              >
                <div
                  className="size-2.5 shrink-0 rounded-full sm:size-2"
                  style={{ backgroundColor: app.color || '#64748b' }}
                />
                <span className="min-w-0 flex-1 truncate">{app.name}</span>
                <span className="shrink-0 font-mono text-emerald-400">
                  <ProjectCardDurationDisplay seconds={app.seconds} />
                </span>
              </div>
            ))}
            {(extraInfo?.top_apps.length ?? 0) > TOP_APPS_DIALOG_LIMIT && (
              <p className="pt-0.5 text-[10px] text-muted-foreground">
                {t('projects_page.top_applications_more', {
                  count: (extraInfo?.top_apps.length ?? 0) - TOP_APPS_DIALOG_LIMIT,
                })}
              </p>
            )}
            {extraInfo?.top_apps.length === 0 && (
              <p className="text-xs italic text-muted-foreground">
                {t('projects_page.no_data')}
              </p>
            )}

            <div className="mt-2 flex flex-col gap-2 border-t border-dashed border-muted-foreground/20 pt-2 sm:flex-row sm:items-center sm:justify-between">
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
                className="h-11 w-full text-xs sm:h-7 sm:w-auto sm:min-w-[10rem]"
                onClick={onToggleAssignOpen}
                disabled={isDeleting}
              >
                {t('projects_page.manage_apps')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg bg-secondary/30 p-2.5 sm:p-3">
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
              <span className="text-muted-foreground">{t('projects_page.sessions')}</span>
              <span className="font-medium">{extraInfo?.db_stats.session_count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('projects_page.manual')}</span>
              <span className="font-medium">
                {extraInfo?.db_stats.manual_session_count || 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('projects.labels.comments')}</span>
              <span className="font-medium">{extraInfo?.db_stats.comment_count || 0}</span>
            </div>
          </div>
        )}

        <div className="pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-11 w-full border-amber-500/20 bg-amber-500/10 text-xs text-amber-500 hover:bg-amber-500/20 sm:h-7 sm:text-[10px]"
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
  );
}
