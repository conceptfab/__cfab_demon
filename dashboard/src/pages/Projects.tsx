import { useEffect, useMemo, useState } from "react";
import { 
  Folder, 
  Plus, 
  MoreHorizontal, 
  Trash2, 
  FileBox, 
  ExternalLink, 
  RefreshCw, 
  Settings, 
  CalendarPlus,
  Flame,
  MessageSquare,
  CircleOff,
  TimerReset,
  Wand2,
  ChevronDown,
  ChevronRight,
  Snowflake,
  Maximize2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getProjects,
  getExcludedProjects,
  createProject,
  updateProject,
  excludeProject,
  restoreProject,
  deleteProject,
  freezeProject,
  unfreezeProject,
  autoFreezeProjects,
  getApplications,
  assignAppToProject,
  getProjectFolders,
  addProjectFolder,
  removeProjectFolder,
  getFolderProjectCandidates,
  createProjectFromFolder,
  syncProjectsFromFolders,
  getDetectedProjects,
  autoCreateProjectsFromDetection,
  resetProjectTime,
  getDemoModeStatus,
  getProjectExtraInfo,
  compactProjectData,
  getProjectEstimates,
} from "@/lib/tauri";
import { ManualSessionDialog } from "@/components/ManualSessionDialog";
import { formatDuration, formatPathForDisplay, formatMoney } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { loadFreezeSettings } from "@/lib/user-settings";
import type {
  ProjectWithStats,
  AppWithStats,
  ProjectFolder,
  FolderProjectCandidate,
  DetectedProject,
  ProjectExtraInfo,
} from "@/lib/db-types";

const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee"];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
}

function inferDetectedProjectName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return fileName;
  const parts = trimmed.split(" - ");
  const candidate = parts[parts.length - 1]?.trim();
  return candidate || trimmed;
}

function normalizeProjectDuplicateKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, "")
    .replace(/\s+/g, "");
}

