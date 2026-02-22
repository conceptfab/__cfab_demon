import type { ExportArchive, ImportSummary } from "@/lib/db-types";
import { exportDataArchive, importDataArchive } from "@/lib/tauri";

const ONLINE_SYNC_SETTINGS_KEY = "cfab.settings.online-sync";
const ONLINE_SYNC_STATE_KEY = "cfab.sync.state";
export const ONLINE_SYNC_SETTINGS_CHANGED_EVENT = "cfab:online-sync-settings-changed";
export const DEFAULT_ONLINE_SYNC_SERVER_URL =
  "https://cfabserver-production.up.railway.app";

export interface OnlineSyncSettings {
  enabled: boolean;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  serverUrl: string;
  userId: string;
  apiToken: string;
  deviceId: string;
  requestTimeoutMs: number;
}

export interface OnlineSyncState {
  serverRevision: number;
  serverHash: string | null;
  lastSyncAt: string | null;
}

export interface OnlineSyncRunResult {
  ok: boolean;
  skipped?: boolean;
  action: "none" | "push" | "pull" | "noop";
  reason: string;
  serverRevision: number | null;
  importSummary?: ImportSummary;
  error?: string;
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
  noOp: boolean;
  revision: number;
  payloadSha256: string;
  reason: string;
}

interface SyncPullResponse {
  ok: true;
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  archive?: ExportArchive;
  reason: string;
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
};

const DEFAULT_ONLINE_SYNC_STATE: OnlineSyncState = {
  serverRevision: 0,
  serverHash: null,
  lastSyncAt: null,
};

type OnlineSyncStatusListener = (snapshot: OnlineSyncIndicatorSnapshot) => void;

const onlineSyncStatusListeners = new Set<OnlineSyncStatusListener>();
let onlineSyncIndicatorSnapshotCache: OnlineSyncIndicatorSnapshot | null = null;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function normalizeServerUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\/+$/, "");
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

