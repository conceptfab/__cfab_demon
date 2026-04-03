// SSE Client — listens for real-time sync notifications from the server.
// When another device pushes data, the server sends a `sync_available` event
// and we immediately trigger an online sync pull.

import { loadOnlineSyncSettings, loadSecureApiToken } from '@/lib/sync/sync-state';

export type SyncSSEListener = (event: {
  type: string;
  revision: number;
  sourceDeviceId: string;
  reason: string;
}) => void;

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 120_000; // 2 min max backoff
const BASE_RECONNECT_DELAY_MS = 5_000;

function getReconnectDelay(): number {
  const delay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
  );
  return delay + Math.random() * 2_000; // jitter
}

export async function connectSSE(onSyncAvailable: SyncSSEListener): Promise<void> {
  disconnectSSE();

  const settings = loadOnlineSyncSettings();
  if (!settings.enabled || !settings.serverUrl || !settings.deviceId) {
    return;
  }

  const apiToken = await loadSecureApiToken();
  if (!apiToken) return;

  // EventSource doesn't support custom headers, so we pass the token as a query param.
  // The server SSE endpoint should accept both Authorization header and ?token= query.
  // For security, we use a short-lived approach — the token is already known to the server.
  const url = new URL(`${settings.serverUrl}/api/sync/events`);
  url.searchParams.set('deviceId', settings.deviceId);
  url.searchParams.set('token', apiToken);

  try {
    eventSource = new EventSource(url.toString());

    eventSource.addEventListener('connected', () => {
      console.log('[SSE] Connected to sync event stream');
      reconnectAttempts = 0;
    });

    eventSource.addEventListener('sync_available', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[SSE] Sync available:', data.reason, 'rev:', data.revision);
        onSyncAvailable(data);
      } catch {
        console.warn('[SSE] Failed to parse sync_available event');
      }
    });

    eventSource.onerror = () => {
      console.warn('[SSE] Connection error — will reconnect');
      eventSource?.close();
      eventSource = null;
      scheduleReconnect(onSyncAvailable);
    };
  } catch (e) {
    console.warn('[SSE] Failed to create EventSource:', e);
    scheduleReconnect(onSyncAvailable);
  }
}

function scheduleReconnect(onSyncAvailable: SyncSSEListener): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = getReconnectDelay();
  console.log(`[SSE] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`);
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
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  reconnectAttempts = 0;
}

export function isSSEConnected(): boolean {
  return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}
