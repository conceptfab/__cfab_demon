import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  RefreshCw,
  CircleOff,
  Wand2,
  Snowflake,
  CircleDollarSign,
  Type,
  Clock,
  Trophy,
  Folders,
  Save,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { open } from '@tauri-apps/plugin-dialog';
import {
  applicationsApi,
  dashboardApi,
  projectsApi,
  settingsApi,
} from '@/lib/tauri';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { CollapsibleSection } from '@/components/project/CollapsibleSection';
import { ProjectCard } from '@/components/project/ProjectCard';
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog';
import {
  formatDuration,
  getDurationParts,
  formatPathForDisplay,
  getErrorMessage,
  logTauriError,
  cn,
} from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { loadFreezeSettings } from '@/lib/user-settings';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-ranges';
import {
  APP_REFRESH_EVENT,
  LOCAL_DATA_CHANGED_EVENT,
  PROJECTS_ALL_TIME_INVALIDATED_EVENT,
  type AppRefreshDetail,
  type LocalDataChangedDetail,
} from '@/lib/sync-events';
import {
  buildEstimateMap,
  shouldInvalidateProjectExtraInfo,
} from '@/lib/projects-all-time';
import {
  shouldRefreshProjectsPageAllTime,
  shouldRefreshProjectsPageCore,
  shouldRefreshProjectsPageFolders,
} from '@/lib/page-refresh-reasons';
import type {
  AppWithStats,
  ProjectFolder,
  FolderProjectCandidate,
  DetectedProject,
  ProjectExtraInfo,
  ProjectWithStats,
} from '@/lib/db-types';
import {
  loadProjectsAllTime,
  useProjectsCacheStore,
} from '@/store/projects-cache-store';

const PROJECT_RENDER_PAGE_SIZE = 120;
const PROJECT_FOLDERS_LOAD_ERROR = '__projects_load_folders_failed__';

const VIEW_MODE_STORAGE_KEY = 'timeflow-dashboard-projects-view-mode';
const SORT_STORAGE_KEY = 'timeflow-dashboard-projects-sort';
const FOLDERS_STORAGE_KEY = 'timeflow-dashboard-projects-use-folders';
const SECTION_STORAGE_KEY = 'timeflow-dashboard-projects-section-open';
const LEGACY_SECTION_STORAGE_KEY = 'cfab-dashboard-projects-section-open';

function isNewProject(project: ProjectWithStats, maxAgeMs: number): boolean {
  const freshnessSource = project.last_activity ?? project.created_at;
  const sourceMs = new Date(freshnessSource).getTime();
  if (!Number.isFinite(sourceMs)) return false;
  const age = Date.now() - sourceMs;
  return age >= 0 && age < maxAgeMs;
}


function inferDetectedProjectName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return fileName;
  const parts = trimmed.split(' - ');
  const candidate = parts[parts.length - 1]?.trim();
  return candidate || trimmed;
}

function normalizeProjectDuplicateKey(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, '').replace(/\s+/g, '');
}

function sortProjectList(
  list: ProjectWithStats[],
  sortBy: string,
  estimates: Record<number, number>,
): ProjectWithStats[] {
  return [...list].sort((a, b) => {
    const valA = estimates[a.id] || 0;
    const valB = estimates[b.id] || 0;
    switch (sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'time-asc':
        return a.total_seconds - b.total_seconds;
      case 'time-desc':
        return b.total_seconds - a.total_seconds;
      case 'value-asc':
        return valA - valB;
      case 'value-desc':
        return valB - valA;
      default:
        return 0;
    }
  });
}

function filterProjectList(
  list: ProjectWithStats[],
  search: string,
): ProjectWithStats[] {
  if (!search) return list;
  const q = search.toLowerCase();
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.assigned_folder_path && p.assigned_folder_path.toLowerCase().includes(q)),
  );
}

function renderDuration(seconds: number) {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);
  const unitClass = 'text-[0.7em] font-[400] opacity-70 ml-0.5 self-baseline';

  if (hours > 0) {
    return (
      <span className="flex items-baseline gap-x-1">
        <span>
          {hours}
          <span className={unitClass}>h</span>
        </span>
        <span>
          {minutes}
          <span className={unitClass}>m</span>
        </span>
      </span>
    );
  }
  if (minutes > 0) {
    return (
      <span className="flex items-baseline gap-x-1">
        <span>
          {minutes}
          <span className={unitClass}>m</span>
        </span>
        <span>
          {remainingSeconds}
          <span className={unitClass}>s</span>
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-baseline">
      {remainingSeconds}
      <span className={unitClass}>s</span>
    </span>
  );
}

