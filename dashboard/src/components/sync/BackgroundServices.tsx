import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/toast-notification';
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
  type OnlineSyncRunResult,
} from '@/lib/online-sync';
import {
  LOCAL_DATA_CHANGED_EVENT,
  emitProjectsAllTimeInvalidated,
} from '@/lib/sync-events';
import { loadSessionSettings } from '@/lib/user-settings';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import {
  AUTO_SPLIT_INTERVAL_MS,
  JOB_LOOP_TICK_MS,
  bootstrapJobPool,
  buildTodayFileSignatureKey,
  isDocumentVisible,
  runAutoSplitCycle,
  runJobPoolTick,
} from '@/components/sync/job-pool-helpers';

const AI_AND_SPLIT_OPERATION_KEY = 'ai_and_split_pipeline';
const AUTO_PROJECT_SYNC_STORAGE_KEY = 'timeflow.projects.auto-sync-meta';
const AUTO_PROJECT_FOLDER_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
const AUTO_PROJECT_DETECTION_TTL_MS = 24 * 60 * 60 * 1000;

interface AutoProjectSyncMeta {
  lastFolderSyncAt: number | null;
  lastDetectionAt: number | null;
}

function loadAutoProjectSyncMeta(): AutoProjectSyncMeta {
  if (typeof window === 'undefined') {
    return {
      lastFolderSyncAt: null,
      lastDetectionAt: null,
    };
  }

  try {
    const raw = window.localStorage.getItem(AUTO_PROJECT_SYNC_STORAGE_KEY);
    if (!raw) {
      return {
        lastFolderSyncAt: null,
        lastDetectionAt: null,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AutoProjectSyncMeta>;
    return {
      lastFolderSyncAt:
        typeof parsed.lastFolderSyncAt === 'number'
          ? parsed.lastFolderSyncAt
          : null,
      lastDetectionAt:
        typeof parsed.lastDetectionAt === 'number'
          ? parsed.lastDetectionAt
          : null,
    };
  } catch (error) {
    console.warn('Failed to read auto project sync metadata:', error);
    return {
      lastFolderSyncAt: null,
      lastDetectionAt: null,
    };
  }
}

function saveAutoProjectSyncMeta(next: Partial<AutoProjectSyncMeta>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = loadAutoProjectSyncMeta();
    window.localStorage.setItem(
      AUTO_PROJECT_SYNC_STORAGE_KEY,
      JSON.stringify({
        ...current,
        ...next,
      }),
    );
  } catch (error) {
    console.warn('Failed to persist auto project sync metadata:', error);
  }
}

function isExpired(lastRunAt: number | null, ttlMs: number, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= ttlMs;
}

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

type AiAssignmentResult = {
  needsRefresh: boolean;
  deterministicAssigned: number;
  aiAssigned: number;
};

async function runAutoAiAssignmentCycle(): Promise<AiAssignmentResult> {
  const result = await runHeavyOperation(
    AI_AND_SPLIT_OPERATION_KEY,
    async () => {
      let deterministicAssigned = 0;
      let aiAssigned = 0;
      try {
        const det = await aiApi.applyDeterministicAssignment();
        deterministicAssigned = det.sessions_assigned;
      } catch (e) {
        console.warn('Deterministic assignment failed:', e);
      }

      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const aiResult = await aiApi.autoRunIfNeeded(minDuration);
        if (aiResult) aiAssigned = aiResult.assigned;
      } catch (e) {
        console.warn('AI auto-assignment failed:', e);
      }

      const needsRefresh = deterministicAssigned > 0 || aiAssigned > 0;
      return { needsRefresh, deterministicAssigned, aiAssigned };
    },
  );

  return result ?? { needsRefresh: false, deterministicAssigned: 0, aiAssigned: 0 };
}

