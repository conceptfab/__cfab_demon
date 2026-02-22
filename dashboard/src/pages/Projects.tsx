import { useEffect, useMemo, useState } from "react";
import { Plus, CircleOff, TimerReset, RefreshCw, Wand2, ChevronDown, ChevronRight, CalendarPlus } from "lucide-react";
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
} from "@/lib/tauri";
import { ManualSessionDialog } from "@/components/ManualSessionDialog";
import { formatDuration, formatPathForDisplay } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type {
  ProjectWithStats,
  AppWithStats,
  ProjectFolder,
  FolderProjectCandidate,
  DetectedProject,
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

export function Projects() {
  const { refreshKey, triggerRefresh } = useAppStore();
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
    });
  }, [refreshKey]);

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

  const handleResetProjectTime = async (id: number) => {
    if (!window.confirm("Reset tracked time for this project? This cannot be undone.")) {
      return;
    }
    await resetProjectTime(id);
    triggerRefresh();
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

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectDialogId) ?? null,
    [projects, projectDialogId]
  );

  const renderProjectCard = (p: ProjectWithStats, options?: { inDialog?: boolean }) => (
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
            {p.is_imported === 1 && (
              <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-orange-500/20 px-1 py-0 h-4 text-[10px]">
                Imported
              </Badge>
            )}
          </CardTitle>
        </div>
        <div className={`flex gap-1 ${options?.inDialog ? "mr-8" : ""}`}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleResetProjectTime(p.id)} title="Reset time">
            <TimerReset className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExclude(p.id)} title="Exclude project">
            <CircleOff className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground">Total time</p>
            <p className="font-mono font-medium">{formatDuration(p.total_seconds)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Apps</p>
            <p className="font-medium">{p.app_count}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setAssignOpen(assignOpen === p.id ? null : p.id)}
          >
            Manage Apps
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSessionDialogProjectId(p.id);
              setSessionDialogOpen(true);
            }}
            title="Add manual session"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {assignOpen === p.id && (
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {apps.map((app) => (
              <label key={app.id} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={app.project_id === p.id}
                  onChange={() => handleAssign(app.id, app.project_id === p.id ? null : p.id)}
                  className="accent-primary"
                />
                <span className="truncate">{app.display_name}</span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {projects.length} projects{excludedProjects.length > 0 ? ` (${excludedProjects.length} excluded)` : ""}
        </p>
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
                        <span className="font-medium truncate text-sm" title={p.name}>{p.name}</span>
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
                      <span className="font-medium truncate text-sm" title={p.name}>{p.name}</span>
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
                <span className="font-medium truncate text-sm" title={p.name}>{p.name}</span>
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
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-muted-foreground">
                      Excluded{p.excluded_at ? `: ${p.excluded_at}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleRestore(p.id)}>
                    Restore
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

