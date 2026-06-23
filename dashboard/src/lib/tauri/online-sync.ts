// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { SyncProgress } from '@/lib/lan-sync-types';

export interface DaemonOnlineSyncSettings {
  enabled: boolean;
  server_url: string;
  auth_token: string;
  device_id: string;
  encryption_key: string;
  sync_interval_minutes: number;
  auto_sync_on_startup: boolean;
}

export const getDaemonOnlineSyncSettings = () =>
  invoke<DaemonOnlineSyncSettings>('get_online_sync_settings');

export const saveDaemonOnlineSyncSettings = (settings: DaemonOnlineSyncSettings) =>
  invokeMutation<void>('save_online_sync_settings', { settings });

/**
 * Wyzwól online sync przez demona.
 * - `background` (sync po starcie) → demon respektuje interwał (429 jeśli nie minął).
 * - `force` (manualny sync z UI: przycisk w panelu, „Sync now", retry) → omija interwał
 *   ORAZ cooldown po nieudanych próbach. Auto-wyzwalacze zostawiają `force=false`,
 *   żeby padający serwer nie wywołał retry stormu.
 */
export const triggerDaemonOnlineSync = (opts: { background?: boolean; force?: boolean } = {}) =>
  invokeMutation<string>('run_online_sync', {
    background: opts.background ?? false,
    force: opts.force ?? false,
  });

export const getDaemonOnlineSyncProgress = () =>
  invoke<SyncProgress>('get_online_sync_progress');

export const cancelDaemonOnlineSync = () =>
  invokeMutation<void>('cancel_online_sync');

export const daemonOnlineSyncApi = {
  getDaemonOnlineSyncSettings,
  saveDaemonOnlineSyncSettings,
  triggerDaemonOnlineSync,
  getDaemonOnlineSyncProgress,
  cancelDaemonOnlineSync,
} as const;