function writeJsonStorage<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emitOnlineSyncSettingsChanged(): void {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(ONLINE_SYNC_SETTINGS_CHANGED_EVENT));
}

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}...` : "n/a";
}

function formatLastSyncDetail(state: OnlineSyncState): string {
  if (!state.lastSyncAt) return "No sync yet";
  const timestamp = new Date(state.lastSyncAt);
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? state.lastSyncAt
    : timestamp.toLocaleTimeString();
  return `Last sync ${timeLabel} • r${state.serverRevision} • ${shortHash(state.serverHash)}`;
}

function buildIndicatorSnapshotFromStorage(): OnlineSyncIndicatorSnapshot {
  const settings = loadOnlineSyncSettings();
  const state = loadOnlineSyncState();

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
    refreshIndicatorFromStorage();
    return;
  }

  if (!result.ok) {
    emitOnlineSyncIndicatorSnapshot({
      status: "error",
      label: "Sync Error",
      detail: result.error ?? result.reason,
      serverRevision: state.serverRevision,
      serverHash: state.serverHash,
      lastSyncAt: state.lastSyncAt,
      lastAction: result.action,
      lastReason: result.reason,
      error: result.error ?? result.reason,
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
  const parsed = readJsonStorage<OnlineSyncSettings>(ONLINE_SYNC_SETTINGS_KEY);
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
  };
  writeJsonStorage(ONLINE_SYNC_SETTINGS_KEY, merged);
  emitOnlineSyncSettingsChanged();
  refreshIndicatorFromStorage();
  return merged;
}

export function loadOnlineSyncState(): OnlineSyncState {
  const parsed = readJsonStorage<OnlineSyncState>(ONLINE_SYNC_STATE_KEY);
  return {
    serverRevision:
      typeof parsed?.serverRevision === "number" && Number.isFinite(parsed.serverRevision)
        ? Math.max(0, Math.floor(parsed.serverRevision))
        : DEFAULT_ONLINE_SYNC_STATE.serverRevision,
    serverHash: typeof parsed?.serverHash === "string" ? parsed.serverHash : null,
    lastSyncAt: typeof parsed?.lastSyncAt === "string" ? parsed.lastSyncAt : null,
  };
}

export function saveOnlineSyncState(next: OnlineSyncState): OnlineSyncState {
  const normalized: OnlineSyncState = {
    serverRevision: Math.max(0, Math.floor(next.serverRevision || 0)),
    serverHash: next.serverHash ?? null,
    lastSyncAt: next.lastSyncAt ?? null,
  };
  writeJsonStorage(ONLINE_SYNC_STATE_KEY, normalized);
  refreshIndicatorFromStorage();
  return normalized;
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

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = (await response.json()) as unknown;
    if (!response.ok) {
      const errorMessage =
        typeof json === "object" &&
        json !== null &&
        "error" in json &&
        typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function runOnlineSyncOnce(
  options: RunOnlineSyncOptions = {},
): Promise<OnlineSyncRunResult> {
  const settings = loadOnlineSyncSettings();

  emitOnlineSyncIndicatorSnapshot({
    ...getOnlineSyncIndicatorSnapshot(),
    status: "syncing",
    label: "Syncing...",
    detail: `Contacting ${settings.serverUrl || "server"}...`,
    error: null,
  });

  if (!settings.enabled) {
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "disabled",
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    return result;
  }

  if (!options.ignoreStartupToggle && !settings.autoSyncOnStartup) {
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "startup_disabled",
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    return result;
  }

  if (!settings.serverUrl || !settings.userId) {
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: "none",
      reason: "missing_config",
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    return result;
  }

  const localState = loadOnlineSyncState();

  try {
    const status = await postJson<SyncStatusResponse>(
      settings.serverUrl,
      "/api/sync/status",
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        clientRevision: localState.serverRevision,
        clientHash: localState.serverHash,
      },
      settings.requestTimeoutMs,
      settings.apiToken,
    );

    if (status.shouldPull) {
      const pull = await postJson<SyncPullResponse>(
        settings.serverUrl,
        "/api/sync/pull",
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          clientRevision: localState.serverRevision,
        },
        settings.requestTimeoutMs,
        settings.apiToken,
      );

      if (pull.hasUpdate && pull.archive) {
        const importSummary = await importDataArchive(pull.archive);
        saveOnlineSyncState({
          serverRevision: pull.revision ?? localState.serverRevision,
          serverHash: pull.payloadSha256 ?? localState.serverHash,
          lastSyncAt: new Date().toISOString(),
        });

        const result: OnlineSyncRunResult = {
          ok: true,
          action: "pull",
          reason: pull.reason,
          serverRevision: pull.revision ?? null,
          importSummary,
        };
        updateIndicatorFromRunResult(result);
        return result;
      }

      saveOnlineSyncState({
        serverRevision: pull.revision ?? status.serverRevision ?? localState.serverRevision,
        serverHash: pull.payloadSha256 ?? status.serverHash ?? localState.serverHash,
        lastSyncAt: new Date().toISOString(),
      });

      const result: OnlineSyncRunResult = {
        ok: true,
        action: "none",
        reason: pull.reason,
        serverRevision: pull.revision ?? status.serverRevision ?? null,
      };
      updateIndicatorFromRunResult(result);
      return result;
    }

    // MVP strategy: if server does not require pull, prepare a local snapshot and try push.
    // Server deduplicates by hash and returns no-op when nothing changed.
    const archive = await exportDataArchive();
    const push = await postJson<SyncPushResponse>(
      settings.serverUrl,
      "/api/sync/push",
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        knownServerRevision: status.serverRevision,
        archive,
      },
      settings.requestTimeoutMs,
      settings.apiToken,
    );

    saveOnlineSyncState({
      serverRevision: push.revision,
      serverHash: push.payloadSha256,
      lastSyncAt: new Date().toISOString(),
    });

    const result: OnlineSyncRunResult = {
      ok: true,
      action: push.noOp ? "noop" : "push",
      reason: push.reason,
      serverRevision: push.revision,
    };
    updateIndicatorFromRunResult(result);
    return result;
  } catch (error) {
    const result: OnlineSyncRunResult = {
      ok: false,
      action: "none",
      reason: "sync_failed",
      serverRevision: localState.serverRevision,
      error: error instanceof Error ? error.message : String(error),
    };
    updateIndicatorFromRunResult(result);
    return result;
  }
}
