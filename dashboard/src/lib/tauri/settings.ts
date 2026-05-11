// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DemoModeStatus } from '../db-types';

export const clearAllData = () => invokeMutation<void>('clear_all_data');
export const getDataDir = () => invoke<string>('get_data_dir');
export const getDemoModeStatus = () =>
  invoke<DemoModeStatus>('get_demo_mode_status');
export const setDemoMode = (enabled: boolean) =>
  invokeMutation<DemoModeStatus>('set_demo_mode', { enabled });

export const getSecureToken = () => invoke<string>('get_secure_token');

export const setSecureToken = (token: string) =>
  invoke<void>('set_secure_token', { token });

export const persistLanguageForDaemon = (code: string) =>
  invoke<void>('persist_language_for_daemon', { code });

export const persistSessionSettingsForDaemon = (
  minSessionDurationSeconds: number,
) =>
  invoke<void>('persist_session_settings_for_daemon', {
    minSessionDurationSeconds,
  });

export const persistLanSyncSettingsForDaemon = (
  syncIntervalHours: number,
  discoveryDurationMinutes: number,
  enabled: boolean,
  forcedRole?: string,
  autoSyncOnPeerFound?: boolean,
) =>
  invoke<void>('persist_lan_sync_settings_for_daemon', {
    syncIntervalHours,
    discoveryDurationMinutes,
    enabled,
    forcedRole: forcedRole || '',
    autoSyncOnPeerFound: autoSyncOnPeerFound ?? false,
  });

export const settingsApi = {
  clearAllData,
  getDataDir,
  getDemoModeStatus,
  setDemoMode,
  getSecureToken,
  setSecureToken,
  persistLanguageForDaemon,
  persistSessionSettingsForDaemon,
  persistLanSyncSettingsForDaemon,
} as const;
