import type { ProjectFolder, ProjectWithStats } from '@/lib/db-types';
import type { ProjectsListSlotDeps } from '@/components/projects/ProjectsListSlot';

export type ProjectListSlotProps = {
  projectList: ProjectWithStats[];
  listKey: string;
};

export type ProjectsByFolder = {
  sections: Array<{
    rootPath: string;
    projects: ProjectWithStats[];
  }>;
  outside: ProjectWithStats[];
};

export type ProjectStatusFilter = 'all' | 'active' | 'frozen';

export type ProjectStatusCounts = {
  all: number;
  active: number;
  frozen: number;
};

export type ProjectsListProps = {
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
  statusFilter: ProjectStatusFilter;
  onStatusFilterChange: (filter: ProjectStatusFilter) => void;
  statusCounts: ProjectStatusCounts;
  projectFolders: ProjectFolder[];
  projectsByFolder: ProjectsByFolder;
  filteredProjects: ProjectWithStats[];
  listSlotDeps: ProjectsListSlotDeps;
};
