import type { ReactNode } from 'react';
import { memo } from 'react';
import { Snowflake, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import type { ProjectWithStats } from '@/lib/db-types';
import { cn } from '@/lib/utils';
import { isRecentProject } from '@/lib/project-utils';

interface ProjectListProps {
  hiddenCount: number;
  hotProjectIds: Set<number>;
  listKey: string;
  newProjectMaxAgeMs: number;
  projects: ProjectWithStats[];
  renderDuplicateMarker: (project: ProjectWithStats) => ReactNode;
  renderProjectCard: (project: ProjectWithStats) => ReactNode;
  viewMode: 'detailed' | 'compact';
  onLoadMore: () => void;
  onOpenProject: (project: ProjectWithStats) => void;
  onUnfreeze: (projectId: number) => void;
}

function ProjectListComponent({
  hiddenCount,
  hotProjectIds,
  newProjectMaxAgeMs,
  projects,
  renderDuplicateMarker,
  renderProjectCard,
  viewMode,
  onLoadMore,
  onOpenProject,
  onUnfreeze,
}: ProjectListProps) {
  const { t } = useTranslation();

  if (projects.length === 0) return null;

  if (viewMode === 'compact') {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {projects.map((project) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              data-project-id={project.id}
              data-project-name={project.name}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border bg-card p-3 shadow-sm transition-colors hover:bg-accent',
                isRecentProject(project, newProjectMaxAgeMs, {
                  useLastActivity: true,
                }) && 'border-yellow-400/70',
              )}
              onClick={() => onOpenProject(project)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProject(project); } }}
            >
              <div
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate font-medium',
                    project.name.length > 40
                      ? 'text-[11px]'
                      : project.name.length > 25
                        ? 'text-xs'
                        : 'text-sm',
                  )}
                  title={project.name}
                >
                  {project.name}
                </span>
                {project.frozen_at && (
                  <AppTooltip content={t('projects.labels.frozen_since_click_unfreeze', {
                    date: project.frozen_at.slice(0, 10),
                  })}>
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center rounded p-0.5 text-blue-400 transition-colors hover:bg-blue-500/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnfreeze(project.id);
                      }}
                    >
                      <Snowflake className="size-3 shrink-0" />
                    </button>
                  </AppTooltip>
                )}
                {renderDuplicateMarker(project)}
                {hotProjectIds.has(project.id) && (
                  <AppTooltip content={t('projects.labels.hot_project')}>
                    <span className="shrink-0">
                      <Trophy className="size-3.5 fill-amber-500/20 text-amber-500" />
                    </span>
                  </AppTooltip>
                )}
              </span>
            </div>
          ))}
        </div>
        {hiddenCount > 0 && (
          <LoadMoreButton hiddenCount={hiddenCount} onLoadMore={onLoadMore} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => renderProjectCard(project))}
      </div>
      {hiddenCount > 0 && (
        <LoadMoreButton hiddenCount={hiddenCount} onLoadMore={onLoadMore} />
      )}
    </div>
  );
}

function LoadMoreButton({
  hiddenCount,
  onLoadMore,
}: {
  hiddenCount: number;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" onClick={onLoadMore}>
        {t('projects_page.load_more_projects')} ({hiddenCount})
      </Button>
    </div>
  );
}

export const ProjectList = memo(ProjectListComponent);
