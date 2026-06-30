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
import { pollLanSyncUntilComplete } from '@/lib/lan-sync-poll';
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
  // Deadline'y schedulera — inicjalizowane raz w efekcie mount-only (Date.now()
  // w renderze łamie czystość; react-hooks/purity). Infinity = jeszcze nie
  // zaplanowane. Delaye (30/120/60 s + 90 s niżej) liczone od mountu, by
  // 'startup' sync biegł pierwszy, bez duplikatów z interwału/pollu.
  const nextSyncIntervalRef = useRef(Infinity);
  const nextLanSyncRef = useRef(Infinity);
  const isLanSyncingRef = useRef(false);

  const syncSettingsRef = useRef<ReturnType<typeof loadOnlineSyncSettings>>(undefined!);
  if (syncSettingsRef.current == null) {
    syncSettingsRef.current = loadOnlineSyncSettings();
  }
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

  // Periodically trigger daemon online sync (handles async delta pull from SFTP).
  // Deadline init w efekcie mount-only (patrz wyżej; react-hooks/purity).
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
      } catch (e) {
        // Nie blokuj synca, ale zaloguj — nieuruchomiony serwer LAN może
        // tłumaczyć późniejsze niepowodzenia synchronizacji.
        logger.warn('[useJobPool] LAN server status/start check failed', e);
      }

      const state = loadLanSyncState();
      const since = state.peerSyncTimes?.[activePeer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z';
      // background=true → daemon enforces the full sync_interval_hours gate against
      // the last COMPLETED sync, so this auto trigger never stacks a session right
      // after a daemon- or peer-initiated one.
      await lanSyncApi.runLanSync(activePeer.ip, activePeer.dashboard_port, since, false, true);
      await pollLanSyncUntilComplete();

      dispatchLanSyncDone(activePeer.machine_name);
      triggerRefresh('background_lan_sync_interval');
    } catch (e) {
      // A 429 means the daemon throttled this background attempt because the
      // minimum interval since the last completed sync hasn't elapsed — expected,
      // not a failure. Log it quietly; surface everything else as a warning.
      // Native Tauri invoke rejects with a raw string (Rust Err(String)), not an
      // Error, so normalize before matching — otherwise the throttle would surface
      // as a false failure on desktop.
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b429\b/.test(msg)) {
        logger.log('[useJobPool] LAN sync interval skipped — min interval not elapsed yet');
      } else {
        logger.warn('[useJobPool] LAN sync interval failed:', e);
      }
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

      // Sync po starcie respektuje interwał: lecimy jako 'background', więc demon
      // odrzuci go (429), jeśli ostatni sync był < interwał temu. Manualny/interval/
      // local_change idą bez tej bramki (jak dotąd).
      const isBackground = reason === 'startup';

      try {
        logger.log(`[useJobPool] Delegating online sync to daemon (reason: ${reason})`);
        // runSync obsługuje tylko auto-reasony (startup/local_change/interval) → bez `force`,
        // więc cooldown demona po nieudanych syncach obejmuje wszystkie te wyzwalacze.
        await triggerDaemonOnlineSync({ background: isBackground });
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
        // HTTP 429 = demon świadomie pominął sync: albo interwał nie minął, albo
        // trwa cooldown po nieudanych próbach (serwer pada). To nie błąd po stronie
        // dashboardu — nie naliczaj własnego backoffu; demon sam wznowi, gdy wolno.
        // invoke odrzuca surowym stringiem (Err(String)), więc normalizujemy.
        const msg = e instanceof Error ? e.message : String(e);
        if (/\b429\b/.test(msg)) {
          logger.log(`[useJobPool] Online sync skipped (reason: ${reason}) — daemon throttled (interval/cooldown)`);
          syncFailCountRef.current = 0;
          return;
        }
        logger.warn('Daemon sync trigger failed (daemon may be offline):', e);
        syncFailCountRef.current += 1;

        // Exponential backoff logic
        const backoffSec = Math.min(
          300,
          30 * Math.pow(2, syncFailCountRef.current - 1),
        );
        logger.log(`Sync backoff: retry assigned in ${backoffSec}s`);
        nextSyncIntervalRef.current = Date.now() + backoffSec * 1000;
      } finally {
        isSyncingRef.current = false;
      }
    },
    [triggerRefresh],
  );

  // Najnowsze wersje tych callbacków trafiają do refów w sync-efekcie niżej
  // (refów nie wolno pisać w renderze — react-hooks/refs).
  const refreshSyncSettingsCacheRef = useRef(refreshSyncSettingsCache);
  const handleSyncSettingsChange = useCallback(() => {
    refreshSyncSettingsCacheRef.current();
  }, []);

  const refreshDiagnosticsRef = useRef(refreshDiagnostics);
  const handleDiagnosticsRefresh = useCallback(() => {
    void refreshDiagnosticsRef.current();
  }, []);

  const refreshDatabaseSettingsRef = useRef(refreshDatabaseSettings);
  const handleDatabaseSettingsRefresh = useCallback(() => {
    void refreshDatabaseSettingsRef.current();
  }, []);

  // Stable refs for event handlers that capture mutable closure state.
  // Najnowsze domknięcie przypisujemy do refa w sync-efekcie (react-hooks/refs).
  const visibilityHandlerRef = useRef<() => void>(() => {});
  const visibilityHandler = () => {
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
      void runRefresh();
    }, 500);
  };
  const handleVisibilityChange = useCallback(() => visibilityHandlerRef.current(), []);

  const localDataChangeRef = useRef<() => void>(() => {});
  const localDataChange = () => {
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

  // Sync najnowszych callbacków/domknięć do refów po renderze (react-hooks/refs);
  // czytane wyłącznie w event-handlerach/efektach (po commicie).
  useEffect(() => {
    refreshSyncSettingsCacheRef.current = refreshSyncSettingsCache;
    refreshDiagnosticsRef.current = refreshDiagnostics;
    refreshDatabaseSettingsRef.current = refreshDatabaseSettings;
    visibilityHandlerRef.current = visibilityHandler;
    localDataChangeRef.current = localDataChange;
  });

  // Init deadline'ów schedulera raz na mount (Date.now() poza renderem).
  useEffect(() => {
    const now = Date.now();
    // Online sync: jedyny okresowy trigger to autoSyncIntervalMinutes.
    // Sync po starcie obsługuje osobny efekt (runSync('startup')) bramkowany
    // przez autoSyncOnStartup — tu pierwszy interwał liczymy od mountu.
    nextSyncIntervalRef.current =
      now + Math.max(1, syncSettingsRef.current.autoSyncIntervalMinutes) * 60_000;
    nextLanSyncRef.current = now + 60_000;
  }, []);

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
        nextLanSyncRef,
        syncSettingsRef,
        refreshDiagnostics: handleDiagnosticsRefresh,
        runRefresh,
        checkFileChange,
        runAutoSplit,
        runSync,
        runLanSyncInterval,
      });

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
    handleDatabaseSettingsRefresh,
    handleDiagnosticsRefresh,
    runAutoSplit,
    runRefresh,
    runSync,
    runLanSyncInterval,
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
  }, [clearLocalChangeTimers, handleLocalDataChange, handleSyncSettingsChange, handleVisibilityChange]);

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
