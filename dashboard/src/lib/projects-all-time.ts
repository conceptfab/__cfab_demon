import type { EstimateProjectRow } from '@/lib/db-types';

const PROJECTS_ALL_TIME_REFRESH_REASON_SET = new Set([
  'apply_deterministic_assignment',
  'assign_session_to_project',
  'assign_sessions_to_project',
  'auto_create_projects_from_detection',
  'auto_run_if_needed',
  'clear_all_data',
  'compact_project_data',
  'create_manual_session',
  'daemon_sync_finished',
  'delete_manual_sessions',
  'delete_app_and_data',
  'delete_sessions',
  'delete_manual_session',
  'delete_session',
  'import_data',
  'import_json_files',
  'lan_sync_pull',
  'refresh_today',
  'rebuild_sessions',
  'reset_app_time',
  'reset_project_time',
  'restore_database_from_file',
  'run_auto_safe_assignment',
  'set_demo_mode',
  'split_session_multi',
  'sse_sync_pull',
  'update_manual_session',
  'update_session_rate_multiplier',
  'update_session_rate_multipliers',
]);

const PROJECTS_EXTRA_INFO_INVALIDATION_REASON_SET = new Set([
  ...PROJECTS_ALL_TIME_REFRESH_REASON_SET,
  'create_project',
  'create_project_from_folder',
  'delete_project',
  'exclude_project',
  'freeze_project',
  'restore_project',
  'sync_projects_from_folders',
  'unfreeze_project',
]);

const PROJECTS_CACHE_REFRESH_REASON_SET = new Set([
  ...PROJECTS_EXTRA_INFO_INVALIDATION_REASON_SET,
  'update_project',
  'update_project_hourly_rate',
]);

export function shouldRefreshProjectsAllTime(reason: string): boolean {
  return PROJECTS_ALL_TIME_REFRESH_REASON_SET.has(reason);
}

export function shouldInvalidateProjectExtraInfo(reason: string): boolean {
  return PROJECTS_EXTRA_INFO_INVALIDATION_REASON_SET.has(reason);
}

export function shouldRefreshProjectsCache(reason: string): boolean {
  return PROJECTS_CACHE_REFRESH_REASON_SET.has(reason);
}

export function buildEstimateMap(
  rows: EstimateProjectRow[],
): Record<number, number> {
  const map: Record<number, number> = {};
  rows.forEach((row) => {
    map[row.project_id] = row.estimated_value;
  });
  return map;
}
