import { create } from 'zustand';
import { getProjects } from '@/lib/tauri';
import type { ProjectWithStats } from '@/lib/db-types';
import {
  APP_REFRESH_EVENT,
  LOCAL_DATA_CHANGED_EVENT,
  PROJECTS_ALL_TIME_INVALIDATED_EVENT,
  type AppRefreshDetail,
  type LocalDataChangedDetail,
} from '@/lib/sync-events';
import { shouldRefreshProjectsCache } from '@/lib/projects-all-time';
import { shouldRefreshProjectsCacheFromAppReason } from '@/lib/page-refresh-reasons';

let projectsAllTimeInFlight: Promise<ProjectWithStats[]> | null = null;
let projectsCacheListenersInitialized = false;

interface ProjectsCacheState {
  projectsAllTime: ProjectWithStats[];
  projectsAllTimeLoaded: boolean;
  loadProjectsAllTime: (force?: boolean) => Promise<ProjectWithStats[]>;
  invalidateProjectsAllTime: () => void;
}

export const useProjectsCacheStore = create<ProjectsCacheState>((set, get) => ({
  projectsAllTime: [],
  projectsAllTimeLoaded: false,
  loadProjectsAllTime: async (force = false) => {
    const state = get();
    if (!force && state.projectsAllTimeLoaded) {
      return state.projectsAllTime;
    }
    if (projectsAllTimeInFlight) {
      return projectsAllTimeInFlight;
    }

    projectsAllTimeInFlight = getProjects()
      .then((projects) => {
        set({
          projectsAllTime: projects,
          projectsAllTimeLoaded: true,
        });
        return projects;
      })
      .finally(() => {
        projectsAllTimeInFlight = null;
      });

    return projectsAllTimeInFlight;
  },
  invalidateProjectsAllTime: () =>
    set((state) => ({
      projectsAllTime: state.projectsAllTime,
      projectsAllTimeLoaded: false,
    })),
}));

function ensureProjectsCacheListeners(): void {
  if (projectsCacheListenersInitialized || typeof window === 'undefined') {
    return;
  }
  projectsCacheListenersInitialized = true;

  const handleLocalDataChange = (event: Event) => {
    const customEvent = event as CustomEvent<LocalDataChangedDetail>;
    const reason = customEvent.detail?.reason;
    if (!reason || !shouldRefreshProjectsCache(reason)) {
      return;
    }
    void useProjectsCacheStore.getState().loadProjectsAllTime(true);
  };

  const handleAllTimeInvalidated = () => {
    void useProjectsCacheStore.getState().loadProjectsAllTime(true);
  };

  const handleAppRefresh = (event: Event) => {
    const customEvent = event as CustomEvent<AppRefreshDetail>;
    const reasons = customEvent.detail?.reasons ?? [];
    if (!reasons.some((reason) => shouldRefreshProjectsCacheFromAppReason(reason))) {
      return;
    }
    void useProjectsCacheStore.getState().loadProjectsAllTime(true);
  };

  window.addEventListener(
    LOCAL_DATA_CHANGED_EVENT,
    handleLocalDataChange as EventListener,
  );
  window.addEventListener(
    APP_REFRESH_EVENT,
    handleAppRefresh as EventListener,
  );
  window.addEventListener(
    PROJECTS_ALL_TIME_INVALIDATED_EVENT,
    handleAllTimeInvalidated,
  );
}

export function loadProjectsAllTime(force = false): Promise<ProjectWithStats[]> {
  ensureProjectsCacheListeners();
  return useProjectsCacheStore.getState().loadProjectsAllTime(force);
}
