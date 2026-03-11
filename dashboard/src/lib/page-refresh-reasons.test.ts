import { describe, expect, it } from 'vitest';
import {
  shouldRefreshDashboardPage,
  shouldRefreshProjectsCacheFromAppReason,
  shouldRefreshProjectsPageAllTime,
  shouldRefreshProjectsPageFolders,
} from '@/lib/page-refresh-reasons';

describe('page refresh reason helpers', () => {
  it('refreshes projects cache for startup import and background sync reasons', () => {
    expect(shouldRefreshProjectsCacheFromAppReason('background_auto_import')).toBe(true);
    expect(shouldRefreshProjectsCacheFromAppReason('background_sync_interval')).toBe(true);
    expect(shouldRefreshProjectsCacheFromAppReason('settings_saved')).toBe(false);
  });

  it('refreshes project folders only for folder-related reasons', () => {
    expect(shouldRefreshProjectsPageFolders('sync_projects_from_folders')).toBe(true);
    expect(shouldRefreshProjectsPageFolders('add_project_folder')).toBe(true);
    expect(shouldRefreshProjectsPageFolders('background_auto_import')).toBe(false);
  });

  it('refreshes project all-time side panels for all-time and sync reasons', () => {
    expect(shouldRefreshProjectsPageAllTime('refresh_today')).toBe(true);
    expect(shouldRefreshProjectsPageAllTime('background_sync_local_change')).toBe(true);
    expect(shouldRefreshProjectsPageAllTime('settings_saved')).toBe(false);
  });

  it('refreshes dashboard for data mutations and manual refresh signals', () => {
    expect(shouldRefreshDashboardPage('dashboard_manual_refresh')).toBe(true);
    expect(shouldRefreshDashboardPage('update_session_comment')).toBe(true);
    expect(shouldRefreshDashboardPage('settings_saved')).toBe(true);
    expect(shouldRefreshDashboardPage('applications_changed')).toBe(false);
  });
});
