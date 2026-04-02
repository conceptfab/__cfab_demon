import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

import { CollapsibleSection } from '@/components/project/CollapsibleSection';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import type { ProjectWithStats } from '@/lib/db-types';

type ExcludedProjectsListProps = {
  isOpen: boolean;
  onToggle: () => void;
  projects: ProjectWithStats[];
  totalExcludedCount: number;
  hiddenCount: number;
  renderDuplicateMarker: (project: ProjectWithStats) => ReactNode;
  isDeleting: (projectId: number) => boolean;
  isDeletingAll: boolean;
  onRestore: (projectId: number) => void;
  onDelete: (project: ProjectWithStats) => void;
  onDeleteAll: () => void;
  onLoadMore: () => void;
};

export function ExcludedProjectsList({
  isOpen,
  onToggle,
  projects,
  totalExcludedCount,
  hiddenCount,
  renderDuplicateMarker,
  isDeleting,
  isDeletingAll,
  onRestore,
  onDelete,
  onDeleteAll,
  onLoadMore,
}: ExcludedProjectsListProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleSection
      title={t('projects.sections.excluded_projects')}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {projects.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('projects.empty.no_excluded_projects')}
        </p>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <span className="min-w-0 truncate">{project.name}</span>
                  {renderDuplicateMarker(project)}
                </p>
                <p className="truncate text-muted-foreground">
                  {t('projects.labels.excluded')}
                  {project.excluded_at ? `: ${project.excluded_at}` : ''}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRestore(project.id)}
              >
                {t('projects.labels.restore')}
              </Button>
              <AppTooltip content={t('projects.labels.delete_project_permanently')}>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => onDelete(project)}
                  disabled={isDeleting(project.id)}
                >
                  {t('projects.labels.delete')}
                </Button>
              </AppTooltip>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={onLoadMore}>
                {t('projects_page.load_more_projects')} ({hiddenCount})
              </Button>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={onDeleteAll}
              disabled={isDeletingAll}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t('projects.actions.delete_all_excluded', { count: totalExcludedCount })}
            </Button>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
