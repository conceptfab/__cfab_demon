import { useEffect } from 'react';
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

  useEffect(() => {
    const settings = loadOnlineSyncSettings();
    if (!settings.enabled) return;

    void connectSSE(async (event) => {
      logger.log(`[SSE] Peer ${event.sourceDeviceId} pushed rev ${event.revision} — triggering daemon sync`);
      try {
        await triggerDaemonOnlineSync();
        // Refresh UI after daemon processes the sync
        // 5s allows for larger databases to complete processing
        setTimeout(() => {
          emitProjectsAllTimeInvalidated('sse_sync_pull');
          triggerRefresh('sse_sync_pull');
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
      disconnectSSE();
      window.removeEventListener(
        ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
        handleSettingsChange,
      );
    };
  }, [triggerRefresh]);
}
