import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emitLocalDataChanged } from "@/lib/sync-events";
import type {
  AssignmentMode,
  AssignmentModelStatus,
  AutoSafeRollbackResult,
  AutoSafeRunResult,
  ImportResult,
  Project,
  DashboardStats,
  ProjectTimeRow,
  TimelinePoint,
  HourlyData,
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
  DateRange,
  AppWithStats,
  SessionWithApp,
  ProjectWithStats,
  HeatmapCell,
  StackedBarData,
  AutoImportResult,
  ImportedFile,
  DetectedProject,
  MonitoredApp,
  DaemonStatus,
  ArchivedFile,
  ProjectFolder,
  FolderProjectCandidate,
  RefreshResult,
  TodayFileSignature,
  DemoModeStatus,
  ManualSession,
  ManualSessionWithProject,
  ImportValidation,
  ImportSummary,
  ExportArchive,
  DbInfo,
  DatabaseSettings,
  BackupFile,
  DeterministicResult,
  ProjectExtraInfo,
} from "./db-types";

export function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    return Promise.reject(
      new Error(`Tauri runtime unavailable for command '${command}'`)
    );
  }
  return tauriInvoke<T>(command, args);
}

function invokeMutation<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).then((result) => {
    emitLocalDataChanged(command);
    return result;
  });
}

// Import
export const importJsonFiles = (filePaths: string[]) =>
  invoke<ImportResult[]>("import_json_files", { filePaths });

export const checkFileImported = (filePath: string) =>
  invoke<boolean>("check_file_imported", { filePath });

export const getImportedFiles = () =>
  invoke<ImportedFile[]>("get_imported_files");
export const getArchiveFiles = () =>
  invoke<ArchivedFile[]>("get_archive_files");
export const deleteArchiveFile = (fileName: string) =>
  invoke<void>("delete_archive_file", { fileName });

// Projects
export const getProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>("get_projects", { dateRange });
export const getExcludedProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>("get_excluded_projects", { dateRange });
export const createProject = (name: string, color: string, assignedFolderPath: string | null) =>
  invokeMutation<Project>("create_project", { name, color, assignedFolderPath });
export const updateProject = (id: number, color: string) =>
  invokeMutation<void>("update_project", { id, color });
export const excludeProject = (id: number) =>
  invokeMutation<void>("exclude_project", { id });
export const restoreProject = (id: number) =>
  invokeMutation<void>("restore_project", { id });
export const deleteProject = (id: number) =>
  invokeMutation<void>("delete_project", { id });
export const freezeProject = (id: number) =>
  invokeMutation<void>("freeze_project", { id });
export const unfreezeProject = (id: number) =>
  invokeMutation<void>("unfreeze_project", { id });
export const autoFreezeProjects = (thresholdDays?: number) =>
  invokeMutation<{ frozen_count: number; unfrozen_count: number }>("auto_freeze_projects", {
    thresholdDays: thresholdDays ?? null,
  });
export const assignAppToProject = (appId: number, projectId: number | null) =>
  invokeMutation<void>("assign_app_to_project", { appId, projectId });
export function assignSessionToProject(sessionId: number, projectId: number | null, source?: string) {
  return invokeMutation("assign_session_to_project", { sessionId, projectId, source });
}
export const getProjectExtraInfo = (id: number, dateRange: DateRange) =>
  invoke<ProjectExtraInfo>("get_project_extra_info", { id, dateRange });
export const compactProjectData = (id: number) =>
  invoke<void>("compact_project_data", { id });
export const deleteSession = (sessionId: number) =>
  invokeMutation<void>("delete_session", { sessionId });
export const updateSessionRateMultiplier = (sessionId: number, multiplier: number | null) =>
  invokeMutation<void>("update_session_rate_multiplier", { sessionId, multiplier });
export const updateSessionComment = (sessionId: number, comment: string | null) =>
  invokeMutation<void>("update_session_comment", { sessionId, comment });
export const getProjectFolders = () => invoke<ProjectFolder[]>("get_project_folders");
export const addProjectFolder = (path: string) =>
  invokeMutation<void>("add_project_folder", { path });
export const removeProjectFolder = (path: string) =>
  invokeMutation<void>("remove_project_folder", { path });
export const getFolderProjectCandidates = () =>
  invoke<FolderProjectCandidate[]>("get_folder_project_candidates");
export const createProjectFromFolder = (folderPath: string) =>
  invokeMutation<Project>("create_project_from_folder", { folderPath });
export const syncProjectsFromFolders = () =>
  invokeMutation<number>("sync_projects_from_folders");
export const autoCreateProjectsFromDetection = (
  dateRange: DateRange,
  minOccurrences = 2
) =>
  invokeMutation<number>("auto_create_projects_from_detection", {
    dateRange,
    minOccurrences,
  });

