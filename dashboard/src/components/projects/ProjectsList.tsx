import { type ReactNode, useMemo } from 'react';
import {
  CircleDollarSign,
  Clock,
  Folders,
  Plus,
  Save,
  Search,
  Snowflake,
  Type,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPathForDisplay } from '@/lib/utils';
import { ProjectsListSlot } from '@/components/projects/ProjectsListSlot';
import type {
  ProjectStatusFilter,
  ProjectsListProps,
} from '@/components/projects/projects-list-types';

const STATUS_FILTER_OPTIONS: {
  value: ProjectStatusFilter;
  activeClassName: string;
  icon: ReactNode;
}[] = [
  { value: 'all', activeClassName: 'text-foreground', icon: null },
  {
    value: 'active',
    activeClassName: 'text-emerald-500 dark:text-emerald-400',
    icon: <span className="size-1.5 rounded-full bg-emerald-500" />,
  },
  {
    value: 'frozen',
    activeClassName: 'text-sky-500 dark:text-sky-400',
    icon: <Snowflake className="size-3" />,
  },
];

export function ProjectsList({
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
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  projectFolders,
  projectsByFolder,
  filteredProjects,
  listSlotDeps,
}: ProjectsListProps) {
  const { t } = useTranslation();

  // Hide empty folders only while the list is narrowed (status filter or search).
  const isNarrowed = statusFilter !== 'all' || search.trim() !== '';
  const visibleFolderSections = useMemo(
    () =>
      isNarrowed
        ? projectsByFolder.sections.filter((section) => section.projects.length > 0)
        : projectsByFolder.sections,
    [projectsByFolder.sections, isNarrowed],
  );

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border/40 bg-secondary/40 p-0.5 text-xs">
              {STATUS_FILTER_OPTIONS.map(({ value, activeClassName, icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  onClick={() => onStatusFilterChange(value)}
                  className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-medium transition-colors ${
                    statusFilter === value
                      ? `bg-background shadow-sm ${activeClassName}`
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {icon}
                  {t(`projects.filters.${value}`)} ({statusCounts[value]})
                </button>
              ))}
            </div>
            {excludedCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({excludedCount} {t('projects_page.excluded')})
              </span>
            )}
          </div>
          {projectsAllTimeLoading && (
            <p className="text-xs text-muted-foreground">
              {t('ui.app.loading')}
            </p>
          )}
          {duplicateGroupCount > 0 && (
            <p className="text-xs text-amber-600/90">
              {t('projects_page.marked_with')}{' '}
              <span className="mx-1 inline-flex size-4 translate-y-[1px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600">
                D
              </span>
              = {t('projects_page.possible_duplicate_names_in_this_tab')} (
              {duplicateProjectCount} {t('projects_page.projects')} {t('projects_page.in')}{' '}
              {duplicateGroupCount} {t('projects_page.groups')})
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 sm:w-48"
              aria-label={t('projects_page.search_projects')}
              placeholder={t('projects_page.search_projects')}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <div className="grid w-full grid-cols-4 gap-1 rounded-md border border-border/40 bg-secondary/40 p-1 sm:flex sm:w-auto sm:max-w-full sm:items-center sm:gap-1.5">
            <AppTooltip content={t('projects.labels.sort_abc')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('projects.labels.sort_abc')}
                aria-pressed={sortBy.startsWith('name')}
                onClick={() =>
                  onSortChange(sortBy === 'name-asc' ? 'name-desc' : 'name-asc')
                }
                className={`h-8 w-full p-0 sm:h-7 sm:w-8 ${
                  sortBy.startsWith('name')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Type className="size-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_value')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('projects.labels.sort_value')}
                aria-pressed={sortBy.startsWith('value')}
                onClick={() =>
                  onSortChange(
                    sortBy === 'value-desc' ? 'value-asc' : 'value-desc',
                  )
                }
                className={`h-8 w-full p-0 sm:h-7 sm:w-8 ${
                  sortBy.startsWith('value')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <CircleDollarSign className="size-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_time')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('projects.labels.sort_time')}
                aria-pressed={sortBy.startsWith('time')}
                onClick={() =>
                  onSortChange(
                    sortBy === 'time-desc' ? 'time-asc' : 'time-desc',
                  )
                }
                className={`h-8 w-full p-0 sm:h-7 sm:w-8 ${
                  sortBy.startsWith('time')
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <Clock className="size-4" />
              </Button>
            </AppTooltip>
            <div className="hidden h-4 w-[1px] bg-border/40 sm:mx-0.5 sm:block" />
            <AppTooltip content={t('projects.labels.toggle_folder_grouping')}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('projects.labels.toggle_folder_grouping')}
                aria-pressed={useFolders}
                onClick={onToggleFolders}
                className={`h-8 w-full p-0 sm:h-7 sm:w-8 ${
                  useFolders
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <Folders className="size-4" />
              </Button>
            </AppTooltip>
          </div>

          <div className="flex w-full rounded-md bg-secondary/50 p-1 text-sm sm:w-auto">
            <button
              type="button"
              aria-pressed={viewMode === 'detailed'}
              onClick={() => onViewModeChange('detailed')}
              className={`min-h-8 flex-1 rounded-sm px-3 py-1 transition-colors sm:flex-none sm:min-h-0 ${
                viewMode === 'detailed'
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('projects.labels.detailed')}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'compact'}
              onClick={() => onViewModeChange('compact')}
              className={`min-h-8 flex-1 rounded-sm px-3 py-1 transition-colors sm:flex-none sm:min-h-0 ${
                viewMode === 'compact'
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('projects.labels.compact')}
            </button>
          </div>

          <AppTooltip content={t('projects_page.save_view_as_default')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('projects_page.save_view_as_default')}
              onClick={onSaveDefaults}
            >
              <Save className="size-4" />
            </Button>
          </AppTooltip>

          <Button size="sm" onClick={onCreateProject} className="w-full sm:w-auto">
            <Plus className="mr-2 size-4" /> {t('projects_page.new_project')}
          </Button>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          {statusCounts.all === 0
            ? t('projects.filters.no_projects')
            : t('projects.filters.no_matching')}
        </div>
      ) : useFolders && projectFolders.length > 0 ? (
        <div className="space-y-5">
          {visibleFolderSections.map((section) => (
            <div key={section.rootPath} className="space-y-2">
              <p
                className="text-xs font-medium text-muted-foreground"
                title={formatPathForDisplay(section.rootPath)}
              >
                {formatPathForDisplay(section.rootPath)}
              </p>
              {section.projects.length > 0 ? (
                <ProjectsListSlot
                  projectList={section.projects}
                  listKey={`folder:${section.rootPath}`}
                  deps={listSlotDeps}
                />
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
              <ProjectsListSlot
                projectList={projectsByFolder.outside}
                listKey="folder:outside"
                deps={listSlotDeps}
              />
            </div>
          )}
        </div>
      ) : (
        <ProjectsListSlot projectList={filteredProjects} listKey="main" deps={listSlotDeps} />
      )}
    </>
  );
}
