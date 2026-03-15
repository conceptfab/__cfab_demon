import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { emitLocalDataChanged } from '@/lib/sync-events';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
  AutoSafeRollbackResult,
  AutoSafeRunResult,
  Project,
  DashboardData,
  DashboardStats,
  ProjectTimeRow,
  TimelinePoint,
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
  DateRange,
  AppWithStats,
  SessionWithApp,
  ProjectWithStats,
  StackedBarData,
  AutoImportResult,
  ImportedFile,
  DetectedProject,
  MonitoredApp,
  MonitoredAppsSyncResult,
  BackgroundDiagnostics,
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
  ImportResult,
  ExportArchive,
  DbInfo,
  DatabaseSettings,
  BackupFile,
  DeterministicResult,
  ProjectExtraInfo,
  ProjectReportData,
  ScoreBreakdown,
  MultiProjectAnalysis,
  SessionSplittableFlag,
  SplitPart,
  DataFolderStats,
  CleanupResult,
} from './db-types';

export function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!hasTauriRuntime()) {
    return Promise.reject(new Error('Tauri runtime not available'));
  }
  return tauriInvoke<T>(command, args);
}

type MutationNotify<T> = boolean | ((result: T) => boolean);

function shouldNotifyMutation<T>(
  notify: MutationNotify<T> | undefined,
  result: T,
): boolean {
  if (typeof notify === 'function') {
    return notify(result);
  }
  return notify ?? true;
}

function invokeMutation<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: {
    notify?: MutationNotify<T>;
  },
): Promise<T> {
  if (!hasTauriRuntime()) {
    return Promise.reject(new Error('Tauri runtime not available'));
  }
  return tauriInvoke<T>(command, args).then((res) => {
    if (shouldNotifyMutation(options?.notify, res)) {
      emitLocalDataChanged(command);
    }
    return res;
  });
}

export const getImportedFiles = () =>
  invoke<ImportedFile[]>('get_imported_files');
export const getArchiveFiles = () =>
  invoke<ArchivedFile[]>('get_archive_files');
export const deleteArchiveFile = (fileName: string) =>
  invokeMutation<void>('delete_archive_file', { fileName });

// Projects
export const getProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>('get_projects', { dateRange });
export const getProject = (id: number) =>
  invoke<ProjectWithStats>('get_project', { id });
export const getExcludedProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>('get_excluded_projects', { dateRange });
export const createProject = (
  name: string,
  color: string,
  assignedFolderPath: string | null,
) =>
  invokeMutation<Project>('create_project', {
    name,
    color,
    assignedFolderPath,
  });
export const updateProject = (id: number, color: string) =>
  invokeMutation<void>('update_project', { id, color });
export const excludeProject = (id: number) =>
  invokeMutation<void>('exclude_project', { id });
export const restoreProject = (id: number) =>
  invokeMutation<void>('restore_project', { id });
export const deleteProject = (id: number) =>
  invokeMutation<void>('delete_project', { id });
export const freezeProject = (id: number) =>
  invokeMutation<void>('freeze_project', { id });
export const unfreezeProject = (id: number) =>
  invokeMutation<void>('unfreeze_project', { id });
export const autoFreezeProjects = (thresholdDays?: number) =>
  invokeMutation<{ frozen_count: number; unfrozen_count: number }>(
    'auto_freeze_projects',
    {
      thresholdDays: thresholdDays ?? null,
    },
    {
      notify: (result) =>
        result.frozen_count > 0 || result.unfrozen_count > 0,
    },
  );
export const assignAppToProject = (appId: number, projectId: number | null) =>
  invokeMutation<void>('assign_app_to_project', { appId, projectId });
export function assignSessionToProject(
  sessionId: number,
  projectId: number | null,
  source?: string,
) {
  return invokeMutation('assign_session_to_project', {
    sessionId,
    projectId,
    source,
  });
}
export function assignSessionsToProjectBatch(
  sessionIds: number[],
  projectId: number | null,
  source?: string,
) {
  return invokeMutation('assign_sessions_to_project', {
    sessionIds,
    projectId,
    source,
  });
}
export const getProjectExtraInfo = (id: number, dateRange: DateRange) =>
  invoke<ProjectExtraInfo>('get_project_extra_info', { id, dateRange });
