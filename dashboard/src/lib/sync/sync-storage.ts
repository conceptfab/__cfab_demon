import type {
  OnlineSyncPendingAck,
  OnlineSyncSettings,
  OnlineSyncState,
  OnlineSyncStateEnvelope,
} from '@/lib/online-sync-types';

export const ONLINE_SYNC_SETTINGS_KEY = 'timeflow.settings.online-sync';
export const ONLINE_SYNC_STATE_KEY = 'timeflow.sync.state';
export const ONLINE_SYNC_STATE_STORAGE_VERSION = 2;
export const ONLINE_SYNC_SETTINGS_CHANGED_EVENT =
  'timeflow:online-sync-settings-changed';
export const LEGACY_ONLINE_SYNC_SETTINGS_KEY = 'cfab.settings.online-sync';
export const LEGACY_ONLINE_SYNC_STATE_KEY = 'cfab.sync.state';

export function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeServerUrl(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\/+$/, '');
}

export function normalizeApiToken(input: unknown): string {
  if (typeof input !== 'string') return '';
  let value = input.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (/^bearer\\s+/i.test(value)) {
    value = value.replace(/^bearer\\s+/i, '').trim();
  }

  return value;
}

export const DEFAULT_ONLINE_SYNC_SERVER_URL =
  normalizeServerUrl(import.meta.env.VITE_TIMEFLOW_SYNC_SERVER_URL) ||
  'https://cfabserver-production.up.railway.app';

export const DEFAULT_ONLINE_SYNC_SETTINGS: OnlineSyncSettings = {
  enabled: false,
  autoSyncOnStartup: true,
  autoSyncIntervalMinutes: 30,
  serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
  userId: '',
  apiToken: '',
  deviceId: '',
  requestTimeoutMs: 15_000,
  enableLogging: false,
};

export const DEFAULT_ONLINE_SYNC_STATE: OnlineSyncState = {
  serverRevision: 0,
  serverHash: null,
  localRevision: null,
  localHash: null,
  pendingAck: null,
  lastSyncAt: null,
  needsReseed: false,
};

export function normalizeAutoSyncIntervalMinutes(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return DEFAULT_ONLINE_SYNC_SETTINGS.autoSyncIntervalMinutes;
  }
  return Math.min(1440, Math.max(1, Math.round(input)));
}

export function normalizeNullableNumber(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null;
  return Math.floor(input);
}

export function normalizeNonNegativeInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return 0;
  return Math.max(0, Math.floor(input));
}

export function normalizeNullableString(input: unknown): string | null {
  return typeof input === 'string' ? input : null;
}

export function normalizeNonEmptyString(input: unknown): string | null {
  return typeof input === 'string' && input.trim().length > 0 ? input : null;
}

export function generateDeviceId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readJsonStorage<T>(key: string): Partial<T> | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return null;
  }
}

export function readJsonStorageWithFallback<T>(
  primaryKey: string,
  legacyKey: string,
): Partial<T> | null {
  return readJsonStorage<T>(primaryKey) ?? readJsonStorage<T>(legacyKey);
}

export function writeJsonStorage<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function emitOnlineSyncSettingsChanged(): void {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(ONLINE_SYNC_SETTINGS_CHANGED_EVENT));
}

export function normalizePendingAck(input: unknown): OnlineSyncPendingAck | null {
  if (!isRecord(input)) return null;
  const revision = normalizeNullableNumber(input.revision);
  const payloadSha256 = normalizeNonEmptyString(input.payloadSha256);
  const createdAt = normalizeNonEmptyString(input.createdAt);
  if (revision === null || payloadSha256 === null || createdAt === null) {
    return null;
  }

  const normalized: OnlineSyncPendingAck = {
    revision: Math.max(0, revision),
    payloadSha256,
    createdAt,
    retries: normalizeNonNegativeInteger(input.retries),
  };

  const lastError = normalizeNonEmptyString(input.lastError);
  if (lastError) {
    normalized.lastError = lastError;
  }

  return normalized;
}

export function normalizeOnlineSyncState(input: unknown): OnlineSyncState {
  const parsed = isRecord(input) ? input : { ...DEFAULT_ONLINE_SYNC_STATE };

  const serverRevisionRaw = normalizeNullableNumber(parsed.serverRevision);
  const serverRevision =
    serverRevisionRaw === null
      ? DEFAULT_ONLINE_SYNC_STATE.serverRevision
      : Math.max(0, serverRevisionRaw);
  const serverHash = normalizeNullableString(parsed.serverHash);

  let localRevision = normalizeNullableNumber(parsed.localRevision);
  let localHash = normalizeNullableString(parsed.localHash);

  if (localRevision === null && (serverRevision > 0 || serverHash !== null)) {
    localRevision = serverRevision;
  }
  if (localHash === null && serverHash !== null) {
    localHash = serverHash;
  }

  return {
    serverRevision,
    serverHash,
    localRevision,
    localHash,
    pendingAck: normalizePendingAck(parsed.pendingAck),
    lastSyncAt: normalizeNullableString(parsed.lastSyncAt),
    needsReseed: parsed.needsReseed === true,
  };
}

export function getOnlineSyncStateScopeKey(
  settings: OnlineSyncSettings,
): string {
  const userPart = settings.userId.trim() || '__no_user__';
  const devicePart = settings.deviceId.trim() || '__no_device__';
  return `${userPart}::${devicePart}`;
}

export function readOnlineSyncStateStorageRaw(): unknown {
  return readJsonStorageWithFallback<Record<string, unknown>>(
    ONLINE_SYNC_STATE_KEY,
    LEGACY_ONLINE_SYNC_STATE_KEY,
  ) as unknown;
}

export function readOnlineSyncStateEnvelope(): OnlineSyncStateEnvelope | null {
  const raw = readOnlineSyncStateStorageRaw();
  if (!isRecord(raw)) return null;
  if (raw.version !== ONLINE_SYNC_STATE_STORAGE_VERSION) return null;
  if (!isRecord(raw.scopes)) return null;

  const scopes: Record<string, Partial<OnlineSyncState>> = {};
  for (const [key, value] of Object.entries(raw.scopes)) {
    if (isRecord(value)) {
      scopes[key] = value as Partial<OnlineSyncState>;
    }
  }

  return {
    version: ONLINE_SYNC_STATE_STORAGE_VERSION,
    scopes,
  };
}
