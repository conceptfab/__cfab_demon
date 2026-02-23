import type { ExportArchive, ImportSummary } from "@/lib/db-types";
import { appendSyncLog, exportDataArchive, getDemoModeStatus, importDataArchive } from "@/lib/tauri";

const ONLINE_SYNC_SETTINGS_KEY = "timeflow.settings.online-sync";
const ONLINE_SYNC_STATE_KEY = "timeflow.sync.state";
const ONLINE_SYNC_STATE_STORAGE_VERSION = 2;
export const ONLINE_SYNC_SETTINGS_CHANGED_EVENT = "timeflow:online-sync-settings-changed";
const LEGACY_ONLINE_SYNC_SETTINGS_KEY = "cfab.settings.online-sync";
const LEGACY_ONLINE_SYNC_STATE_KEY = "cfab.sync.state";
const LEGACY_ONLINE_SYNC_SETTINGS_CHANGED_EVENT = "cfab:online-sync-settings-changed";
const LEGACY_DEFAULT_ONLINE_SYNC_SERVER_URL = "https://cfabserver-production.up.railway.app";
const PLACEHOLDER_TIMEFLOW_ONLINE_SYNC_SERVER_URL =
  "https://timeflowserver-production.up.railway.app";
export const DEFAULT_ONLINE_SYNC_SERVER_URL =
  PLACEHOLDER_TIMEFLOW_ONLINE_SYNC_SERVER_URL;

export interface OnlineSyncSettings {
  enabled: boolean;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  serverUrl: string;
  userId: string;
  apiToken: string;
  deviceId: string;
  requestTimeoutMs: number;
  enableLogging: boolean;
}

export interface OnlineSyncPendingAck {
  revision: number;
  payloadSha256: string;
  createdAt: string;
  retries: number;
  lastError?: string;
}

export interface OnlineSyncState {
  serverRevision: number;
  serverHash: string | null;
  localRevision: number | null;
  localHash: string | null;
  pendingAck: OnlineSyncPendingAck | null;
  lastSyncAt: string | null;
  needsReseed: boolean;
}

export interface OnlineSyncRunResult {
  ok: boolean;
  skipped?: boolean;
  action: "none" | "push" | "pull" | "noop";
  reason: string;
  serverRevision: number | null;
  importSummary?: ImportSummary;
  error?: string;
  ackAccepted?: boolean;
  ackPending?: boolean;
  ackReason?: string | null;
  ackIsLatest?: boolean | null;
  needsReseed?: boolean;
}

export interface RunOnlineSyncOptions {
  ignoreStartupToggle?: boolean;
}

export type OnlineSyncIndicatorStatus =
  | "disabled"
  | "unconfigured"
  | "idle"
  | "syncing"
  | "success"
  | "warning"
  | "error";

export interface OnlineSyncIndicatorSnapshot {
  status: OnlineSyncIndicatorStatus;
  label: string;
  detail: string;
  serverRevision: number;
  serverHash: string | null;
  lastSyncAt: string | null;
  lastAction: OnlineSyncRunResult["action"] | null;
  lastReason: string | null;
  error: string | null;
  pendingAck: OnlineSyncPendingAck | null;
  needsReseed: boolean;
}

interface SyncStatusResponse {
  ok: true;
  serverRevision: number;
  serverHash: string | null;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
}

interface SyncPushResponse {
  ok: true;
  accepted?: boolean;
  noOp: boolean;
  revision: number;
  payloadSha256: string;
  receivedAt?: string;
  reason: string;
}

interface SyncPullResponse {
  ok: true;
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: ExportArchive;
  reason: string;
}

interface SyncAckResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  payloadSha256: string;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}

interface OnlineSyncStateEnvelope {
  version: number;
  scopes: Record<string, Partial<OnlineSyncState>>;
}

interface LocalDatasetState {
  exportOk: boolean;
  hasReseedData: boolean;
  revision: number | null;
  payloadSha256: string | null;
  archive: ExportArchive | null;
  exportError?: string;
}

interface FlushPendingAckResult {
  attempted: boolean;
  accepted: boolean;
  pendingRemains: boolean;
  reason: string;
  response?: SyncAckResponse;
  error?: string;
}

type SyncHttpErrorKind = "timeout" | "network" | "http" | "invalid_json" | "unknown";