export const getProjectReportData = (projectId: number, dateRange: DateRange) =>
  invoke<ProjectReportData>('get_project_report_data', {
    projectId,
    dateRange,
  });
export const compactProjectData = (id: number) =>
  invokeMutation<void>('compact_project_data', { id });
export const deleteSession = (sessionId: number) =>
  invokeMutation<void>('delete_session', { sessionId });
export const deleteSessionsBatch = (sessionIds: number[]) =>
  invokeMutation<void>('delete_sessions', { sessionIds });
export const updateSessionRateMultiplier = (
  sessionId: number,
  multiplier: number | null,
) =>
  invokeMutation<void>('update_session_rate_multiplier', {
    sessionId,
    multiplier,
  });
export const updateSessionRateMultipliersBatch = (
  sessionIds: number[],
  multiplier: number | null,
) =>
  invokeMutation<void>('update_session_rate_multipliers', {
    sessionIds,
    multiplier,
  });
export const updateSessionComment = (
  sessionId: number,
  comment: string | null,
) => invokeMutation<void>('update_session_comment', { sessionId, comment });
export const updateSessionCommentsBatch = (
  sessionIds: number[],
  comment: string | null,
) => invokeMutation<void>('update_session_comments', { sessionIds, comment });
export const getProjectFolders = () =>
  invoke<ProjectFolder[]>('get_project_folders');
export const addProjectFolder = (path: string) =>
  invokeMutation<void>('add_project_folder', { path });
export const removeProjectFolder = (path: string) =>
  invokeMutation<void>('remove_project_folder', { path });
export const getFolderProjectCandidates = () =>
  invoke<FolderProjectCandidate[]>('get_folder_project_candidates');
export const createProjectFromFolder = (folderPath: string) =>
  invokeMutation<Project>('create_project_from_folder', { folderPath });
export const syncProjectsFromFolders = () =>
  invokeMutation<{ created_projects: string[]; scanned_folders: number }>(
    'sync_projects_from_folders',
    undefined,
    {
      notify: (result) => result.created_projects.length > 0,
    },
  );
export const autoCreateProjectsFromDetection = (
  dateRange: DateRange,
  minOccurrences = 2,
) =>
  invokeMutation<number>('auto_create_projects_from_detection', {
    dateRange,
    minOccurrences,
  }, {
    notify: (createdCount) => createdCount > 0,
  });

// Dashboard
export const getActivityDateSpan = () =>
  invoke<DateRange | null>('get_activity_date_span');
export const getDashboardData = (
  dateRange: DateRange,
  topLimit = 5,
  timelineLimit = 8,
  timelineGranularity: 'hour' | 'day' = 'day',
) =>
  invoke<DashboardData>('get_dashboard_data', {
    dateRange,
    topLimit,
    timelineLimit,
    timelineGranularity,
  });
export const getDashboardStats = (dateRange: DateRange) =>
  invoke<DashboardStats>('get_dashboard_stats', { dateRange });
export const getTopProjects = (dateRange: DateRange, limit = 8) =>
  invoke<ProjectTimeRow[]>('get_top_projects', { dateRange, limit });
export const getDashboardProjects = (dateRange: DateRange) =>
  invoke<ProjectTimeRow[]>('get_dashboard_projects', { dateRange });
export const getTimeline = (dateRange: DateRange) =>
  invoke<TimelinePoint[]>('get_timeline', { dateRange });
export const getEstimateSettings = () =>
  invoke<EstimateSettings>('get_estimate_settings');
export const updateGlobalHourlyRate = (rate: number) =>
  invokeMutation<void>('update_global_hourly_rate', { rate });
export const updateProjectHourlyRate = (
  projectId: number,
  rate: number | null,
) => invokeMutation<void>('update_project_hourly_rate', { projectId, rate });
export const getProjectEstimates = (dateRange: DateRange) =>
  invoke<EstimateProjectRow[]>('get_project_estimates', { dateRange });
