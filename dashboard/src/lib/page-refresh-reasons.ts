import {
  shouldRefreshProjectsAllTime,
  shouldRefreshProjectsCache,
} from '@/lib/projects-all-time';

const BACKGROUND_SYNC_REASON_PREFIX = 'background_sync_';

const PROJECTS_PAGE_CORE_APP_REASON_SET = new Set([
  'applications_changed',
  'background_auto_import',
  'background_file_signature_changed',
  'background_local_data_changed',
  'settings_manual_sync_pull',
]);

const PROJECTS_PAGE_CORE_LOCAL_REASON_SET = new Set([
  'assign_app_to_project',
  'rename_application',
  'set_demo_mode',
]);

const PROJECTS_PAGE_FOLDERS_REASON_SET = new Set([
  'add_project_folder',
  'clear_all_data',
  'create_project_from_folder',
  'remove_project_folder',
  'restore_database_from_file',
  'set_demo_mode',
  'sync_projects_from_folders',
]);

const PROJECTS_PAGE_ALL_TIME_APP_REASON_SET = new Set([
  'background_auto_import',
  'background_file_signature_changed',
  'settings_manual_sync_pull',
]);

const DASHBOARD_APP_REASON_SET = new Set([
  'background_auto_import',
  'background_file_signature_changed',
  'background_local_data_changed',
  'dashboard_manual_refresh',
  'dashboard_manual_session_saved',
  'dashboard_session_mutation',
  'settings_manual_sync_pull',
  'settings_saved',
]);

const DASHBOARD_LOCAL_REASON_SET = new Set([
  'clear_all_data',
  'create_manual_session',
  'delete_app_and_data',
  'delete_manual_session',
  'delete_manual_sessions',
  'delete_session',
  'delete_sessions',
  'import_data',
  'import_json_files',
  'rebuild_sessions',
  'refresh_today',
  'restore_database_from_file',
  'set_demo_mode',
  'split_session_multi',
  'update_manual_session',
  'update_session_comment',
  'update_session_comments',
  'update_session_rate_multiplier',
  'update_session_rate_multipliers',
]);

function isBackgroundSyncReason(reason: string): boolean {
  return reason.startsWith(BACKGROUND_SYNC_REASON_PREFIX);
}

export function shouldRefreshProjectsCacheFromAppReason(reason: string): boolean {
  return (
    PROJECTS_PAGE_ALL_TIME_APP_REASON_SET.has(reason) ||
    isBackgroundSyncReason(reason)
  );
}

export function shouldRefreshProjectsPageCore(reason: string): boolean {
  return (
    shouldRefreshProjectsCache(reason) ||
    PROJECTS_PAGE_CORE_LOCAL_REASON_SET.has(reason) ||
    PROJECTS_PAGE_CORE_APP_REASON_SET.has(reason) ||
    isBackgroundSyncReason(reason)
  );
}

export function shouldRefreshProjectsPageFolders(reason: string): boolean {
  return PROJECTS_PAGE_FOLDERS_REASON_SET.has(reason);
}

export function shouldRefreshProjectsPageAllTime(reason: string): boolean {
  return (
    shouldRefreshProjectsAllTime(reason) ||
    PROJECTS_PAGE_ALL_TIME_APP_REASON_SET.has(reason) ||
    isBackgroundSyncReason(reason)
  );
}

export function shouldRefreshDashboardPage(reason: string): boolean {
  return (
    DASHBOARD_APP_REASON_SET.has(reason) ||
    DASHBOARD_LOCAL_REASON_SET.has(reason) ||
    shouldRefreshProjectsAllTime(reason) ||
    isBackgroundSyncReason(reason)
  );
}