class SyncHttpError extends Error {
  readonly kind: SyncHttpErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: SyncHttpErrorKind, status: number | null = null) {
    super(message);
    this.name = "SyncHttpError";
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_ONLINE_SYNC_SETTINGS: OnlineSyncSettings = {
  enabled: false,
  autoSyncOnStartup: true,
  autoSyncIntervalMinutes: 30,
  serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
  userId: "",
  apiToken: "",
  deviceId: "",
  requestTimeoutMs: 15_000,
  enableLogging: false,
};

const DEFAULT_ONLINE_SYNC_STATE: OnlineSyncState = {
  serverRevision: 0,
  serverHash: null,
  localRevision: null,
  localHash: null,
  pendingAck: null,
  lastSyncAt: null,
  needsReseed: false,
};

type OnlineSyncStatusListener = (snapshot: OnlineSyncIndicatorSnapshot) => void;

const onlineSyncStatusListeners = new Set<OnlineSyncStatusListener>();
let onlineSyncIndicatorSnapshotCache: OnlineSyncIndicatorSnapshot | null = null;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeServerUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const normalized = input.trim().replace(/\/+$/, "");
  // Compatibility: early TimeFlow rebrand builds used a placeholder host before DNS/deploy was ready.
  if (normalized === PLACEHOLDER_TIMEFLOW_ONLINE_SYNC_SERVER_URL) {
    return LEGACY_DEFAULT_ONLINE_SYNC_SERVER_URL;
  }
  return normalized;
}

function normalizeApiToken(input: unknown): string {
  if (typeof input !== "string") return "";
  let value = input.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (/^bearer\s+/i.test(value)) {
    value = value.replace(/^bearer\s+/i, "").trim();
  }

  return value;
}

function normalizeAutoSyncIntervalMinutes(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DEFAULT_ONLINE_SYNC_SETTINGS.autoSyncIntervalMinutes;
  }
  return Math.min(1440, Math.max(1, Math.round(input)));
}

function normalizeNullableNumber(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  return Math.floor(input);
}

function normalizeNonNegativeInteger(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return 0;
  return Math.max(0, Math.floor(input));
}

function normalizeNullableString(input: unknown): string | null {
  return typeof input === "string" ? input : null;
}

function normalizeNonEmptyString(input: unknown): string | null {
  return typeof input === "string" && input.trim().length > 0 ? input : null;
}

function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJsonStorage<T>(key: string): Partial<T> | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return null;
  }
}

function readJsonStorageWithFallback<T>(primaryKey: string, legacyKey: string): Partial<T> | null {
  return readJsonStorage<T>(primaryKey) ?? readJsonStorage<T>(legacyKey);
}

