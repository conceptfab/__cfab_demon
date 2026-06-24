import { useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import { logger } from '@/lib/logger';
import { lanSyncApi, triggerDaemonOnlineSync } from '@/lib/tauri';
import {
  ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
  loadOnlineSyncSettings,
} from '@/lib/online-sync';
import { loadLanSyncSettings } from '@/lib/lan-sync';
import { connectSSE, disconnectSSE } from '@/lib/sync/sync-sse';
import { emitProjectsAllTimeInvalidated } from '@/lib/sync-events';

export function useLanSyncServerStartup() {
  useEffect(() => {
    const settings = loadLanSyncSettings();
    if (settings.enabled) {
      lanSyncApi.startLanServer(settings.serverPort).catch((e) => {
        logger.warn('Failed to start LAN server on startup:', e);
      });
    }
    return () => {
      lanSyncApi.stopLanServer().catch(() => {});
    };
  }, []);
}

export function useOnlineSyncSSE() {
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const refreshTimerRef = useRef<number | null>(null);
  const triggerRefreshRef = useRef(triggerRefresh);
  // Zapis refa poza renderem (react-hooks/refs); czytany w callbacku SSE.
  useEffect(() => {
    triggerRefreshRef.current = triggerRefresh;
  });

  useEffect(() => {
    const refreshTimer = refreshTimerRef;
    const settings = loadOnlineSyncSettings();
    if (!settings.enabled) return;

    const ownDeviceId = settings.deviceId;
    void connectSSE(async (event) => {
      // Ignoruj echo WŁASNYCH pushy: serwer rozsyła SSE do wszystkich klientów,
      // też do nadawcy. Bez tego push → echo → trigger → push tworzy pętlę
      // (storm). Floor po stronie demona i tak by ją zdławił, ale tu odcinamy
      // ją u źródła (zero zbędnych 429).
      if (event.sourceDeviceId && event.sourceDeviceId === ownDeviceId) {
        logger.log(`[SSE] Ignoruję echo własnego pushu (rev ${event.revision})`);
        return;
      }
      logger.log(`[SSE] Peer ${event.sourceDeviceId} pushed rev ${event.revision} — triggering daemon sync`);
      try {
        await triggerDaemonOnlineSync();
        // Refresh UI after daemon processes the sync
        // 5s allows for larger databases to complete processing
        if (refreshTimerRef.current) {
          window.clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = window.setTimeout(() => {
          refreshTimerRef.current = null;
          emitProjectsAllTimeInvalidated('sse_sync_pull');
          triggerRefreshRef.current('sse_sync_pull');
        }, 5_000);
      } catch (e) {
        logger.warn('[SSE] Daemon sync trigger failed:', e);
      }
    });

    const handleSettingsChange = () => {
      const updated = loadOnlineSyncSettings();
      if (!updated.enabled) {
        disconnectSSE();
      }
      // Reconnect handled by next mount cycle
    };
    window.addEventListener(
      ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
      handleSettingsChange,
    );

    return () => {
      const timerId = refreshTimer.current;
      if (timerId) {
        window.clearTimeout(timerId);
        refreshTimer.current = null;
      }
      disconnectSSE();
      window.removeEventListener(
        ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
        handleSettingsChange,
      );
    };
  }, []);
}