export function Projects() {
  const { t } = useTranslation();
  const { setProjectPageId, setCurrentPage } = useUIStore();
  const { triggerRefresh } = useDataStore();
  const { currencyCode } = useSettingsStore();
  const { showError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [excludedProjects, setExcludedProjects] = useState<ProjectWithStats[]>(
    [],
  );
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [projectDialogId, setProjectDialogId] = useState<number | null>(null);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<number | null>(null);
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([]);
  const [folderCandidates, setFolderCandidates] = useState<
    FolderProjectCandidate[]
  >([]);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>(
    [],
  );
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<string | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogProjectId, setSessionDialogProjectId] = useState<
    number | null
  >(null);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>(() => {
    return (
      (localStorage.getItem(VIEW_MODE_STORAGE_KEY) as 'detailed' | 'compact') ||
      'compact'
    );
  });
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [estimates, setEstimates] = useState<Record<number, number>>({});
  const [search, setSearch] = useState('');
  const [projectRenderLimits, setProjectRenderLimits] = useState<
    Record<string, number>
  >({});
  const autoFreezeInitializedRef = useRef(false);
  const [coreRefreshKey, setCoreRefreshKey] = useState(0);
  const [foldersRefreshKey, setFoldersRefreshKey] = useState(0);
  const [allTimeRefreshKey, setAllTimeRefreshKey] = useState(0);
  const projectExtraInfoCacheRef = useRef<Record<number, ProjectExtraInfo>>({});
  const [projectExtraInfoCacheVersion, setProjectExtraInfoCacheVersion] =
    useState(0);
  const projects = useProjectsCacheStore((s) => s.projectsAllTime);
  const { thresholdDays: newProjectThresholdDays } = loadFreezeSettings();
  const newProjectMaxAgeMs =
    Math.max(1, newProjectThresholdDays) * 24 * 60 * 60 * 1000;

  const [sortBy, setSortBy] = useState(() => {
    return localStorage.getItem(SORT_STORAGE_KEY) || 'name-asc';
  });

  const [useFolders, setUseFolders] = useState(() => {
    return localStorage.getItem(FOLDERS_STORAGE_KEY) !== 'false';
  });

  const defaultSectionOpen = {
    excluded: true,
    folders: true,
    candidates: true,
    detected: true,
  };
  const [sectionOpen, setSectionOpen] = useState(() => {
    try {
      const raw =
        localStorage.getItem(SECTION_STORAGE_KEY) ??
        localStorage.getItem(LEGACY_SECTION_STORAGE_KEY);
      if (!raw) return defaultSectionOpen;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      const next = {
        excluded: parsed.excluded ?? defaultSectionOpen.excluded,
        folders: parsed.folders ?? defaultSectionOpen.folders,
        candidates: parsed.candidates ?? defaultSectionOpen.candidates,
        detected: parsed.detected ?? defaultSectionOpen.detected,
      };
      const allClosed =
        !next.excluded && !next.folders && !next.candidates && !next.detected;
      return allClosed ? defaultSectionOpen : next;
    } catch {
      return defaultSectionOpen;
    }
  });

  const persistSectionOpen = (next: typeof defaultSectionOpen) => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
      localStorage.removeItem(LEGACY_SECTION_STORAGE_KEY);
    } catch (error) {
      console.debug('Failed to persist sections state:', error);
    }
  };

  const toggleSection = (key: keyof typeof defaultSectionOpen) => () =>
    setSectionOpen((s) => {
      const next = { ...s, [key]: !s[key] };
      persistSectionOpen(next);
      return next;
    });

  const expandAllSections = () => {
    setSectionOpen(defaultSectionOpen);
    persistSectionOpen(defaultSectionOpen);
  };

  const collapseAllSections = () => {
    const next = {
      excluded: false,
      folders: false,
      candidates: false,
      detected: false,
    };
    setSectionOpen(next);
    persistSectionOpen(next);
  };

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

  useEffect(() => {
    if (autoFreezeInitializedRef.current) return;
    autoFreezeInitializedRef.current = true;
    const { thresholdDays } = loadFreezeSettings();
    projectsApi.autoFreezeProjects(thresholdDays)
      .catch(() => {
        /* ignore: feature not yet compiled */
      });
  }, []);

  useEffect(() => {
    void loadProjectsAllTime();
  }, []);

  useEffect(() => {
    const handleLocalDataChange = (event: Event) => {
      const customEvent = event as CustomEvent<LocalDataChangedDetail>;
      const reason = customEvent.detail?.reason;
      if (!reason) return;

      if (shouldRefreshProjectsPageCore(reason)) {
        invalidateCoreData();
      }
      if (shouldRefreshProjectsPageFolders(reason)) {
        invalidateFolderData();
      }
      if (shouldRefreshProjectsPageAllTime(reason)) {
        invalidateAllTimeData();
      }
      if (shouldInvalidateProjectExtraInfo(reason)) {
        invalidateProjectExtraInfoCache();
      }
    };

    const handleAppRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<AppRefreshDetail>;
      const reasons = customEvent.detail?.reasons ?? [];
      if (reasons.some((reason) => shouldRefreshProjectsPageCore(reason))) {
        invalidateCoreData();
      }
      if (reasons.some((reason) => shouldRefreshProjectsPageFolders(reason))) {
        invalidateFolderData();
      }
      if (reasons.some((reason) => shouldRefreshProjectsPageAllTime(reason))) {
        invalidateAllTimeData();
      }
    };

    const handleAllTimeInvalidated = () => {
      invalidateAllTimeData();
      invalidateProjectExtraInfoCache();
    };

    window.addEventListener(
      APP_REFRESH_EVENT,
      handleAppRefresh as EventListener,
    );
    window.addEventListener(
      LOCAL_DATA_CHANGED_EVENT,
      handleLocalDataChange as EventListener,
    );
    window.addEventListener(
      PROJECTS_ALL_TIME_INVALIDATED_EVENT,
      handleAllTimeInvalidated,
    );

    return () => {
      window.removeEventListener(
        APP_REFRESH_EVENT,
        handleAppRefresh as EventListener,
      );
      window.removeEventListener(
        LOCAL_DATA_CHANGED_EVENT,
        handleLocalDataChange as EventListener,
      );
      window.removeEventListener(
        PROJECTS_ALL_TIME_INVALIDATED_EVENT,
        handleAllTimeInvalidated,
      );
    };
  }, [
    invalidateAllTimeData,
    invalidateCoreData,
    invalidateFolderData,
    invalidateProjectExtraInfoCache,
  ]);

  const hotProjectIds = useMemo(() => {
    return new Set(
      [...projects]
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 5)
        .map((p) => p.id),
    );
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      projectsApi.getExcludedProjects(),
      applicationsApi.getApplications(),
      settingsApi.getDemoModeStatus(),
    ]).then(([excludedRes, appsRes, demoModeRes]) => {
      if (cancelled) return;

      if (excludedRes.status === 'fulfilled')
        setExcludedProjects(excludedRes.value);
      else
        logTauriError('load excluded projects', excludedRes.reason);

      if (appsRes.status === 'fulfilled') setApps(appsRes.value);
      else logTauriError('load applications', appsRes.reason);

      if (demoModeRes.status === 'fulfilled')
        setIsDemoMode(demoModeRes.value.enabled);
      else logTauriError('load demo mode status', demoModeRes.reason);
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

      if (candidatesRes.status === 'fulfilled')
        setFolderCandidates(candidatesRes.value);
      else
        console.error(
          'Failed to load folder candidates:',
          candidatesRes.reason,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [foldersRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    projectsApi.getDetectedProjects(ALL_TIME_DATE_RANGE)
      .then((data) => {
        if (!cancelled) setDetectedProjects(data);
      })
      .catch((reason) => {
        if (!cancelled)
          logTauriError('load detected projects', reason);
      });
    return () => {
      cancelled = true;
    };
  }, [allTimeRefreshKey, isDemoMode]);

  useEffect(() => {
    let cancelled = false;
    dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE)
      .then((rows) => {
        if (cancelled) return;
        setEstimates(buildEstimateMap(rows));
      })
      .catch((reason) => {
        if (!cancelled) logTauriError('load estimates', reason);
      });
    return () => {
      cancelled = true;
    };
  }, [allTimeRefreshKey, isDemoMode]);

  useEffect(() => {
    if (projectDialogId === null) {
      setExtraInfo(null);
      return;
    }
    const cachedInfo = projectExtraInfoCacheRef.current[projectDialogId];
    if (cachedInfo) {
      setExtraInfo(cachedInfo);
      setLoadingExtra(false);
      return;
    }
    setLoadingExtra(true);
    projectsApi.getProjectExtraInfo(projectDialogId, ALL_TIME_DATE_RANGE)
      .then((info) => {
        projectExtraInfoCacheRef.current[projectDialogId] = info;
        setExtraInfo(info);
      })
      .catch(console.error)
      .finally(() => setLoadingExtra(false));
  }, [projectDialogId, projectExtraInfoCacheVersion]);

  const handleUpdateProjectColor = async (projectId: number, color: string) => {
    await projectsApi.updateProject(projectId, color);
    setEditingColorId(null);
  };

  const handleCreateProject = async (name: string, color: string, folderPath: string) => {
    await projectsApi.createProject(name, color, folderPath);
  };

  const handleExclude = async (id: number) => {
    if (!await confirm(t('projects.confirm.exclude_project'))) {
      return;
    }
    await projectsApi.excludeProject(id);
  };

  const handleRestore = async (id: number) => {
    await projectsApi.restoreProject(id);
  };

  const handleFreeze = async (id: number) => {
    await projectsApi.freezeProject(id);
  };

  const handleUnfreeze = async (id: number) => {
    await projectsApi.unfreezeProject(id);
  };

  const handleDeleteProject = async (project: ProjectWithStats) => {
    const projectLabel = project.name.trim() || `#${project.id}`;
    const confirmed = await confirm(
      t('projects.confirm.delete_project_permanent', { projectLabel }),
    );
    if (!confirmed) return;

    const busyKey = `delete-project:${project.id}`;
    setBusy(busyKey);
    try {
      await projectsApi.deleteProject(project.id);
      setProjectDialogId((prev) => (prev === project.id ? null : prev));
      setAssignOpen((prev) => (prev === project.id ? null : prev));
      setEditingColorId((prev) => (prev === project.id ? null : prev));
    } catch (e) {
      logTauriError('delete project', e);
      showError(
        t('projects.errors.delete_project_failed', {
          projectLabel,
          error: getErrorMessage(e, t('ui.common.unknown_error')),
        }),
      );
    } finally {
      setBusy((prev) => (prev === busyKey ? null : prev));
    }
  };

  const handleResetProjectTime = async (id: number) => {
    if (!await confirm(t('projects.confirm.reset_project_time'))) {
      return;
    }
    await projectsApi.resetProjectTime(id);
  };

  const handleCompactProject = async (id: number) => {
    if (!await confirm(t('projects.confirm.compact_project_data'))) {
      return;
    }
    setBusy(`compact-project:${id}`);
    try {
      await projectsApi.compactProjectData(id);
      const info = await projectsApi.getProjectExtraInfo(id, ALL_TIME_DATE_RANGE);
      projectExtraInfoCacheRef.current[id] = info;
      setExtraInfo(info);
    } catch (e) {
      logTauriError('compact project data', e);
      showError(
        t('projects.errors.compact_project_failed', {
          error: getErrorMessage(e, t('ui.common.unknown_error')),
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleAssign = async (appId: number, projectId: number | null) => {
    await projectsApi.assignAppToProject(appId, projectId);
  };


  const openEdit = (project: ProjectWithStats) => {
    setProjectDialogId(project.id);
    setAssignOpen(null);
  };

  const handleAddFolder = async () => {
    const path = newFolderPath.trim();
    if (!path) {
      setFolderError(t('projects.errors.folder_path_required'));
      return;
    }
    setBusy('add-folder');
    setFolderError(null);
    setFolderInfo(null);
    try {
      await projectsApi.addProjectFolder(path);
      setNewFolderPath('');
      setFolderInfo(t('projects.messages.folder_saved'));
    } catch (error: unknown) {
      setFolderError(
        getErrorMessage(error, t('projects.errors.add_folder_failed')),
      );
      console.error(error);
    } finally {
      setBusy(null);
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('projects.dialogs.select_project_folder'),
      });
      if (selected && typeof selected === 'string') {
        setNewFolderPath(selected);
        setFolderError(null);
      }
    } catch (e) {
      logTauriError('open folder dialog', e);
    }
  };

  const handleRemoveFolder = async (path: string) => {
    if (!await confirm(t('projects.confirm.remove_project_root', { path: formatPathForDisplay(path) }))) {
      return;
    }
    setBusy(`remove-folder:${path}`);
    try {
      await projectsApi.removeProjectFolder(path);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateFromFolder = async (folderPath: string) => {
    setBusy(`create-folder:${folderPath}`);
    try {
      await projectsApi.createProjectFromFolder(folderPath);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleSyncFolders = async () => {
    setBusy('sync-folders');
    try {
      await projectsApi.syncProjectsFromFolders();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleAutoCreateDetected = async () => {
    setBusy('auto-detect');
    try {
      await projectsApi.autoCreateProjectsFromDetection(
        ALL_TIME_DATE_RANGE,
        2,
      );
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const sortedProjects = useMemo(
    () => sortProjectList(projects, sortBy, estimates),
    [projects, sortBy, estimates],
  );

  const sortedExcludedProjects = useMemo(
    () => sortProjectList(excludedProjects, sortBy, estimates),
    [excludedProjects, sortBy, estimates],
  );

  const filteredProjects = useMemo(
    () => filterProjectList(sortedProjects, search),
    [sortedProjects, search],
  );

  const filteredExcludedProjects = useMemo(
    () => filterProjectList(sortedExcludedProjects, search),
    [sortedExcludedProjects, search],
  );

  useEffect(() => {
    setProjectRenderLimits({});
  }, [
    search,
    sortBy,
    viewMode,
    useFolders,
    projects.length,
    excludedProjects.length,
    detectedProjects.length,
    folderCandidates.length,
  ]);

  const getRenderLimit = (listKey: string) =>
    projectRenderLimits[listKey] ?? PROJECT_RENDER_PAGE_SIZE;

  const getVisibleProjects = (
    projectList: ProjectWithStats[],
    listKey: string,
  ) => {
    const limit = getRenderLimit(listKey);
    return {
      visible: projectList.slice(0, limit),
      hiddenCount: Math.max(0, projectList.length - limit),
    };
  };

  const loadMoreProjects = (listKey: string, totalCount: number) => {
    setProjectRenderLimits((prev) => ({
      ...prev,
      [listKey]: Math.min(
        (prev[listKey] ?? PROJECT_RENDER_PAGE_SIZE) + PROJECT_RENDER_PAGE_SIZE,
        totalCount,
      ),
    }));
  };

  const handleSortChange = (val: string) => {
    setSortBy(val);
    localStorage.setItem(SORT_STORAGE_KEY, val);
  };

  const toggleFolders = () => {
    const next = !useFolders;
    setUseFolders(next);
  };

  const handleSaveDefaults = () => {
    localStorage.setItem(SORT_STORAGE_KEY, sortBy);
    localStorage.setItem(FOLDERS_STORAGE_KEY, String(useFolders));
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    setFolderInfo(t('projects.messages.view_settings_saved'));
    setTimeout(() => setFolderInfo(null), 3000);
  };

  const visibleFolderCandidates = useMemo(() => {
    const existingProjectNames = new Set(
      [...projects, ...excludedProjects].map((project) =>
        project.name.toLowerCase(),
      ),
    );
    return folderCandidates.filter(
      (candidate) =>
        !candidate.already_exists &&
        !existingProjectNames.has(candidate.name.toLowerCase()),
    );
  }, [folderCandidates, projects, excludedProjects]);
  const hiddenRegisteredFolderCandidatesCount =
    folderCandidates.length - visibleFolderCandidates.length;

  const detectedCandidatesView = useMemo(() => {
    const existingNames = new Set(projects.map((p) => p.name.toLowerCase()));
    const excludedNames = new Set(
      excludedProjects.map((p) => p.name.toLowerCase()),
    );
    const seenCandidateNames = new Set<string>();

    const visible: Array<
      DetectedProject & {
        inferredProjectName: string;
      }
    > = [];
    let hiddenExisting = 0;
    let hiddenExcluded = 0;
    let hiddenDuplicates = 0;

    for (const d of detectedProjects) {
      const inferredProjectName = inferDetectedProjectName(d.file_name);
      const key = inferredProjectName.toLowerCase();

      if (existingNames.has(key)) {
        hiddenExisting += 1;
        continue;
      }
      if (excludedNames.has(key)) {
        hiddenExcluded += 1;
        continue;
      }
      if (seenCandidateNames.has(key)) {
        hiddenDuplicates += 1;
        continue;
      }

      seenCandidateNames.add(key);
      visible.push({ ...d, inferredProjectName });
    }

    const cap = isDemoMode ? 8 : visible.length;
    const visibleCapped = visible.slice(0, cap);
    const hiddenOverflow = Math.max(0, visible.length - visibleCapped.length);

    return {
      visible: visibleCapped,
      hiddenExisting,
      hiddenExcluded,
      hiddenDuplicates,
      hiddenOverflow,
      totalCandidateCount: visible.length,
    };
  }, [detectedProjects, projects, excludedProjects, isDemoMode]);

  const projectsByFolder = useMemo(() => {
    const rootByProjectName = new Map<string, string>();
    for (const candidate of folderCandidates) {
      const key = candidate.name.toLowerCase();
      if (!rootByProjectName.has(key)) {
        rootByProjectName.set(key, candidate.root_path);
      }
    }

    // Build a map of folder basename -> folder path for name-contains matching
    const folderBasenames = projectFolders.map((f) => {
      const parts = f.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
      return { basename: parts[parts.length - 1].toLowerCase(), path: f.path };
    });

    const grouped = new Map<string, ProjectWithStats[]>();
    for (const folder of projectFolders) {
      grouped.set(folder.path, []);
    }

    const outside: ProjectWithStats[] = [];
    for (const project of filteredProjects) {
      // 1. Exact match by candidate name
      const root = rootByProjectName.get(project.name.toLowerCase());
      if (root && grouped.has(root)) {
        grouped.get(root)!.push(project);
        continue;
      }
      // 2. Project name contains a folder's basename (e.g. "TODO.md - __timeflow_demon" contains "__timeflow_demon")
      const nameLC = project.name.toLowerCase();
      const matchedFolder = folderBasenames.find((f) =>
        nameLC.includes(f.basename),
      );
      if (matchedFolder && grouped.has(matchedFolder.path)) {
        grouped.get(matchedFolder.path)!.push(project);
      } else {
        outside.push(project);
      }
    }

    return {
      sections: projectFolders.map((folder) => ({
        rootPath: folder.path,
        projects: grouped.get(folder.path) ?? [],
      })),
      outside,
    };
  }, [filteredProjects, projectFolders, folderCandidates]);

  const duplicateProjectsView = useMemo(() => {
    const groups = new Map<string, ProjectWithStats[]>();
    const allTabProjects = [...projects, ...excludedProjects];

    for (const project of allTabProjects) {
      const key = normalizeProjectDuplicateKey(project.name);
      if (!key) continue;
      const list = groups.get(key);
      if (list) {
        list.push(project);
      } else {
        groups.set(key, [project]);
      }
    }

    const byProjectId = new Map<
      number,
      {
        groupSize: number;
        normalizedKey: string;
        groupNames: string[];
      }
    >();

    let groupCount = 0;
    let projectCount = 0;

    for (const [normalizedKey, group] of groups.entries()) {
      if (group.length < 2) continue;
      groupCount += 1;
      projectCount += group.length;

      const groupNames = Array.from(
        new Set(group.map((project) => project.name.trim()).filter(Boolean)),
      );

      for (const project of group) {
        byProjectId.set(project.id, {
          groupSize: group.length,
          normalizedKey,
          groupNames,
        });
      }
    }

    return {
      byProjectId,
      groupCount,
      projectCount,
    };
  }, [projects, excludedProjects]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectDialogId) ?? null,
    [projects, projectDialogId],
  );
  const visibleExcludedProjects = useMemo(() => {
    const limit = projectRenderLimits.excluded ?? PROJECT_RENDER_PAGE_SIZE;
    return filteredExcludedProjects.slice(0, limit);
  }, [filteredExcludedProjects, projectRenderLimits.excluded]);
  const hiddenExcludedProjectsCount = Math.max(
    0,
    filteredExcludedProjects.length - visibleExcludedProjects.length,
  );

  const renderDuplicateMarker = (project: ProjectWithStats) => {
    const info = duplicateProjectsView.byProjectId.get(project.id);
    if (!info) return null;

    const title =
      info.groupNames.length > 1
        ? t('projects.labels.possible_duplicate_named', {
            groupSize: info.groupSize,
            groupNames: info.groupNames.join(' | '),
          })
        : t('projects.labels.possible_duplicate_normalized', {
            groupSize: info.groupSize,
          });

    return (
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600 shrink-0"
        title={title}
        aria-label={title}
      >
        {t('projects.labels.duplicate_marker')}
      </span>
    );
  };

  const renderProjectList = (
    projectList: ProjectWithStats[],
    listKey: string,
  ) => {
    if (projectList.length === 0) return null;
    const { visible, hiddenCount } = getVisibleProjects(projectList, listKey);

    if (viewMode === 'compact') {
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
            {visible.map((p) => (
              <div
                key={p.id}
                data-project-id={p.id}
                data-project-name={p.name}
                className={cn(
                  'flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-pointer hover:bg-accent transition-colors',
                  isNewProject(p, newProjectMaxAgeMs) && 'border-yellow-400/70',
                )}
                onClick={() => openEdit(p)}
              >
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-medium',
                      p.name.length > 40
                        ? 'text-[11px]'
                        : p.name.length > 25
                          ? 'text-xs'
                          : 'text-sm',
                    )}
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  {p.frozen_at && (
                    <AppTooltip content={t('projects.labels.frozen_since_click_unfreeze', {
                      date: p.frozen_at.slice(0, 10),
                    })}>
                      <button
                        type="button"
                        className="inline-flex items-center rounded px-0.5 py-0.5 text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnfreeze(p.id);
                        }}
                      >
                        <Snowflake className="h-3 w-3 shrink-0" />
                      </button>
                    </AppTooltip>
                  )}
                  {renderDuplicateMarker(p)}
                  {hotProjectIds.has(p.id) && (
                    <AppTooltip content={t('projects.labels.hot_project')}>
                      <span className="shrink-0">
                        <Trophy className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20" />
                      </span>
                    </AppTooltip>
                  )}
                </span>
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadMoreProjects(listKey, projectList.length)}
              >
                {t('projects_page.load_more_projects')} ({hiddenCount})
              </Button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => renderProjectCard(p))}
        </div>
        {hiddenCount > 0 && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadMoreProjects(listKey, projectList.length)}
            >
              {t('projects_page.load_more_projects')} ({hiddenCount})
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderProjectCard = (
    p: ProjectWithStats,
    options?: { inDialog?: boolean },
  ) => {
    const isDeleting = busy === `delete-project:${p.id}`;
    return (
      <ProjectCard
        key={p.id}
        project={p}
        currencyCode={currencyCode}
        estimateValue={estimates[p.id] || 0}
        isNew={isNewProject(p, newProjectMaxAgeMs)}
        isDeleting={isDeleting}
        isHotProject={hotProjectIds.has(p.id)}
        inDialog={options?.inDialog}
        duplicateMarker={renderDuplicateMarker(p)}
        extraInfo={extraInfo}
        loadingExtra={loadingExtra}
        apps={apps}
        assignOpen={assignOpen === p.id}
        isColorEditorOpen={editingColorId === p.id}
        pendingColor={pendingColor}
        renderDuration={renderDuration}
        onToggleColorEditor={() => {
          if (editingColorId === p.id) {
            setEditingColorId(null);
            setPendingColor(null);
            return;
          }
          setEditingColorId(p.id);
          setPendingColor(null);
        }}
        onPendingColorChange={setPendingColor}
        onSavePendingColor={() => {
          if (!pendingColor) return;
          void handleUpdateProjectColor(p.id, pendingColor);
          setPendingColor(null);
        }}
        onSelectPresetColor={(color) => {
          void handleUpdateProjectColor(p.id, color);
          setPendingColor(null);
        }}
        onResetProjectTime={() => {
          void handleResetProjectTime(p.id);
        }}
        onToggleFreeze={() => {
          if (p.frozen_at) {
            void handleUnfreeze(p.id);
            return;
          }
          void handleFreeze(p.id);
        }}
        onExclude={() => {
          void handleExclude(p.id);
        }}
        onDelete={() => handleDeleteProject(p)}
        onOpenManualSession={() => {
          setSessionDialogProjectId(p.id);
          setSessionDialogOpen(true);
        }}
        onOpenProjectPage={() => {
          setProjectPageId(p.id);
          setCurrentPage('project-card');
        }}
        onToggleAssignOpen={() =>
          setAssignOpen(assignOpen === p.id ? null : p.id)
        }
        onAssignApp={(appId, projectId) => handleAssign(appId, projectId)}
        onCompactProject={() => {
          void handleCompactProject(p.id);
        }}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <p className="text-sm text-muted-foreground">
            {projects.length} {t('projects_page.projects')}
            {excludedProjects.length > 0
              ? ` (${excludedProjects.length} ${t('projects_page.excluded')})`
              : ''}
          </p>
          {duplicateProjectsView.groupCount > 0 && (
            <p className="text-xs text-amber-600/90">
              {t('projects_page.marked_with')}{' '}
              <span className="mx-1 inline-flex h-4 w-4 translate-y-[1px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600">
                D
              </span>
              = {t('projects_page.possible_duplicate_names_in_this_tab')} (
              {duplicateProjectsView.projectCount} {t('projects_page.projects')} {t('projects_page.in')}{' '}
              {duplicateProjectsView.groupCount} {t('projects_page.groups')})
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="flex h-9 w-48 rounded-md border bg-transparent pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('projects_page.search_projects')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/40 p-1 rounded-md border border-border/40">
            <AppTooltip content={t('projects.labels.sort_abc')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleSortChange(
                    sortBy === 'name-asc' ? 'name-desc' : 'name-asc',
                  )
                }
                className={`h-7 w-8 p-0 ${sortBy.startsWith('name') ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Type className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_value')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleSortChange(
                    sortBy === 'value-desc' ? 'value-asc' : 'value-desc',
                  )
                }
                className={`h-7 w-8 p-0 ${sortBy.startsWith('value') ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                <CircleDollarSign className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <AppTooltip content={t('projects.labels.sort_time')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleSortChange(
                    sortBy === 'time-desc' ? 'time-asc' : 'time-desc',
                  )
                }
                className={`h-7 w-8 p-0 ${sortBy.startsWith('time') ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                <Clock className="h-4 w-4" />
              </Button>
            </AppTooltip>
            <div className="w-[1px] h-4 bg-border/40 mx-0.5" />
            <AppTooltip content={t('projects.labels.toggle_folder_grouping')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFolders}
                className={`h-7 w-8 p-0 ${useFolders ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
              >
                <Folders className="h-4 w-4" />
              </Button>
            </AppTooltip>
          </div>

          <div className="flex bg-secondary/50 p-1 rounded-md text-sm">
            <button
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === 'detailed' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('projects.labels.detailed')}
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === 'compact' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t('projects.labels.compact')}
            </button>
          </div>

          <AppTooltip content={t('projects_page.save_view_as_default')}>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSaveDefaults}
            >
              <Save className="h-4 w-4" />
            </Button>
          </AppTooltip>

          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
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
                renderProjectList(
                  section.projects,
                  `folder:${section.rootPath}`,
                )
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

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={expandAllSections}
          className="hover:text-foreground underline"
        >
          {t('projects.actions.expand_all')}
        </button>
        <span>|</span>
        <button
          type="button"
          onClick={collapseAllSections}
          className="hover:text-foreground underline"
        >
          {t('projects.actions.collapse_all')}
        </button>
      </div>

      <CollapsibleSection
        title={t('projects.sections.excluded_projects')}
        isOpen={sectionOpen.excluded}
        onToggle={toggleSection('excluded')}
      >
            {filteredExcludedProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('projects.empty.no_excluded_projects')}
              </p>
            ) : (
              <div className="space-y-2">
                {visibleExcludedProjects.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium">
                        <span className="min-w-0 truncate">{p.name}</span>
                        {renderDuplicateMarker(p)}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {t('projects.labels.excluded')}
                        {p.excluded_at ? `: ${p.excluded_at}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRestore(p.id)}
                    >
                      {t('projects.labels.restore')}
                    </Button>
                    <AppTooltip content={t('projects.labels.delete_project_permanently')}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void handleDeleteProject(p)}
                        disabled={busy === `delete-project:${p.id}`}
                      >
                        {t('projects.labels.delete')}
                      </Button>
                    </AppTooltip>
                  </div>
                ))}
                {hiddenExcludedProjectsCount > 0 && (
                  <div className="flex justify-center pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        loadMoreProjects(
                          'excluded',
                          filteredExcludedProjects.length,
                        )
                      }
                    >
                      {t('projects_page.load_more_projects')} (
                      {hiddenExcludedProjectsCount})
                    </Button>
                  </div>
                )}
              </div>
            )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('projects.sections.project_folders')}
        isOpen={sectionOpen.folders}
        onToggle={toggleSection('folders')}
      >
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={newFolderPath}
                onChange={(e) => {
                  setNewFolderPath(e.target.value);
                  setFolderError(null);
                  setFolderInfo(null);
                }}
                placeholder={t('projects.placeholders.project_folder_path')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddFolder();
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleBrowseFolder}
                disabled={busy === 'add-folder'}
              >
                  {t('projects_page.browse')}
              </Button>
              <Button
                size="sm"
                onClick={handleAddFolder}
                disabled={busy === 'add-folder'}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t('projects.actions.add')}
              </Button>
            </div>
            {folderError && (
              <p className="text-xs text-destructive">
                {folderError === PROJECT_FOLDERS_LOAD_ERROR
                  ? t('projects.errors.load_project_folders_failed')
                  : folderError}
              </p>
            )}
            {folderInfo && !folderError && (
              <p className="text-xs text-emerald-400">{folderInfo}</p>
            )}

            {projectFolders.length > 0 ? (
              <div className="space-y-1">
                {projectFolders.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span
                      className="truncate text-muted-foreground"
                      title={formatPathForDisplay(f.path)}
                    >
                      {formatPathForDisplay(f.path)}
                    </span>
                    <AppTooltip content={t('layout.tooltips.remove_folder')}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleRemoveFolder(f.path)}
                        disabled={busy === `remove-folder:${f.path}`}
                      >
                        <CircleOff className="h-3.5 w-3.5" />
                      </Button>
                    </AppTooltip>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('projects.empty.no_folders_configured')}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncFolders}
                disabled={busy === 'sync-folders'}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('projects_page.sync_subfolders_as_projects')}
              </Button>
            </div>
          </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('projects_page.folder_project_candidates')}
        isOpen={sectionOpen.candidates}
        onToggle={toggleSection('candidates')}
      >
            {visibleFolderCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('projects.empty.no_subfolder_candidates')}
              </p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {visibleFolderCandidates.map((c) => (
                  <div
                    key={c.folder_path}
                    className="flex items-center justify-between gap-2 text-xs py-1"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p
                        className="truncate text-muted-foreground"
                        title={formatPathForDisplay(c.folder_path)}
                      >
                        {formatPathForDisplay(c.folder_path)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCreateFromFolder(c.folder_path)}
                      disabled={busy === `create-folder:${c.folder_path}`}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      {t('projects.actions.create')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {hiddenRegisteredFolderCandidatesCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('projects_page.hidden_already_registered_folders')}{' '}
                {hiddenRegisteredFolderCandidatesCount}
              </p>
            )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('projects_page.detected_projects_opened_2_times')}
        isOpen={sectionOpen.detected}
        onToggle={toggleSection('detected')}
      >
          <div className="space-y-3">
            {detectedCandidatesView.visible.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {detectedProjects.length === 0
                  ? t('projects_page.no_detected_projects')
                  : t('projects_page.no_candidate_projects_detected_items_already_match_exist')}
              </p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {detectedCandidatesView.visible.map((d) => {
                  return (
                    <div
                      key={d.file_name}
                      className="flex items-center justify-between gap-2 text-xs py-1"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {d.inferredProjectName}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {t('projects_page.detected_project_opens_duration', {
                            count: d.occurrence_count,
                            duration: formatDuration(d.total_seconds),
                          })}
                        </p>
                        {d.inferredProjectName !== d.file_name && (
                          <p
                            className="truncate text-muted-foreground/80"
                            title={d.file_name}
                          >
                            {t('projects_page.from')} {d.file_name}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline">{t('projects_page.candidate')}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
            {(detectedCandidatesView.hiddenExisting > 0 ||
              detectedCandidatesView.hiddenExcluded > 0 ||
              detectedCandidatesView.hiddenDuplicates > 0 ||
              detectedCandidatesView.hiddenOverflow > 0) && (
              <p className="text-xs text-muted-foreground">
                {t('projects.labels.hidden_prefix')}{' '}
                {detectedCandidatesView.hiddenExisting > 0 &&
                  t('projects.labels.hidden_existing', {
                    count: detectedCandidatesView.hiddenExisting,
                  })}
                {detectedCandidatesView.hiddenExisting > 0 &&
                  (detectedCandidatesView.hiddenExcluded > 0 ||
                    detectedCandidatesView.hiddenDuplicates > 0 ||
                    detectedCandidatesView.hiddenOverflow > 0) &&
                  ' | '}
                {detectedCandidatesView.hiddenExcluded > 0 &&
                  t('projects.labels.hidden_excluded', {
                    count: detectedCandidatesView.hiddenExcluded,
                  })}
                {detectedCandidatesView.hiddenExcluded > 0 &&
                  (detectedCandidatesView.hiddenDuplicates > 0 ||
                    detectedCandidatesView.hiddenOverflow > 0) &&
                  ' | '}
                {detectedCandidatesView.hiddenDuplicates > 0 &&
                  t('projects.labels.duplicate_names', {
                    count: detectedCandidatesView.hiddenDuplicates,
                  })}
                {detectedCandidatesView.hiddenDuplicates > 0 &&
                  detectedCandidatesView.hiddenOverflow > 0 &&
                  ' | '}
                {detectedCandidatesView.hiddenOverflow > 0 &&
                  t(
                    isDemoMode
                      ? 'projects.labels.extra_candidates_demo_cap'
                      : 'projects.labels.extra_candidates',
                    { count: detectedCandidatesView.hiddenOverflow },
                  )}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoCreateDetected}
                disabled={
                  busy === 'auto-detect' ||
                  detectedCandidatesView.totalCandidateCount === 0
                }
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                {t('projects_page.auto_create_detected_projects')}
              </Button>
            </div>
          </div>
      </CollapsibleSection>

      <Dialog
        open={projectDialogId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProjectDialogId(null);
            setAssignOpen(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl border-0 bg-transparent p-0 shadow-none">
          {selectedProject &&
            renderProjectCard(selectedProject, { inDialog: true })}
        </DialogContent>
      </Dialog>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectCount={projects.length}
        onSave={handleCreateProject}
      />

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        projects={projects}
        defaultProjectId={sessionDialogProjectId}
        onSaved={triggerRefresh}
      />
      <ConfirmDialog />
    </div>
  );
}

