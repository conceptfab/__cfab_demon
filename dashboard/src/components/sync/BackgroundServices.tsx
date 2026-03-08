import { useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import {
  autoCreateProjectsFromDetection,
  autoImportFromDataDir,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  analyzeSessionProjects,
  getTodayFileSignature,
  getSessions,
  refreshToday,
  splitSessionMulti,
  syncProjectsFromFolders,
  rebuildSessions,
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
import { loadSessionSettings, loadSplitSettings } from '@/lib/user-settings';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-ranges';
import type { MultiProjectAnalysis, SplitPart } from '@/lib/db-types';

const JOB_LOOP_TICK_MS = 5000;
const AUTO_SPLIT_THROTTLE_MS = 100;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function isSessionAlreadySplit(session: {
  split_source_session_id?: number | null;
}): boolean {
  return typeof session.split_source_session_id === 'number';
}

function buildAutoSplits(
  analysis: MultiProjectAnalysis,
  maxProjects: number,
): SplitPart[] {
  const candidates = analysis.candidates
    .filter((candidate) => candidate.score > 0)
    .slice(0, Math.max(2, Math.min(5, maxProjects)));

  if (candidates.length < 2) return [];

  const totalScore = candidates.reduce(
    (acc, candidate) => acc + candidate.score,
    0,
  );
  if (totalScore <= 0) return [];

  const raw: SplitPart[] = candidates.map((candidate) => ({
    project_id: candidate.project_id,
    ratio: candidate.score / totalScore,
  }));

  const ratioSum = raw.reduce((acc, part) => acc + part.ratio, 0);
  if (ratioSum > 0 && Math.abs(1 - ratioSum) > 0.000_001) {
    raw.forEach((part) => {
      part.ratio = part.ratio / ratioSum;
    });
  }
  return raw;
}

async function runAutoAiAssignmentCycle(): Promise<boolean> {
  const result = await runHeavyOperation(
    AI_AND_SPLIT_OPERATION_KEY,
    async () => {
      let needsRefresh = false;
      try {
        const det = await applyDeterministicAssignment();
        if (det.sessions_assigned > 0) needsRefresh = true;
      } catch (e) {
        console.warn('Deterministic assignment failed:', e);
      }

      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const aiResult = await autoRunIfNeeded(minDuration);
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

    autoImportFromDataDir()
      .then((result) => {
        setAutoImportDone(true, result);
        if (result.files_imported > 0) {
          triggerRefresh();
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
        const syncResult = await syncProjectsFromFolders();
        await autoCreateProjectsFromDetection(ALL_TIME_DATE_RANGE, 2);
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
            rebuildSessions(settings.gapFillMinutes),
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

function useAutoSplitSessions() {
  const { autoImportDone } = useDataStore();

  const runAutoSplit = useCallback(async () => {
    if (!autoImportDone) return;

    const splitSettings = loadSplitSettings();
    if (!splitSettings.autoSplitEnabled) return;

    const minDuration =
      loadSessionSettings().minSessionDurationSeconds || undefined;
    await runHeavyOperation(AI_AND_SPLIT_OPERATION_KEY, async () => {
      const sessions = await getSessions({
        limit: 50,
        offset: 0,
        unassigned: true,
        includeFiles: false,
        includeAiSuggestions: true,
        minDuration,
      });

      let splitCount = 0;
      let firstIteration = true;
      for (const session of sessions) {
        if (!firstIteration) {
          await sleep(AUTO_SPLIT_THROTTLE_MS);
        }
        firstIteration = false;

        if (isSessionAlreadySplit(session)) continue;

        const analysis = await analyzeSessionProjects(
          session.id,
          splitSettings.toleranceThreshold,
          splitSettings.maxProjectsPerSession,
        );
        if (!analysis.is_splittable) continue;

        const splits = buildAutoSplits(
          analysis,
          splitSettings.maxProjectsPerSession,
        );
        if (splits.length < 2) continue;

        await splitSessionMulti(session.id, splits);
        splitCount += 1;
        if (splitCount >= 5) break;
      }

      return splitCount;
    });
  }, [autoImportDone]);

  const runAutoSplitRef = useRef(runAutoSplit);
  useEffect(() => {
    runAutoSplitRef.current = runAutoSplit;
  }, [runAutoSplit]);

  useEffect(() => {
    if (!autoImportDone) return;

    void runAutoSplitRef.current();
    const interval = window.setInterval(() => {
      void runAutoSplitRef.current();
    }, 60_000);
    return () => clearInterval(interval);
  }, [autoImportDone]);
}

// === UNIVERSAL JOB POOL ===
// Replaces multiple setTimeouts/setIntervals scattered across components with a single event loop
function useJobPool() {
  const { autoImportDone, triggerRefresh } = useDataStore();
  const loopRef = useRef<number | null>(null);

  const nextRefreshRef = useRef(0);
  const nextSigCheckRef = useRef(0);
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
      const sig = await getTodayFileSignature();
      const current = `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}:${sig.revision ?? 'na'}`;
      if (
        lastSignatureRef.current !== null &&
        lastSignatureRef.current !== current
      ) {
        triggerRefresh();
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
      const result = await refreshToday();
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
        triggerRefresh();
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
    if (!autoImportDone) return;
    let disposed = false;

    // Bootstrap initial data
    if (isDocumentVisible()) {
      void runRefresh().then(() => {
        if (disposed) return;
        getTodayFileSignature()
          .then((sig) => {
            lastSignatureRef.current = `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}:${sig.revision ?? 'na'}`;
          })
          .catch(() => {});
      });
    }

    // Universal Event Loop (1 second tick)
    loopRef.current = window.setInterval(() => {
      if (!isDocumentVisible()) return;
      const now = Date.now();

      if (autoImportDone && now >= nextRefreshRef.current) {
        nextRefreshRef.current = now + 60_000;
        void runRefresh();
      }
      if (autoImportDone && now >= nextSigCheckRef.current) {
        nextSigCheckRef.current = now + 5_000;
        void checkFileChange();
      }

      if (autoImportDone) {
        const syncSettings = syncSettingsRef.current;
        if (syncSettings.enabled) {
          if (now >= nextSyncIntervalRef.current) {
            nextSyncIntervalRef.current =
              now + Math.max(1, syncSettings.autoSyncIntervalMinutes) * 60_000;
            void runSync('interval');
          }

          if (now >= nextSyncPollRef.current) {
            nextSyncPollRef.current = now + 120_000;
            void runSync('poll');
          }
        }
      }
    }, JOB_LOOP_TICK_MS);

    return () => {
      disposed = true;
      if (loopRef.current !== null) clearInterval(loopRef.current);
    };
  }, [
    autoImportDone,
    checkFileChange,
    runRefresh,
    runSync,
    refreshSyncSettingsCache,
  ]);

  useEffect(() => {
    const handleSyncSettingsChange = () => {
      refreshSyncSettingsCache();
    };

    const handleVisibilityChange = () => {
      refreshSyncSettingsCache();
      if (!autoImportDone || !isDocumentVisible()) return;
      nextRefreshRef.current = 0;
      nextSigCheckRef.current = 0;
      nextSyncIntervalRef.current = 0;
      nextSyncPollRef.current = 0;
      void runRefresh();
    };

    const handleLocalDataChange = () => {
      if (!isDocumentVisible()) return;
      if (localChangeRefreshTimer.current)
        window.clearTimeout(localChangeRefreshTimer.current);
      localChangeRefreshTimer.current = window.setTimeout(
        () => triggerRefresh(),
        120,
      );

      if (autoImportDone) {
        if (localChangeSyncTimer.current)
          window.clearTimeout(localChangeSyncTimer.current);
        localChangeSyncTimer.current = window.setTimeout(() => {
          void runSync('local_change');
        }, 1_500);
      }
    };

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
      if (localChangeRefreshTimer.current)
        window.clearTimeout(localChangeRefreshTimer.current);
      if (localChangeSyncTimer.current)
        window.clearTimeout(localChangeSyncTimer.current);
    };
  }, [autoImportDone, runRefresh, runSync, triggerRefresh, refreshSyncSettingsCache]);

  useEffect(() => {
    if (!autoImportDone) return;
    void runSync('startup', false);
  }, [autoImportDone, runSync]);
}

export function BackgroundServices() {
  useAutoImporter();
  useAutoProjectSync();
  useAutoSessionRebuild();
  useAutoAiAssignment();
  useAutoSplitSessions();
  useJobPool();

  return null;
}
