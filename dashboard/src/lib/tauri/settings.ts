// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DemoModeStatus } from '../db-types';

export const clearAllData = () => invokeMutation<void>('clear_all_data');
export const getDataDir = () => invoke<string>('get_data_dir');
export const getDemoModeStatus = () =>
  invoke<DemoModeStatus>('get_demo_mode_status');
export const setDemoMode = (enabled: boolean) =>
  invokeMutation<DemoModeStatus>('set_demo_mode', { enabled });

export interface TimeAlgorithmInfo {
  /** Stable strategy id (persisted). */
  id: string;
  /** i18n key (or literal text for future plugins) for the display name. */
  name: string;
  /** i18n key (or literal text) for the description. */
  description: string;
  active: boolean;
}

export const listTimeAlgorithms = () =>
  invoke<TimeAlgorithmInfo[]>('list_time_algorithms');

export const getTimeAlgorithm = () => invoke<string>('get_time_algorithm');

export const setTimeAlgorithm = (algorithm: string) =>
  invokeMutation<void>('set_time_algorithm', { algorithm });

export const getSecureToken = () => invoke<string>('get_secure_token');

export const setSecureToken = (token: string) =>
  invoke<void>('set_secure_token', { token });

/** Shared UI-settings store (single source of truth in the data dir, read by
 *  both desktop and the LAN web UI). See lib/user-settings.ts. */
export const getAllUserSettings = () =>
  invoke<Record<string, unknown>>('get_all_user_settings');

export const setUserSetting = (key: string, value: unknown) =>
  invoke<void>('set_user_setting', { key, value });

/** True gdy backend obsługujący to wywołanie działa headless (instancja web UI)
 *  lub gdy to przeglądarka (routing przez serwer headless). Okno pulpitu => false. */
export const webuiIsHeadlessProcess = () =>
  invoke<boolean>('webui_is_headless_process');

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
  listTimeAlgorithms,
  getTimeAlgorithm,
  setTimeAlgorithm,
  getSecureToken,
  setSecureToken,
  getAllUserSettings,
  setUserSetting,
  webuiIsHeadlessProcess,
  persistLanguageForDaemon,
  persistSessionSettingsForDaemon,
  persistLanSyncSettingsForDaemon,
} as const;
