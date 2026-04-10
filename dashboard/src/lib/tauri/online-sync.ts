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

export const triggerDaemonOnlineSync = () =>
  invokeMutation<string>('run_online_sync');

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
