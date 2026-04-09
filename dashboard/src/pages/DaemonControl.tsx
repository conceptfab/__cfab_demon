import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Cpu,
  ScrollText,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { useBackgroundStatusStore } from "@/store/background-status-store";
import { daemonApi, readLogFile } from "@/lib/tauri";
import { useCancellableAsync } from "@/lib/async-utils";
import { useTranslation } from "react-i18next";
import { formatPathForDisplay, cn, logTauriError } from "@/lib/utils";
import type { DaemonStatus } from "@/lib/db-types";

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export function DaemonControl() {
  const { t } = useTranslation();
  const status = useBackgroundStatusStore((s) => s.daemonStatus);
  const filteredUnassigned = useBackgroundStatusStore((s) => s.allUnassigned);
  const refreshDiagnostics = useBackgroundStatusStore((s) => s.refreshDiagnostics);
  const setDaemonStatus = useBackgroundStatusStore((s) => s.setDaemonStatus);
  const setDaemonAutostart = useBackgroundStatusStore((s) => s.setDaemonAutostart);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isWindowVisible, setIsWindowVisible] = useState(() => isDocumentVisible());
  const refreshAsync = useCancellableAsync();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const refreshLogs = useCallback(() => {
    void refreshAsync(
      async () => readLogFile("daemon", 200),
      {
        onSuccess: (nextLogs) => {
          setLogs(nextLogs);
        },
        onError: (error) => {
          logTauriError('refresh daemon logs', error);
        },
      },
    );
  }, [refreshAsync]);

  const refreshAll = useCallback(
    ({ includeLogs = true }: { includeLogs?: boolean } = {}) => {
      void refreshDiagnostics();
      if (!includeLogs) return;
      void refreshAsync(
        async () => readLogFile("daemon", 200),
        {
        onSuccess: (nextLogs) => {
          setLogs(nextLogs);
        },
        onError: (error) => {
          logTauriError('refresh daemon logs', error);
        },
      },
    );
    },
    [refreshAsync, refreshDiagnostics],
  );

  // Initial load
  useEffect(() => {
    if (status === null) {
      void refreshDiagnostics();
    }
    refreshLogs();
  }, [refreshDiagnostics, refreshLogs, status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = isDocumentVisible();
      setIsWindowVisible(visible);
      if (!visible) return;
      refreshLogs();
    };
    const handleWindowFocus = () => {
      const visible = isDocumentVisible();
      setIsWindowVisible(visible);
      if (!visible) return;
      refreshLogs();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refreshLogs]);

  // Auto-refresh every 5s when enabled
  useEffect(() => {
    if (!autoRefresh || !isWindowVisible) return;
    const interval = setInterval(refreshLogs, 5000);
    return () => clearInterval(interval);
  }, [refreshLogs, autoRefresh, isWindowVisible]);

  // Scroll logs to bottom on update
  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAutoScroll = distanceFromBottom < 80;
    if (shouldAutoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [logs]);

  const logLines = useMemo(() => {
    if (!logs) return [];
    const seen = new Map<string, number>();
    return logs.split("\n").map((line) => {
      const count = (seen.get(line) ?? 0) + 1;
      seen.set(line, count);
      const key = `${line}\u0000${count}`;
      const className = line.includes("[ERROR]")
        ? "text-red-400"
        : line.includes("[WARN]")
          ? "text-yellow-400"
          : "text-muted-foreground";
      return { key, line, className };
    });
  }, [logs]);

  const pollDaemonStatus = useCallback(
    async (predicate: (next: DaemonStatus) => boolean) => {
      const timeoutMs = 5_000;
      const intervalMs = 300;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        try {
          const next = await daemonApi.getDaemonStatus();
          setDaemonStatus(next);
          if (predicate(next)) return;
        } catch (error) {
          console.warn('Failed to poll daemon status:', error);
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
    [setDaemonStatus],
  );

  const withLoading = async (
    label: string,
    fn: () => Promise<void>,
    settlePredicate: (next: DaemonStatus) => boolean,
  ) => {
    setLoading(label);
    try {
      await fn();
      await pollDaemonStatus(settlePredicate);
      refreshAll();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading("");
    }
  };

  const handleStart = () =>
    withLoading("start", daemonApi.startDaemon, (next) => next.running);
  const handleStop = () =>
    withLoading("stop", daemonApi.stopDaemon, (next) => !next.running);
  const handleRestart = () =>
    withLoading("restart", daemonApi.restartDaemon, (next) => next.running);

  const handleAutostartToggle = async () => {
    if (!status) return;
    const newVal = !status.autostart;
    try {
      await daemonApi.setAutostartEnabled(newVal);
      setDaemonAutostart(newVal);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status + Controls */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Status Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              {t("daemon_page.status_title")}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 w-7 p-0"
                onClick={() => refreshAll({ includeLogs: false })}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  status?.running
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                }`}
              />
              <div>
                <p className="text-sm font-medium">
                  {status?.running
                    ? t("daemon_page.running")
                    : t("daemon_page.stopped")}
                </p>
                {status?.pid && (
                  <p className="text-xs text-muted-foreground">
                    PID: {status.pid}
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {status?.version && (
                  <AppTooltip content={status.is_compatible ? t("daemon_page.daemon_version") : t("daemon_page.version_incompatibility")}>
                    <span className={cn(
                      "text-[10px] font-mono cursor-default",
                      status.is_compatible ? "text-muted-foreground/50" : "text-destructive font-bold"
                    )}>
                      v{status.version} {!status.is_compatible && "!"}
                    </span>
                  </AppTooltip>
                )}
                <Badge
                  variant={status?.running ? "default" : "destructive"}
                >
                  {status?.running ? t("daemon_page.active") : t("daemon_page.inactive")}
                </Badge>
              </div>
            </div>

            {filteredUnassigned > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <span className="font-semibold mr-1">*</span>
                <span>
                  {t("daemon_page.unassigned_sessions_hint", {
                    count: filteredUnassigned,
                  })}
                </span>
              </div>
            )}

            {status?.exe_path && (
              <p className="text-xs text-muted-foreground font-mono truncate" title={formatPathForDisplay(status.exe_path)}>
                {formatPathForDisplay(status.exe_path)}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              {status?.running ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={handleStop}
                    disabled={!!loading}
                  >
                    <Square className="h-3.5 w-3.5 mr-1.5" />
                    {loading === "stop"
                      ? t("daemon_page.stopping")
                      : t("daemon_page.stop")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleRestart}
                    disabled={!!loading}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    {loading === "restart"
                      ? t("daemon_page.restarting")
                      : t("daemon_page.restart")}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleStart}
                  disabled={!!loading}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {loading === "start"
                    ? t("daemon_page.starting")
                    : t("daemon_page.start")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Autostart Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {t("daemon_page.autostart_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("daemon_page.autostart_description")}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {status?.autostart
                  ? t("daemon_page.enabled")
                  : t("daemon_page.disabled")}
              </span>
              <button
                onClick={handleAutostartToggle}
                role="switch"
                aria-checked={!!status?.autostart}
                aria-label={t("daemon_page.autostart")}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  status?.autostart ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    status?.autostart ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            {t("daemon_page.logs_title")}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`text-xs px-2 py-0.5 rounded ${
                  autoRefresh
                    ? "bg-accent text-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {autoRefresh
                  ? t("daemon_page.auto_refresh_on")
                  : t("daemon_page.auto_refresh_off")}
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => refreshAll()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logsContainerRef}
            className="h-96 overflow-y-auto rounded-md border bg-black/50 p-3 font-mono text-xs leading-5"
          >
            {logs ? (
              logLines.map((entry) => (
                <div key={entry.key} className={entry.className}>
                  {entry.line}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {t("daemon_page.no_logs")}
              </p>
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

