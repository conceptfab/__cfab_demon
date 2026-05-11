import { useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { logger } from '@/lib/logger';
import { daemonApi, lanSyncApi, triggerDaemonOnlineSync } from '@/lib/tauri';
import {
  ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
  loadOnlineSyncSettings,
} from '@/lib/online-sync';
import { loadLanSyncSettings, loadLanSyncState } from '@/lib/lan-sync';
import {
  LOCAL_DATA_CHANGED_EVENT,
} from '@/lib/sync-events';
import {
  AUTO_SPLIT_INTERVAL_MS,
  JOB_LOOP_TICK_MS,
  bootstrapJobPool,
  buildTodayFileSignatureKey,
  isDocumentVisible,
  runAutoSplitCycle,
  runJobPoolTick,
} from '@/components/sync/job-pool-helpers';
import {
  AI_AND_SPLIT_OPERATION_KEY,
  runAutoAiAssignmentCycle,
  runHeavyOperation,
  dispatchAiAssignmentDone,
  dispatchLanSyncDone,
} from '@/lib/background-helpers';

export function useJobPool() {
  const autoImportDone = useDataStore((s) => s.autoImportDone);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const refreshDiagnostics = useBackgroundStatusStore((s) => s.refreshDiagnostics);
  const refreshDatabaseSettings = useBackgroundStatusStore(
    (s) => s.refreshDatabaseSettings,
  );
  const refreshAiStatus = useBackgroundStatusStore((s) => s.refreshAiStatus);
  const loopRef = useRef<number | null>(null);

  const nextDiagnosticsRef = useRef(0);
  const nextAiStatusRef = useRef(0);
  const nextRefreshRef = useRef(0);
  const nextSigCheckRef = useRef(0);
  const nextAutoSplitRef = useRef(0);
  // Start with a delay so the 'startup' sync runs first without duplicates
  // from the interval/poll triggers firing immediately on the first tick.
  const nextSyncIntervalRef = useRef(Date.now() + 30_000);
  const nextSyncPollRef = useRef(Date.now() + 120_000);
  // LAN sync interval — delayed 60s to let discovery find peers first
  const nextLanSyncRef = useRef(Date.now() + 60_000);
  const isLanSyncingRef = useRef(false);

  const syncSettingsRef = useRef(loadOnlineSyncSettings());
  const syncFailCountRef = useRef(0);

  const lastSignatureRef = useRef<string | null>(null);
  const localChangeRefreshTimer = useRef<number | null>(null);
  const localChangeSyncTimer = useRef<number | null>(null);
  const syncRefreshTimer = useRef<number | null>(null);
  const visibilityDebounceTimer = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);
  const isSyncingRef = useRef(false);

  const checkFileChange = useCallback(async () => {
    if (!autoImportDone || !isDocumentVisible()) return;
    try {
      const sig = await daemonApi.getTodayFileSignature();
      const current = buildTodayFileSignatureKey(sig);
      if (
        lastSignatureRef.current !== null &&
        lastSignatureRef.current !== current
      ) {
        triggerRefresh('background_file_signature_changed');
      }
      lastSignatureRef.current = current;
    } catch (error) {
      logger.warn('[useJobPool] Failed to check today file signature', error);
    }
  }, [autoImportDone, triggerRefresh]);

  const runRefresh = useCallback(async () => {
    if (!autoImportDone || isRefreshingRef.current || !isDocumentVisible()) return;
    isRefreshingRef.current = true;
    try {
      const result = await daemonApi.refreshToday();
      if (result.sessions_upserted > 0) {
        const aiResult = await runAutoAiAssignmentCycle();
        dispatchAiAssignmentDone(aiResult);
      }
    } catch (error) {
      logger.warn('[useJobPool] Refresh today failed', error);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [autoImportDone]);

  const refreshSyncSettingsCache = useCallback(() => {
    syncSettingsRef.current = loadOnlineSyncSettings();
  }, []);

  const clearLocalChangeTimers = useCallback(() => {
    if (localChangeRefreshTimer.current) {
      window.clearTimeout(localChangeRefreshTimer.current);
      localChangeRefreshTimer.current = null;
    }
    if (localChangeSyncTimer.current) {
      window.clearTimeout(localChangeSyncTimer.current);
      localChangeSyncTimer.current = null;
    }
    if (visibilityDebounceTimer.current) {
      window.clearTimeout(visibilityDebounceTimer.current);
      visibilityDebounceTimer.current = null;
    }
    if (syncRefreshTimer.current) {
      window.clearTimeout(syncRefreshTimer.current);
      syncRefreshTimer.current = null;
    }
  }, []);

  const runAutoSplit = useCallback(async () => {
    if (!autoImportDone) return;
    await runAutoSplitCycle(
      runHeavyOperation,
      AI_AND_SPLIT_OPERATION_KEY,
    );
  }, [autoImportDone]);

  // Periodically trigger daemon online sync (handles async delta pull from SFTP)
  const nextDaemonOnlineSyncRef = useRef(Date.now() + 90_000);
  const isDaemonOnlineSyncingRef = useRef(false);

  const runDaemonOnlineSyncInterval = useCallback(async () => {
    if (isDaemonOnlineSyncingRef.current || !isDocumentVisible()) return;
    const settings = syncSettingsRef.current;
    if (!settings.enabled) {
      nextDaemonOnlineSyncRef.current = Date.now() + 300_000;
      return;
    }
    isDaemonOnlineSyncingRef.current = true;

    // Reschedule for next interval (60s)
    nextDaemonOnlineSyncRef.current = Date.now() + 60_000;

    try {
      await triggerDaemonOnlineSync();
    } catch {
      // Daemon unreachable or sync not configured — ignore
    } finally {
      isDaemonOnlineSyncingRef.current = false;
    }
  }, []);

  const runLanSyncInterval = useCallback(async () => {
    if (isLanSyncingRef.current || !isDocumentVisible()) return;
    const lanSettings = loadLanSyncSettings();
    if (!lanSettings.enabled || lanSettings.syncIntervalHours === 0) {
      // Manual-only or disabled — reschedule check in 5 min
      nextLanSyncRef.current = Date.now() + 300_000;
      return;
    }

    // Reschedule for next interval
    nextLanSyncRef.current = Date.now() + lanSettings.syncIntervalHours * 3600_000;

    // Find an online peer
    try {
      const peers = await lanSyncApi.getLanPeers();
      const activePeer = peers.find((p) => p.dashboard_running);
      if (!activePeer) return;

      // Sync wymaga zgodnej wersji TIMEFLOW po obu stronach — backend i tak
      // odrzuci niezgodne (412), ale nie ma sensu nawet próbować z tła.
      const localVersion = (useBackgroundStatusStore.getState().daemonStatus?.dashboard_version ?? '').trim();
      const peerVersion = (activePeer.timeflow_version ?? '').trim();
      if (localVersion !== '' && peerVersion !== '' && localVersion !== peerVersion) {
        logger.log(`[useJobPool] LAN sync skipped — version mismatch (local=${localVersion}, peer=${peerVersion})`);
        return;
      }

      isLanSyncingRef.current = true;
      logger.log(`[useJobPool] Running LAN sync interval with peer ${activePeer.machine_name}`);

      // Ensure our server is running
      try {
        const status = await lanSyncApi.getLanServerStatus();
        if (!status.running) await lanSyncApi.startLanServer(lanSettings.serverPort);
      } catch { /* ignore */ }

      const state = loadLanSyncState();
      const since = state.peerSyncTimes?.[activePeer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z';
      await lanSyncApi.runLanSync(activePeer.ip, activePeer.dashboard_port, since);

      // Poll progress until done (max 5 min)
      const deadline = Date.now() + 300_000;
      let lastPhase = '';
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const p = await lanSyncApi.getLanSyncProgress();
          if (p.phase !== lastPhase) lastPhase = p.phase;
          if (p.phase === 'completed' || (p.phase === 'idle' && p.step === 0 && lastPhase !== '')) break;
        } catch { /* daemon unreachable */ }
      }

      dispatchLanSyncDone(activePeer.machine_name);
      triggerRefresh('background_lan_sync_interval');
    } catch (e) {
      logger.warn('[useJobPool] LAN sync interval failed:', e);
    } finally {
      isLanSyncingRef.current = false;
    }
  }, [triggerRefresh]);

  const runSync = useCallback(
    async (reason: string, isAuto = true) => {
      if (isSyncingRef.current) return;
      const settings = syncSettingsRef.current;
      if (isAuto && !settings.enabled) return;
      if (isAuto && !isDocumentVisible()) return;
      isSyncingRef.current = true;

      try {
        logger.log(`[useJobPool] Delegating online sync to daemon (reason: ${reason})`);
        await triggerDaemonOnlineSync();
        // Daemon handles the sync — refresh UI after delay to pick up changes
        // 5s allows for larger databases to complete processing
        if (syncRefreshTimer.current) {
          window.clearTimeout(syncRefreshTimer.current);
        }
        syncRefreshTimer.current = window.setTimeout(() => {
          syncRefreshTimer.current = null;
          triggerRefresh(`background_sync_${reason}`);
        }, 5_000);
        syncFailCountRef.current = 0;
      } catch (e) {
        logger.warn('Daemon sync trigger failed (daemon may be offline):', e);
        syncFailCountRef.current += 1;

        // Exponential backoff logic
        const backoffSec = Math.min(
          300,
          30 * Math.pow(2, syncFailCountRef.current - 1),
        );
        logger.log(`Sync backoff: retry assigned in ${backoffSec}s`);
        nextSyncPollRef.current = Date.now() + backoffSec * 1000;
      } finally {
        isSyncingRef.current = false;
      }
    },
    [triggerRefresh],
  );

  const refreshSyncSettingsCacheRef = useRef(refreshSyncSettingsCache);
  refreshSyncSettingsCacheRef.current = refreshSyncSettingsCache;
  const handleSyncSettingsChange = useCallback(() => {
    refreshSyncSettingsCacheRef.current();
  }, []);

  const refreshDiagnosticsRef = useRef(refreshDiagnostics);
  refreshDiagnosticsRef.current = refreshDiagnostics;
  const handleDiagnosticsRefresh = useCallback(() => {
    void refreshDiagnosticsRef.current();
  }, []);

  const refreshDatabaseSettingsRef = useRef(refreshDatabaseSettings);
  refreshDatabaseSettingsRef.current = refreshDatabaseSettings;
  const handleDatabaseSettingsRefresh = useCallback(() => {
    void refreshDatabaseSettingsRef.current();
  }, []);

  // Stable refs for event handlers that capture mutable closure state
  const visibilityHandlerRef = useRef<() => void>(() => {});
  visibilityHandlerRef.current = () => {
    refreshSyncSettingsCache();
    if (!isDocumentVisible()) {
      if (visibilityDebounceTimer.current) {
        window.clearTimeout(visibilityDebounceTimer.current);
        visibilityDebounceTimer.current = null;
      }
      return;
    }

    if (visibilityDebounceTimer.current) {
      window.clearTimeout(visibilityDebounceTimer.current);
    }
    visibilityDebounceTimer.current = window.setTimeout(() => {
      visibilityDebounceTimer.current = null;
      nextDiagnosticsRef.current = 0;
      nextAiStatusRef.current = 0;
      handleDiagnosticsRefresh();
      handleDatabaseSettingsRefresh();

      if (!autoImportDone) return;

      nextRefreshRef.current = 0;
      nextSigCheckRef.current = 0;
      nextAutoSplitRef.current = Date.now() + AUTO_SPLIT_INTERVAL_MS;
      nextSyncIntervalRef.current = 0;
      nextSyncPollRef.current = Date.now() + 120_000;
      void runRefresh();
    }, 500);
  };
  const handleVisibilityChange = useCallback(() => visibilityHandlerRef.current(), []);

  const localDataChangeRef = useRef<() => void>(() => {});
  localDataChangeRef.current = () => {
    if (!isDocumentVisible()) return;

    handleDatabaseSettingsRefresh();
    nextAiStatusRef.current = 0;

    if (localChangeRefreshTimer.current) {
      window.clearTimeout(localChangeRefreshTimer.current);
    }
    localChangeRefreshTimer.current = window.setTimeout(
      () => triggerRefresh('background_local_data_changed'),
      120,
    );

    if (!autoImportDone) return;

    if (localChangeSyncTimer.current) {
      window.clearTimeout(localChangeSyncTimer.current);
    }
    localChangeSyncTimer.current = window.setTimeout(() => {
      void runSync('local_change');
    }, 1_500);
  };
  const handleLocalDataChange = useCallback(() => localDataChangeRef.current(), []);

  useEffect(() => {
    handleDiagnosticsRefresh();
    handleDatabaseSettingsRefresh();
    void bootstrapJobPool({
      autoImportDone,
      lastSignatureRef,
      runRefresh,
    });

    // Universal Event Loop (1 second tick)
    loopRef.current = window.setInterval(() => {
      const now = Date.now();
      runJobPoolTick({
        autoImportDone,
        now,
        nextDiagnosticsRef,
        nextRefreshRef,
        nextSigCheckRef,
        nextAutoSplitRef,
        nextSyncIntervalRef,
        nextSyncPollRef,
        nextLanSyncRef,
        syncSettingsRef,
        refreshDiagnostics: handleDiagnosticsRefresh,
        runRefresh,
        checkFileChange,
        runAutoSplit,
        runSync,
        runLanSyncInterval,
      });

      // Daemon async delta pull (SFTP) — triggers independently of dashboard sync
      if (autoImportDone && now >= nextDaemonOnlineSyncRef.current) {
        void runDaemonOnlineSyncInterval();
      }

      // Periodic AI status refresh — keeps sidebar training badge up to date
      if (isDocumentVisible() && now >= nextAiStatusRef.current) {
        nextAiStatusRef.current = now + 120_000;
        void refreshAiStatus().catch((e) => logger.warn('[useJobPool] AI status refresh failed:', e));
      }
    }, JOB_LOOP_TICK_MS);

    return () => {
      if (loopRef.current !== null) clearInterval(loopRef.current);
    };
  }, [
    autoImportDone,
    checkFileChange,
    runAutoSplit,
    runRefresh,
    runSync,
    runLanSyncInterval,
    runDaemonOnlineSyncInterval,
    refreshAiStatus,
  ]);

  useEffect(() => {
    const onSyncSettingsChange = () => {
      handleSyncSettingsChange();
    };
    const onVisibilityChange = () => {
      handleVisibilityChange();
    };
    const onLocalDataChange = () => {
      handleLocalDataChange();
    };

    window.addEventListener('focus', onSyncSettingsChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(
      ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
      onSyncSettingsChange,
    );
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, onLocalDataChange);

    return () => {
      window.removeEventListener('focus', onSyncSettingsChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(
        ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
        onSyncSettingsChange,
      );
      window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, onLocalDataChange);
      clearLocalChangeTimers();
    };
  }, [clearLocalChangeTimers]);

  useEffect(() => {
    if (!autoImportDone) return;
    nextAutoSplitRef.current = Date.now() + AUTO_SPLIT_INTERVAL_MS;
    void runAutoSplit();
    refreshSyncSettingsCache();
    if (!syncSettingsRef.current.enabled) return;
    if (!syncSettingsRef.current.autoSyncOnStartup) return;
    void runSync('startup');
  }, [autoImportDone, runAutoSplit, runSync, refreshSyncSettingsCache]);
}
