import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Snowflake,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { open } from '@tauri-apps/plugin-dialog';
import {
  projectsApi,
} from '@/lib/tauri';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { ProjectCard } from '@/components/project/ProjectCard';
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog';
import {
  getDurationParts,
  formatPathForDisplay,
  getErrorMessage,
  logTauriError,
  cn,
} from '@/lib/utils';
import { isRecentProject } from '@/lib/project-utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { loadFreezeSettings } from '@/lib/user-settings';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { useProjectsData, PROJECT_FOLDERS_LOAD_ERROR } from '@/hooks/useProjectsData';
import type {
  ProjectWithStats,
} from '@/lib/db-types';
import { ProjectsList } from '@/components/projects/ProjectsList';
import { ExcludedProjectsList } from '@/components/projects/ExcludedProjectsList';
import { ProjectDiscoveryPanel } from '@/components/projects/ProjectDiscoveryPanel';

const PROJECT_RENDER_PAGE_SIZE = 120;

const VIEW_MODE_STORAGE_KEY = 'timeflow-dashboard-projects-view-mode';
const SORT_STORAGE_KEY = 'timeflow-dashboard-projects-sort';
const FOLDERS_STORAGE_KEY = 'timeflow-dashboard-projects-use-folders';
const SECTION_STORAGE_KEY = 'timeflow-dashboard-projects-section-open';
const LEGACY_SECTION_STORAGE_KEY = 'cfab-dashboard-projects-section-open';

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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
  const [projectRenderLimits, setProjectRenderLimits] = useState<
    Record<string, number>
  >({});
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
    projectFolders,
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

  const hotProjectIds = useMemo(() => {
    return new Set(
      [...projects]
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 5)
        .map((p) => p.id),
    );
  }, [projects]);

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

  useEffect(() => {
    return () => {
      if (folderInfoTimeoutRef.current !== null) {
        window.clearTimeout(folderInfoTimeoutRef.current);
      }
    };
  }, []);

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
    // Backend already filters: only folder-based candidates, no existing/excluded/blacklisted
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
                  isRecentProject(p, newProjectMaxAgeMs, {
                    useLastActivity: true,
                  }) && 'border-yellow-400/70',
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
        isNew={isRecentProject(p, newProjectMaxAgeMs, {
          useLastActivity: true,
        })}
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
      <ProjectsList
        projectCount={projects.length}
        excludedCount={excludedProjects.length}
        projectsAllTimeLoading={projectsAllTimeLoading}
        duplicateGroupCount={duplicateProjectsView.groupCount}
        duplicateProjectCount={duplicateProjectsView.projectCount}
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        useFolders={useFolders}
        onToggleFolders={toggleFolders}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSaveDefaults={handleSaveDefaults}
        onCreateProject={() => setCreateDialogOpen(true)}
        projectFolders={projectFolders}
        projectsByFolder={projectsByFolder}
        filteredProjects={filteredProjects}
        renderProjectList={renderProjectList}
      />

      {projectFolders.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <span className="mt-0.5 text-lg leading-none">!</span>
          <div>
            <p className="font-semibold">{t('projects.warnings.no_folders_title')}</p>
            <p className="mt-0.5 text-xs text-amber-300/80">{t('projects.warnings.no_folders_defined')}</p>
          </div>
        </div>
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

      <ExcludedProjectsList
        isOpen={sectionOpen.excluded}
        onToggle={toggleSection('excluded')}
        projects={visibleExcludedProjects}
        totalExcludedCount={excludedProjects.length}
        hiddenCount={hiddenExcludedProjectsCount}
        renderDuplicateMarker={renderDuplicateMarker}
        isDeleting={(projectId) => busy === `delete-project:${projectId}`}
        isDeletingAll={busy === 'delete-all-excluded'}
        onRestore={(projectId) => {
          void handleRestore(projectId);
        }}
        onDelete={(project) => {
          void handleDeleteProject(project);
        }}
        onDeleteAll={() => {
          void handleDeleteAllExcluded();
        }}
        onLoadMore={() =>
          loadMoreProjects('excluded', filteredExcludedProjects.length)
        }
      />

      <ProjectDiscoveryPanel
        sectionOpen={{
          folders: sectionOpen.folders,
          candidates: sectionOpen.candidates,
          detected: sectionOpen.detected,
        }}
        onToggleFolders={toggleSection('folders')}
        onToggleCandidates={toggleSection('candidates')}
        onToggleDetected={toggleSection('detected')}
        newFolderPath={newFolderPath}
        onFolderPathChange={(value) => {
          setNewFolderPath(value);
          setFolderError(null);
          setFolderInfo(null);
        }}
        folderError={folderError}
        isFolderLoadError={folderError === PROJECT_FOLDERS_LOAD_ERROR}
        folderInfo={folderInfo}
        projectFolders={projectFolders}
        busy={busy}
        onBrowseFolder={() => {
          void handleBrowseFolder();
        }}
        onAddFolder={() => {
          void handleAddFolder();
        }}
        onRemoveFolder={(path) => {
          void handleRemoveFolder(path);
        }}
        onSyncFolders={() => {
          void handleSyncFolders();
        }}
        visibleFolderCandidates={visibleFolderCandidates}
        hiddenRegisteredFolderCandidatesCount={
          hiddenRegisteredFolderCandidatesCount
        }
        onCreateFromFolder={(path) => {
          void handleCreateFromFolder(path);
        }}
        detectedProjectsCount={detectedProjects.length}
        detectedCandidatesView={detectedCandidatesView}
        isDemoMode={isDemoMode}
        onAutoCreateDetected={() => {
          void handleAutoCreateDetected();
        }}
        onClearCandidates={() => {
          void handleClearCandidates();
        }}
        isClearingCandidates={busy === 'clear-candidates'}
        onBlacklistDetected={(name) => {
          void handleBlacklistDetected(name);
        }}
        onClearAllDetected={() => {
          void handleClearAllDetected();
        }}
        isClearingAllDetected={busy === 'clear-all-detected'}
      />

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