function writeJsonStorage<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emitOnlineSyncSettingsChanged(): void {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(ONLINE_SYNC_SETTINGS_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent(LEGACY_ONLINE_SYNC_SETTINGS_CHANGED_EVENT));
}

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}...` : "n/a";
}

function createDefaultOnlineSyncState(): OnlineSyncState {
  return {
    serverRevision: DEFAULT_ONLINE_SYNC_STATE.serverRevision,
    serverHash: DEFAULT_ONLINE_SYNC_STATE.serverHash,
    localRevision: DEFAULT_ONLINE_SYNC_STATE.localRevision,
    localHash: DEFAULT_ONLINE_SYNC_STATE.localHash,
    pendingAck: DEFAULT_ONLINE_SYNC_STATE.pendingAck,
    lastSyncAt: DEFAULT_ONLINE_SYNC_STATE.lastSyncAt,
    needsReseed: DEFAULT_ONLINE_SYNC_STATE.needsReseed,
  };
}

function normalizePendingAck(input: unknown): OnlineSyncPendingAck | null {
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

function normalizeOnlineSyncState(input: unknown): OnlineSyncState {
  const parsed = isRecord(input) ? input : createDefaultOnlineSyncState();

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

function getOnlineSyncStateScopeKey(settings: OnlineSyncSettings): string {
  const userPart = settings.userId.trim() || "__no_user__";
  const devicePart = settings.deviceId.trim() || "__no_device__";
  return `${userPart}::${devicePart}`;
}

function readOnlineSyncStateStorageRaw(): unknown {
  return readJsonStorageWithFallback<Record<string, unknown>>(
    ONLINE_SYNC_STATE_KEY,
    LEGACY_ONLINE_SYNC_STATE_KEY,
  ) as unknown;
}

function readOnlineSyncStateEnvelope(): OnlineSyncStateEnvelope | null {
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

function formatLastSyncDetail(state: OnlineSyncState): string {
  if (!state.lastSyncAt) return "No sync yet";
  const timestamp = new Date(state.lastSyncAt);
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? state.lastSyncAt
    : timestamp.toLocaleTimeString();
  return `Last sync ${timeLabel} • r${state.serverRevision} • ${shortHash(state.serverHash)}`;
}

function formatPendingAckDetail(state: OnlineSyncState): string {
  if (!state.pendingAck) return "ACK pending";
  const pending = state.pendingAck;
  const retryPart = pending.retries > 0 ? ` • retries ${pending.retries}` : "";
  return `Downloaded r${pending.revision}, waiting for ACK${retryPart}`;
}

function buildIndicatorSnapshotFromStorage(): OnlineSyncIndicatorSnapshot {
  const settings = loadOnlineSyncSettings();
  const state = loadOnlineSyncState(settings);

  if (!settings.enabled) {
    return {
      status: "disabled",
      label: "Sync Off",
      detail: "Online sync disabled",
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: null,
      lastReason: null,
      error: null,
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    };
  }

  if (!settings.serverUrl || !settings.userId) {
    return {
      status: "unconfigured",
      label: "Sync Setup",
      detail: "Configure server URL and user ID",
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: null,
      lastReason: null,
      error: null,
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    };
  }

  if (state.needsReseed) {
    return {
      status: "error",
      label: "Reseed Required",
      detail: "Server payload was cleaned up and local reseed data is unavailable",
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: null,
      lastReason: "server_snapshot_pruned",
      error: "server_snapshot_pruned",
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    };
  }

  if (state.pendingAck) {
    return {
      status: "warning",
      label: "ACK Pending",
      detail: formatPendingAckDetail(state),
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: null,
      lastReason: "pending_ack",
      error: null,
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    };
  }

  return {
    status: "idle",
    label: "Sync Ready",
    detail: formatLastSyncDetail(state),
    serverRevision: state.serverRevision,
    serverHash: state.serverHash,
    lastSyncAt: state.lastSyncAt,
    lastAction: null,
    lastReason: null,
    error: null,
    pendingAck: state.pendingAck,
    needsReseed: state.needsReseed,
  };
}

function emitOnlineSyncIndicatorSnapshot(snapshot: OnlineSyncIndicatorSnapshot): void {
  onlineSyncIndicatorSnapshotCache = snapshot;
  for (const listener of onlineSyncStatusListeners) {
    listener(snapshot);
  }
}

function refreshIndicatorFromStorage(): void {
  emitOnlineSyncIndicatorSnapshot(buildIndicatorSnapshotFromStorage());
}

function updateIndicatorFromRunResult(result: OnlineSyncRunResult): void {
  const state = loadOnlineSyncState();

  if (result.skipped) {
    if (result.reason === "demo_mode") {
      emitOnlineSyncIndicatorSnapshot({
        status: "disabled",
        label: "Sync Off (Demo)",
        detail: "Online sync is disabled while Demo Mode is active",
        serverRevision: state.serverRevision,
        serverHash: state.serverHash,
        lastSyncAt: state.lastSyncAt,
        lastAction: result.action,
        lastReason: result.reason,
        error: null,
        pendingAck: state.pendingAck,
        needsReseed: state.needsReseed,
      });
      return;
    }

    refreshIndicatorFromStorage();
    return;
  }

  if (!result.ok) {
    emitOnlineSyncIndicatorSnapshot({
      status: "error",
      label: result.needsReseed || state.needsReseed ? "Reseed Required" : "Sync Error",
      detail: result.error ?? result.reason,
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: result.action,
      lastReason: result.reason,
      error: result.error ?? result.reason,
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    });
    return;
  }

  if (result.ackPending || state.pendingAck) {
    emitOnlineSyncIndicatorSnapshot({
      status: "warning",
      label: "ACK Pending",
      detail:
        result.ackReason && result.ackReason !== "ack_deferred"
          ? `Waiting for ACK retry (${result.ackReason})`
          : formatPendingAckDetail(state),
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: result.action,
      lastReason: result.reason,
      error: null,
      pendingAck: state.pendingAck,
      needsReseed: state.needsReseed,
    });
    return;
  }

  const labelMap: Record<OnlineSyncRunResult["action"], string> = {
    none: "Sync OK",
    noop: "Sync No-op",
    push: "Sync Pushed",
    pull: "Sync Pulled",
  };

  emitOnlineSyncIndicatorSnapshot({
    status: "success",
    label: labelMap[result.action],
    detail: formatLastSyncDetail(state),
    serverRevision: state.serverRevision,
    serverHash: state.serverHash,
    lastSyncAt: state.lastSyncAt,
    lastAction: result.action,
    lastReason: result.reason,
    error: null,
    pendingAck: state.pendingAck,
    needsReseed: state.needsReseed,
  });
}

export function getOnlineSyncIndicatorSnapshot(): OnlineSyncIndicatorSnapshot {
  if (!onlineSyncIndicatorSnapshotCache) {
    onlineSyncIndicatorSnapshotCache = buildIndicatorSnapshotFromStorage();
  }
  return onlineSyncIndicatorSnapshotCache;
}

export function subscribeOnlineSyncIndicator(
  listener: OnlineSyncStatusListener,
): () => void {
  onlineSyncStatusListeners.add(listener);
  listener(getOnlineSyncIndicatorSnapshot());
  return () => {
    onlineSyncStatusListeners.delete(listener);
  };
}

export function loadOnlineSyncSettings(): OnlineSyncSettings {
  const parsed = readJsonStorageWithFallback<OnlineSyncSettings>(
    ONLINE_SYNC_SETTINGS_KEY,
    LEGACY_ONLINE_SYNC_SETTINGS_KEY,
  );
  const deviceId =
    typeof parsed?.deviceId === "string" && parsed.deviceId.trim()
      ? parsed.deviceId.trim()
      : generateDeviceId();

  const normalized: OnlineSyncSettings = {
    enabled: typeof parsed?.enabled === "boolean" ? parsed.enabled : DEFAULT_ONLINE_SYNC_SETTINGS.enabled,
    autoSyncOnStartup:
      typeof parsed?.autoSyncOnStartup === "boolean"
        ? parsed.autoSyncOnStartup
        : DEFAULT_ONLINE_SYNC_SETTINGS.autoSyncOnStartup,
    autoSyncIntervalMinutes: normalizeAutoSyncIntervalMinutes(parsed?.autoSyncIntervalMinutes),
    serverUrl:
      normalizeServerUrl(parsed?.serverUrl) || DEFAULT_ONLINE_SYNC_SETTINGS.serverUrl,
    userId: typeof parsed?.userId === "string" ? parsed.userId.trim() : "",
    apiToken: normalizeApiToken(parsed?.apiToken),
    deviceId,
    requestTimeoutMs:
      typeof parsed?.requestTimeoutMs === "number" && Number.isFinite(parsed.requestTimeoutMs)
        ? Math.min(60_000, Math.max(3_000, Math.round(parsed.requestTimeoutMs)))
        : DEFAULT_ONLINE_SYNC_SETTINGS.requestTimeoutMs,
    enableLogging: typeof parsed?.enableLogging === "boolean" ? parsed.enableLogging : DEFAULT_ONLINE_SYNC_SETTINGS.enableLogging,
  };

  // Persist generated device id even if sync is disabled, so the identifier is stable.
  writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, normalized);
  return normalized;
}

export function saveOnlineSyncSettings(next: Partial<OnlineSyncSettings>): OnlineSyncSettings {
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
    userId: typeof (next.userId ?? current.userId) === "string" ? String(next.userId ?? current.userId).trim() : current.userId,
    apiToken:
      typeof (next.apiToken ?? current.apiToken) === "string"
        ? normalizeApiToken(next.apiToken ?? current.apiToken)
        : current.apiToken,
    deviceId:
      typeof (next.deviceId ?? current.deviceId) === "string" && String(next.deviceId ?? current.deviceId).trim()
        ? String(next.deviceId ?? current.deviceId).trim()
        : current.deviceId,
    requestTimeoutMs:
      typeof (next.requestTimeoutMs ?? current.requestTimeoutMs) === "number"
        ? Math.min(60_000, Math.max(3_000, Math.round(Number(next.requestTimeoutMs ?? current.requestTimeoutMs))))
        : current.requestTimeoutMs,
    enableLogging: typeof (next.enableLogging ?? current.enableLogging) === "boolean" 
      ? next.enableLogging ?? current.enableLogging 
      : DEFAULT_ONLINE_SYNC_SETTINGS.enableLogging,
  };
  writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, merged);
  if (hasWindow()) {
    window.localStorage.removeItem(LEGACY_ONLINE_SYNC_SETTINGS_KEY);
  }
  emitOnlineSyncSettingsChanged();
  refreshIndicatorFromStorage();
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

  // Legacy single-state format fallback.
  return normalizeOnlineSyncState(readOnlineSyncStateStorageRaw());
}

export function saveOnlineSyncState(
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
  refreshIndicatorFromStorage();
  return normalized;
}

function extractErrorMessageFromJson(json: unknown, fallbackStatus: number): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof (json as { error?: unknown }).error === "string"
  ) {
    return (json as { error: string }).error;
  }
  return `HTTP ${fallbackStatus}`;
}

function normalizeRequestError(error: unknown): SyncHttpError {
  if (error instanceof SyncHttpError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new SyncHttpError("Request timeout", "timeout");
  }
  if (error instanceof TypeError) {
    return new SyncHttpError(error.message || "Network error", "network");
  }
  return new SyncHttpError(error instanceof Error ? error.message : String(error), "unknown");
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  apiToken?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiToken && apiToken.trim()) {
      headers.Authorization = `Bearer ${apiToken.trim()}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw normalizeRequestError(error);
    }

    const rawText = await response.text();
    let json: unknown = null;

    if (rawText.length > 0) {
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        if (!response.ok) {
          throw new SyncHttpError(`HTTP ${response.status}`, "http", response.status);
        }
        throw new SyncHttpError("Invalid JSON response", "invalid_json", response.status);
      }
    }

    if (!response.ok) {
      throw new SyncHttpError(
        extractErrorMessageFromJson(json, response.status),
        "http",
        response.status,
      );
    }

    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableAckError(error: unknown): boolean {
  const normalized = normalizeRequestError(error);
  if (normalized.kind === "timeout" || normalized.kind === "network") {
    return true;
  }
  return normalized.kind === "http" && normalized.status !== null && normalized.status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getAckTimeoutMs(requestTimeoutMs: number): number {
  return Math.min(10_000, Math.max(5_000, requestTimeoutMs));
}

async function postAckWithRetries(
  settings: OnlineSyncSettings,
  body: {
    userId: string;
    deviceId: string;
    revision: number;
    payloadSha256: string;
  },
): Promise<SyncAckResponse> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson<SyncAckResponse>(
        settings.serverUrl,
        "/api/sync/ack",
        body,
        getAckTimeoutMs(settings.requestTimeoutMs),
        settings.apiToken,
      );
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableAckError(error)) {
        throw error;
      }

      console.warn(
        `[online-sync] ACK transient failure (attempt ${attempt}/${maxAttempts}), retrying`,
        error instanceof Error ? error.message : String(error),
      );
      await delay(250 * attempt);
    }
  }

  throw new Error("ACK retry loop failed unexpectedly");
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API unavailable for sync hash");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function archiveHasReseedData(archive: ExportArchive): boolean {
  const sessions = Array.isArray(archive.data?.sessions) ? archive.data.sessions.length : 0;
  const manualSessions = Array.isArray(archive.data?.manual_sessions)
    ? archive.data.manual_sessions.length
    : 0;
  const projects = Array.isArray(archive.data?.projects) ? archive.data.projects.length : 0;
  const apps = Array.isArray(archive.data?.applications) ? archive.data.applications.length : 0;
  const dailyFiles =
    archive.data?.daily_files && typeof archive.data.daily_files === "object"
      ? Object.keys(archive.data.daily_files).length
      : 0;

  return sessions > 0 || manualSessions > 0 || projects > 0 || apps > 0 || dailyFiles > 0;
}

