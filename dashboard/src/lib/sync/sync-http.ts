import type { ExportArchive } from '@/lib/db-types';
import type {
  LocalDatasetState,
  OnlineSyncSettings,
  OnlineSyncState,
  SyncAckResponse,
  SyncHttpErrorKind,
} from '@/lib/online-sync-types';
import {
  appendSyncLog,
  exportDataArchive,
  getDemoModeStatus,
} from '@/lib/tauri';

export class SyncHttpError extends Error {
  readonly kind: SyncHttpErrorKind;
  readonly status: number | null;

  constructor(
    message: string,
    kind: SyncHttpErrorKind,
    status: number | null = null,
  ) {
    super(message);
    this.name = 'SyncHttpError';
    this.kind = kind;
    this.status = status;
  }
}

function extractErrorMessageFromJson(
  json: unknown,
  fallbackStatus: number,
): string {
  if (
    typeof json === 'object' &&
    json !== null &&
    'error' in json &&
    typeof (json as { error?: unknown }).error === 'string'
  ) {
    return (json as { error: string }).error;
  }
  return `HTTP ${fallbackStatus}`;
}

export function normalizeRequestError(error: unknown): SyncHttpError {
  if (error instanceof SyncHttpError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new SyncHttpError('Request timeout', 'timeout');
  }
  if (error instanceof TypeError) {
    return new SyncHttpError(error.message || 'Network error', 'network');
  }
  return new SyncHttpError(
    error instanceof Error ? error.message : String(error),
    'unknown',
  );
}

export async function postJson<T>(
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
      'Content-Type': 'application/json',
    };
    if (apiToken && apiToken.trim()) {
      headers.Authorization = `Bearer ${apiToken.trim()}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
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
          throw new SyncHttpError(
            `HTTP ${response.status}`,
            'http',
            response.status,
          );
        }
        throw new SyncHttpError(
          'Invalid JSON response',
          'invalid_json',
          response.status,
        );
      }
    }

    if (!response.ok) {
      throw new SyncHttpError(
        extractErrorMessageFromJson(json, response.status),
        'http',
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
  if (normalized.kind === 'timeout' || normalized.kind === 'network') {
    return true;
  }
  return (
    normalized.kind === 'http' &&
    normalized.status !== null &&
    normalized.status >= 500
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getAckTimeoutMs(requestTimeoutMs: number): number {
  return Math.min(10_000, Math.max(5_000, requestTimeoutMs));
}

export async function postAckWithRetries(
  settings: OnlineSyncSettings,
  body: {
    userId: string;
    deviceId: string;
    revision: number;
    payloadSha256: string;
  },
  apiToken: string,
  log?: SyncFileLogger | null,
): Promise<SyncAckResponse> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson<SyncAckResponse>(
        settings.serverUrl,
        '/api/sync/ack',
        body,
        getAckTimeoutMs(settings.requestTimeoutMs),
        apiToken,
      );
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableAckError(error)) {
        throw error;
      }

      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[online-sync] ACK transient failure (attempt ${attempt}/${maxAttempts}), retrying`,
        msg,
      );
      log?.warn(`ACK transient failure, retrying`, {
        attempt,
        maxAttempts,
        error: msg,
        delayMs: 250 * attempt,
      });
      await delay(250 * attempt);
    }
  }

  throw new Error('ACK retry loop failed unexpectedly');
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API unavailable for sync hash');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function archiveHasReseedData(archive: ExportArchive): boolean {
  const sessions = Array.isArray(archive.data?.sessions)
    ? archive.data.sessions.length
    : 0;
  const manualSessions = Array.isArray(archive.data?.manual_sessions)
    ? archive.data.manual_sessions.length
    : 0;
  const projects = Array.isArray(archive.data?.projects)
    ? archive.data.projects.length
    : 0;
  const apps = Array.isArray(archive.data?.applications)
    ? archive.data.applications.length
    : 0;
  const dailyFiles =
    archive.data?.daily_files && typeof archive.data.daily_files === 'object'
      ? Object.keys(archive.data.daily_files).length
      : 0;

  return (
    sessions > 0 ||
    manualSessions > 0 ||
    projects > 0 ||
    apps > 0 ||
    dailyFiles > 0
  );
}

export async function getLocalDatasetState(
  state: OnlineSyncState,
): Promise<LocalDatasetState> {
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

export function logSyncDiagnostic(
  stage: 'status' | 'pull' | 'ack',
  details: Record<string, unknown>,
): void {
  console.info(`[online-sync] ${stage}`, details);
}

export class SyncFileLogger {
  private buffer: string[] = [];

  log(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level}] ${message}`;
    if (details && Object.keys(details).length > 0) {
      line += ` | ${JSON.stringify(details)}`;
    }
    this.buffer.push(line);
    if (level === 'ERROR') {
      console.error(`[sync-log] ${message}`, details ?? '');
    } else if (level === 'WARN') {
      console.warn(`[sync-log] ${message}`, details ?? '');
    } else {
      console.info(`[sync-log] ${message}`, details ?? '');
    }
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log('INFO', message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log('WARN', message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log('ERROR', message, details);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const lines = [...this.buffer];
    this.buffer = [];
    try {
      await appendSyncLog(lines);
    } catch {
      console.warn('[sync-log] Failed to flush sync log to file');
    }
  }
}

export async function isDemoModeSyncDisabled(): Promise<boolean> {
  try {
    const status = await getDemoModeStatus();
    return status.enabled === true;
  } catch {
    return false;
  }
}
