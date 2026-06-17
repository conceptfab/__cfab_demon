import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';

import { ProjectCard } from '@/components/project/ProjectCard';
import type { ProjectsListSlotDeps } from '@/components/projects/ProjectsListSlot';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { PROJECT_FOLDERS_LOAD_ERROR, useProjectsData } from '@/hooks/useProjectsData';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import type { ProjectWithStats } from '@/lib/db-types';
import { findFolderByBasenameInName } from '@/lib/project-folder-match';
import { isRecentProject } from '@/lib/project-utils';
import {
  assignAppToProjectEntry,
  createProjectEntry,
  freezeProjectEntry,
  mergeProjectEntries,
  restoreProjectEntry,
} from '@/lib/projects-page-api';
import {
  filterProjectList,
  loadSectionOpenState,
  normalizeProjectDuplicateKey,
  persistSectionOpen,
  sortProjectList,
} from '@/lib/projects-page-utils';
import { projectsApi } from '@/lib/tauri';
import { loadFreezeSettings } from '@/lib/user-settings';
import {
  formatPathForDisplay,
  getErrorMessage,
  logTauriError,
} from '@/lib/utils';
import {
  DEFAULT_SECTION_OPEN,
  EMPTY_PROJECT_RENDER_LIMITS,
  FOLDERS_STORAGE_KEY,
  PROJECT_RENDER_PAGE_SIZE,
  SORT_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
} from '@/pages/projects/projects-page-constants';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/toast-notification';

