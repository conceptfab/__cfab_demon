import { Component, lazy, Suspense, useEffect, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast-notification';
import { useAppStore } from '@/store/app-store';
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
import {
  LOCAL_DATA_CHANGED_EVENT,
} from '@/lib/sync-events';
import { loadSessionSettings } from '@/lib/user-settings';
import { Dashboard } from '@/pages/Dashboard';

const Projects = lazy(() =>
  import('@/pages/Projects').then((m) => ({ default: m.Projects })),
);
const Estimates = lazy(() =>
  import('@/pages/Estimates').then((m) => ({ default: m.Estimates })),
);
const Applications = lazy(() =>
  import('@/pages/Applications').then((m) => ({ default: m.Applications })),
);
const TimeAnalysis = lazy(() =>
  import('@/pages/TimeAnalysis').then((m) => ({ default: m.TimeAnalysis })),
);
const Sessions = lazy(() =>
  import('@/pages/Sessions').then((m) => ({ default: m.Sessions })),
);
const ImportPage = lazy(() =>
  import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const Settings = lazy(() =>
  import('@/pages/Settings').then((m) => ({ default: m.Settings })),
);
const DaemonControl = lazy(() =>
  import('@/pages/DaemonControl').then((m) => ({ default: m.DaemonControl })),
);
const DataManagement = lazy(() =>
  import('@/pages/Data').then((m) => ({ default: m.DataManagement })),
);
const AIPage = lazy(() =>
  import('@/pages/AI').then((m) => ({ default: m.AIPage })),
);
const QuickStart = lazy(() =>
  import('@/pages/QuickStart').then((m) => ({ default: m.QuickStart })),
);
const Help = lazy(() =>
  import('@/pages/Help').then((m) => ({ default: m.Help })),
);
const ProjectPage = lazy(() =>
  import('@/pages/ProjectPage').then((m) => ({ default: m.ProjectPage })),
);

function PageRouter() {
  const currentPage = useAppStore((s) => s.currentPage);

  const page = (() => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'projects':
        return <Projects />;
      case 'estimates':
        return <Estimates />;
      case 'applications':
        return <Applications />;
      case 'analysis':
        return <TimeAnalysis />;
      case 'sessions':
        return <Sessions />;
      case 'import':
        return <ImportPage />;
      case 'data':
        return <DataManagement />;
      case 'ai':
        return <AIPage />;
      case 'daemon':
        return <DaemonControl />;
      case 'settings':
        return <Settings />;
      case 'help':
        return <Help />;
      case 'quickstart':
        return <QuickStart />;
      case 'project-card':
        return <ProjectPage />;
      default:
        return <Dashboard />;
    }
  })();

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading...
        </div>
      }
    >
      {page}
    </Suspense>
  );
}

function AutoImporter() {
  const { autoImportDone, setAutoImportDone, triggerRefresh } = useAppStore();

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
          console.log(
            `Auto-import: ${result.files_imported} files imported, ${result.files_archived} archived`,
          );
        }
        if (result.errors.length > 0) {
          console.warn('Auto-import errors:', result.errors);
        }
        if (longRunningWarned) {
          console.log('Auto-import finished after long run.');
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
      .finally(() => {
        clearTimeout(warnTimer);
      });

    return () => clearTimeout(warnTimer);
  }, [autoImportDone, setAutoImportDone, triggerRefresh]);

  return null;
}

function AutoRefresher() {
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    let lastSignature: string | null = null;

    const signatureKey = (sig: {
      exists: boolean;
      modified_unix_ms: number | null;
      size_bytes: number | null;
    }) =>
      `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}`;

    const runRefresh = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const result = await refreshToday();
        // If today's file exists, refresh UI even when upserted count is 0
        // (e.g. data already in DB but views still need re-fetch).
        if (!disposed && result.file_found) {
          triggerRefresh();
        }
      } catch {
        // Silently ignore refresh errors
      } finally {
        refreshing = false;
      }
    };

    const checkFileChange = async () => {
      if (disposed) return;
      try {
        const sig = await getTodayFileSignature();
        const key = signatureKey(sig);
        if (lastSignature === null) {
          lastSignature = key;
          return;
        }
        if (key !== lastSignature) {
          lastSignature = key;
          await runRefresh();
        }
      } catch {
        // Ignore watcher read errors
      }
    };

    const bootstrap = async () => {
      await runRefresh();
      try {
        const sig = await getTodayFileSignature();
        lastSignature = signatureKey(sig);
      } catch {
        // ignore initial signature read errors
      }
    };

    // Initial automatic refresh + watcher baseline.
    bootstrap();
    const interval = setInterval(() => {
      void runRefresh();
    }, 30_000); // periodic safety refresh
    const watcher = setInterval(() => {
      void checkFileChange();
    }, 5_000); // JSON change detection (5s reduces IPC overhead vs 2s)

    return () => {
      disposed = true;
      clearInterval(interval);
      clearInterval(watcher);
    };
  }, [triggerRefresh]);

  return null;
}

