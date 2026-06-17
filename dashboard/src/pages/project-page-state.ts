import type {
  ManualSessionWithProject,
  ProjectExtraInfo,
  ProjectWithStats,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';

export type ProjectPageData = {
  project: ProjectWithStats | null;
  extraInfo: ProjectExtraInfo | null;
  timelineData: StackedBarData[];
  timelineError: string | null;
  recentSessions: SessionWithApp[];
  manualSessions: ManualSessionWithProject[];
  mergedChildren: ProjectWithStats[];
  estimate: number;
};

export type ProjectPageState = {
  loading: boolean;
  data: ProjectPageData;
  projectsList: ProjectWithStats[];
};

const EMPTY_PROJECT_PAGE_DATA: ProjectPageData = {
  project: null,
  extraInfo: null,
  timelineData: [],
  timelineError: null,
  recentSessions: [],
  manualSessions: [],
  mergedChildren: [],
  estimate: 0,
};

export function createInitialProjectPageState(
  loading = true,
): ProjectPageState {
  return {
    loading,
    data: EMPTY_PROJECT_PAGE_DATA,
    projectsList: [],
  };
}

function upsertProjectInList(
  projects: ProjectWithStats[],
  nextProject: ProjectWithStats,
): ProjectWithStats[] {
  const existingIndex = projects.findIndex(
    (project) => project.id === nextProject.id,
  );
  if (existingIndex === -1) {
    return [nextProject, ...projects];
  }

  const nextProjects = [...projects];
  nextProjects[existingIndex] = nextProject;
  return nextProjects;
}

export type ProjectLoadResult = {
  project: ProjectWithStats;
  extraInfo: ProjectExtraInfo;
  timelineData: StackedBarData[];
  timelineError: string | null;
  recentSessions: SessionWithApp[];
  manualSessions: ManualSessionWithProject[];
  mergedChildren: ProjectWithStats[];
  estimate: number;
};

export function applyProjectPageLoad(
  prev: ProjectPageState,
  load: ProjectLoadResult,
): ProjectPageState {
  return {
    loading: false,
    data: {
      project: load.project,
      extraInfo: load.extraInfo,
      timelineData: load.timelineData,
      timelineError: load.timelineError,
      recentSessions: load.recentSessions,
      manualSessions: load.manualSessions,
      mergedChildren: load.mergedChildren,
      estimate: load.estimate,
    },
    projectsList: upsertProjectInList(prev.projectsList, load.project),
  };
}
