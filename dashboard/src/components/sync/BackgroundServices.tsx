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
import { loadLanSyncSettings, loadLanSyncState } from '@/lib/lan-sync';
import { lanSyncApi } from '@/lib/tauri';
import { connectSSE, disconnectSSE } from '@/lib/sync/sync-sse';
import { DaemonSyncOverlay } from '@/components/sync/DaemonSyncOverlay';
import { LanPeerNotification } from '@/components/sync/LanPeerNotification';
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

      isLanSyncingRef.current = true;
      console.log(`[useJobPool] Running LAN sync interval with peer ${activePeer.machine_name}`);

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
      console.warn('[useJobPool] LAN sync interval failed:', e);
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
        console.log(`[useJobPool] Running online sync (reason: ${reason})`);
        const result = await runOnlineSyncOnce({
          isStartupSync: reason === 'startup',
        });
        if (result.action === 'pull') {
          emitProjectsAllTimeInvalidated('online_sync_pull');
        }
        if (shouldRefreshAfterOnlineSync(result)) {
          triggerRefresh(`background_sync_${reason}`);
        }
        dispatchOnlineSyncDone(result.action, reason);
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
      nextSyncPollRef.current = Date.now() + 120_000;
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
        nextLanSyncRef,
        syncSettingsRef,
        refreshDiagnostics: handleDiagnosticsRefresh,
        runRefresh,
        checkFileChange,
        runAutoSplit,
        runSync,
        runLanSyncInterval,
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
    runLanSyncInterval,
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
const ONLINE_SYNC_DONE_EVENT = 'timeflow:online-sync-done';
const LAN_SYNC_DONE_EVENT = 'timeflow:lan-sync-done';

function dispatchOnlineSyncDone(action: string, reason: string) {
  if (action !== 'none') {
    window.dispatchEvent(
      new CustomEvent(ONLINE_SYNC_DONE_EVENT, { detail: { action, reason } }),
    );
  }
}

function dispatchLanSyncDone(peerName: string) {
  window.dispatchEvent(
    new CustomEvent(LAN_SYNC_DONE_EVENT, { detail: { peerName } }),
  );
}

function dispatchAiAssignmentDone(result: AiAssignmentResult) {
  const total = result.deterministicAssigned + result.aiAssigned;
  if (total > 0) {
    window.dispatchEvent(
      new CustomEvent(AI_ASSIGNMENT_DONE_EVENT, { detail: total }),
    );
  }
}

function useLanSyncServerStartup() {
  useEffect(() => {
    const settings = loadLanSyncSettings();
    if (settings.enabled) {
      lanSyncApi.startLanServer(settings.serverPort).catch((e) => {
        console.warn('Failed to start LAN server on startup:', e);
      });
    }
    return () => {
      lanSyncApi.stopLanServer().catch(() => {});
    };
  }, []);
}

function useOnlineSyncSSE() {
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  useEffect(() => {
    const settings = loadOnlineSyncSettings();
    if (!settings.enabled) return;

    void connectSSE(async (event) => {
      console.log(`[SSE] Peer ${event.sourceDeviceId} pushed rev ${event.revision} — triggering pull`);
      try {
        const result = await runOnlineSyncOnce();
        if (result.action === 'pull') {
          emitProjectsAllTimeInvalidated('sse_sync_pull');
          triggerRefresh('sse_sync_pull');
          dispatchOnlineSyncDone('pull', 'sse_notification');
        }
      } catch (e) {
        console.warn('[SSE] Auto-sync after notification failed:', e);
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

export function BackgroundServices() {
  useAutoImporter();
  useAutoSessionRebuild();
  useStartupProjectSyncAndAiAssignment();
  useJobPool();
  useLanSyncServerStartup();
  useOnlineSyncSSE();

  const { t } = useTranslation();
  const { showInfo } = useToast();
  const handleAiAssignmentDone = useEffectEvent((e: Event) => {
    const count = (e as CustomEvent<number>).detail;
    showInfo(t('background.ai_assigned_sessions', { count }));
  });
  const handleOnlineSyncDone = useEffectEvent((e: Event) => {
    const { action, reason } = (e as CustomEvent<{ action: string; reason: string }>).detail;
    if (action === 'pull') {
      showInfo(t('background.online_sync_pulled', { defaultValue: 'Dane zsynchronizowane z serwera' }));
    } else if (action === 'push') {
      showInfo(t('background.online_sync_pushed', { defaultValue: 'Dane wysłane na serwer' }));
    }
  });
  const handleLanSyncDone = useEffectEvent((e: Event) => {
    const { peerName } = (e as CustomEvent<{ peerName: string }>).detail;
    showInfo(t('background.lan_sync_done', { peer: peerName, defaultValue: `LAN sync z ${peerName} zakończony` }));
  });
  useEffect(() => {
    window.addEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
    window.addEventListener(ONLINE_SYNC_DONE_EVENT, handleOnlineSyncDone);
    window.addEventListener(LAN_SYNC_DONE_EVENT, handleLanSyncDone);
    return () => {
      window.removeEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
      window.removeEventListener(ONLINE_SYNC_DONE_EVENT, handleOnlineSyncDone);
      window.removeEventListener(LAN_SYNC_DONE_EVENT, handleLanSyncDone);
    };
  }, []);

  return (
    <>
      <LanPeerNotification />
      <DaemonSyncOverlay />
    </>
  );
}