function AutoProjectSync() {
  useEffect(() => {
    const run = async () => {
      try {
        const synced = await syncProjectsFromFolders();
        const detected = await autoCreateProjectsFromDetection(
          { start: '2000-01-01', end: '2100-01-01' },
          2,
        );
        if (synced > 0 || detected > 0) {
          useAppStore.getState().triggerRefresh();
        }
      } catch (e) {
        console.warn('Auto project sync failed:', e);
      }
    };
    run();
  }, []);

  return null;
}

function AutoSessionRebuild() {
  useEffect(() => {
    const run = async () => {
      try {
        const settings = loadSessionSettings();
        if (settings.rebuildOnStartup && settings.gapFillMinutes > 0) {
          const merged = await rebuildSessions(settings.gapFillMinutes);
          if (merged > 0) {
            console.log(`Auto session rebuild: merged ${merged} sessions`);
            useAppStore.getState().triggerRefresh();
          }
        }
      } catch (e) {
        console.warn('Auto session rebuild failed:', e);
      }
    };
    run();
  }, []);

  return null;
}

function AutoAiAssignment() {
  const { autoImportDone, refreshKey, triggerRefresh } = useAppStore();

  useEffect(() => {
    if (!autoImportDone) return;

    const run = async () => {
      let needsRefresh = false;

      // Layer 2: Deterministic rules (100% consistent app→project mapping)
      try {
        const det = await applyDeterministicAssignment();
        if (det.sessions_assigned > 0) {
          console.log(
            `Deterministic assignment: ${det.sessions_assigned} sessions assigned (${det.apps_with_rules} app rules)`,
          );
          needsRefresh = true;
        }
      } catch (e) {
        console.warn('Deterministic assignment failed:', e);
      }

      // Layer 3: ML auto-safe assignment
      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const result = await autoRunIfNeeded(minDuration);
        if (result && result.assigned > 0) {
          console.log(
            `AI auto-assignment: assigned ${result.assigned} / ${result.scanned} sessions`,
          );
          needsRefresh = true;
        }
      } catch (e) {
        console.warn('AI auto-assignment failed:', e);
      }

      if (needsRefresh) {
        triggerRefresh();
      }
    };

    run();
  }, [autoImportDone, refreshKey, triggerRefresh]);

  return null;
}

