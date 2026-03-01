import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
import {
  getDaemonStatus,
  getDaemonLogs,
  getSessionCount,
  setAutostartEnabled,
  startDaemon,
  stopDaemon,
  restartDaemon,
} from "@/lib/tauri";
import { loadSessionSettings, normalizeLanguageCode } from "@/lib/user-settings";
import { formatPathForDisplay, cn } from "@/lib/utils";
import type { DaemonStatus } from "@/lib/db-types";

export function DaemonControl() {
  const { i18n } = useTranslation();
  const lang = normalizeLanguageCode(i18n.resolvedLanguage ?? i18n.language);
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [filteredUnassigned, setFilteredUnassigned] = useState<number>(0);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(() => {
    getDaemonStatus().then(setStatus).catch(console.error);
    const minDuration = loadSessionSettings().minSessionDurationSeconds || undefined;
    getSessionCount({ unassigned: true, minDuration })
      .then((n) => setFilteredUnassigned(Math.max(0, n)))
      .catch(console.error);
  }, []);

  const refreshLogs = useCallback(() => {
    getDaemonLogs(200).then(setLogs).catch(console.error);
  }, []);

  const refresh = useCallback(() => {
    refreshStatus();
    refreshLogs();
  }, [refreshStatus, refreshLogs]);

  // Initial load + auto-refresh every 5s
  useEffect(() => {
    refresh();
    if (!autoRefresh) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh, autoRefresh]);

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

  const withLoading = async (label: string, fn: () => Promise<void>) => {
    setLoading(label);
    try {
      await fn();
      // Wait a bit for process state to settle
      await new Promise((r) => setTimeout(r, 1500));
      refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading("");
    }
  };

  const handleStart = () => withLoading("start", startDaemon);
  const handleStop = () => withLoading("stop", stopDaemon);
  const handleRestart = () => withLoading("restart", restartDaemon);

  const handleAutostartToggle = async () => {
    if (!status) return;
    const newVal = !status.autostart;
    try {
      await setAutostartEnabled(newVal);
      setStatus({ ...status, autostart: newVal });
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
              {t("Status demona", "Daemon Status")}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 w-7 p-0"
                onClick={refresh}
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
                    ? t("Uruchomiony", "Running")
                    : t("Zatrzymany", "Stopped")}
                </p>
                {status?.pid && (
                  <p className="text-xs text-muted-foreground">
                    PID: {status.pid}
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {status?.version && (
                  <span className={cn(
                    "text-[10px] font-mono",
                    status.is_compatible ? "text-muted-foreground/50" : "text-destructive font-bold"
                  )} title={status.is_compatible ? t("Wersja demona", "Daemon version") : t("NIEZGODNOŚĆ WERSJI!", "VERSION INCOMPATIBILITY!")}>
                    v{status.version} {!status.is_compatible && "!"}
                  </span>
                )}
                <Badge
                  variant={status?.running ? "default" : "destructive"}
                >
                  {status?.running ? t("Aktywny", "Active") : t("Nieaktywny", "Inactive")}
                </Badge>
              </div>
            </div>

            {filteredUnassigned > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <span className="font-semibold mr-1">*</span>
                <span>
                  {t(
                    `${filteredUnassigned} nieprzypisanych sesji. Przypisz je w Sesjach/Osi czasu.`,
                    `${filteredUnassigned} unassigned sessions. Assign them in Sessions/Timeline.`,
                  )}
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
                      ? t("Zatrzymywanie...", "Stopping...")
                      : t("Zatrzymaj", "Stop")}
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
                      ? t("Restartowanie...", "Restarting...")
                      : t("Restart", "Restart")}
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
                    ? t("Uruchamianie...", "Starting...")
                    : t("Uruchom", "Start")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Autostart Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              {t("Autostart", "Autostart")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t(
                "Uruchamiaj demona automatycznie przy starcie Windows. Używa skrótu w folderze Autostart.",
                "Start daemon automatically when Windows starts. Uses a shortcut in the Startup folder.",
              )}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {status?.autostart
                  ? t("Włączony", "Enabled")
                  : t("Wyłączony", "Disabled")}
              </span>
              <button
                onClick={handleAutostartToggle}
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
            {t("Logi demona", "Daemon Logs")}
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
                  ? t("Auto-odświeżanie WŁ.", "Auto-refresh ON")
                  : t("Auto-odświeżanie WYŁ.", "Auto-refresh OFF")}
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={refreshLogs}
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
              logs.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes("[ERROR]")
                      ? "text-red-400"
                      : line.includes("[WARN]")
                        ? "text-yellow-400"
                        : "text-muted-foreground"
                  }
                >
                  {line}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {t("Brak dostępnych logów", "No logs available")}
              </p>
            )}
            <div ref={logsEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

