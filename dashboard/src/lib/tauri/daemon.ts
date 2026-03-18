import { invoke, invokeMutation } from './core';
import type {
  BackgroundDiagnostics,
  DaemonStatus,
  MonitoredApp,
  MonitoredAppsSyncResult,
  RefreshResult,
  TodayFileSignature,
} from '../db-types';

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

export const refreshToday = () =>
  invokeMutation<RefreshResult>('refresh_today', undefined, {
    notify: (result) => result.sessions_upserted > 0,
  });

export const getTodayFileSignature = () =>
  invoke<TodayFileSignature>('get_today_file_signature');

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