export const getEstimatesSummary = (dateRange: DateRange) =>
  invoke<EstimateSummary>('get_estimates_summary', { dateRange });

// Applications
export const getApplications = (dateRange?: DateRange) =>
  invoke<AppWithStats[]>(
    'get_applications',
    dateRange ? { dateRange } : undefined,
  );
export const updateAppColor = (id: number, color: string) =>
  invokeMutation<void>('update_app_color', { id, color });

// Sessions
export const getSessions = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
  includeFiles?: boolean;
  includeAiSuggestions?: boolean;
  limit?: number;
  offset?: number;
}) => invoke<SessionWithApp[]>('get_sessions', { filters });

export const getSessionCount = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
}) => invoke<number>('get_session_count', { filters });

export const rebuildSessions = (gapFillMinutes: number) =>
  invokeMutation<number>('rebuild_sessions', { gapFillMinutes }, {
    notify: (merged) => merged > 0,
  });

export const getAssignmentModelStatus = () =>
  invoke<AssignmentModelStatus>('get_assignment_model_status');

export const getAssignmentModelMetrics = (days = 30) =>
  invoke<AssignmentModelMetrics>('get_assignment_model_metrics', { days });

export const setAssignmentMode = (
  mode: AssignmentMode,
  suggestConf: number,
  autoConf: number,
  autoEv: number,
) =>
  invokeMutation<void>('set_assignment_mode', {
    mode,
    suggestConf,
    autoConf,
    autoEv,
  });

export const setAssignmentModelCooldown = (hours: number) =>
  invokeMutation<AssignmentModelStatus>('set_assignment_model_cooldown', {
    hours,
  });

export const setTrainingHorizonDays = (days: number) =>
  invokeMutation<AssignmentModelStatus>('set_training_horizon_days', {
    days,
  });

export const setTrainingBlacklists = (
  appBlacklist: string[],
  folderBlacklist: string[],
) =>
  invokeMutation<AssignmentModelStatus>('set_training_blacklists', {
    appBlacklist,
    folderBlacklist,
  });

export const resetAssignmentModelKnowledge = () =>
  invokeMutation<AssignmentModelStatus>('reset_assignment_model_knowledge');

export const trainAssignmentModel = (force = false) =>
  invokeMutation<AssignmentModelStatus>('train_assignment_model', { force });

export const runAutoSafeAssignment = (
  limit?: number,
  dateRange?: DateRange,
  minDuration?: number,
) =>
  invokeMutation<AutoSafeRunResult>('run_auto_safe_assignment', {
    limit,
    dateRange,
    minDuration,
  });

export const rollbackLastAutoSafeRun = () =>
  invokeMutation<AutoSafeRollbackResult>('rollback_last_auto_safe_run');

export const autoRunIfNeeded = (minDuration?: number) =>
  invokeMutation<AutoSafeRunResult | null>('auto_run_if_needed', {
    minDuration,
  }, {
    notify: (result) => (result?.assigned ?? 0) > 0,
  });

export const applyDeterministicAssignment = (minHistory?: number) =>
  invokeMutation<DeterministicResult>('apply_deterministic_assignment', {
    minHistory: minHistory ?? null,
  }, {
    notify: (result) => result.sessions_assigned > 0,
  });

export const getSessionScoreBreakdown = (sessionId: number) =>
  invoke<ScoreBreakdown>('get_session_score_breakdown', { sessionId });

export const getFeedbackWeight = () => invoke<number>('get_feedback_weight');

export const setFeedbackWeight = (weight: number) =>
  invokeMutation<void>('set_feedback_weight', { weight });

// Analysis
export const getProjectTimeline = (
  dateRange: DateRange,
  limit = 8,
  granularity: 'hour' | 'day' = 'day',
  projectId?: number,
) =>
  invoke<StackedBarData[]>('get_project_timeline', {
    dateRange,
    limit,
    granularity,
    id: projectId,
  });