// Dashboard
export const getDashboardStats = (dateRange: DateRange) =>
  invoke<DashboardStats>("get_dashboard_stats", { dateRange });
export const getTopProjects = (dateRange: DateRange, limit = 8) =>
  invoke<ProjectTimeRow[]>("get_top_projects", { dateRange, limit });
export const getDashboardProjects = (dateRange: DateRange) =>
  invoke<ProjectTimeRow[]>("get_dashboard_projects", { dateRange });
export const getTimeline = (dateRange: DateRange) =>
  invoke<TimelinePoint[]>("get_timeline", { dateRange });
export const getHourlyBreakdown = (dateRange: DateRange) =>
  invoke<HourlyData[]>("get_hourly_breakdown", { dateRange });
export const getEstimateSettings = () =>
  invoke<EstimateSettings>("get_estimate_settings");
export const updateGlobalHourlyRate = (rate: number) =>
  invoke<void>("update_global_hourly_rate", { rate });
export const updateProjectHourlyRate = (projectId: number, rate: number | null) =>
  invoke<void>("update_project_hourly_rate", { projectId, rate });
export const getProjectEstimates = (dateRange: DateRange) =>
  invoke<EstimateProjectRow[]>("get_project_estimates", { dateRange });
export const getEstimatesSummary = (dateRange: DateRange) =>
  invoke<EstimateSummary>("get_estimates_summary", { dateRange });

// Applications
export const getApplications = (dateRange?: DateRange) =>
  invoke<AppWithStats[]>("get_applications", dateRange ? { dateRange } : undefined);
export const getAppTimeline = (appId: number, dateRange: DateRange) =>
  invoke<TimelinePoint[]>("get_app_timeline", { appId, dateRange });
export const updateAppColor = (id: number, color: string) =>
  invoke<void>("update_app_color", { id, color });

// Sessions
export const getSessions = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
  limit?: number;
  offset?: number;
}) => invoke<SessionWithApp[]>("get_sessions", { filters });

export const getSessionCount = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
}) => invoke<number>("get_session_count", { filters });

export const rebuildSessions = (gapFillMinutes: number) =>
  invokeMutation<number>("rebuild_sessions", { gapFillMinutes });

export const getAssignmentModelStatus = () =>
  invoke<AssignmentModelStatus>("get_assignment_model_status");

export const setAssignmentMode = (
  mode: AssignmentMode,
  suggestConf: number,
  autoConf: number,
  autoEv: number
) =>
  invoke<void>("set_assignment_mode", {
    mode,
    suggestConf,
    autoConf,
    autoEv,
  });

export const setAssignmentModelCooldown = (hours: number) =>
  invoke<AssignmentModelStatus>("set_assignment_model_cooldown", { hours });

export const trainAssignmentModel = (force = false) =>
  invoke<AssignmentModelStatus>("train_assignment_model", { force });

export const runAutoSafeAssignment = (
  limit?: number,
  dateRange?: DateRange,
  minDuration?: number
) =>
  invokeMutation<AutoSafeRunResult>("run_auto_safe_assignment", {
    limit,
    dateRange,
    minDuration,
  });

export const rollbackLastAutoSafeRun = () =>
  invokeMutation<AutoSafeRollbackResult>("rollback_last_auto_safe_run");

export const autoRunIfNeeded = (minDuration?: number) =>
  invoke<AutoSafeRunResult | null>("auto_run_if_needed", { minDuration });

export const applyDeterministicAssignment = (minHistory?: number) =>
  invoke<DeterministicResult>("apply_deterministic_assignment", {
    minHistory: minHistory ?? null,
  });

// Analysis
export const getHeatmap = (dateRange: DateRange) =>
  invoke<HeatmapCell[]>("get_heatmap", { dateRange });
export const getStackedTimeline = (dateRange: DateRange, limit: number) =>
  invoke<StackedBarData[]>("get_stacked_timeline", { dateRange, limit });
export const getProjectTimeline = (
  dateRange: DateRange,
  limit = 8,
  granularity: "hour" | "day" = "day",
  projectId?: number
) =>
  invoke<StackedBarData[]>("get_project_timeline", { dateRange, limit, granularity, id: projectId });

// Auto-import
export const autoImportFromDataDir = () =>
  invoke<AutoImportResult>("auto_import_from_data_dir");

// Detected projects (files opened > 1 time)
export const getDetectedProjects = (dateRange: DateRange) =>
  invoke<DetectedProject[]>("get_detected_projects", { dateRange });

// Daemon Control
export const getDaemonStatus = (minDuration?: number) => invoke<DaemonStatus>("get_daemon_status", { minDuration });
export const getDaemonLogs = (tailLines?: number) =>
  invoke<string>("get_daemon_logs", { tailLines });
