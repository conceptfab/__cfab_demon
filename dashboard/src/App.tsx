import { Component, lazy, Suspense, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast-notification";
import { useAppStore } from "@/store/app-store";
import {
  autoCreateProjectsFromDetection,
  autoImportFromDataDir,
  getTodayFileSignature,
  refreshToday,
  syncProjectsFromFolders,
  rebuildSessions,
} from "@/lib/tauri";
import { loadSessionSettings } from "@/lib/user-settings";
import { Dashboard } from "@/pages/Dashboard";

const Projects = lazy(() => import("@/pages/Projects").then((m) => ({ default: m.Projects })));
const Applications = lazy(() => import("@/pages/Applications").then((m) => ({ default: m.Applications })));
const TimeAnalysis = lazy(() => import("@/pages/TimeAnalysis").then((m) => ({ default: m.TimeAnalysis })));
const Sessions = lazy(() => import("@/pages/Sessions").then((m) => ({ default: m.Sessions })));
const ImportPage = lazy(() => import("@/pages/ImportPage").then((m) => ({ default: m.ImportPage })));
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));
const DaemonControl = lazy(() => import("@/pages/DaemonControl").then((m) => ({ default: m.DaemonControl })));
const DataManagement = lazy(() => import("@/pages/Data").then((m) => ({ default: m.DataManagement })));
const AIPage = lazy(() => import("@/pages/AI").then((m) => ({ default: m.AIPage })));

function PageRouter() {
  const currentPage = useAppStore((s) => s.currentPage);

  const page = (() => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard />;
      case "projects":
        return <Projects />;
      case "applications":
        return <Applications />;
      case "analysis":
        return <TimeAnalysis />;
      case "sessions":
        return <Sessions />;
      case "import":
        return <ImportPage />;
      case "data":
        return <DataManagement />;
      case "ai":
        return <AIPage />;
      case "daemon":
        return <DaemonControl />;
      case "settings":
        return <Settings />;
      default:
        return <Dashboard />;
    }
  })();

  return <Suspense fallback={<div className="flex h-64 items-center justify-center text-muted-foreground">Loading...</div>}>{page}</Suspense>;
}

function AutoImporter() {
  const { autoImportDone, setAutoImportDone, triggerRefresh } = useAppStore();

  useEffect(() => {
    if (autoImportDone) return;

    let longRunningWarned = false;
    const warnTimer = setTimeout(() => {
      longRunningWarned = true;
      console.warn("Auto-import is still running (longer than 8s)...");
    }, 8_000);

    autoImportFromDataDir()
      .then((result) => {
        setAutoImportDone(true, result);
        if (result.files_imported > 0) {
          triggerRefresh();
        }
        if (result.files_imported > 0) {
          console.log(
            `Auto-import: ${result.files_imported} files imported, ${result.files_archived} archived`
          );
        }
        if (result.errors.length > 0) {
          console.warn("Auto-import errors:", result.errors);
        }
        if (longRunningWarned) {
          console.log("Auto-import finished after long run.");
        }
      })
      .catch((e) => {
        console.error("Auto-import failed:", e);
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
    }) => `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? "na"}:${sig.size_bytes ?? "na"}`;

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
          { start: "2020-01-01", end: "2100-01-01" },
          2
        );
        if (synced > 0 || detected > 0) {
          useAppStore.getState().triggerRefresh();
        }
      } catch (e) {
        console.warn("Auto project sync failed:", e);
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
        console.warn("Auto session rebuild failed:", e);
      }
    };
    run();
  }, []);

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
    console.error("Uncaught render error:", error, info.componentStack);
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
          <AutoRefresher />
          <AutoProjectSync />
          <AutoSessionRebuild />
          <MainLayout>
            <PageRouter />
          </MainLayout>
        </TooltipProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