async function getLocalDatasetState(state: OnlineSyncState): Promise<LocalDatasetState> {
  try {
    const archive = await exportDataArchive();
    const payloadSha256 = await sha256Hex(JSON.stringify(archive));
    return {
      exportOk: true,
      hasReseedData: archiveHasReseedData(archive),
      revision: state.localRevision,
      payloadSha256,
      archive,
    };
  } catch (error) {
    return {
      exportOk: false,
      hasReseedData: false,
      revision: state.localRevision,
      payloadSha256: state.localHash,
      archive: null,
      exportError: error instanceof Error ? error.message : String(error),
    };
  }
}

function logSyncDiagnostic(
  stage: "status" | "pull" | "ack",
  details: Record<string, unknown>,
): void {
  console.info(`[online-sync] ${stage}`, details);
}

// ---------------------------------------------------------------------------
// File-based sync logger
// ---------------------------------------------------------------------------

class SyncFileLogger {
  private buffer: string[] = [];

  log(level: "INFO" | "WARN" | "ERROR", message: string, details?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] ${message}`;
    if (details && Object.keys(details).length > 0) {
      line += ` | ${JSON.stringify(details)}`;
    }
    this.buffer.push(line);
    // Also keep console logging for dev tools
    if (level === "ERROR") {
      console.error(`[sync-log] ${message}`, details ?? "");
    } else if (level === "WARN") {
      console.warn(`[sync-log] ${message}`, details ?? "");
    } else {
      console.info(`[sync-log] ${message}`, details ?? "");
    }
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log("INFO", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log("WARN", message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log("ERROR", message, details);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const lines = [...this.buffer];
    this.buffer = [];
    try {
      await appendSyncLog(lines);
    } catch {
      // If file logging fails, don't break the sync flow.
      console.warn("[sync-log] Failed to flush sync log to file");
    }
  }
}

async function isDemoModeSyncDisabled(): Promise<boolean> {
  try {
    const status = await getDemoModeStatus();
    return status.enabled === true;
  } catch {
    // When not running inside Tauri (e.g. plain web preview), fall back to normal behavior.
    return false;
  }
}

async function flushPendingAck(
  settings: OnlineSyncSettings,
  state: OnlineSyncState,
): Promise<FlushPendingAckResult> {
  if (!state.pendingAck) {
    return {
      attempted: false,
      accepted: false,
      pendingRemains: false,
      reason: "no_pending_ack",
    };
  }

  const pendingAck: OnlineSyncPendingAck = { ...state.pendingAck };

  try {
    const ackRes = await postAckWithRetries(settings, {
      userId: settings.userId,
      deviceId: settings.deviceId,
      revision: pendingAck.revision,
      payloadSha256: pendingAck.payloadSha256,
    });

    logSyncDiagnostic("ack", {
      reason: ackRes.reason,
      accepted: ackRes.accepted,
      isLatest: ackRes.isLatest,
    });

    state.serverRevision = Math.max(0, Math.floor(ackRes.serverRevision || 0));
    state.serverHash = ackRes.serverHash ?? null;

    if (ackRes.accepted === true) {
      state.pendingAck = null;
      saveOnlineSyncState(state, settings);
      return {
        attempted: true,
        accepted: true,
        pendingRemains: false,
        reason: ackRes.reason,
        response: ackRes,
      };
    }

    if (
      ackRes.reason === "unknown_revision" ||
      ackRes.reason === "hash_mismatch_for_revision"
    ) {
      state.pendingAck = null;
      saveOnlineSyncState(state, settings);
      return {
        attempted: true,
        accepted: false,
        pendingRemains: false,
        reason: ackRes.reason,
        response: ackRes,
      };
    }

    throw new Error(`ack rejected: ${ackRes.reason}`);
  } catch (error) {
    pendingAck.retries += 1;
    pendingAck.lastError = error instanceof Error ? error.message : String(error);
    state.pendingAck = pendingAck;
    saveOnlineSyncState(state, settings);
    return {
      attempted: true,
      accepted: false,
      pendingRemains: true,
      reason: "ack_deferred",
      error: pendingAck.lastError,
    };
  }
}

async function handleServerSnapshotPruned(
  settings: OnlineSyncSettings,
  state: OnlineSyncState,
  local: LocalDatasetState,
  statusRes: SyncStatusResponse,
): Promise<OnlineSyncRunResult> {
  if (local.archive && local.hasReseedData) {
    const push = await postJson<SyncPushResponse>(
      settings.serverUrl,
      "/api/sync/push",
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        knownServerRevision: statusRes.serverRevision ?? null,
        archive: local.archive,
      },
      settings.requestTimeoutMs,
      settings.apiToken,
    );

    if (push.accepted === false) {
      throw new Error("reseed push rejected after server_snapshot_pruned");
    }

    state.localRevision = push.revision;
    state.localHash = push.payloadSha256;
    state.serverRevision = push.revision;
    state.serverHash = push.payloadSha256;
    state.needsReseed = false;
    state.lastSyncAt = new Date().toISOString();
    saveOnlineSyncState(state, settings);

    return {
      ok: true,
      action: push.noOp ? "noop" : "push",
      reason: "server_snapshot_pruned_reseeded",
      serverRevision: push.revision,
      needsReseed: false,
    };
  }

  state.needsReseed = true;
  saveOnlineSyncState(state, settings);
  return {
    ok: false,
    action: "none",
    reason: "server_snapshot_pruned",
    serverRevision: statusRes.serverRevision ?? state.serverRevision,
    error:
      local.exportError ??
      "Server snapshot payload was pruned and no local data is available for reseed",
    needsReseed: true,
  };
}

export async function runOnlineSyncOnce(
  options: RunOnlineSyncOptions = {},
): Promise<OnlineSyncRunResult> {
  const settings = loadOnlineSyncSettings();
  const log = settings.enableLogging ? new SyncFileLogger() : null;

  log?.info("Sync started", { ignoreStartupToggle: options.ignoreStartupToggle ?? false });

  if (!settings.enabled) {
    log?.info("Sync skipped: disabled");
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "disabled",
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  if (!settings.serverUrl || !settings.userId) {
    log?.warn("Sync skipped: missing config", {
      hasServerUrl: Boolean(settings.serverUrl),
      hasUserId: Boolean(settings.userId),
    });
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "missing_config",
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  if (await isDemoModeSyncDisabled()) {
    log?.info("Sync skipped: demo mode");
    const state = loadOnlineSyncState(settings);
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "demo_mode",
      serverRevision: state.serverRevision,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  log?.info("Connecting to server", { serverUrl: settings.serverUrl, deviceId: settings.deviceId });

  emitOnlineSyncIndicatorSnapshot({
    ...getOnlineSyncIndicatorSnapshot(),
    status: "syncing",
    label: "Syncing...",
    detail: `Contacting ${settings.serverUrl || "server"}...`,
    error: null,
  });

  let state = loadOnlineSyncState(settings);

  try {
    // Retry durable ACK first, even if regular startup sync is disabled.
    log?.info("Flushing pending ACK", { hasPendingAck: state.pendingAck !== null });
    const pendingAckResult = await flushPendingAck(settings, state);
    log?.info("Pending ACK result", {
      attempted: pendingAckResult.attempted,
      accepted: pendingAckResult.accepted,
      pendingRemains: pendingAckResult.pendingRemains,
      reason: pendingAckResult.reason,
    });
    state = loadOnlineSyncState(settings);

    if (!options.ignoreStartupToggle && !settings.autoSyncOnStartup) {
      if (pendingAckResult.accepted) {
        state.lastSyncAt = new Date().toISOString();
        saveOnlineSyncState(state, settings);
      }

      log?.info("Sync skipped: startup sync disabled");
      const result: OnlineSyncRunResult = {
        ok: true,
        skipped: true,
        action: "none",
        reason: "startup_disabled",
        serverRevision: state.serverRevision,
      };
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    log?.info("Exporting local dataset");
    const local = await getLocalDatasetState(state);
    log?.info("Local dataset state", {
      exportOk: local.exportOk,
      hasArchive: local.archive !== null,
      revision: local.revision,
      hash: local.payloadSha256?.substring(0, 12) ?? null,
      exportError: local.exportError ?? null,
    });
    if (local.exportOk) {
      state.localRevision = local.revision;
      state.localHash = local.payloadSha256;
      saveOnlineSyncState(state, settings);
    }

    log?.info("Checking server status");
    const status = await postJson<SyncStatusResponse>(
      settings.serverUrl,
      "/api/sync/status",
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        clientRevision: state.localRevision,
        clientHash: local.payloadSha256 ?? state.localHash,
      },
      settings.requestTimeoutMs,
      settings.apiToken,
    );

    log?.info("Server status response", {
      reason: status.reason,
      shouldPull: status.shouldPull,
      shouldPush: status.shouldPush,
      serverRevision: status.serverRevision,
    });

    logSyncDiagnostic("status", {
      reason: status.reason,
      shouldPull: status.shouldPull,
      shouldPush: status.shouldPush,
      serverRevision: status.serverRevision,
    });

    state.serverRevision = Math.max(0, Math.floor(status.serverRevision || 0));
    state.serverHash = status.serverHash ?? null;
    saveOnlineSyncState(state, settings);

    if (status.reason === "server_snapshot_pruned") {
      log?.warn("Server snapshot pruned, handling reseed");
      const result = await handleServerSnapshotPruned(settings, state, local, status);
      log?.info("Sync finished (server_snapshot_pruned)", { ok: result.ok, reason: result.reason });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (status.shouldPull) {
      log?.info("Pulling from server");
      const pull = await postJson<SyncPullResponse>(
        settings.serverUrl,
        "/api/sync/pull",
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          clientRevision: state.localRevision,
        },
        settings.requestTimeoutMs,
        settings.apiToken,
      );

      log?.info("Pull response", {
        reason: pull.reason,
        hasUpdate: pull.hasUpdate,
        revision: pull.revision,
      });

      logSyncDiagnostic("pull", {
        reason: pull.reason,
        hasUpdate: pull.hasUpdate,
        revision: pull.revision,
      });

      if (pull.reason === "server_snapshot_pruned") {
        log?.warn("Pull returned server_snapshot_pruned, handling reseed");
        const result = await handleServerSnapshotPruned(settings, state, local, status);
        log?.info("Sync finished (pull server_snapshot_pruned)", { ok: result.ok, reason: result.reason });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      if (pull.hasUpdate) {
        if (!pull.archive || pull.revision == null || !pull.payloadSha256) {
          log?.error("Pull response incomplete");
          throw new Error("pull response incomplete");
        }

        log?.info("Importing pulled archive", { revision: pull.revision });
        const importSummary = await importDataArchive(pull.archive);
        log?.info("Import complete", {
          sessions_imported: importSummary.sessions_imported,
          sessions_merged: importSummary.sessions_merged,
          projects_created: importSummary.projects_created,
        });

        state.localRevision = pull.revision;
        state.localHash = pull.payloadSha256;
        state.serverRevision = pull.revision;
        state.serverHash = pull.payloadSha256;
        state.needsReseed = false;
        state.pendingAck = {
          revision: pull.revision,
          payloadSha256: pull.payloadSha256,
          createdAt: new Date().toISOString(),
          retries: 0,
        };
        saveOnlineSyncState(state, settings);

        log?.info("Flushing post-pull ACK");
        const ackResult = await flushPendingAck(settings, state);
        log?.info("Post-pull ACK result", {
          accepted: ackResult.accepted,
          reason: ackResult.reason,
        });
        state = loadOnlineSyncState(settings);

        if (ackResult.accepted) {
          state.lastSyncAt = new Date().toISOString();
          saveOnlineSyncState(state, settings);

          const result: OnlineSyncRunResult = {
            ok: true,
            action: "pull",
            reason: "pull_applied_ack_accepted",
            serverRevision: state.serverRevision,
            importSummary,
            ackAccepted: true,
            ackPending: false,
            ackReason: ackResult.reason,
            ackIsLatest: ackResult.response?.isLatest ?? null,
          };
          log?.info("Sync finished: pull + ack accepted", { serverRevision: state.serverRevision });
          updateIndicatorFromRunResult(result);
          await log?.flush();
          return result;
        }

        const ackPending =
          ackResult.pendingRemains || loadOnlineSyncState(settings).pendingAck !== null;
        const result: OnlineSyncRunResult = {
          ok: true,
          action: "pull",
          reason: ackPending ? "pull_applied_ack_pending" : "pull_applied_ack_not_accepted",
          serverRevision: state.serverRevision,
          importSummary,
          ackAccepted: false,
          ackPending,
          ackReason: ackResult.error ?? ackResult.reason,
          ackIsLatest: ackResult.response?.isLatest ?? null,
        };
        log?.info("Sync finished: pull applied, ack pending", { ackPending, reason: result.reason });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      state.serverRevision = pull.revision ?? status.serverRevision ?? state.serverRevision;
      state.serverHash = pull.payloadSha256 ?? status.serverHash ?? state.serverHash;
      if (
        pull.reason === "client_up_to_date" &&
        pull.revision != null &&
        pull.payloadSha256
      ) {
        state.localRevision = pull.revision;
        state.localHash = pull.payloadSha256;
      }
      state.lastSyncAt = new Date().toISOString();
      saveOnlineSyncState(state, settings);

      const result: OnlineSyncRunResult = {
        ok: true,
        action: "none",
        reason: pull.reason,
        serverRevision: pull.revision ?? status.serverRevision ?? null,
      };
      log?.info("Sync finished: no update needed (pull path)", { reason: pull.reason });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (status.shouldPush) {
      if (!local.archive) {
        log?.error("Local export unavailable for push", { exportError: local.exportError ?? null });
        throw new Error(local.exportError ?? "Local export unavailable for push");
      }

      const pushPayloadSize = JSON.stringify(local.archive).length;
      log?.info("Pushing to server", {
        knownServerRevision: status.serverRevision ?? null,
        payloadSizeKB: Math.round(pushPayloadSize / 1024),
        timeoutMs: settings.requestTimeoutMs,
      });
      const push = await postJson<SyncPushResponse>(
        settings.serverUrl,
        "/api/sync/push",
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          knownServerRevision: status.serverRevision ?? null,
          archive: local.archive,
        },
        settings.requestTimeoutMs,
        settings.apiToken,
      );

      if (push.accepted === false) {
        log?.error("Push rejected", { reason: push.reason });
        throw new Error(`push rejected: ${push.reason}`);
      }

      log?.info("Push accepted", { revision: push.revision, noOp: push.noOp ?? false });

      state.localRevision = push.revision;
      state.localHash = push.payloadSha256;
      state.serverRevision = push.revision;
      state.serverHash = push.payloadSha256;
      state.needsReseed = false;
      state.lastSyncAt = new Date().toISOString();
      saveOnlineSyncState(state, settings);

      const result: OnlineSyncRunResult = {
        ok: true,
        action: push.noOp ? "noop" : "push",
        reason: push.reason,
        serverRevision: push.revision,
      };
      log?.info("Sync finished: push", { action: result.action, reason: result.reason });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (
      status.reason === "same_hash" ||
      status.reason === "same_revision_hash_not_provided"
    ) {
      state.localRevision = status.serverRevision;
      state.localHash = status.serverHash;
    }
    state.lastSyncAt = new Date().toISOString();
    saveOnlineSyncState(state, settings);

    const result: OnlineSyncRunResult = {
      ok: true,
      action: "none",
      reason: status.reason,
      serverRevision: status.serverRevision ?? null,
    };
    log?.info("Sync finished: already in sync", { reason: status.reason });
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  } catch (error) {
    state = loadOnlineSyncState(settings);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorKind = error instanceof SyncHttpError ? error.kind : "unknown";
    const errorStatus = error instanceof SyncHttpError ? error.status : null;
    log?.error("Sync failed", {
      error: errorMessage,
      kind: errorKind,
      httpStatus: errorStatus,
      needsReseed: state.needsReseed,
    });
    const result: OnlineSyncRunResult = {
      ok: false,
      action: "none",
      reason: "sync_failed",
      serverRevision: state.serverRevision,
      error: errorMessage,
      needsReseed: state.needsReseed,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }
}

