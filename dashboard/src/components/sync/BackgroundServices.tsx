import { useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import {
  aiApi,
  daemonApi,
  dataApi,
  projectsApi,
  sessionsApi,
} from '@/lib/tauri';
import {
  ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
  loadOnlineSyncSettings,
  runOnlineSyncOnce,
} from '@/lib/online-sync';
import {
  LOCAL_DATA_CHANGED_EVENT,
  emitProjectsAllTimeInvalidated,
} from '@/lib/sync-events';
import { loadSessionSettings } from '@/lib/user-settings';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-ranges';
import {
  AUTO_SPLIT_INTERVAL_MS,
  JOB_LOOP_TICK_MS,
  bootstrapJobPool,
  buildTodayFileSignatureKey,
  createJobPoolEventHandlers,
  isDocumentVisible,
  runAutoSplitCycle,
  runJobPoolTick,
} from '@/components/sync/job-pool-helpers';

const AI_AND_SPLIT_OPERATION_KEY = 'ai_and_split_pipeline';

// THREADING: Prevents concurrent heavy operations (rebuild, AI train/assign)
// from overloading the backend. Simple module-level flag — safe in single-threaded JS.
const heavyOperations = new Map<string, boolean>();

async function runHeavyOperation<T>(
  key: string,
  fn_: () => Promise<T>,
): Promise<T | null> {
  if (heavyOperations.get(key)) {
    console.warn(`Heavy operation '${key}' is already in progress. Skipping.`);
    return null;
  }
  heavyOperations.set(key, true);
  try {
    return await fn_();
  } finally {
    heavyOperations.set(key, false);
  }
}

async function runAutoAiAssignmentCycle(): Promise<boolean> {
  const result = await runHeavyOperation(
    AI_AND_SPLIT_OPERATION_KEY,
    async () => {
      let needsRefresh = false;
      try {
        const det = await aiApi.applyDeterministicAssignment();
        if (det.sessions_assigned > 0) needsRefresh = true;
      } catch (e) {
        console.warn('Deterministic assignment failed:', e);
      }

      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const aiResult = await aiApi.autoRunIfNeeded(minDuration);
        if (aiResult && aiResult.assigned > 0) needsRefresh = true;
      } catch (e) {
        console.warn('AI auto-assignment failed:', e);
      }

      return needsRefresh;
    },
  );

  return result ?? false;
}

// === BACKGROUND HOOKS ===

function useAutoImporter() {
  const { autoImportDone, setAutoImportDone, triggerRefresh } = useDataStore();

  useEffect(() => {
    if (autoImportDone) return;
    const warnTimer = setTimeout(() => {
      console.warn('Auto-import is still running (longer than 8s)...');
    }, 8_000);

    dataApi.autoImportFromDataDir()
      .then((result) => {
        setAutoImportDone(true, result);
        if (result.files_imported > 0) {
          triggerRefresh('background_auto_import');
        }
      })
      .catch((e) => {
        console.error('Auto-import failed:', e);
        setAutoImportDone(true, {
          files_found: 0,
          files_imported: 0,
          files_skipped: 0,
          files_archived: 0,
          errors: [String(e)],
        });
      })
      .finally(() => clearTimeout(warnTimer));

    return () => clearTimeout(warnTimer);
  }, [autoImportDone, setAutoImportDone, triggerRefresh]);
}

function useAutoProjectSync() {
  useEffect(() => {
    const run = async () => {
      try {
        const syncResult = await projectsApi.syncProjectsFromFolders();
        await projectsApi.autoCreateProjectsFromDetection(ALL_TIME_DATE_RANGE, 2);
        const allNew = syncResult.created_projects;
        if (allNew.length > 0) {
          useDataStore.getState().setDiscoveredProjects(allNew);
        }
      } catch (e) {
        console.warn('Auto project sync failed:', e);
      }
    };
    void run();
  }, []);
}

function useAutoSessionRebuild() {
  useEffect(() => {
    const run = async () => {
      try {
        const settings = loadSessionSettings();
        if (settings.rebuildOnStartup && settings.gapFillMinutes > 0) {
          await runHeavyOperation('rebuild', () =>
            sessionsApi.rebuildSessions(settings.gapFillMinutes),
          );
        }
      } catch (e) {
        console.warn('Auto session rebuild failed:', e);
      }
    };
    void run();
  }, []);
}

function useAutoAiAssignment() {
  const { autoImportDone } = useDataStore();
  const hasProcessedStartupRef = useRef(false);

  useEffect(() => {
    if (!autoImportDone || hasProcessedStartupRef.current) return;
    hasProcessedStartupRef.current = true;
    void runAutoAiAssignmentCycle();
  }, [autoImportDone]);
}