export function Projects() {
  const {
    refreshKey,
    triggerRefresh,
    currencyCode,
  } = useAppStore();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [excludedProjects, setExcludedProjects] = useState<ProjectWithStats[]>([]);
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [projectDialogId, setProjectDialogId] = useState<number | null>(null);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [projectFolderPath, setProjectFolderPath] = useState("");
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<number | null>(null);
  const [projectFolders, setProjectFolders] = useState<ProjectFolder[]>([]);
  const [folderCandidates, setFolderCandidates] = useState<FolderProjectCandidate[]>([]);
  const [detectedProjects, setDetectedProjects] = useState<DetectedProject[]>([]);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<string | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogProjectId, setSessionDialogProjectId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("compact");
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [estimates, setEstimates] = useState<Record<number, number>>({});

  const SECTION_STORAGE_KEY = "timeflow-dashboard-projects-section-open";
  const LEGACY_SECTION_STORAGE_KEY = "cfab-dashboard-projects-section-open";
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
      const allClosed = !next.excluded && !next.folders && !next.candidates && !next.detected;
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
      console.debug("Failed to persist sections state:", error);
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

  useEffect(() => {
    const { thresholdDays } = loadFreezeSettings();
    autoFreezeProjects(thresholdDays).then(({ frozen_count, unfrozen_count }) => {
      if (frozen_count > 0 || unfrozen_count > 0) {
        triggerRefresh();
      }
    }).catch(() => {/* ignore — feature not yet compiled */ });
  }, []);

  const hotProjectIds = useMemo(() => {
    return [...projects]
      .sort((a, b) => b.total_seconds - a.total_seconds)
      .slice(0, 5)
      .map((p) => p.id);
  }, [projects]);

  useEffect(() => {
    Promise.allSettled([
      getProjects(),
      getExcludedProjects(),
      getApplications(),
      getProjectFolders(),
      getFolderProjectCandidates(),
      getDetectedProjects({ start: "2020-01-01", end: "2100-01-01" }),
      getDemoModeStatus(),
    ]).then(([projectsRes, excludedRes, appsRes, foldersRes, candidatesRes, detectedRes, demoModeRes]) => {
      if (projectsRes.status === "fulfilled") setProjects(projectsRes.value);
      else console.error("Failed to load projects:", projectsRes.reason);

      if (excludedRes.status === "fulfilled") setExcludedProjects(excludedRes.value);
      else console.error("Failed to load excluded projects:", excludedRes.reason);

      if (appsRes.status === "fulfilled") setApps(appsRes.value);
      else console.error("Failed to load applications:", appsRes.reason);

      if (foldersRes.status === "fulfilled") setProjectFolders(foldersRes.value);
      else {
        console.error("Failed to load project folders:", foldersRes.reason);
        setFolderError("Failed to load project folders");
      }

      if (candidatesRes.status === "fulfilled") setFolderCandidates(candidatesRes.value);
      else console.error("Failed to load folder candidates:", candidatesRes.reason);

      if (detectedRes.status === "fulfilled") setDetectedProjects(detectedRes.value);
      else console.error("Failed to load detected projects:", detectedRes.reason);

      if (demoModeRes.status === "fulfilled") setIsDemoMode(demoModeRes.value.enabled);
      else console.error("Failed to load demo mode status:", demoModeRes.reason);

      getProjectEstimates({ start: "2020-01-01", end: "2100-01-01" }).then((res) => {
        const map: Record<number, number> = {};
        res.forEach((r) => {
          map[r.project_id] = r.estimated_value;
        });
        setEstimates(map);
      }).catch(console.error);
    });
  }, [refreshKey]);

  useEffect(() => {
    if (projectDialogId === null) {
      setExtraInfo(null);
      return;
    }
    setLoadingExtra(true);
    getProjectExtraInfo(projectDialogId, { start: "2020-01-01", end: "2100-01-01" })
      .then(setExtraInfo)
      .catch(console.error)
      .finally(() => setLoadingExtra(false));
  }, [projectDialogId]);

  const handleUpdateProjectColor = async (projectId: number, color: string) => {
    await updateProject(projectId, color);
    setEditingColorId(null);
    triggerRefresh();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setCreateProjectError("Project name is required.");
      return;
    }
    if (!projectFolderPath.trim()) {
      setCreateProjectError("Project folder is required to identify tracked files.");
      return;
    }
    setCreateProjectError(null);
    try {
      await createProject(name.trim(), color, projectFolderPath.trim());
      setCreateDialogOpen(false);
      setName("");
      setProjectFolderPath("");
      triggerRefresh();
    } catch (e) {
      setCreateProjectError(getErrorMessage(e, "Failed to create project"));
    }
  };

  const handleExclude = async (id: number) => {
    if (!window.confirm("Exclude this project? It can be restored later.")) {
      return;
    }
    await excludeProject(id);
    triggerRefresh();
  };

  const handleRestore = async (id: number) => {
    await restoreProject(id);
    triggerRefresh();
  };

  const handleFreeze = async (id: number) => {
    await freezeProject(id);
    triggerRefresh();
  };

  const handleUnfreeze = async (id: number) => {
    await unfreezeProject(id);
    triggerRefresh();
  };

  const handleDeleteProject = async (project: ProjectWithStats) => {
    const projectLabel = project.name.trim() || `#${project.id}`;
    const confirmed = window.confirm(
      `Delete project permanently?\n\n${projectLabel}\n\n` +
      `This will:\n` +
      `- remove the project record\n` +
      `- unassign linked apps/sessions/file activities\n` +
      `- delete manual sessions assigned to this project\n\n` +
      `This cannot be undone.`
    );
    if (!confirmed) return;

    const busyKey = `delete-project:${project.id}`;
    setBusy(busyKey);
    try {
      await deleteProject(project.id);
      setProjectDialogId((prev) => (prev === project.id ? null : prev));
      setAssignOpen((prev) => (prev === project.id ? null : prev));
      setEditingColorId((prev) => (prev === project.id ? null : prev));
      triggerRefresh();
    } catch (e) {
      console.error("Failed to delete project:", e);
      window.alert(`Failed to delete project "${projectLabel}": ${getErrorMessage(e, "Unknown error")}`);
    } finally {
      setBusy((prev) => (prev === busyKey ? null : prev));
    }
  };

  const handleResetProjectTime = async (id: number) => {
    if (!window.confirm("Reset tracked time for this project? This cannot be undone.")) {
      return;
    }
    await resetProjectTime(id);
    triggerRefresh();
  };

  const handleCompactProject = async (id: number) => {
    if (!window.confirm("Kompaktować dane tego projektu? To usunie szczegółową historię plików (file activities), ale zachowa sesje i całkowity czas. Tej operacji nie można cofnąć.")) {
      return;
    }
    setBusy(`compact-project:${id}`);
    try {
      await compactProjectData(id);
      triggerRefresh();
      const info = await getProjectExtraInfo(id, { start: "2020-01-01", end: "2100-01-01" });
      setExtraInfo(info);
    } catch (e) {
      console.error("Failed to compact project data:", e);
      window.alert(`Failed to compact project data: ${getErrorMessage(e, "Unknown error")}`);
    } finally {
      setBusy(null);
    }
  };

  const handleAssign = async (appId: number, projectId: number | null) => {
    await assignAppToProject(appId, projectId);
    triggerRefresh();
  };

  const openCreate = () => {
    setName("");
    setProjectFolderPath("");
    setCreateProjectError(null);
    setColor(COLORS[projects.length % COLORS.length]);
    setCreateDialogOpen(true);
  };

  const handleBrowseProjectCreateFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Assigned Project Folder",
      });
      if (selected && typeof selected === "string") {
        setProjectFolderPath(selected);
        setCreateProjectError(null);
      }
    } catch (e) {
      console.error("Failed to open folder dialog:", e);
    }
  };

  const openEdit = (project: ProjectWithStats) => {
    setProjectDialogId(project.id);
    setAssignOpen(null);
  };

  const handleAddFolder = async () => {
    const path = newFolderPath.trim();
    if (!path) {
      setFolderError("Please enter a folder path");
      return;
    }
    setBusy("add-folder");
    setFolderError(null);
    setFolderInfo(null);
    try {
      await addProjectFolder(path);
      setNewFolderPath("");
      setFolderInfo("Folder saved");
      triggerRefresh();
    } catch (error: unknown) {
      setFolderError(getErrorMessage(error, "Failed to add folder"));
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
        title: "Select Project Folder",
      });
      if (selected && typeof selected === "string") {
        setNewFolderPath(selected);
        setFolderError(null);
      }
    } catch (e) {
      console.error("Failed to open folder dialog:", e);
    }
  };

  const handleRemoveFolder = async (path: string) => {
    if (!window.confirm(`Remove folder from project roots?\n\n${formatPathForDisplay(path)}`)) {
      return;
    }
    setBusy(`remove-folder:${path}`);
    try {
      await removeProjectFolder(path);
      triggerRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateFromFolder = async (folderPath: string) => {
    setBusy(`create-folder:${folderPath}`);
    try {
      await createProjectFromFolder(folderPath);
      triggerRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleSyncFolders = async () => {
    setBusy("sync-folders");
    try {
      await syncProjectsFromFolders();
      triggerRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleAutoCreateDetected = async () => {
    setBusy("auto-detect");
    try {
      await autoCreateProjectsFromDetection({ start: "2020-01-01", end: "2100-01-01" }, 2);
      triggerRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const visibleFolderCandidates = useMemo(() => {
    const existingProjectNames = new Set(
      [...projects, ...excludedProjects].map((project) => project.name.toLowerCase()),
    );
    return folderCandidates.filter(
      (candidate) => !candidate.already_exists && !existingProjectNames.has(candidate.name.toLowerCase()),
    );
  }, [folderCandidates, projects, excludedProjects]);
  const hiddenRegisteredFolderCandidatesCount = folderCandidates.length - visibleFolderCandidates.length;

  const detectedCandidatesView = useMemo(() => {
    const existingNames = new Set(projects.map((p) => p.name.toLowerCase()));
    const excludedNames = new Set(excludedProjects.map((p) => p.name.toLowerCase()));
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
      const parts = f.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
      return { basename: parts[parts.length - 1].toLowerCase(), path: f.path };
    });

    const grouped = new Map<string, ProjectWithStats[]>();
    for (const folder of projectFolders) {
      grouped.set(folder.path, []);
    }

    const outside: ProjectWithStats[] = [];
    for (const project of projects) {
      // 1. Exact match by candidate name
      const root = rootByProjectName.get(project.name.toLowerCase());
      if (root && grouped.has(root)) {
        grouped.get(root)!.push(project);
        continue;
      }
      // 2. Project name contains a folder's basename (e.g. "TODO.md - __timeflow_demon" contains "__timeflow_demon")
      const nameLC = project.name.toLowerCase();
      const matchedFolder = folderBasenames.find((f) => nameLC.includes(f.basename));
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
  }, [projects, projectFolders, folderCandidates]);

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
        new Set(group.map((project) => project.name.trim()).filter(Boolean))
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
    [projects, projectDialogId]
  );

  const renderDuplicateMarker = (project: ProjectWithStats) => {
    const info = duplicateProjectsView.byProjectId.get(project.id);
    if (!info) return null;

    const title =
      info.groupNames.length > 1
        ? `Possible duplicate (${info.groupSize}): ${info.groupNames.join(" | ")}`
        : `Possible duplicate (${info.groupSize}) after normalizing "_" and "-"`;

    return (
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600 shrink-0"
        title={title}
        aria-label={title}
      >
        D
      </span>
    );
  };

  const renderProjectCard = (p: ProjectWithStats, options?: { inDialog?: boolean }) => {
    const isDeleting = busy === `delete-project:${p.id}`;
    return (
      <Card key={p.id}>
        <CardHeader
          className={`flex flex-row items-center justify-between pb-2 ${options?.inDialog ? "pr-10" : ""}`}
        >
          <div className="flex items-center gap-2">
            <div className="relative group">
              <div
                className="h-3 w-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                style={{ backgroundColor: p.color }}
                onClick={() => setEditingColorId(editingColorId === p.id ? null : p.id)}
                title="Change color"
              />
              {editingColorId === p.id && (
                <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded border bg-popover shadow-md">
                  <input
                    type="color"
                    defaultValue={p.color}
                    className="w-16 h-8 border border-border rounded cursor-pointer"
                    onChange={(e) => handleUpdateProjectColor(p.id, e.target.value)}
                    title="Choose color"
                  />
                  <div className="mt-2 flex gap-1">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }}
                        onClick={() => handleUpdateProjectColor(p.id, c)}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <CardTitle className="text-base flex items-center gap-2">
              {p.name}

              {renderDuplicateMarker(p)}
              {p.is_imported === 1 && (
                <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-orange-500/20 px-1 py-0 h-4 text-[10px]">
                  Imported
                </Badge>
              )}
              {hotProjectIds.includes(p.id) && (
                <span title="Hot project - top 5 by time">
                  <Flame className="h-3.5 w-3.5 text-red-500 fill-red-500/20" />
                </span>
              )}
            </CardTitle>
          </div>
          <div className={`flex gap-1 ${options?.inDialog ? "mr-8" : ""}`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => handleResetProjectTime(p.id)}
              title="Reset time"
              disabled={isDeleting}
            >
              <TimerReset className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${p.frozen_at ? "text-blue-400 bg-blue-500/10" : "text-muted-foreground"}`}
              onClick={() => p.frozen_at ? handleUnfreeze(p.id) : handleFreeze(p.id)}
              title={p.frozen_at ? `Frozen since ${p.frozen_at.slice(0, 10)} - click to unfreeze` : "Freeze project"}
              disabled={isDeleting}
            >
              <Snowflake className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => handleExclude(p.id)}
              title="Exclude project"
              disabled={isDeleting}
            >
              <CircleOff className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => void handleDeleteProject(p)}
              title="Delete project permanently"
              disabled={isDeleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">TOTAL TIME / VALUE</p>
              <p className="text-2xl font-black text-emerald-400 leading-none flex items-center gap-x-3">
                <span>
                  {formatDuration(p.total_seconds)}
                  <span className="ml-2">
                    / {formatMoney(estimates[p.id] || 0, currencyCode)}
                  </span>
                </span>
                
                <span className="flex items-center gap-2">
                  {extraInfo && extraInfo.db_stats.manual_session_count > 0 && (
                    <Flame className="h-5 w-5 text-amber-400 fill-amber-400/20" title={`Boosted sessions: ${extraInfo.db_stats.manual_session_count}`} />
                  )}
                  {extraInfo && extraInfo.db_stats.comment_count > 0 && (
                    <MessageSquare className="h-5 w-5 text-blue-400 fill-blue-400/20" title={`Comments: ${extraInfo.db_stats.comment_count}`} />
                  )}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSessionDialogProjectId(p.id);
                  setSessionDialogOpen(true);
                }}
                title="Add manual session"
                className="shrink-0 h-9 w-9"
                disabled={isDeleting}
              >
                <CalendarPlus className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setProjectDialogId(p.id);
                }}
                title="Project details"
                className="shrink-0 h-9 w-9"
                disabled={isDeleting}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {options?.inDialog && (
            <div className="mt-4 space-y-4 border-t pt-4 animate-in fade-in duration-500 text-sm">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Top 3 Aplikacje</p>
                {loadingExtra ? (
                  <p className="text-xs text-muted-foreground italic">Ładowanie...</p>
                ) : (
                  <div className="space-y-1.5">
                    {extraInfo?.top_apps.map((app, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: app.color || "#64748b" }} />
                        <span className="truncate flex-1">{app.name}</span>
                        <span className="font-mono text-emerald-400 shrink-0">{formatDuration(app.seconds)}</span>
                      </div>
                    ))}
                    {extraInfo?.top_apps.length === 0 && <p className="text-xs text-muted-foreground italic">Brak danych</p>}
                    
                    <div className="pt-2 mt-2 border-t border-dashed border-muted-foreground/20 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-tight whitespace-nowrap">Apps Linked:</span>
                        <span className="text-xs font-bold text-emerald-400">{p.app_count}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-1/2 text-[11px] h-7"
                        onClick={() => setAssignOpen(assignOpen === p.id ? null : p.id)}
                        disabled={isDeleting}
                      >
                        Manage Apps
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-secondary/30 p-3 space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center justify-between">
                  Statystyki bazy danych
                  {extraInfo && (
                    <span className="text-[10px] lowercase font-normal opacity-70">
                      ~{(extraInfo.db_stats.estimated_size_bytes / 1024).toFixed(1)} KB
                    </span>
                  )}
                </p>
                {loadingExtra ? (
                  <p className="text-center py-2 text-xs text-muted-foreground">Ładowanie statystyk...</p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sesje:</span>
                      <span className="font-medium">{extraInfo?.db_stats.session_count || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pliki:</span>
                      <span className="font-medium">{extraInfo?.db_stats.file_activity_count || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ręczne:</span>
                      <span className="font-medium">{extraInfo?.db_stats.manual_session_count || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Komentarze:</span>
                      <span className="font-medium">{extraInfo?.db_stats.comment_count || 0}</span>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full text-[10px] h-7 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/20"
                    onClick={() => handleCompactProject(p.id)}
                    disabled={loadingExtra || !extraInfo || extraInfo.db_stats.file_activity_count === 0 || !!busy}
                  >
                    {busy === `compact-project:${p.id}` ? "Kompaktowanie..." : "Kompaktuj dane projektu"}
                  </Button>
                </div>
              </div>
            </div>
          )}



          {assignOpen === p.id && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {apps.map((app) => (
                <label key={app.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={app.project_id === p.id}
                    onChange={() => handleAssign(app.id, app.project_id === p.id ? null : p.id)}
                    className="accent-primary"
                    disabled={isDeleting}
                  />
                  <span className="truncate">{app.display_name}</span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <p className="text-sm text-muted-foreground">
            {projects.length} projects{excludedProjects.length > 0 ? ` (${excludedProjects.length} excluded)` : ""}
          </p>
          {duplicateProjectsView.groupCount > 0 && (
            <p className="text-xs text-amber-600/90">
              Marked with{" "}
              <span className="mx-1 inline-flex h-4 w-4 translate-y-[1px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600">
                D
              </span>
              = possible duplicate names in this tab ({duplicateProjectsView.projectCount} projects in {duplicateProjectsView.groupCount} groups)
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-secondary/50 p-1 rounded-md text-sm">
            <button
              onClick={() => setViewMode("detailed")}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === "detailed" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Detailed
            </button>
            <button
              onClick={() => setViewMode("compact")}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === "compact" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Compact
            </button>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </div>
      </div>

      {projectFolders.length > 0 ? (
        <div className="space-y-5">
          {projectsByFolder.sections.map((section) => (
            <div key={section.rootPath} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground" title={formatPathForDisplay(section.rootPath)}>{formatPathForDisplay(section.rootPath)}</p>
              {section.projects.length > 0 ? (
                viewMode === "compact" ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                    {section.projects.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => openEdit(p)}
                      >
                        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={p.name}>{p.name}</span>
                          {p.frozen_at && (
                            <button
                              type="button"
                              className="inline-flex items-center rounded px-0.5 py-0.5 text-blue-400 hover:bg-blue-500/20 transition-colors cursor-pointer"
                              title={`Frozen since ${p.frozen_at.slice(0, 10)} — click to unfreeze`}
                              onClick={(e) => { e.stopPropagation(); handleUnfreeze(p.id); }}
                            >
                              <Snowflake className="h-3 w-3 shrink-0" />
                            </button>
                          )}
                          {renderDuplicateMarker(p)}
                          {hotProjectIds.includes(p.id) && (
                            <span title="Hot project - top 5 by time" className="shrink-0">
                              <Flame className="h-3.5 w-3.5 text-red-500 fill-red-500/20" />
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {section.projects.map((p) => renderProjectCard(p))}
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground">No projects for this folder</p>
              )}
            </div>
          ))}
          {projectsByFolder.outside.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Other projects</p>
              {viewMode === "compact" ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                  {projectsByFolder.outside.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => openEdit(p)}
                    >
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={p.name}>{p.name}</span>
                        {renderDuplicateMarker(p)}
                        {hotProjectIds.includes(p.id) && (
                          <span title="Hot project - top 5 by time" className="shrink-0">
                            <Flame className="h-3.5 w-3.5 text-red-500 fill-red-500/20" />
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {projectsByFolder.outside.map((p) => renderProjectCard(p))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        viewMode === "compact" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm cursor-pointer hover:bg-accent transition-colors"
                onClick={() => openEdit(p)}
              >
                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={p.name}>{p.name}</span>
                  {renderDuplicateMarker(p)}
                  {hotProjectIds.includes(p.id) && (
                    <span title="Hot project - top 5 by time" className="shrink-0">
                      <Flame className="h-3.5 w-3.5 text-red-500 fill-red-500/20" />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => renderProjectCard(p))}
          </div>
        )
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button type="button" onClick={expandAllSections} className="hover:text-foreground underline">
          Expand all
        </button>
        <span>·</span>
        <button type="button" onClick={collapseAllSections} className="hover:text-foreground underline">
          Collapse all
        </button>
      </div>

      <Card>
        <CardHeader
          className="cursor-pointer select-none py-3 px-6"
          onClick={toggleSection("excluded")}
        >
          <div className="flex items-center gap-2">
            {sectionOpen.excluded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-medium">Excluded Projects</CardTitle>
          </div>
        </CardHeader>
        {sectionOpen.excluded && (
          <CardContent>
            {excludedProjects.length === 0 ? (
              <p className="text-xs text-muted-foreground">No excluded projects</p>
            ) : (
              <div className="space-y-2">
                {excludedProjects.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium">
                        <span className="min-w-0 truncate">{p.name}</span>
                        {renderDuplicateMarker(p)}
                      </p>
                      <p className="truncate text-muted-foreground">
                        Excluded{p.excluded_at ? `: ${p.excluded_at}` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleRestore(p.id)}>
                      Restore
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void handleDeleteProject(p)}
                      disabled={busy === `delete-project:${p.id}`}
                      title="Delete project permanently"
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader
          className="cursor-pointer select-none py-3 px-6"
          onClick={toggleSection("folders")}
        >
          <div className="flex items-center gap-2">
            {sectionOpen.folders ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-medium">Project Folders</CardTitle>
          </div>
        </CardHeader>
        {sectionOpen.folders && (
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={newFolderPath}
                onChange={(e) => {
                  setNewFolderPath(e.target.value);
                  setFolderError(null);
                  setFolderInfo(null);
                }}
                placeholder="C:\\projects\\clients"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddFolder();
                  }
                }}
              />
              <Button size="sm" variant="outline" onClick={handleBrowseFolder} disabled={busy === "add-folder"}>
                Browse...
              </Button>
              <Button size="sm" onClick={handleAddFolder} disabled={busy === "add-folder"}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add
              </Button>
            </div>
            {folderError && (
              <p className="text-xs text-destructive">{folderError}</p>
            )}
            {folderInfo && !folderError && (
              <p className="text-xs text-emerald-400">{folderInfo}</p>
            )}

            {projectFolders.length > 0 ? (
              <div className="space-y-1">
                {projectFolders.map((f) => (
                  <div key={f.path} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground" title={formatPathForDisplay(f.path)}>{formatPathForDisplay(f.path)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleRemoveFolder(f.path)}
                      disabled={busy === `remove-folder:${f.path}`}
                      title="Remove folder"
                    >
                      <CircleOff className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No folders configured</p>
            )}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleSyncFolders} disabled={busy === "sync-folders"}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Sync subfolders as projects
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader
          className="cursor-pointer select-none py-3 px-6"
          onClick={toggleSection("candidates")}
        >
          <div className="flex items-center gap-2">
            {sectionOpen.candidates ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-medium">Folder Project Candidates</CardTitle>
          </div>
        </CardHeader>
        {sectionOpen.candidates && (
          <CardContent>
            {visibleFolderCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No subfolder candidates found</p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {visibleFolderCandidates.map((c) => (
                  <div key={c.folder_path} className="flex items-center justify-between gap-2 text-xs py-1">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-muted-foreground" title={formatPathForDisplay(c.folder_path)}>{formatPathForDisplay(c.folder_path)}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCreateFromFolder(c.folder_path)}
                      disabled={busy === `create-folder:${c.folder_path}`}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Create
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {hiddenRegisteredFolderCandidatesCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Hidden already registered folders: {hiddenRegisteredFolderCandidatesCount}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader
          className="cursor-pointer select-none py-3 px-6"
          onClick={toggleSection("detected")}
        >
          <div className="flex items-center gap-2">
            {sectionOpen.detected ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-medium">Detected Projects (opened &gt;= 2 times)</CardTitle>
          </div>
        </CardHeader>
        {sectionOpen.detected && (
          <CardContent className="space-y-3">
            {detectedCandidatesView.visible.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {detectedProjects.length === 0
                  ? "No detected projects"
                  : "No candidate projects (detected items already match existing/excluded projects)."}
              </p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {detectedCandidatesView.visible.map((d) => {
                  return (
                    <div key={d.file_name} className="flex items-center justify-between gap-2 text-xs py-1">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.inferredProjectName}</p>
                        <p className="truncate text-muted-foreground">
                          {d.occurrence_count} opens · {formatDuration(d.total_seconds)}
                        </p>
                        {d.inferredProjectName !== d.file_name && (
                          <p className="truncate text-muted-foreground/80" title={d.file_name}>
                            from: {d.file_name}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline">Candidate</Badge>
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
                  Hidden:
                  {" "}
                  {detectedCandidatesView.hiddenExisting > 0 && `${detectedCandidatesView.hiddenExisting} existing`}
                  {detectedCandidatesView.hiddenExisting > 0 &&
                    (detectedCandidatesView.hiddenExcluded > 0 ||
                      detectedCandidatesView.hiddenDuplicates > 0 ||
                      detectedCandidatesView.hiddenOverflow > 0) &&
                    " · "}
                  {detectedCandidatesView.hiddenExcluded > 0 && `${detectedCandidatesView.hiddenExcluded} excluded`}
                  {detectedCandidatesView.hiddenExcluded > 0 &&
                    (detectedCandidatesView.hiddenDuplicates > 0 || detectedCandidatesView.hiddenOverflow > 0) &&
                    " · "}
                  {detectedCandidatesView.hiddenDuplicates > 0 && `${detectedCandidatesView.hiddenDuplicates} duplicate names`}
                  {detectedCandidatesView.hiddenDuplicates > 0 && detectedCandidatesView.hiddenOverflow > 0 && " · "}
                  {detectedCandidatesView.hiddenOverflow > 0 &&
                    `${detectedCandidatesView.hiddenOverflow} extra candidates${isDemoMode ? " (demo cap)" : ""}`}
                </p>
              )}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoCreateDetected}
                disabled={busy === "auto-detect" || detectedCandidatesView.totalCandidateCount === 0}
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                Auto-create detected projects
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

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
          {selectedProject && renderProjectCard(selectedProject, { inDialog: true })}
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <input
                className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setCreateProjectError(null);
                }}
                placeholder="Project name"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Assigned Folder</label>
              <div className="mt-1 flex gap-2">
                <input
                  className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={projectFolderPath}
                  onChange={(e) => {
                    setProjectFolderPath(e.target.value);
                    setCreateProjectError(null);
                  }}
                  placeholder="C:\projects\my-new-app"
                />
                <Button size="sm" variant="outline" onClick={handleBrowseProjectCreateFolder}>
                  Browse...
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Color</label>
              <div className="mt-1 flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className="h-8 w-8 rounded-full border-2 transition-transform"
                    style={{ backgroundColor: c, borderColor: color === c ? "#fff" : "transparent", transform: color === c ? "scale(1.1)" : "scale(1)" }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
            {createProjectError && (
              <p className="text-sm text-destructive">{createProjectError}</p>
            )}
            <Button onClick={handleSave} className="w-full mt-2">Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        projects={projects}
        defaultProjectId={sessionDialogProjectId}
        onSaved={triggerRefresh}
      />
    </div>
  );
}

