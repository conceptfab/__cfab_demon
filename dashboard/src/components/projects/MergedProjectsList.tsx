import { useTranslation } from 'react-i18next';
import { GitMerge } from 'lucide-react';

import { CollapsibleSection } from '@/components/project/CollapsibleSection';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import type { ProjectWithStats } from '@/lib/db-types';
import { formatDurationWithDaily } from '@/lib/utils';

type MergedProjectsListProps = {
  isOpen: boolean;
  onToggle: () => void;
  projects: ProjectWithStats[];
  isDeleting: (projectId: number) => boolean;
  onUnmerge: (projectId: number) => void;
  onDelete: (project: ProjectWithStats) => void;
};

export function MergedProjectsList({
  isOpen,
  onToggle,
  projects,
  isDeleting,
  onUnmerge,
  onDelete,
}: MergedProjectsListProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleSection
      title={`${t('projects.sections.merged_projects')} (${projects.length})`}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {projects.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('projects.empty.no_merged_projects')}
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
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="min-w-0 truncate">{project.name}</span>
                  <span className="shrink-0 font-mono text-emerald-400">
                    {formatDurationWithDaily(project.total_seconds, project.daily_seconds)}
                  </span>
                </p>
                <p className="flex items-center gap-1.5 truncate text-muted-foreground">
                  <GitMerge className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">
                    {t('projects.labels.merged_into', {
                      name: project.merged_into ?? '',
                    })}
                    {project.merged_at ? `: ${project.merged_at}` : ''}
                  </span>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUnmerge(project.id)}
              >
                {t('projects.labels.unmerge')}
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
        </div>
      )}
    </CollapsibleSection>
  );
}
