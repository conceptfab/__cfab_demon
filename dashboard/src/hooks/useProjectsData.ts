import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppWithStats,
  DetectedProject,
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

export function useProjectsData(projectDialogId: number | null) {
  const [excludedProjects, setExcludedProjects] = useState<ProjectWithStats[]>(
    [],
  );
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([]);
  const [folderCandidates, setFolderCandidates] = useState<
    FolderProjectCandidate[]
  >([]);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>(
    [],
  );
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [estimates, setEstimates] = useState<Record<number, number>>({});
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
      applicationsApi.getApplications(),
      settingsApi.getDemoModeStatus(),
    ]).then(([excludedRes, appsRes, demoModeRes]) => {
      if (cancelled) return;

      if (excludedRes.status === 'fulfilled') {
        setExcludedProjects(excludedRes.value);
      } else {
        logTauriError('load excluded projects', excludedRes.reason);
      }

      if (appsRes.status === 'fulfilled') {
        setApps(appsRes.value);
      } else {
        logTauriError('load applications', appsRes.reason);
      }

      if (demoModeRes.status === 'fulfilled') {
        setIsDemoMode(demoModeRes.value.enabled);
      } else {
        logTauriError('load demo mode status', demoModeRes.reason);
      }
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
    ]).then(([foldersRes, candidatesRes]) => {
      if (cancelled) return;

      if (foldersRes.status === 'fulfilled') {
        setProjectFolders(foldersRes.value);
        setFolderError(null);
      } else {
        logTauriError('load project folders', foldersRes.reason);
        setFolderError(PROJECT_FOLDERS_LOAD_ERROR);
      }

      if (candidatesRes.status === 'fulfilled') {
        setFolderCandidates(candidatesRes.value);
      } else {
        console.error(
          'Failed to load folder candidates:',
          candidatesRes.reason,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [foldersRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .getDetectedProjects(ALL_TIME_DATE_RANGE)
      .then((data) => {
        if (!cancelled) setDetectedProjects(data);
      })
      .catch((reason) => {
        if (!cancelled) {
          logTauriError('load detected projects', reason);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [allTimeRefreshKey, isDemoMode]);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .getProjectEstimates(ALL_TIME_DATE_RANGE)
      .then((rows) => {
        if (cancelled) return;
        setEstimates(buildEstimateMap(rows));
      })
      .catch((reason) => {
        if (!cancelled) {
          logTauriError('load estimates', reason);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [allTimeRefreshKey, isDemoMode]);

  useEffect(() => {
    if (projectDialogId === null) {
      startTransition(() => {
        setExtraInfo(null);
      });
      return;
    }
    const cachedInfo = projectExtraInfoCacheRef.current[projectDialogId];
    if (cachedInfo) {
      setExtraInfo(cachedInfo);
      setLoadingExtra(false);
      return;
    }
    let cancelled = false;
    setLoadingExtra(true);
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
    projectFolders,
    setProjectFolders,
    projects,
    projectsAllTimeLoading,
    setFolderError,
  };
}