export function useProjectsPageController() {
  const { t } = useTranslation();
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const projectPageMinimal = useUIStore((s) => s.projectPageMinimal);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const { showError } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [mergeDialogProjectId, setMergeDialogProjectId] = useState<
    number | null
  >(null);
  const [projectDialogId, setProjectDialogId] = useState<number | null>(null);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<number | null>(null);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<string | null>(null);
  const folderInfoTimeoutRef = useRef<number | null>(null);
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
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const {
    apps,
    cacheProjectExtraInfo,
    detectedProjects,
    estimates,
    excludedProjects,
    extraInfo,
    folderCandidates,
    folderError,
    isDemoMode,
    loadingExtra,
    mergedProjects,
    projectFolders,
    setProjectFolders,
    projects,
    projectsAllTimeLoading,
    setFolderError,
  } = useProjectsData(projectDialogId);
  const { thresholdDays: newProjectThresholdDays } = loadFreezeSettings();
  const newProjectMaxAgeMs =
    Math.max(1, newProjectThresholdDays) * 24 * 60 * 60 * 1000;

  const [sortBy, setSortBy] = useState(() => {
    return localStorage.getItem(SORT_STORAGE_KEY) || 'name-asc';
  });

  const [useFolders, setUseFolders] = useState(() => {
    return localStorage.getItem(FOLDERS_STORAGE_KEY) !== 'false';
  });

  const projectListScopeKey = useMemo(
    () =>
      [
        search,
        sortBy,
        viewMode,
        useFolders,
        projects.length,
        excludedProjects.length,
        detectedProjects.length,
        folderCandidates.length,
      ].join('|'),
    [
      search,
      sortBy,
      viewMode,
      useFolders,
      projects.length,
      excludedProjects.length,
      detectedProjects.length,
      folderCandidates.length,
    ],
  );
  const [limitsByScope, setLimitsByScope] = useState<
    Record<string, Record<string, number>>
  >({});
  const projectRenderLimits =
    limitsByScope[projectListScopeKey] ?? EMPTY_PROJECT_RENDER_LIMITS;
  const setProjectRenderLimits = (
    updater: (
      prev: Record<string, number>,
    ) => Record<string, number>,
  ) => {
    setLimitsByScope((prev) => ({
      ...prev,
      [projectListScopeKey]: updater(
        prev[projectListScopeKey] ?? EMPTY_PROJECT_RENDER_LIMITS,
      ),
    }));
  };

  const [sectionOpen, setSectionOpen] = useState(loadSectionOpenState);

  const toggleSection = (key: keyof typeof DEFAULT_SECTION_OPEN) => () =>
    setSectionOpen((s) => {
      const next = { ...s, [key]: !s[key] };
      persistSectionOpen(next);
      return next;
    });

  const expandAllSections = () => {
    setSectionOpen(DEFAULT_SECTION_OPEN);
    persistSectionOpen(DEFAULT_SECTION_OPEN);
  };

  const collapseAllSections = () => {
    const next = {
      excluded: false,
      merged: false,
      folders: false,
      candidates: false,
      detected: false,
    };
    setSectionOpen(next);
    persistSectionOpen(next);
  };

  const hotProjectIds = useMemo(() => {
    return new Set(
      projects
        .toSorted((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 5)
        .map((p) => p.id),
    );
  }, [projects]);

  const handleUpdateProjectColor = useCallback(
    async (projectId: number, color: string) => {
      await projectsApi.updateProject(projectId, color);
      setEditingColorId(null);
    },
    [],
  );

  const handleExclude = useCallback(async (id: number) => {
    if (!await confirm(t('projects.confirm.exclude_project'))) {
      return;
    }
    await projectsApi.excludeProject(id);
  }, [confirm, t]);

  const handleUnfreeze = useCallback(async (id: number) => {
    await projectsApi.unfreezeProject(id);
  }, []);

  const handleUnmerge = async (id: number) => {
    if (!await confirm(t('projects.confirm.unmerge_project'))) {
      return;
    }
    await projectsApi.unmergeProject(id);
  };

  const handleDeleteProject = useCallback(async (project: ProjectWithStats) => {
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
  }, [confirm, showError, t]);

  const handleResetProjectTime = useCallback(async (id: number) => {
    if (!await confirm(t('projects.confirm.reset_project_time'))) {
      return;
    }
    await projectsApi.resetProjectTime(id);
  }, [confirm, t]);

  const handleCompactProject = useCallback(async (id: number) => {
    if (!await confirm(t('projects.confirm.compact_project_data'))) {
      return;
    }
    setBusy(`compact-project:${id}`);
    try {
      await projectsApi.compactProjectData(id);
      const info = await projectsApi.getProjectExtraInfo(id, ALL_TIME_DATE_RANGE);
      cacheProjectExtraInfo(id, info);
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
  }, [cacheProjectExtraInfo, confirm, showError, t]);

  const handleFreeze = freezeProjectEntry;
  const handleAssign = assignAppToProjectEntry;

  const openEdit = useCallback((project: ProjectWithStats) => {
    setProjectDialogId(project.id);
    setAssignOpen(null);
  }, []);

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

  const handleUpdateFolderMeta = async (
    path: string,
    color: string,
    category: string,
    badge: string,
  ) => {
    setProjectFolders((prev) =>
      prev.map((f) =>
        f.path === path ? { ...f, color, category, badge } : f,
      ),
    );
    try {
      await projectsApi.updateProjectFolderMeta(path, color, category, badge);
    } catch (e) {
      console.error('updateProjectFolderMeta failed:', e);
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

  const handleDeleteAllExcluded = async () => {
    if (!await confirm(t('projects.confirm.delete_all_excluded'))) {
      return;
    }
    setBusy('delete-all-excluded');
    try {
      await projectsApi.deleteAllExcludedProjects();
    } catch (e) {
      logTauriError('delete all excluded projects', e);
      showError(getErrorMessage(e, t('ui.common.unknown_error')));
    } finally {
      setBusy(null);
    }
  };

  const handleClearCandidates = async () => {
    if (visibleFolderCandidates.length === 0) return;
    if (!await confirm(t('projects.confirm.clear_candidates'))) {
      return;
    }
    setBusy('clear-candidates');
    try {
      const names = visibleFolderCandidates.map((c) => c.name);
      await projectsApi.blacklistProjectNames(names);
    } catch (e) {
      logTauriError('blacklist candidates', e);
      showError(getErrorMessage(e, t('ui.common.unknown_error')));
    } finally {
      setBusy(null);
    }
  };

  const handleBlacklistDetected = async (name: string) => {
    setBusy(`blacklist:${name}`);
    try {
      await projectsApi.blacklistProjectNames([name]);
    } catch (e) {
      logTauriError('blacklist detected project', e);
      showError(getErrorMessage(e, t('ui.common.unknown_error')));
    } finally {
      setBusy(null);
    }
  };

  const handleClearAllDetected = async () => {
    const names = detectedCandidatesView.visible.map((c) => c.project_name);
    if (names.length === 0) return;
    if (!await confirm(t('projects.confirm.clear_all_detected'))) {
      return;
    }
    setBusy('clear-all-detected');
    try {
      await projectsApi.blacklistProjectNames(names);
    } catch (e) {
      logTauriError('blacklist all detected', e);
      showError(getErrorMessage(e, t('ui.common.unknown_error')));
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
    () => filterProjectList(sortedProjects, deferredSearch),
    [sortedProjects, deferredSearch],
  );

  const filteredExcludedProjects = useMemo(
    () => filterProjectList(sortedExcludedProjects, deferredSearch),
    [sortedExcludedProjects, deferredSearch],
  );

  useEffect(() => {
    const folderTimerRef = folderInfoTimeoutRef;
    return () => {
      const timerId = folderTimerRef.current;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const getVisibleProjects = useCallback(
    (projectList: ProjectWithStats[], listKey: string) => {
      const limit = projectRenderLimits[listKey] ?? PROJECT_RENDER_PAGE_SIZE;
      return {
        visible: projectList.slice(0, limit),
        hiddenCount: Math.max(0, projectList.length - limit),
      };
    },
    [projectRenderLimits],
  );

  const loadMoreProjects = useCallback((listKey: string, totalCount: number) => {
    setLimitsByScope((prev) => {
      const currentScope = prev[projectListScopeKey] ?? EMPTY_PROJECT_RENDER_LIMITS;
      return {
        ...prev,
        [projectListScopeKey]: {
          ...currentScope,
          [listKey]: Math.min(
            (currentScope[listKey] ?? PROJECT_RENDER_PAGE_SIZE) +
              PROJECT_RENDER_PAGE_SIZE,
            totalCount,
          ),
        },
      };
    });
  }, [projectListScopeKey]);

  const handleSortChange = (val: string) => {
    setSortBy(val);
    localStorage.setItem(SORT_STORAGE_KEY, val);
  };

  const toggleFolders = () => {
    const next = !useFolders;
    setUseFolders(next);
    localStorage.setItem(FOLDERS_STORAGE_KEY, String(next));
  };

  const handleSaveDefaults = () => {
    localStorage.setItem(SORT_STORAGE_KEY, sortBy);
    localStorage.setItem(FOLDERS_STORAGE_KEY, String(useFolders));
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    setFolderInfo(t('projects.messages.view_settings_saved'));
    if (folderInfoTimeoutRef.current !== null) {
      window.clearTimeout(folderInfoTimeoutRef.current);
    }
    folderInfoTimeoutRef.current = window.setTimeout(() => {
      setFolderInfo(null);
      folderInfoTimeoutRef.current = null;
    }, 3000);
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
    const cap = isDemoMode ? 8 : detectedProjects.length;
    const visible = detectedProjects.slice(0, cap);
    const hiddenOverflow = Math.max(0, detectedProjects.length - visible.length);

    return {
      visible,
      hiddenOverflow,
      totalCandidateCount: detectedProjects.length,
    };
  }, [detectedProjects, isDemoMode]);

  const projectsByFolder = useMemo(() => {
    const rootByProjectName = new Map<string, string>();
    for (const candidate of folderCandidates) {
      const key = candidate.name.toLowerCase();
      if (!rootByProjectName.has(key)) {
        rootByProjectName.set(key, candidate.root_path);
      }
    }

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
      const root = rootByProjectName.get(project.name.toLowerCase());
      if (root && grouped.has(root)) {
        grouped.get(root)!.push(project);
        continue;
      }
      const nameLC = project.name.toLowerCase();
      const matchedFolder = findFolderByBasenameInName(nameLC, folderBasenames);
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
        new Set(group.flatMap((project) => { const n = project.name.trim(); return n ? [n] : []; })),
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

  const renderProjectCard = useCallback((
    p: ProjectWithStats,
    options?: { inDialog?: boolean },
  ) => {
    const isDeleting = busy === `delete-project:${p.id}`;
    const duplicateInfo = duplicateProjectsView.byProjectId.get(p.id);
    return (
      <ProjectCard
        key={p.id}
        project={p}
        currencyCode={currencyCode}
        estimateValue={estimates[p.id] || 0}
        flags={{
          isNew: isRecentProject(p, newProjectMaxAgeMs, {
            useLastActivity: true,
          }),
          isDeleting,
          isHotProject: hotProjectIds.has(p.id),
          inDialog: options?.inDialog,
          assignOpen: assignOpen === p.id,
          isColorEditorOpen: editingColorId === p.id,
          minimal: projectPageMinimal,
        }}
        duplicateInfo={duplicateInfo ?? null}
        extraInfo={extraInfo}
        loadingExtra={loadingExtra}
        apps={apps}
        pendingColor={pendingColor}
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
        onOpenMergeDialog={() => setMergeDialogProjectId(p.id)}
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
  }, [
    assignOpen,
    apps,
    busy,
    currencyCode,
    duplicateProjectsView.byProjectId,
    editingColorId,
    estimates,
    extraInfo,
    handleAssign,
    handleCompactProject,
    handleDeleteProject,
    handleExclude,
    handleFreeze,
    handleResetProjectTime,
    handleUnfreeze,
    handleUpdateProjectColor,
    loadingExtra,
    newProjectMaxAgeMs,
    pendingColor,
    projectPageMinimal,
    hotProjectIds,
    setCurrentPage,
    setProjectPageId,
  ]);

  const listSlotDeps: ProjectsListSlotDeps = {
    hotProjectIds,
    newProjectMaxAgeMs,
    duplicateByProjectId: duplicateProjectsView.byProjectId,
    viewMode,
    getVisibleProjects,
    loadMoreProjects,
    renderProjectCard,
    openEdit,
    handleUnfreeze,
  };

  return {
    t,
    projects,
    excludedProjects,
    projectsAllTimeLoading,
    duplicateProjectsView,
    search,
    setSearch,
    sortBy,
    handleSortChange,
    useFolders,
    toggleFolders,
    viewMode,
    setViewMode,
    handleSaveDefaults,
    setCreateDialogOpen,
    projectFolders,
    projectsByFolder,
    filteredProjects,
    listSlotDeps,
    expandAllSections,
    collapseAllSections,
    sectionOpen,
    toggleSection,
    newFolderPath,
    setNewFolderPath,
    setFolderError,
    setFolderInfo,
    folderError,
    projectFoldersLoadError: PROJECT_FOLDERS_LOAD_ERROR,
    folderInfo,
    busy,
    handleBrowseFolder,
    handleAddFolder,
    handleRemoveFolder,
    handleUpdateFolderMeta,
    handleSyncFolders,
    visibleFolderCandidates,
    hiddenRegisteredFolderCandidatesCount,
    handleCreateFromFolder,
    detectedProjects,
    detectedCandidatesView,
    isDemoMode,
    handleAutoCreateDetected,
    handleClearCandidates,
    handleBlacklistDetected,
    handleClearAllDetected,
    visibleExcludedProjects,
    hiddenExcludedProjectsCount,
    restoreProjectEntry,
    handleDeleteProject,
    handleDeleteAllExcluded,
    loadMoreProjects,
    filteredExcludedProjects,
    mergedProjects,
    handleUnmerge,
    projectDialogId,
    setProjectDialogId,
    setAssignOpen,
    selectedProject,
    renderProjectCard,
    createDialogOpen,
    createProjectEntry,
    mergeDialogProjectId,
    setMergeDialogProjectId,
    mergeProjectEntries,
    sessionDialogOpen,
    setSessionDialogOpen,
    sessionDialogProjectId,
    triggerRefresh,
    confirmDialogProps,
  };
}

export type ProjectsPageController = ReturnType<typeof useProjectsPageController>;
