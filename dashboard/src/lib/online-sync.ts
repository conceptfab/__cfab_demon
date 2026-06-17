import type {
  LicenseActivationResult,
  LicenseInfo,
  OnlineSyncSettings,
} from '@/lib/online-sync-types';
export type {
  LicenseActivationResult,
  LicenseInfo,
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

import { refreshIndicatorFromStorage } from '@/lib/sync/sync-indicator';
import {
  saveOnlineSyncSettingsRaw,
} from '@/lib/sync/sync-state';

export function saveOnlineSyncSettings(
  next: Partial<OnlineSyncSettings>,
): OnlineSyncSettings {
  const saved = saveOnlineSyncSettingsRaw(next);
  refreshIndicatorFromStorage();
  return saved;
}

// ---------------------------------------------------------------------------
// License activation
// ---------------------------------------------------------------------------

const LICENSE_INFO_KEY = 'timeflow.license.info';

export function loadLicenseInfo(): LicenseInfo | null {
  try {
    const raw = window.localStorage.getItem(LICENSE_INFO_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseInfo;
  } catch {
    return null;
  }
}

export function saveLicenseInfo(info: LicenseInfo): void {
  window.localStorage.setItem(LICENSE_INFO_KEY, JSON.stringify(info));
}

export function clearLicenseInfo(): void {
  window.localStorage.removeItem(LICENSE_INFO_KEY);
}

export async function activateLicense(
  serverUrl: string,
  licenseKey: string,
  deviceId: string,
  deviceName: string,
): Promise<LicenseActivationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${serverUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, deviceId, deviceName }),
      signal: controller.signal,
    });
    const json = (await response.json()) as LicenseActivationResult;
    return json;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
