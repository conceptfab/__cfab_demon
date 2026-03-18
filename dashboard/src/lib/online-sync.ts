import type {
  OnlineSyncSettings,
  OnlineSyncState,
} from '@/lib/online-sync-types';
export type {
  OnlineSyncIndicatorSnapshot,
  OnlineSyncIndicatorStatus,
  OnlineSyncPendingAck,
  OnlineSyncRunResult,
  OnlineSyncSettings,
  OnlineSyncState,
  RunOnlineSyncOptions,
} from '@/lib/online-sync-types';
export {
  DEFAULT_ONLINE_SYNC_SERVER_URL,
  ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
} from '@/lib/sync/sync-storage';
export {
  loadOnlineSyncSettings,
  loadOnlineSyncState,
  loadSecureApiToken,
} from '@/lib/sync/sync-state';
export {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
} from '@/lib/sync/sync-indicator';
export { runOnlineSyncOnce } from '@/lib/sync/sync-runner';

import { refreshIndicatorFromStorage } from '@/lib/sync/sync-indicator';
import {
  saveOnlineSyncSettingsRaw,
  saveOnlineSyncStateRaw,
} from '@/lib/sync/sync-state';

export function saveOnlineSyncSettings(
  next: Partial<OnlineSyncSettings>,
): OnlineSyncSettings {
  const saved = saveOnlineSyncSettingsRaw(next);
  refreshIndicatorFromStorage();
  return saved;
}

export function saveOnlineSyncState(
  next: OnlineSyncState,
  settings?: OnlineSyncSettings,
): OnlineSyncState {
  const saved = saveOnlineSyncStateRaw(next, settings);
  refreshIndicatorFromStorage();
  return saved;
}