export const getAutostartEnabled = () => invoke<boolean>("get_autostart_enabled");
export const setAutostartEnabled = (enabled: boolean) =>
  invoke<void>("set_autostart_enabled", { enabled });
export const startDaemon = () => invoke<void>("start_daemon");
export const stopDaemon = () => invoke<void>("stop_daemon");
export const restartDaemon = () => invoke<void>("restart_daemon");

// Monitored Apps (daemon config)
export const getMonitoredApps = () => invoke<MonitoredApp[]>("get_monitored_apps");
export const addMonitoredApp = (exeName: string, displayName: string) =>
  invoke<void>("add_monitored_app", { exeName, displayName });
export const removeMonitoredApp = (exeName: string) =>
  invoke<void>("remove_monitored_app", { exeName });
export const renameMonitoredApp = (exeName: string, displayName: string) =>
  invoke<void>("rename_monitored_app", { exeName, displayName });

// Refresh & Reset
export const refreshToday = () =>
  invoke<RefreshResult>("refresh_today");
export const getTodayFileSignature = () =>
  invoke<TodayFileSignature>("get_today_file_signature");
export const resetAppTime = (appId: number) =>
  invokeMutation<void>("reset_app_time", { appId });
export const renameApplication = (appId: number, displayName: string) =>
  invokeMutation<void>("rename_application", { appId, displayName });
export const deleteAppAndData = (appId: number) =>
  invokeMutation<void>("delete_app_and_data", { appId });
export const resetProjectTime = (projectId: number) =>
  invokeMutation<void>("reset_project_time", { projectId });

// Manual Sessions
export const createManualSession = (input: {
  title: string;
  session_type: string;
  project_id: number;
  app_id?: number | null;
  start_time: string;
  end_time: string;
}) => invokeMutation<ManualSession>("create_manual_session", { input });

export const getManualSessions = (filters: {
  dateRange?: DateRange;
  projectId?: number;
}) => invoke<ManualSessionWithProject[]>("get_manual_sessions", { filters });

export const updateManualSession = (
  id: number,
  input: {
    title: string;
    session_type: string;
    project_id: number;
    app_id?: number | null;
    start_time: string;
    end_time: string;
  }
) => invokeMutation<void>("update_manual_session", { id, input });

export const deleteManualSession = (id: number) =>
  invokeMutation<void>("delete_manual_session", { id });

// Settings
export const clearAllData = () => invokeMutation<void>("clear_all_data");
export const exportDatabase = (path: string) =>
  invoke<void>("export_database", { path });
export const getDataDir = () => invoke<string>("get_data_dir");
export const getDemoModeStatus = () => invoke<DemoModeStatus>("get_demo_mode_status");
export const setDemoMode = (enabled: boolean) =>
  invoke<DemoModeStatus>("set_demo_mode", { enabled });

// Data Management
export const exportData = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string
) => invoke<string>("export_data", { projectId, dateStart, dateEnd });

export const exportDataArchive = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string
) => invoke<ExportArchive>("export_data_archive", { projectId, dateStart, dateEnd });

export const validateImport = (archivePath: string) =>
  invoke<ImportValidation>("validate_import", { archivePath });

export const importData = (archivePath: string) =>
  invoke<ImportSummary>("import_data", { archivePath });

export const importDataArchive = (archive: ExportArchive) =>
  invoke<ImportSummary>("import_data_archive", { archive });

// Sync log
export const appendSyncLog = (lines: string[]) =>
  invoke<void>("append_sync_log", { lines });
export const getSyncLog = (tailLines?: number) =>
  invoke<string>("get_sync_log", { tailLines });

// Database Management
export const getDbInfo = () => invoke<DbInfo>("get_db_info");

export const vacuumDatabase = () => invoke<void>("vacuum_database");

export const optimizeDatabase = () => invoke<void>("optimize_database");

export const getDatabaseSettings = () =>
  invoke<DatabaseSettings>("get_database_settings");

export const updateDatabaseSettings = (settings: DatabaseSettings) =>
  invoke<void>("update_database_settings", {
    vacuumOnStartup: settings.vacuum_on_startup,
    backupEnabled: settings.backup_enabled,
    backupPath: settings.backup_path,
    backupIntervalDays: settings.backup_interval_days,
    autoOptimizeEnabled: settings.auto_optimize_enabled,
    autoOptimizeIntervalHours: settings.auto_optimize_interval_hours,
  });

export const performManualBackup = () =>
  invoke<string>("perform_manual_backup");

export const openDbFolder = () => invoke<void>("open_db_folder");

export const restoreDatabaseFromFile = (path: string) =>
  invokeMutation<void>("restore_database_from_file", { path });

export const getBackupFiles = () =>
  invoke<BackupFile[]>("get_backup_files");