// Auto-import
export const importJsonFiles = (filePaths: string[]) =>
  invokeMutation<ImportResult[]>('import_json_files', { filePaths });

export const autoImportFromDataDir = () =>
  invoke<AutoImportResult>('auto_import_from_data_dir');

// Detected projects (files opened > 1 time)
export const getDetectedProjects = (dateRange: DateRange) =>
  invoke<DetectedProject[]>('get_detected_projects', { dateRange });

// Daemon Control
export const getDaemonStatus = (minDuration?: number) =>
  invoke<DaemonStatus>('get_daemon_status', { minDuration });
export const getDaemonRuntimeStatus = () =>
  invoke<DaemonStatus>('get_daemon_runtime_status');
export const getBackgroundDiagnostics = () =>
  invoke<BackgroundDiagnostics>('get_background_diagnostics');
export const getDaemonLogs = (tailLines?: number) =>
  invoke<string>('get_daemon_logs', { tailLines });
export const getAutostartEnabled = () =>
  invoke<boolean>('get_autostart_enabled');
export const setAutostartEnabled = (enabled: boolean) =>
  invoke<void>('set_autostart_enabled', { enabled });
export const startDaemon = () => invoke<void>('start_daemon');
export const stopDaemon = () => invoke<void>('stop_daemon');
export const restartDaemon = () => invoke<void>('restart_daemon');

// Monitored Apps (daemon config)
export const getMonitoredApps = () =>
  invoke<MonitoredApp[]>('get_monitored_apps');
export const addMonitoredApp = (exeName: string, displayName: string) =>
  invokeMutation<void>('add_monitored_app', { exeName, displayName });
export const removeMonitoredApp = (exeName: string) =>
  invokeMutation<void>('remove_monitored_app', { exeName });
export const renameMonitoredApp = (exeName: string, displayName: string) =>
  invokeMutation<void>('rename_monitored_app', { exeName, displayName });
export const syncMonitoredAppsFromApplications = () =>
  invokeMutation<MonitoredAppsSyncResult>(
    'sync_monitored_apps_from_applications',
  );

// Refresh & Reset
export const refreshToday = () =>
  invokeMutation<RefreshResult>('refresh_today', undefined, {
    notify: (result) => result.sessions_upserted > 0,
  });
export const getTodayFileSignature = () =>
  invoke<TodayFileSignature>('get_today_file_signature');
export const resetAppTime = (appId: number) =>
  invokeMutation<void>('reset_app_time', { appId });
export const renameApplication = (appId: number, displayName: string) =>
  invokeMutation<void>('rename_application', { appId, displayName });
export const deleteAppAndData = (appId: number) =>
  invokeMutation<void>('delete_app_and_data', { appId });
export const resetProjectTime = (projectId: number) =>
  invokeMutation<void>('reset_project_time', { projectId });

// Manual Sessions
export const createManualSession = (input: {
  title: string;
  session_type: string;
  project_id: number;
  app_id?: number | null;
  start_time: string;
  end_time: string;
}) => invokeMutation<ManualSession>('create_manual_session', { input });

export const getManualSessions = (filters: {
  dateRange?: DateRange;
  projectId?: number;
}) => invoke<ManualSessionWithProject[]>('get_manual_sessions', { filters });

export const updateManualSession = (
  id: number,
  input: {
    title: string;
    session_type: string;
    project_id: number;
    app_id?: number | null;
    start_time: string;
    end_time: string;
  },
) => invokeMutation<void>('update_manual_session', { id, input });

export const deleteManualSession = (id: number) =>
  invokeMutation<void>('delete_manual_session', { id });
export const deleteManualSessionsBatch = (ids: number[]) =>
  invokeMutation<void>('delete_manual_sessions', { ids });

// Settings
export const clearAllData = () => invokeMutation<void>('clear_all_data');
export const getDataDir = () => invoke<string>('get_data_dir');
export const getDemoModeStatus = () =>
  invoke<DemoModeStatus>('get_demo_mode_status');
export const setDemoMode = (enabled: boolean) =>
  invokeMutation<DemoModeStatus>('set_demo_mode', { enabled });

