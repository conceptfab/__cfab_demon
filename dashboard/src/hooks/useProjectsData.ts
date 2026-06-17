import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppWithStats,
  DetectedProject,
  EstimateProjectRow,
  FolderProjectCandidate,
  ProjectExtraInfo,
  ProjectFolder,
  ProjectWithStats,
} from '@/lib/db-types';
import {
  shouldRefreshProjectsPageAllTime,
  shouldRefreshProjectsPageCore,
  shouldRefreshProjectsPageFolders,
} from '@/lib/page-refresh-reasons';
import {
  buildEstimateMap,
  shouldInvalidateProjectExtraInfo,
} from '@/lib/projects-all-time';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { applicationsApi, dashboardApi, projectsApi, settingsApi } from '@/lib/tauri';
import { logTauriError } from '@/lib/utils';
import { PROJECTS_ALL_TIME_INVALIDATED_EVENT } from '@/lib/sync-events';
import {
  loadProjectsAllTime,
  useProjectsCacheStore,
} from '@/store/projects-cache-store';

export const PROJECT_FOLDERS_LOAD_ERROR = '__projects_load_folders_failed__';

type CoreProjectsBundle = {
  excludedProjects: ProjectWithStats[];
  mergedProjects: ProjectWithStats[];
  apps: AppWithStats[];
  isDemoMode: boolean;
};

const initialCoreProjectsBundle: CoreProjectsBundle = {
  excludedProjects: [],
  mergedProjects: [],
  apps: [],
  isDemoMode: false,
};

type FolderProjectsBundle = {
  projectFolders: ProjectFolder[];
  folderCandidates: FolderProjectCandidate[];
  detectedProjects: DetectedProject[];
  estimates: Record<number, number>;
  folderError: string | null;
};

const initialFolderProjectsBundle: FolderProjectsBundle = {
  projectFolders: [],
  folderCandidates: [],
  detectedProjects: [],
  estimates: {},
  folderError: null,
};

function applyCoreProjectsBundle(
  prev: CoreProjectsBundle,
  results: PromiseSettledResult<unknown>[],
): CoreProjectsBundle {
  const [excludedRes, mergedRes, appsRes, demoModeRes] = results as [
    PromiseSettledResult<ProjectWithStats[]>,
    PromiseSettledResult<ProjectWithStats[]>,
    PromiseSettledResult<AppWithStats[]>,
    PromiseSettledResult<{ enabled: boolean }>,
  ];

  const next = { ...prev };

  if (excludedRes.status === 'fulfilled') {
    next.excludedProjects = excludedRes.value;
  } else {
    logTauriError('load excluded projects', excludedRes.reason);
  }

  if (mergedRes.status === 'fulfilled') {
    next.mergedProjects = mergedRes.value;
  } else {
    logTauriError('load merged projects', mergedRes.reason);
  }

  if (appsRes.status === 'fulfilled') {
    next.apps = appsRes.value;
  } else {
    logTauriError('load applications', appsRes.reason);
  }

  if (demoModeRes.status === 'fulfilled') {
    next.isDemoMode = demoModeRes.value.enabled;
  } else {
    logTauriError('load demo mode status', demoModeRes.reason);
  }

  return next;
}

function applyFolderProjectsBundle(
  prev: FolderProjectsBundle,
  results: PromiseSettledResult<unknown>[],
): FolderProjectsBundle {
  const [foldersRes, candidatesRes, detectedRes, estimatesRes] = results as [
    PromiseSettledResult<ProjectFolder[]>,
    PromiseSettledResult<FolderProjectCandidate[]>,
    PromiseSettledResult<DetectedProject[]>,
    PromiseSettledResult<EstimateProjectRow[]>,
  ];

  const next = { ...prev };

  if (foldersRes.status === 'fulfilled') {
    next.projectFolders = foldersRes.value;
    next.folderError = null;
  } else {
    logTauriError('load project folders', foldersRes.reason);
    next.folderError = PROJECT_FOLDERS_LOAD_ERROR;
  }

  if (candidatesRes.status === 'fulfilled') {
    next.folderCandidates = candidatesRes.value;
  } else {
    console.error(
      'Failed to load folder candidates:',
      candidatesRes.reason,
    );
  }

  if (detectedRes.status === 'fulfilled') {
    next.detectedProjects = detectedRes.value;
  } else {
    logTauriError('load detected projects', detectedRes.reason);
  }

  if (estimatesRes.status === 'fulfilled') {
    next.estimates = buildEstimateMap(estimatesRes.value);
  } else {
    logTauriError('load estimates', estimatesRes.reason);
  }

  return next;
}

