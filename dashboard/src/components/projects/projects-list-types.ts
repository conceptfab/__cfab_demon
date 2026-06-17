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

export type ProjectsListProps = {
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
  listSlotDeps: ProjectsListSlotDeps;
};