function shouldRefreshAfterOnlineSync(result: OnlineSyncRunResult): boolean {
  return result.action === 'pull';
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

async function runAutoProjectSyncStartup(
  autoImportResult: ReturnType<typeof useDataStore.getState>['autoImportResult'],
  setDiscoveredProjects: ReturnType<typeof useDataStore.getState>['setDiscoveredProjects'],
): Promise<void> {
  const importedFiles = autoImportResult?.files_imported ?? 0;
  const now = Date.now();
  const meta = loadAutoProjectSyncMeta();
  const shouldRunFolderSync =
    importedFiles > 0 ||
    isExpired(meta.lastFolderSyncAt, AUTO_PROJECT_FOLDER_SYNC_TTL_MS, now);
  const shouldRunDetection =
    importedFiles > 0 ||
    isExpired(meta.lastDetectionAt, AUTO_PROJECT_DETECTION_TTL_MS, now);

  if (!shouldRunFolderSync && !shouldRunDetection) {
    return;
  }

  if (shouldRunFolderSync) {
    const syncResult = await projectsApi.syncProjectsFromFolders();
    saveAutoProjectSyncMeta({ lastFolderSyncAt: now });
    if (syncResult.created_projects.length > 0) {
      setDiscoveredProjects(syncResult.created_projects);
    }
  }

  if (shouldRunDetection) {
    await projectsApi.autoCreateProjectsFromDetection(ALL_TIME_DATE_RANGE, 2);
    saveAutoProjectSyncMeta({ lastDetectionAt: now });
  }
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

function useStartupProjectSyncAndAiAssignment() {
  const { autoImportDone, autoImportResult, setDiscoveredProjects } =
    useDataStore();
  const hasProcessedStartupRef = useRef(false);

  useEffect(() => {
    if (!autoImportDone || hasProcessedStartupRef.current) return;
    hasProcessedStartupRef.current = true;

    let cancelled = false;
    const run = async () => {
      try {
        await runAutoProjectSyncStartup(
          autoImportResult,
          setDiscoveredProjects,
        );
      } catch (error) {
        console.warn('Auto project sync failed:', error);
      }

      if (cancelled) return;

      try {
        const aiResult = await runAutoAiAssignmentCycle();
        dispatchAiAssignmentDone(aiResult);
      } catch (error) {
        console.warn('AI auto-assignment failed:', error);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoImportDone, autoImportResult, setDiscoveredProjects]);
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
      console.warn('[useJobPool] Failed to check today file signature', error);
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
    if (visibilityDebounceTimer.current) {
      window.clearTimeout(visibilityDebounceTimer.current);
      visibilityDebounceTimer.current = null;
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
        if (shouldRefreshAfterOnlineSync(result)) {
          triggerRefresh(`background_sync_${reason}`);
        }
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

  const handleSyncSettingsChange = useEffectEvent(() => {
    refreshSyncSettingsCache();
  });

  const handleDiagnosticsRefresh = useEffectEvent(() => {
    void refreshDiagnostics();
  });

  const handleDatabaseSettingsRefresh = useEffectEvent(() => {
    void refreshDatabaseSettings();
  });

  const handleVisibilityChange = useEffectEvent(() => {
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
      handleDiagnosticsRefresh();
      handleDatabaseSettingsRefresh();

      if (!autoImportDone) return;

      nextRefreshRef.current = 0;
      nextSigCheckRef.current = 0;
      nextAutoSplitRef.current = Date.now() + AUTO_SPLIT_INTERVAL_MS;
      nextSyncIntervalRef.current = 0;
      nextSyncPollRef.current = 0;
      void runRefresh();
    }, 500);
  });

  const handleLocalDataChange = useEffectEvent(() => {
    if (!isDocumentVisible()) return;

    handleDatabaseSettingsRefresh();

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
  });

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
        refreshDiagnostics: handleDiagnosticsRefresh,
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
    runAutoSplit,
    runRefresh,
    runSync,
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
    void runSync('startup', false);
  }, [autoImportDone, runAutoSplit, runSync, refreshSyncSettingsCache]);
}

const AI_ASSIGNMENT_DONE_EVENT = 'timeflow:ai-assignment-done';

function dispatchAiAssignmentDone(result: AiAssignmentResult) {
  const total = result.deterministicAssigned + result.aiAssigned;
  if (total > 0) {
    window.dispatchEvent(
      new CustomEvent(AI_ASSIGNMENT_DONE_EVENT, { detail: total }),
    );
  }
}

export function BackgroundServices() {
  useAutoImporter();
  useAutoSessionRebuild();
  useStartupProjectSyncAndAiAssignment();
  useJobPool();

  const { t } = useTranslation();
  const { showInfo } = useToast();
  const handleAiAssignmentDone = useEffectEvent((e: Event) => {
    const count = (e as CustomEvent<number>).detail;
    showInfo(t('background.ai_assigned_sessions', { count }));
  });
  useEffect(() => {
    window.addEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
    return () => window.removeEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
  }, []);

  return null;
}

