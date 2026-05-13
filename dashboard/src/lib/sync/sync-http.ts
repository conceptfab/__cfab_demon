import type { ExportArchive } from '@/lib/db-types';
import type {
  LocalDatasetState,
  OnlineSyncState,
  SyncHttpErrorKind,
} from '@/lib/online-sync-types';
import {
  exportDataArchive,
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

export async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return data; // fallback: send uncompressed
  }
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

const GZIP_THRESHOLD = 1024; // compress payloads > 1 KB

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
    const jsonStr = JSON.stringify(body);
    const rawBytes = new TextEncoder().encode(jsonStr);

    const useGzip =
      rawBytes.length > GZIP_THRESHOLD &&
      typeof CompressionStream !== 'undefined';
    const payload = useGzip ? await compressGzip(rawBytes) : rawBytes;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (useGzip) {
      headers['Content-Encoding'] = 'gzip';
    }
    if (apiToken && apiToken.trim()) {
      headers.Authorization = `Bearer ${apiToken.trim()}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: payload,
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
      payloadSha256: null,
      archive: null,
      exportError: error instanceof Error ? error.message : String(error),
    };
  }
}