// Data Management
export const exportData = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string,
) => invoke<string>('export_data', { projectId, dateStart, dateEnd });

export const exportDataArchive = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string,
) =>
  invoke<ExportArchive>('export_data_archive', {
    projectId,
    dateStart,
    dateEnd,
  });

export const validateImport = (archivePath: string) =>
  invoke<ImportValidation>('validate_import', { archivePath });

export const importData = (archivePath: string) =>
  invokeMutation<ImportSummary>('import_data', { archivePath }, {
    notify: (result) =>
      result.projects_created > 0 ||
      result.apps_created > 0 ||
      result.sessions_imported > 0 ||
      result.sessions_merged > 0 ||
      result.daily_files_imported > 0,
  });

export const importDataArchive = (archive: ExportArchive) =>
  invokeMutation<ImportSummary>('import_data_archive', { archive });

// Sync log
export const appendSyncLog = (lines: string[]) =>
  invoke<void>('append_sync_log', { lines });
export const getSyncLog = (tailLines?: number) =>
  invoke<string>('get_sync_log', { tailLines });

// Database Management
export const getDbInfo = () => invoke<DbInfo>('get_db_info');

export const vacuumDatabase = () => invoke<void>('vacuum_database');

export const optimizeDatabase = () => invoke<void>('optimize_database');

export const getDatabaseSettings = () =>
  invoke<DatabaseSettings>('get_database_settings');

export const updateDatabaseSettings = (settings: DatabaseSettings) =>
  invokeMutation<void>('update_database_settings', {
    vacuumOnStartup: settings.vacuum_on_startup,
    backupEnabled: settings.backup_enabled,
    backupPath: settings.backup_path,
    backupIntervalDays: settings.backup_interval_days,
    autoOptimizeEnabled: settings.auto_optimize_enabled,
    autoOptimizeIntervalHours: settings.auto_optimize_interval_hours,
  });

export const performManualBackup = () =>
  invokeMutation<string>('perform_manual_backup');

export const openDbFolder = () => invoke<void>('open_db_folder');

export const restoreDatabaseFromFile = (path: string) =>
  invokeMutation<void>('restore_database_from_file', { path });

export const getBackupFiles = () => invoke<BackupFile[]>('get_backup_files');

export const getDataFolderStats = () =>
  invoke<DataFolderStats>('get_data_folder_stats');
export const cleanupDataFolder = () =>
  invokeMutation<CleanupResult>('cleanup_data_folder');

// Secure token storage (API token stored in Rust backend, not localStorage)
export const getSecureToken = () => invoke<string>('get_secure_token');

export const setSecureToken = (token: string) =>
  invoke<void>('set_secure_token', { token });

// Language persistence for daemon (shared file in %APPDATA%/TimeFlow/)
export const persistLanguageForDaemon = (code: string) =>
  invoke<void>('persist_language_for_daemon', { code });
export const persistSessionSettingsForDaemon = (
  minSessionDurationSeconds: number,
) =>
  invoke<void>('persist_session_settings_for_daemon', {
    minSessionDurationSeconds,
  });

// Session Splitting
// Multi-project session analysis & split
export const analyzeSessionProjects = (
  sessionId: number,
  toleranceThreshold: number,
  maxProjects: number,
) =>
  invoke<MultiProjectAnalysis>('analyze_session_projects', {
    sessionId,
    toleranceThreshold,
    maxProjects,
  });

export const analyzeSessionsSplittable = (
  sessionIds: number[],
  toleranceThreshold: number,
  maxProjects: number,
) =>
  invoke<SessionSplittableFlag[]>('analyze_sessions_splittable', {
    sessionIds,
    toleranceThreshold,
    maxProjects,
  });

export const splitSessionMulti = (sessionId: number, splits: SplitPart[]) =>
  invokeMutation<void>('split_session_multi', { sessionId, splits });

export const runtimeApi = {
  hasTauriRuntime,
} as const;

