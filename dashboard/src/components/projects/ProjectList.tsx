import type { ReactNode } from 'react';
import { memo } from 'react';
import { Snowflake, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DuplicateMarkerBadge,
  type DuplicateInfo,
} from '@/components/project/DuplicateMarkerBadge';

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
  duplicateByProjectId: Map<number, DuplicateInfo>;
  renderProjectCard: (project: ProjectWithStats) => ReactNode;
  viewMode: 'detailed' | 'compact';
  onLoadMore: () => void;
  onOpenProject: (project: ProjectWithStats) => void;
  onUnfreeze: (projectId: number) => void;
}

function ProjectCardSlot({
  project,
  renderProjectCard,
}: {
  project: ProjectWithStats;
  renderProjectCard: (project: ProjectWithStats) => ReactNode;
}) {
  return renderProjectCard(project);
}

function ProjectListComponent({
  hiddenCount,
  hotProjectIds,
  newProjectMaxAgeMs,
  projects,
  duplicateByProjectId,
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
              data-project-id={project.id}
              data-project-name={project.name}
              className={cn(
                'flex w-full items-center gap-1 rounded-md border bg-card p-3 shadow-sm',
                isRecentProject(project, newProjectMaxAgeMs, {
                  useLastActivity: true,
                }) && 'border-yellow-400/70',
              )}
            >
              <button
                type="button"
                aria-label={t('accessibility.open_project', { name: project.name })}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground"
                onClick={() => onOpenProject(project)}
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
                  {duplicateByProjectId.has(project.id) && (
                    <DuplicateMarkerBadge
                      duplicateInfo={duplicateByProjectId.get(project.id)!}
                    />
                  )}
                  {hotProjectIds.has(project.id) && (
                    <AppTooltip content={t('projects.labels.hot_project')}>
                      <span className="shrink-0">
                        <Trophy className="size-3.5 fill-amber-500/20 text-amber-500" />
                      </span>
                    </AppTooltip>
                  )}
                </span>
              </button>
              {project.frozen_at && (
                <AppTooltip content={t('projects.labels.frozen_since_click_unfreeze', {
                  date: project.frozen_at.slice(0, 10),
                })}>
                  <button
                    type="button"
                    aria-label={t('projects.labels.frozen_since_click_unfreeze', {
                      date: project.frozen_at.slice(0, 10),
                    })}
                    className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded text-blue-400 transition-colors hover:bg-blue-500/20 md:size-auto md:p-0.5"
                    onClick={() => onUnfreeze(project.id)}
                  >
                    <Snowflake className="size-4 shrink-0 md:size-3" />
                  </button>
                </AppTooltip>
              )}
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
        {projects.map((project) => (
          <ProjectCardSlot
            key={project.id}
            project={project}
            renderProjectCard={renderProjectCard}
          />
        ))}
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
