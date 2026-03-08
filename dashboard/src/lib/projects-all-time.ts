import type { EstimateProjectRow } from '@/lib/db-types';

const PROJECTS_ALL_TIME_REFRESH_REASON_SET = new Set([
  'assign_session_to_project',
  'clear_all_data',
  'compact_project_data',
  'create_manual_session',
  'delete_app_and_data',
  'delete_manual_session',
  'delete_session',
  'import_data',
  'import_json_files',
  'refresh_today',
  'reset_app_time',
  'reset_project_time',
  'restore_database_from_file',
  'set_demo_mode',
  'split_session_multi',
  'update_manual_session',
  'update_session_rate_multiplier',
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

export function shouldRefreshProjectsAllTime(reason: string): boolean {
  return PROJECTS_ALL_TIME_REFRESH_REASON_SET.has(reason);
}

export function shouldInvalidateProjectExtraInfo(reason: string): boolean {
  return PROJECTS_EXTRA_INFO_INVALIDATION_REASON_SET.has(reason);
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