export const projectsApi = {
  getProjects,
  getProject,
  getExcludedProjects,
  createProject,
  updateProject,
  excludeProject,
  restoreProject,
  deleteProject,
  freezeProject,
  unfreezeProject,
  autoFreezeProjects,
  assignAppToProject,
  assignSessionToProject,
  assignSessionsToProjectBatch,
  getProjectExtraInfo,
  getProjectReportData,
  compactProjectData,
  getProjectFolders,
  addProjectFolder,
  removeProjectFolder,
  getFolderProjectCandidates,
  createProjectFromFolder,
  syncProjectsFromFolders,
  autoCreateProjectsFromDetection,
  getDetectedProjects,
  resetProjectTime,
} as const;

export const dashboardApi = {
  getActivityDateSpan,
  getDashboardData,
  getDashboardStats,
  getTopProjects,
  getDashboardProjects,
  getTimeline,
  getEstimateSettings,
  updateGlobalHourlyRate,
  updateProjectHourlyRate,
  getProjectEstimates,
  getEstimatesSummary,
  getProjectTimeline,
} as const;

export const applicationsApi = {
  getApplications,
  updateAppColor,
  resetAppTime,
  renameApplication,
  deleteAppAndData,
} as const;

export const sessionsApi = {
  getSessions,
  getSessionCount,
  rebuildSessions,
  deleteSession,
  deleteSessionsBatch,
  updateSessionRateMultiplier,
  updateSessionRateMultipliersBatch,
  updateSessionComment,
  updateSessionCommentsBatch,
  analyzeSessionProjects,
  analyzeSessionsSplittable,
  splitSessionMulti,
  getSessionScoreBreakdown,
} as const;

export const aiApi = {
  getAssignmentModelStatus,
  getAssignmentModelMetrics,
  setAssignmentMode,
  setAssignmentModelCooldown,
  setTrainingHorizonDays,
  setTrainingBlacklists,
  resetAssignmentModelKnowledge,
  trainAssignmentModel,
  runAutoSafeAssignment,
  rollbackLastAutoSafeRun,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  getFeedbackWeight,
  setFeedbackWeight,
} as const;

export const daemonApi = {
  getDaemonStatus,
  getDaemonRuntimeStatus,
  getBackgroundDiagnostics,
  getDaemonLogs,
  getAutostartEnabled,
  setAutostartEnabled,
  startDaemon,
  stopDaemon,
  restartDaemon,
  getMonitoredApps,
  addMonitoredApp,
  removeMonitoredApp,
  renameMonitoredApp,
  syncMonitoredAppsFromApplications,
  refreshToday,
  getTodayFileSignature,
} as const;

export const manualSessionsApi = {
  createManualSession,
  getManualSessions,
  updateManualSession,
  deleteManualSession,
  deleteManualSessionsBatch,
} as const;

export const settingsApi = {
  clearAllData,
  getDataDir,
  getDemoModeStatus,
  setDemoMode,
  getSecureToken,
  setSecureToken,
  persistLanguageForDaemon,
  persistSessionSettingsForDaemon,
} as const;

export const dataApi = {
  getImportedFiles,
  getArchiveFiles,
  deleteArchiveFile,
  importJsonFiles,
  autoImportFromDataDir,
  exportData,
  exportDataArchive,
  validateImport,
  importData,
  importDataArchive,
  appendSyncLog,
  getSyncLog,
} as const;

export const databaseApi = {
  getDbInfo,
  vacuumDatabase,
  optimizeDatabase,
  getDatabaseSettings,
  updateDatabaseSettings,
  performManualBackup,
  openDbFolder,
  restoreDatabaseFromFile,
  getBackupFiles,
  getDataFolderStats,
  cleanupDataFolder,
} as const;

export const tauriApi = {
  runtime: runtimeApi,
  projects: projectsApi,
  dashboard: dashboardApi,
  applications: applicationsApi,
  sessions: sessionsApi,
  ai: aiApi,
  daemon: daemonApi,
  manualSessions: manualSessionsApi,
  settings: settingsApi,
  data: dataApi,
  database: databaseApi,
} as const;