// === UNIVERSAL JOB POOL ===
// Replaces multiple setTimeouts/setIntervals scattered across components with a single event loop
function useJobPool() {
  const { autoImportDone, triggerRefresh } = useDataStore();
  const refreshDiagnostics = useBackgroundStatusStore((s) => s.refreshDiagnostics);
  const refreshDatabaseSettings = useBackgroundStatusStore(
    (s) => s.refreshDatabaseSettings,
  );
  const loopRef = useRef<number | null>(null);

  const nextDiagnosticsRef = useRef(0);
  const nextRefreshRef = useRef(0);
  const nextSigCheckRef = useRef(0);
  const nextAutoSplitRef = useRef(0);
  const nextSyncIntervalRef = useRef(0);
  const nextSyncPollRef = useRef(0);

  const syncSettingsRef = useRef(loadOnlineSyncSettings());
  const syncFailCountRef = useRef(0);

  const lastSignatureRef = useRef<string | null>(null);
  const localChangeRefreshTimer = useRef<number | null>(null);
  const localChangeSyncTimer = useRef<number | null>(null);
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
      console.warn('[useJobPool] Failed to check today file signature', error);
    }
  }, [autoImportDone, triggerRefresh]);

  const runRefresh = useCallback(async () => {
    if (!autoImportDone || isRefreshingRef.current || !isDocumentVisible()) return;
    isRefreshingRef.current = true;
    try {
      const result = await daemonApi.refreshToday();
      if (result.sessions_upserted > 0) {
        await runAutoAiAssignmentCycle();
      }
    } catch (error) {
      console.warn('[useJobPool] Refresh today failed', error);
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
  }, []);

  const runAutoSplit = useCallback(async () => {
    if (!autoImportDone) return;
    await runAutoSplitCycle(
      runHeavyOperation,
      AI_AND_SPLIT_OPERATION_KEY,
    );
  }, [autoImportDone]);

  const runSync = useCallback(
    async (reason: string, isAuto = true) => {
      if (isSyncingRef.current) return;
      const settings = syncSettingsRef.current;
      if (isAuto && !settings.enabled) return;
      if (isAuto && !isDocumentVisible()) return;
      isSyncingRef.current = true;

      try {
        console.log(`[useJobPool] Running online sync (reason: ${reason})`);
        const result = await runOnlineSyncOnce();
        if (result.action === 'pull') {
          emitProjectsAllTimeInvalidated('online_sync_pull');
        }
        triggerRefresh(`background_sync_${reason}`);
        syncFailCountRef.current = 0; // Reset na sukces
      } catch (e) {
        console.warn('Sync failed:', e);
        syncFailCountRef.current += 1;

        // Exponential backoff logic
        const backoffSec = Math.min(
          300,
          30 * Math.pow(2, syncFailCountRef.current - 1),
        );
        console.log(`Sync backoff: retry assigned in ${backoffSec}s`);
        nextSyncPollRef.current = Date.now() + backoffSec * 1000;
      } finally {
        isSyncingRef.current = false;
      }
    },
    [triggerRefresh],
  );

  useEffect(() => {
    void refreshDiagnostics();
    void refreshDatabaseSettings();
    void bootstrapJobPool({
      autoImportDone,
      lastSignatureRef,
      runRefresh,
    });

    // Universal Event Loop (1 second tick)
    loopRef.current = window.setInterval(() => {
      runJobPoolTick({
        autoImportDone,
        now: Date.now(),
        nextDiagnosticsRef,
        nextRefreshRef,
        nextSigCheckRef,
        nextAutoSplitRef,
        nextSyncIntervalRef,
        nextSyncPollRef,
        syncSettingsRef,
        refreshDiagnostics,
        runRefresh,
        checkFileChange,
        runAutoSplit,
        runSync,
      });
    }, JOB_LOOP_TICK_MS);

    return () => {
      if (loopRef.current !== null) clearInterval(loopRef.current);
    };
  }, [
    autoImportDone,
    checkFileChange,
    refreshDatabaseSettings,
    refreshDiagnostics,
    runAutoSplit,
    runRefresh,
    runSync,
    refreshSyncSettingsCache,
  ]);

  useEffect(() => {
    const {
      handleSyncSettingsChange,
      handleVisibilityChange,
      handleLocalDataChange,
    } = createJobPoolEventHandlers({
      autoImportDone,
      nextDiagnosticsRef,
      nextRefreshRef,
      nextSigCheckRef,
      nextAutoSplitRef,
      nextSyncIntervalRef,
      nextSyncPollRef,
      localChangeRefreshTimer,
      localChangeSyncTimer,
      refreshSyncSettingsCache,
      refreshDiagnostics,
      refreshDatabaseSettings,
      runRefresh,
      runSync,
      triggerRefresh,
    });

    window.addEventListener('focus', handleSyncSettingsChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(
      ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
      handleSyncSettingsChange,
    );
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, handleLocalDataChange);

    return () => {
      window.removeEventListener('focus', handleSyncSettingsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(
        ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
        handleSyncSettingsChange,
      );
      window.removeEventListener(
        LOCAL_DATA_CHANGED_EVENT,
        handleLocalDataChange,
      );
      clearLocalChangeTimers();
    };
  }, [
    autoImportDone,
    clearLocalChangeTimers,
    refreshDatabaseSettings,
    refreshDiagnostics,
    runRefresh,
    runSync,
    triggerRefresh,
    refreshSyncSettingsCache,
  ]);

  useEffect(() => {
    if (!autoImportDone) return;
    nextAutoSplitRef.current = Date.now() + AUTO_SPLIT_INTERVAL_MS;
    void runAutoSplit();
    refreshSyncSettingsCache();
    if (!syncSettingsRef.current.enabled) return;
    void runSync('startup', false);
  }, [autoImportDone, runAutoSplit, runSync, refreshSyncSettingsCache]);
}

export function BackgroundServices() {
  useAutoImporter();
  useAutoProjectSync();
  useAutoSessionRebuild();
  useAutoAiAssignment();
  useJobPool();

  return null;
}
