import { useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import {
  autoCreateProjectsFromDetection,
  autoImportFromDataDir,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  getTodayFileSignature,
  refreshToday,
  syncProjectsFromFolders,
  rebuildSessions,
} from '@/lib/tauri';
import {
  ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
  loadOnlineSyncSettings,
  runOnlineSyncOnce,
} from '@/lib/online-sync';
import { LOCAL_DATA_CHANGED_EVENT } from '@/lib/sync-events';
import { loadSessionSettings } from '@/lib/user-settings';

// === BACKGROUND HOOKS ===

function useAutoImporter() {
  const { autoImportDone, setAutoImportDone, triggerRefresh } = useDataStore();

  useEffect(() => {
    if (autoImportDone) return;
    let longRunningWarned = false;
    const warnTimer = setTimeout(() => {
      longRunningWarned = true;
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
        const synced = await syncProjectsFromFolders();
        const detected = await autoCreateProjectsFromDetection(
          { start: '2000-01-01', end: '2100-01-01' },
          2,
        );
        if (synced > 0 || detected > 0) {
          useDataStore.getState().triggerRefresh();
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
          const merged = await rebuildSessions(settings.gapFillMinutes);
          if (merged > 0) {
            useDataStore.getState().triggerRefresh();
          }
        }
      } catch (e) {
        console.warn('Auto session rebuild failed:', e);
      }
    };
    void run();
  }, []);
}

function useAutoAiAssignment() {
  const { autoImportDone, refreshKey, triggerRefresh } = useDataStore();
  const lastProcessedKey = useRef(-1);

  useEffect(() => {
    if (!autoImportDone || lastProcessedKey.current === refreshKey) return;
    lastProcessedKey.current = refreshKey;

    const run = async () => {
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
        const result = await autoRunIfNeeded(minDuration);
        if (result && result.assigned > 0) needsRefresh = true;
      } catch (e) {
        console.warn('AI auto-assignment failed:', e);
      }

      if (needsRefresh) triggerRefresh();
    };

    void run();
  }, [autoImportDone, refreshKey, triggerRefresh]);
}

// === UNIVERSAL JOB POOL ===
// Replaces multiple setTimeouts/setIntervals scattered across components with a single event loop

function useJobPool() {
  const { autoImportDone, triggerRefresh } = useDataStore();

  const startupAttemptedRef = useRef(false);
  const syncRunningRef = useRef(false);
  const refreshingRef = useRef(false);
  const lastSignatureRef = useRef<string | null>(null);

  const loopRef = useRef<number | null>(null);
  const nextRefreshRef = useRef(Date.now() + 30_000);
  const nextSigCheckRef = useRef(Date.now() + 5_000);
  const nextSyncIntervalRef = useRef(0);
  const nextSyncPollRef = useRef(Date.now() + 20_000);

  const localChangeSyncTimer = useRef<number | null>(null);
  const localChangeRefreshTimer = useRef<number | null>(null);

  const runRefresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const result = await refreshToday();
      if (result.file_found) triggerRefresh();
    } catch {
      // Ignore
    } finally {
      refreshingRef.current = false;
    }
  };

  const checkFileChange = async () => {
    try {
      const sig = await getTodayFileSignature();
      const key = `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}`;
      if (lastSignatureRef.current === null) {
        lastSignatureRef.current = key;
        return;
      }
      if (key !== lastSignatureRef.current) {
        lastSignatureRef.current = key;
        await runRefresh();
      }
    } catch {
      // Ignore
    }
  };

  const runSync = async (source: string, ignoreStartupToggle = true) => {
    if (syncRunningRef.current) return;
    syncRunningRef.current = true;
    try {
      const result = await runOnlineSyncOnce({ ignoreStartupToggle });
      if (result.skipped) return;
      if (result.ok && result.action === 'pull') triggerRefresh();
    } catch (error) {
      console.warn(`Online sync (${source}) failed:`, String(error));
    } finally {
      syncRunningRef.current = false;
    }
  };

  useEffect(() => {
    let disposed = false;

    // Bootstrap initial data
    void runRefresh().then(() => {
      if (disposed) return;
      getTodayFileSignature()
        .then((sig) => {
          lastSignatureRef.current = `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}`;
        })
        .catch(() => {});
    });

    // Universal Event Loop (1 second tick)
    loopRef.current = window.setInterval(() => {
      const now = Date.now();

      if (now >= nextRefreshRef.current) {
        nextRefreshRef.current = now + 30_000;
        void runRefresh();
      }
      if (now >= nextSigCheckRef.current) {
        nextSigCheckRef.current = now + 5_000;
        void checkFileChange();
      }

      if (autoImportDone) {
        const syncSettings = loadOnlineSyncSettings();
        if (syncSettings.enabled) {
          if (nextSyncIntervalRef.current === 0) {
            nextSyncIntervalRef.current =
              now + Math.max(1, syncSettings.autoSyncIntervalMinutes) * 60_000;
          } else if (now >= nextSyncIntervalRef.current) {
            nextSyncIntervalRef.current =
              now + Math.max(1, syncSettings.autoSyncIntervalMinutes) * 60_000;
            void runSync('interval');
          }

          if (now >= nextSyncPollRef.current) {
            nextSyncPollRef.current = now + 20_000;
            void runSync('poll');
          }
        }
      }
    }, 1000);

    return () => {
      disposed = true;
      if (loopRef.current !== null) clearInterval(loopRef.current);
    };
  }, [autoImportDone, triggerRefresh]);

  useEffect(() => {
    const handleSyncSettingsChange = () => {
      const syncSettings = loadOnlineSyncSettings();
      nextSyncIntervalRef.current =
        Date.now() + Math.max(1, syncSettings.autoSyncIntervalMinutes) * 60_000;
      nextSyncPollRef.current = Date.now() + 20_000;
    };

    const handleLocalDataChange = () => {
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
          if (!syncRunningRef.current) void runSync('local_change');
        }, 1_500);
      }
    };

    window.addEventListener('focus', handleSyncSettingsChange);
    window.addEventListener(
      ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
      handleSyncSettingsChange,
    );
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, handleLocalDataChange);

    return () => {
      window.removeEventListener('focus', handleSyncSettingsChange);
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
  }, [autoImportDone, triggerRefresh]);

  useEffect(() => {
    if (!autoImportDone || startupAttemptedRef.current) return;
    startupAttemptedRef.current = true;
    void runSync('startup', false);
  }, [autoImportDone]);
}

export function BackgroundServices() {
  useAutoImporter();
  useAutoProjectSync();
  useAutoSessionRebuild();
  useAutoAiAssignment();
  useJobPool();

  return null;
}
