export interface Project {
  id: number;
  name: string;
  color: string;
  hourly_rate?: number | null;
  created_at: string;
  excluded_at?: string | null;
  frozen_at?: string | null;
  assigned_folder_path?: string | null;
  is_imported: number;
}

export interface Application {
  id: number;
  executable_name: string;
  display_name: string;
  project_id: number | null;
  is_imported: number;
}

export interface Session {
  id: number;
  app_id: number;
  project_id?: number | null;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  rate_multiplier?: number;
  comment?: string | null;
  is_hidden?: boolean;
}

export interface FileActivity {
  id: number;
  app_id: number;
  file_name: string;
  total_seconds: number;
  first_seen: string;
  last_seen: string;
  project_id?: number | null;
  project_name?: string | null;
  project_color?: string | null;
}

export interface ImportedFile {
  file_path: string;
  import_date: string;
  records_count: number;
}

export interface ArchivedFile {
  file_name: string;
  file_path: string;
  modified_at: string;
  size_bytes: number;
}

// Aggregated types for UI
export interface AppWithStats extends Application {
  total_seconds: number;
  session_count: number;
  last_used: string | null;
  project_name: string | null;
  project_color: string | null;
  color: string;
}

export interface SessionWithApp extends Session {
  app_name: string;
  executable_name: string;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  files: FileActivity[];
  suggested_project_id?: number;
  suggested_project_name?: string;
  suggested_confidence?: number;
  /** true when the most recent assignment for this session was made by AI auto-safe */
  ai_assigned?: boolean;
  comment?: string | null;
}

export type AssignmentMode = "off" | "suggest" | "auto_safe";

export interface AssignmentModelStatus {
  mode: AssignmentMode;
  min_confidence_suggest: number;
  min_confidence_auto: number;
  min_evidence_auto: number;
  last_train_at: string | null;
  feedback_since_train: number;
  is_training: boolean;
  last_train_duration_ms: number | null;
  last_train_samples: number | null;
  train_error_last: string | null;
  cooldown_until: string | null;
  last_auto_run_at: string | null;
  last_auto_assigned_count: number;
  last_auto_rolled_back_at: string | null;
  can_rollback_last_auto_run: boolean;
}

export interface AutoSafeRunResult {
  run_id: number | null;
  scanned: number;
  suggested: number;
  assigned: number;
  skipped_low_confidence: number;
  skipped_ambiguous: number;
  skipped_already_assigned: number;
}

export interface AutoSafeRollbackResult {
  run_id: number;
  reverted: number;
  skipped: number;
}

export interface DeterministicResult {
  apps_with_rules: number;
  sessions_assigned: number;
  sessions_skipped: number;
}

export interface DashboardStats {
  total_seconds: number;
  app_count: number;
  session_count: number;
  avg_daily_seconds: number;
  top_apps: { name: string; seconds: number; color: string | null }[];
  top_project: { name: string; seconds: number; color: string } | null;
}

export interface ProjectTimeRow {
  name: string;
  seconds: number;
  color: string;
  session_count: number;
  app_count: number;
}

export interface TimelinePoint {
  date: string;
  seconds: number;
}

export interface HourlyData {
  hour: number;
  seconds: number;
}

export interface EstimateSettings {
  global_hourly_rate: number;
}

export interface EstimateProjectRow {
  project_id: number;
  project_name: string;
  project_color: string;
  seconds: number;
  hours: number;
  weighted_hours: number;
  project_hourly_rate: number | null;
  effective_hourly_rate: number;
  estimated_value: number;
  session_count: number;
  multiplied_session_count: number;
  multiplier_extra_seconds: number;
}

export interface EstimateSummary {
  total_seconds: number;
  total_hours: number;
  total_value: number;
  projects_count: number;
  overrides_count: number;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface ImportResult {
  file_path: string;
  success: boolean;
  records_imported: number;
  error: string | null;
}

export interface ProjectWithStats extends Project {
  total_seconds: number;
  period_seconds?: number | null;
  app_count: number;
  last_activity: string | null;
  assigned_folder_path?: string | null;
}

export interface ProjectDbStats {
  session_count: number;
  file_activity_count: number;
  manual_session_count: number;
  comment_count: number;
  estimated_size_bytes: number;
}

export interface ProjectExtraInfo {
  current_value: number;
  period_value: number;
  db_stats: ProjectDbStats;
  top_apps: { name: string; seconds: number; color: string | null }[];
}

export interface ProjectFolder {
  path: string;
  added_at: string;
}

export interface FolderProjectCandidate {
  name: string;
  folder_path: string;
  root_path: string;
  already_exists: boolean;
}

export interface HeatmapCell {
  day: number; // 0=Sun..6=Sat
  hour: number;
  seconds: number;
}

export interface StackedBarData {
  date: string;
  has_boost?: boolean;
  has_manual?: boolean;
  comments?: string[];
  [appName: string]: string | number | string[] | boolean | undefined;
}

export interface AutoImportResult {
  files_found: number;
  files_imported: number;
  files_skipped: number;
  files_archived: number;
  errors: string[];
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  exe_path: string | null;
  autostart: boolean;
  needs_assignment: boolean;
  unassigned_sessions: number;
  unassigned_apps: number;
  version?: string;
  dashboard_version?: string;
  is_compatible?: boolean;
}

export interface MonitoredApp {
  exe_name: string;
  display_name: string;
  added_at: string;
}

export interface DetectedProject {
  file_name: string;
  total_seconds: number;
  occurrence_count: number;
  apps: string[];
  first_seen: string;
  last_seen: string;
}

export interface RefreshResult {
  sessions_upserted: number;
  file_found: boolean;
}

export interface TodayFileSignature {
  exists: boolean;
  path: string;
  modified_unix_ms: number | null;
  size_bytes: number | null;
}

export interface DemoModeStatus {
  enabled: boolean;
  activeDbPath: string;
  primaryDbPath: string;
  demoDbPath: string;
}

export interface ManualSession {
  id: number;
  title: string;
  session_type: string;
  project_id: number;
  app_id?: number | null;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  date: string;
  created_at: string;
}

export interface ManualSessionWithProject {
  id: number;
  title: string;
  session_type: string;
  project_id: number;
  app_id?: number | null;
  project_name: string;
  project_color: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  date: string;
}

export interface ExportArchive {
  version: string;
  exported_at: string;
  machine_id: string;
  export_type: "single_project" | "all_data";
  date_range: DateRange;
  metadata: {
    project_id?: number;
    project_name?: string;
    total_sessions: number;
    total_seconds: number;
  };
  data: {
    projects: Project[];
    applications: Application[];
    sessions: Session[];
    manual_sessions: ManualSession[];
    daily_files: Record<string, unknown>;
    tombstones?: Array<{
      table_name: string;
      record_id?: number | null;
      record_uuid?: string | null;
      deleted_at: string;
      sync_key?: string | null;
    }>;
  };
}

export interface ImportValidation {
  valid: boolean;
  missing_projects: string[];
  missing_applications: string[];
  overlapping_sessions: SessionConflict[];
}

export interface SessionConflict {
  app_name: string;
  start: string;
  end: string;
  existing_start: string;
  existing_end: string;
}

export interface ImportSummary {
  projects_created: number;
  apps_created: number;
  sessions_imported: number;
  sessions_merged: number;
  daily_files_imported: number;
}

export interface DbInfo {
  path: string;
  size_bytes: number;
}

export interface DatabaseSettings {
  vacuum_on_startup: boolean;
  backup_enabled: boolean;
  backup_path: string;
  backup_interval_days: number;
  last_backup_at: string | null;
}

export interface BackupFile {
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}