export function useProjectsData(projectDialogId: number | null) {
  const [coreBundle, setCoreBundle] = useState(initialCoreProjectsBundle);
  const { excludedProjects, mergedProjects, apps, isDemoMode } = coreBundle;
  const [folderBundle, setFolderBundle] = useState(initialFolderProjectsBundle);
  const {
    projectFolders,
    folderCandidates,
    detectedProjects,
    estimates,
    folderError,
  } = folderBundle;
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [prevDialogId, setPrevDialogId] = useState<number | null | undefined>(undefined);
  const autoFreezeInitializedRef = useRef(false);
  const [coreRefreshKey, setCoreRefreshKey] = useState(0);
  const [foldersRefreshKey, setFoldersRefreshKey] = useState(0);
  const [allTimeRefreshKey, setAllTimeRefreshKey] = useState(0);
  const projectExtraInfoCacheRef = useRef<Record<number, ProjectExtraInfo>>({});
  const [projectExtraInfoCacheVersion, setProjectExtraInfoCacheVersion] =
    useState(0);
  const projects = useProjectsCacheStore((state) => state.projectsAllTime);
  const projectsAllTimeLoading = useProjectsCacheStore(
    (state) => state.projectsAllTimeLoading,
  );

  const invalidateAllTimeData = useCallback(() => {
    setAllTimeRefreshKey((prev) => prev + 1);
  }, []);

  const invalidateCoreData = useCallback(() => {
    setCoreRefreshKey((prev) => prev + 1);
  }, []);

  const invalidateFolderData = useCallback(() => {
    setFoldersRefreshKey((prev) => prev + 1);
  }, []);

  const invalidateProjectExtraInfoCache = useCallback(() => {
    projectExtraInfoCacheRef.current = {};
    setProjectExtraInfoCacheVersion((prev) => prev + 1);
  }, []);

  const cacheProjectExtraInfo = useCallback(
    (projectId: number, info: ProjectExtraInfo) => {
      projectExtraInfoCacheRef.current[projectId] = info;
      if (projectDialogId === projectId) {
        setExtraInfo(info);
      }
    },
    [projectDialogId],
  );

  useEffect(() => {
    if (autoFreezeInitializedRef.current) return;
    autoFreezeInitializedRef.current = true;
    // Auto-freeze is additive only: it freezes stale projects but never
    // clears a manual freeze. Safe to run on every Projects page mount.
    projectsApi.autoFreezeProjects()
      .catch(() => {
        /* feature optional */
      });
  }, []);

  useEffect(() => {
    void loadProjectsAllTime();
  }, []);

  usePageRefreshListener((reasons, source) => {
    if (reasons.some((reason) => shouldRefreshProjectsPageCore(reason))) {
      invalidateCoreData();
    }
    if (reasons.some((reason) => shouldRefreshProjectsPageFolders(reason))) {
      invalidateFolderData();
    }
    if (reasons.some((reason) => shouldRefreshProjectsPageAllTime(reason))) {
      invalidateAllTimeData();
    }
    if (
      source === 'local' &&
      reasons.some((reason) => shouldInvalidateProjectExtraInfo(reason))
    ) {
      invalidateProjectExtraInfoCache();
    }
  });

  useEffect(() => {
    const handleAllTimeInvalidated = () => {
      invalidateAllTimeData();
      invalidateProjectExtraInfoCache();
    };

    window.addEventListener(
      PROJECTS_ALL_TIME_INVALIDATED_EVENT,
      handleAllTimeInvalidated,
    );

    return () => {
      window.removeEventListener(
        PROJECTS_ALL_TIME_INVALIDATED_EVENT,
        handleAllTimeInvalidated,
      );
    };
  }, [invalidateAllTimeData, invalidateProjectExtraInfoCache]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      projectsApi.getExcludedProjects(),
      projectsApi.getMergedProjects(),
      applicationsApi.getApplications(),
      settingsApi.getDemoModeStatus(),
    ]).then((results) => {
      if (cancelled) return;
      startTransition(() => {
        setCoreBundle((prev) => applyCoreProjectsBundle(prev, results));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [coreRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      projectsApi.getProjectFolders(),
      projectsApi.getFolderProjectCandidates(),
      projectsApi.getDetectedProjects(ALL_TIME_DATE_RANGE),
      dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE),
    ]).then((results) => {
      if (cancelled) return;

      startTransition(() => {
        setFolderBundle((prev) => applyFolderProjectsBundle(prev, results));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [allTimeRefreshKey, foldersRefreshKey, isDemoMode]);

  if (projectDialogId !== prevDialogId) {
    setPrevDialogId(projectDialogId);
    if (projectDialogId === null) {
      startTransition(() => {
        setExtraInfo(null);
      });
    } else {
      const cachedInfo = projectExtraInfoCacheRef.current[projectDialogId];
      if (cachedInfo) {
        setExtraInfo(cachedInfo);
        setLoadingExtra(false);
      } else {
        setLoadingExtra(true);
      }
    }
  }

  useEffect(() => {
    if (projectDialogId === null) {
      return;
    }
    const cachedInfo = projectExtraInfoCacheRef.current[projectDialogId];
    if (cachedInfo) {
      return;
    }
    let cancelled = false;
    projectsApi
      .getProjectExtraInfo(projectDialogId, ALL_TIME_DATE_RANGE)
      .then((info) => {
        if (cancelled) return;
        projectExtraInfoCacheRef.current[projectDialogId] = info;
        setExtraInfo(info);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoadingExtra(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectDialogId, projectExtraInfoCacheVersion]);

  const setProjectFolders = useCallback(
    (
      updater:
        | ProjectFolder[]
        | ((prev: ProjectFolder[]) => ProjectFolder[]),
    ) => {
      setFolderBundle((prev) => ({
        ...prev,
        projectFolders:
          typeof updater === 'function'
            ? updater(prev.projectFolders)
            : updater,
      }));
    },
    [],
  );

  const setFolderError = useCallback((error: string | null) => {
    setFolderBundle((prev) => ({ ...prev, folderError: error }));
  }, []);

  return {
    apps,
    cacheProjectExtraInfo,
    detectedProjects,
    estimates,
    excludedProjects,
    extraInfo,
    folderCandidates,
    folderError,
    invalidateProjectExtraInfoCache,
    isDemoMode,
    loadingExtra,
    mergedProjects,
    projectFolders,
    setProjectFolders,
    projects,
    projectsAllTimeLoading,
    setFolderError,
  };
}
