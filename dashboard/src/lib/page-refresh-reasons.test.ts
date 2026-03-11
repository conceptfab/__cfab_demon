import { describe, expect, it } from 'vitest';
import {
  shouldRefreshApplicationsPage,
  shouldRefreshDashboardPage,
  shouldRefreshEstimatesPage,
  shouldRefreshProjectPage,
  shouldRefreshProjectsCacheFromAppReason,
  shouldRefreshProjectsPageAllTime,
  shouldRefreshProjectsPageFolders,
  shouldRefreshSessionsPage,
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

  it('refreshes sessions only for session-related reasons and settings changes', () => {
    expect(shouldRefreshSessionsPage('update_session_comment')).toBe(true);
    expect(shouldRefreshSessionsPage('refresh_today')).toBe(true);
    expect(shouldRefreshSessionsPage('settings_saved')).toBe(true);
    expect(shouldRefreshSessionsPage('applications_changed')).toBe(false);
  });

  it('refreshes applications for app mutations and imported activity changes', () => {
    expect(shouldRefreshApplicationsPage('applications_changed')).toBe(true);
    expect(shouldRefreshApplicationsPage('rename_application')).toBe(true);
    expect(shouldRefreshApplicationsPage('background_sync_interval')).toBe(true);
    expect(shouldRefreshApplicationsPage('estimates_project_rate_updated')).toBe(false);
  });

  it('refreshes estimates for rate changes and project mutations', () => {
    expect(shouldRefreshEstimatesPage('update_global_hourly_rate')).toBe(true);
    expect(shouldRefreshEstimatesPage('update_project')).toBe(true);
    expect(shouldRefreshEstimatesPage('estimates_project_rate_updated')).toBe(true);
    expect(shouldRefreshEstimatesPage('applications_changed')).toBe(false);
  });

  it('refreshes project page for project metadata and session mutations', () => {
    expect(shouldRefreshProjectPage('update_project')).toBe(true);
    expect(shouldRefreshProjectPage('update_session_comment')).toBe(true);
    expect(shouldRefreshProjectPage('project_page_session_mutation')).toBe(true);
    expect(shouldRefreshProjectPage('applications_changed')).toBe(false);
  });
});