function AutoOnlineSync() {
  const autoImportDone = useAppStore((s) => s.autoImportDone);
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);
  const startupAttemptedRef = useRef(false);
  const runningRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const localChangeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!autoImportDone) return;

    let disposed = false;
    type SyncRunResult = Awaited<ReturnType<typeof runOnlineSyncOnce>>;
    type SyncSource = 'startup' | 'interval' | 'poll' | 'local_change';

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const clearLocalChangeTimer = () => {
      if (localChangeTimerRef.current !== null) {
        window.clearTimeout(localChangeTimerRef.current);
        localChangeTimerRef.current = null;
      }
    };
    const clearPollTimer = () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const handleResult = async (
      resultPromise: Promise<SyncRunResult>,
      source: SyncSource,
    ) => {
      if (runningRef.current) {
        return;
      }

      runningRef.current = true;
      let result: SyncRunResult;
      try {
        result = await resultPromise;
      } finally {
        runningRef.current = false;
      }

      if (disposed) return;
      if (result.skipped) {
        if (result.reason !== 'disabled' && result.reason !== 'demo_mode') {
          console.log(`Online sync (${source}) skipped: ${result.reason}`);
        }
        return;
      }

      if (!result.ok) {
        console.warn(
          `Online sync (${source}) failed:`,
          result.error ?? result.reason,
        );
        return;
      }

      if (result.action === 'pull') {
        console.log(
          `Online sync (${source}): pulled newer snapshot from server`,
        );
        triggerRefresh();
      } else if (result.action === 'push') {
        console.log(`Online sync (${source}): pushed local snapshot to server`);
      } else if (result.action === 'noop') {
        console.log(`Online sync (${source}): no changes to push`);
      }
    };

    const runOnce = async (source: SyncSource) => {
      try {
        if (source === 'startup') {
          await handleResult(runOnlineSyncOnce(), source);
          return;
        }

        await handleResult(
          runOnlineSyncOnce({ ignoreStartupToggle: true }),
          source,
        );
      } catch (error) {
        runningRef.current = false;
        if (!disposed) {
          console.warn(`Online sync (${source}) failed:`, String(error));
        }
      }
    };

    const scheduleNextIntervalSync = () => {
      clearTimer();
      if (disposed) return;

      const settings = loadOnlineSyncSettings();
      if (!settings.enabled) {
        return;
      }

      const delayMs = Math.max(1, settings.autoSyncIntervalMinutes) * 60_000;
      timerRef.current = window.setTimeout(() => {
        void (async () => {
          await runOnce('interval');
          scheduleNextIntervalSync();
        })();
      }, delayMs);
    };

    const schedulePollSync = () => {
      clearPollTimer();
      if (disposed) return;

      const settings = loadOnlineSyncSettings();
      if (!settings.enabled) {
        return;
      }

      const delayMs = 20_000;
      pollTimerRef.current = window.setTimeout(() => {
        void (async () => {
          await runOnce('poll');
          schedulePollSync();
        })();
      }, delayMs);
    };

    const scheduleLocalChangeSync = () => {
      clearLocalChangeTimer();
      if (disposed) return;
      localChangeTimerRef.current = window.setTimeout(() => {
        if (runningRef.current) {
          scheduleLocalChangeSync();
          return;
        }
        void runOnce('local_change');
      }, 1_500);
    };

    const bootstrap = async () => {
      if (!startupAttemptedRef.current) {
        startupAttemptedRef.current = true;
        await runOnce('startup');
      }
      scheduleNextIntervalSync();
      schedulePollSync();
    };

    void bootstrap();

    const reschedule = () => {
      // Re-read settings after local changes and move the next tick to the new interval.
      scheduleNextIntervalSync();
      schedulePollSync();
    };
    const syncAfterLocalChange = () => {
      scheduleLocalChangeSync();
    };
    window.addEventListener('focus', reschedule);
    window.addEventListener(ONLINE_SYNC_SETTINGS_CHANGED_EVENT, reschedule);
    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, syncAfterLocalChange);

    return () => {
      disposed = true;
      clearTimer();
      clearPollTimer();
      clearLocalChangeTimer();
      window.removeEventListener('focus', reschedule);
      window.removeEventListener(
        ONLINE_SYNC_SETTINGS_CHANGED_EVENT,
        reschedule,
      );
      window.removeEventListener(
        LOCAL_DATA_CHANGED_EVENT,
        syncAfterLocalChange,
      );
    };
  }, [autoImportDone, triggerRefresh]);

  return null;
}

function AutoLocalMutationRefresh() {
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onLocalDataChanged = () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        triggerRefresh();
      }, 120);
    };

    window.addEventListener(LOCAL_DATA_CHANGED_EVENT, onLocalDataChanged);
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      window.removeEventListener(LOCAL_DATA_CHANGED_EVENT, onLocalDataChanged);
    };
  }, [triggerRefresh]);

  return null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-200">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-slate-400">{this.state.error.message}</p>
            <button
              className="rounded bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <TooltipProvider>
          <AutoImporter />
          <AutoAiAssignment />
          <AutoRefresher />
          <AutoProjectSync />
          <AutoSessionRebuild />
          <AutoLocalMutationRefresh />
          <AutoOnlineSync />
          <MainLayout>
            <PageRouter />
          </MainLayout>
        </TooltipProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
