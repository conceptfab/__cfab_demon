import type { ReactNode } from 'react';
import {
  CircleDollarSign,
  Clock,
  Folders,
  Plus,
  Save,
  Search,
  Type,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProjectFolder, ProjectWithStats } from '@/lib/db-types';
import { formatPathForDisplay } from '@/lib/utils';

type ProjectsByFolder = {
  sections: Array<{
    rootPath: string;
    projects: ProjectWithStats[];
  }>;
  outside: ProjectWithStats[];
};

type ProjectsListProps = {
  projectCount: number;
  excludedCount: number;
  projectsAllTimeLoading: boolean;
  duplicateGroupCount: number;
  duplicateProjectCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  useFolders: boolean;
  onToggleFolders: () => void;
  viewMode: 'detailed' | 'compact';
  onViewModeChange: (mode: 'detailed' | 'compact') => void;
  onSaveDefaults: () => void;
  onCreateProject: () => void;
  projectFolders: ProjectFolder[];
  projectsByFolder: ProjectsByFolder;
  filteredProjects: ProjectWithStats[];
  renderProjectList: (
    projectList: ProjectWithStats[],
    listKey: string,
  ) => ReactNode;
};

export function ProjectsList({
  projectCount,
  excludedCount,
  projectsAllTimeLoading,
  duplicateGroupCount,
  duplicateProjectCount,
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  useFolders,
  onToggleFolders,
  viewMode,
  onViewModeChange,
  onSaveDefaults,
  onCreateProject,
  projectFolders,
  projectsByFolder,
  filteredProjects,
  renderProjectList,
}: ProjectsListProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <p className="text-sm text-muted-foreground">
            {projectCount} {t('projects_page.projects')}
            {excludedCount > 0
              ? ` (${excludedCount} ${t('projects_page.excluded')})`
              : ''}
          </p>
          {projectsAllTimeLoading && (
            <p className="text-xs text-muted-foreground">
              {t('ui.app.loading')}
            </p>
          )}
          {duplicateGroupCount > 0 && (
            <p className="text-xs text-amber-600/90">
              {t('projects_page.marked_with')}{' '}
              <span className="mx-1 inline-flex h-4 w-4 translate-y-[1px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600">
                D
              </span>
              = {t('projects_page.possible_duplicate_names_in_this_tab')} (
              {duplicateProjectCount} {t('projects_page.projects')} {t('projects_page.in')}{' '}
              {duplicateGroupCount} {t('projects_page.groups')})
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-48 pl-9"
              placeholder={t('projects_page.search_projects')}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-secondary/40 p-1">
            <AppTooltip content={t('projects.labels.sort_abc')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onSortChange(sortBy === 'name-asc' ? 'name-desc' : 'name-asc')
                }
                className={`h-7 w-8 p-0 ${
                  sortBy.startsWith('name')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Type className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_value')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onSortChange(
                    sortBy === 'value-desc' ? 'value-asc' : 'value-desc',
                  )
                }
                className={`h-7 w-8 p-0 ${
                  sortBy.startsWith('value')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <CircleDollarSign className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_time')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onSortChange(
                    sortBy === 'time-desc' ? 'time-asc' : 'time-desc',
                  )
                }
                className={`h-7 w-8 p-0 ${
                  sortBy.startsWith('time')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <Clock className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <div className="mx-0.5 h-4 w-[1px] bg-border/40" />
            <AppTooltip content={t('projects.labels.toggle_folder_grouping')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleFolders}
                className={`h-7 w-8 p-0 ${
                  useFolders
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <Folders className="h-4 w-4" />
              </Button>
            </AppTooltip>
          </div>

          <div className="flex rounded-md bg-secondary/50 p-1 text-sm">
            <button
              onClick={() => onViewModeChange('detailed')}
              className={`rounded-sm px-3 py-1 transition-colors ${
                viewMode === 'detailed'
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('projects.labels.detailed')}
            </button>
            <button
              onClick={() => onViewModeChange('compact')}
              className={`rounded-sm px-3 py-1 transition-colors ${
                viewMode === 'compact'
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('projects.labels.compact')}
            </button>
          </div>

          <AppTooltip content={t('projects_page.save_view_as_default')}>
            <Button variant="ghost" size="icon" onClick={onSaveDefaults}>
              <Save className="h-4 w-4" />
            </Button>
          </AppTooltip>

          <Button size="sm" onClick={onCreateProject}>
            <Plus className="mr-2 h-4 w-4" /> {t('projects_page.new_project')}
          </Button>
        </div>
      </div>

      {useFolders && projectFolders.length > 0 ? (
        <div className="space-y-5">
          {projectsByFolder.sections.map((section) => (
            <div key={section.rootPath} className="space-y-2">
              <p
                className="text-xs font-medium text-muted-foreground"
                title={formatPathForDisplay(section.rootPath)}
              >
                {formatPathForDisplay(section.rootPath)}
              </p>
              {section.projects.length > 0 ? (
                renderProjectList(section.projects, `folder:${section.rootPath}`)
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('projects_page.no_projects_for_this_folder')}
                </p>
              )}
            </div>
          ))}
          {projectsByFolder.outside.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t('projects_page.other_projects')}
              </p>
              {renderProjectList(projectsByFolder.outside, 'folder:outside')}
            </div>
          )}
        </div>
      ) : (
        renderProjectList(filteredProjects, 'main')
      )}
    </>
  );
}
