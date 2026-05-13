// SSE Client — listens for real-time sync notifications from the server.
// When another device pushes data, the server sends a `sync_available` event
// and we immediately trigger an online sync pull.
//
// Uses fetch() streaming with Authorization header instead of EventSource
// to avoid leaking the API token in URL query params (logged by proxies/CDN).

import { logger } from '@/lib/logger';
import { loadOnlineSyncSettings, loadSecureApiToken } from '@/lib/sync/sync-state';

export type SyncSSEListener = (event: {
  type: string;
  revision: number;
  sourceDeviceId: string;
  reason: string;
}) => void;

let abortController: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 120_000; // 2 min max backoff
const BASE_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 20;

function getReconnectDelay(): number {
  const delay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
  );
  return delay + Math.random() * 2_000; // jitter
}

/** Parse a single SSE frame: "event: <name>\ndata: <json>\n\n" */
function parseSSEFrame(raw: string): { event: string; data: string } | null {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }
  if (!event && !data) return null;
  return { event, data };
}

export async function connectSSE(onSyncAvailable: SyncSSEListener): Promise<void> {
  disconnectSSE();

  const settings = loadOnlineSyncSettings();
  if (!settings.enabled || !settings.serverUrl || !settings.deviceId) {
    return;
  }

  const apiToken = await loadSecureApiToken();
  if (!apiToken) return;

  const url = new URL(`${settings.serverUrl}/api/sync/events`);
  url.searchParams.set('deviceId', settings.deviceId);

  abortController = new AbortController();

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'text/event-stream',
      },
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      logger.warn(`[SSE] HTTP ${response.status} — will reconnect`);
      scheduleReconnect(onSyncAvailable);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    reconnectAttempts = 0;
    logger.info('[SSE] Connected to sync event stream');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by double newline
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseSSEFrame(frame);
        if (!parsed) continue;

        if (parsed.event === 'connected') {
          logger.info('[SSE] Server confirmed connection');
        } else if (parsed.event === 'sync_available') {
          try {
            const data = JSON.parse(parsed.data);
            logger.info('[SSE] Sync available:', data.reason, 'rev:', data.revision);
            onSyncAvailable(data);
          } catch {
            logger.warn('[SSE] Failed to parse sync_available event');
          }
        }
      }
    }

    // Stream ended normally — reconnect
    logger.info('[SSE] Stream ended — will reconnect');
    scheduleReconnect(onSyncAvailable);
  } catch (e) {
    if (abortController?.signal.aborted) return; // intentional disconnect
    logger.warn('[SSE] Connection error — will reconnect', e);
    scheduleReconnect(onSyncAvailable);
  }
}

function scheduleReconnect(onSyncAvailable: SyncSSEListener): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    logger.warn(`[SSE] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
    return;
  }
  const delay = getReconnectDelay();
  logger.info(`[SSE] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSSE(onSyncAvailable);
  }, delay);
}

export function disconnectSSE(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  reconnectAttempts = 0;
}

