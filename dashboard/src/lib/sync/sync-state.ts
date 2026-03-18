import { getSecureToken, setSecureToken } from '@/lib/tauri';
import type {
  OnlineSyncSettings,
  OnlineSyncState,
} from '@/lib/online-sync-types';
import {
  DEFAULT_ONLINE_SYNC_SETTINGS,
  emitOnlineSyncSettingsChanged,
  generateDeviceId,
  getOnlineSyncStateScopeKey,
  hasWindow,
  LEGACY_ONLINE_SYNC_SETTINGS_KEY,
  LEGACY_ONLINE_SYNC_STATE_KEY,
  normalizeApiToken,
  normalizeAutoSyncIntervalMinutes,
  normalizeOnlineSyncState,
  normalizeServerUrl,
  ONLINE_SYNC_SETTINGS_KEY,
  ONLINE_SYNC_STATE_KEY,
  ONLINE_SYNC_STATE_STORAGE_VERSION,
  readJsonStorage,
  readJsonStorageWithFallback,
  readOnlineSyncStateEnvelope,
  readOnlineSyncStateStorageRaw,
  writeJsonStorage,
} from '@/lib/sync/sync-storage';

export function loadOnlineSyncSettings(): OnlineSyncSettings {
  const parsed = readJsonStorageWithFallback<OnlineSyncSettings>(
    ONLINE_SYNC_SETTINGS_KEY,
    LEGACY_ONLINE_SYNC_SETTINGS_KEY,
  );
  const existingDeviceId =
    typeof parsed?.deviceId === 'string' && parsed.deviceId.trim()
      ? parsed.deviceId.trim()
      : null;
  const deviceId = existingDeviceId ?? generateDeviceId();

  const legacyToken = normalizeApiToken(parsed?.apiToken);
  if (legacyToken) {
    setSecureToken(legacyToken)
      .then(() => {
        const raw = readJsonStorage<OnlineSyncSettings>(
          ONLINE_SYNC_SETTINGS_KEY,
        );
        if (raw && 'apiToken' in raw) {
          delete (raw as Record<string, unknown>).apiToken;
          writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, raw);
        }
      })
      .catch(() => {
        // Migration failed silently — token stays in localStorage until next attempt.
      });
  }

  const normalized: OnlineSyncSettings = {
    enabled:
      typeof parsed?.enabled === 'boolean'
        ? parsed.enabled
        : DEFAULT_ONLINE_SYNC_SETTINGS.enabled,
    autoSyncOnStartup:
      typeof parsed?.autoSyncOnStartup === 'boolean'
        ? parsed.autoSyncOnStartup
        : DEFAULT_ONLINE_SYNC_SETTINGS.autoSyncOnStartup,
    autoSyncIntervalMinutes: normalizeAutoSyncIntervalMinutes(
      parsed?.autoSyncIntervalMinutes,
    ),
    serverUrl:
      normalizeServerUrl(parsed?.serverUrl) ||
      DEFAULT_ONLINE_SYNC_SETTINGS.serverUrl,
    userId: typeof parsed?.userId === 'string' ? parsed.userId.trim() : '',
    apiToken: '',
    deviceId,
    requestTimeoutMs:
      typeof parsed?.requestTimeoutMs === 'number' &&
      Number.isFinite(parsed.requestTimeoutMs)
        ? Math.min(60_000, Math.max(3_000, Math.round(parsed.requestTimeoutMs)))
        : DEFAULT_ONLINE_SYNC_SETTINGS.requestTimeoutMs,
    enableLogging:
      typeof parsed?.enableLogging === 'boolean'
        ? parsed.enableLogging
        : DEFAULT_ONLINE_SYNC_SETTINGS.enableLogging,
  };

  if (!existingDeviceId) {
    writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, normalized);
  }
  return normalized;
}

export async function loadSecureApiToken(): Promise<string> {
  try {
    return await getSecureToken();
  } catch {
    return '';
  }
}

export function saveOnlineSyncSettingsRaw(
  next: Partial<OnlineSyncSettings>,
): OnlineSyncSettings {
  if (next.apiToken !== undefined) {
    const tokenToStore = normalizeApiToken(next.apiToken);
    setSecureToken(tokenToStore).catch(() => {
      console.warn(
        '[online-sync] Failed to persist API token to secure storage',
      );
    });
  }

  const current = loadOnlineSyncSettings();
  const merged: OnlineSyncSettings = {
    ...current,
    ...next,
    autoSyncIntervalMinutes: normalizeAutoSyncIntervalMinutes(
      next.autoSyncIntervalMinutes ?? current.autoSyncIntervalMinutes,
    ),
    serverUrl:
      normalizeServerUrl(next.serverUrl ?? current.serverUrl) ||
      DEFAULT_ONLINE_SYNC_SETTINGS.serverUrl,
    userId:
      typeof (next.userId ?? current.userId) === 'string'
        ? String(next.userId ?? current.userId).trim()
        : current.userId,
    apiToken: '',
    deviceId:
      typeof (next.deviceId ?? current.deviceId) === 'string' &&
      String(next.deviceId ?? current.deviceId).trim()
        ? String(next.deviceId ?? current.deviceId).trim()
        : current.deviceId,
    requestTimeoutMs:
      typeof (next.requestTimeoutMs ?? current.requestTimeoutMs) === 'number'
        ? Math.min(
            60_000,
            Math.max(
              3_000,
              Math.round(
                Number(next.requestTimeoutMs ?? current.requestTimeoutMs),
              ),
            ),
          )
        : current.requestTimeoutMs,
    enableLogging:
      typeof (next.enableLogging ?? current.enableLogging) === 'boolean'
        ? (next.enableLogging ?? current.enableLogging)
        : DEFAULT_ONLINE_SYNC_SETTINGS.enableLogging,
  };
  writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, merged);
  if (hasWindow()) {
    window.localStorage.removeItem(LEGACY_ONLINE_SYNC_SETTINGS_KEY);
  }
  emitOnlineSyncSettingsChanged();
  return merged;
}

export function loadOnlineSyncState(
  settings: OnlineSyncSettings = loadOnlineSyncSettings(),
): OnlineSyncState {
  const scopeKey = getOnlineSyncStateScopeKey(settings);
  const envelope = readOnlineSyncStateEnvelope();
  if (envelope) {
    return normalizeOnlineSyncState(envelope.scopes[scopeKey]);
  }

  return normalizeOnlineSyncState(readOnlineSyncStateStorageRaw());
}

export function saveOnlineSyncStateRaw(
  next: OnlineSyncState,
  settings: OnlineSyncSettings = loadOnlineSyncSettings(),
): OnlineSyncState {
  const normalized = normalizeOnlineSyncState(next);
  const scopeKey = getOnlineSyncStateScopeKey(settings);
  const envelope = readOnlineSyncStateEnvelope() ?? {
    version: ONLINE_SYNC_STATE_STORAGE_VERSION,
    scopes: {},
  };

  envelope.scopes[scopeKey] = normalized;
  writeJsonStorage(ONLINE_SYNC_STATE_KEY, envelope);
  if (hasWindow()) {
    window.localStorage.removeItem(LEGACY_ONLINE_SYNC_STATE_KEY);
  }
  return normalized;
}
