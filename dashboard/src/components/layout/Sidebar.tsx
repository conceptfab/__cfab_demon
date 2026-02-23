import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  List,
  Settings,
  Import,
  Power,
  Brain,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { getDaemonStatus, getSessionCount } from "@/lib/tauri";
import {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
  type OnlineSyncIndicatorSnapshot,
} from "@/lib/online-sync";
import type { DaemonStatus } from "@/lib/db-types";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "estimates", label: "Estimates", icon: CircleDollarSign },
  { id: "applications", label: "Applications", icon: AppWindow },
  { id: "analysis", label: "Time Analysis", icon: BarChart3 },
  { id: "sessions", label: "Sessions", icon: List },
  { id: "ai", label: "AI & Model", icon: Brain },
  { id: "data", label: "Data", icon: Import },
  { id: "daemon", label: "Daemon", icon: Power },
];

function DaemonStatusIndicator({ status }: { status: DaemonStatus | null }) {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  const running = status?.running ?? null;
  const needsAssignment = status?.needs_assignment ?? false;
  const statusText = running === true ? "running" : running === false ? "stopped" : "unknown";
  const attentionTitle = needsAssignment
    ? `${status?.unassigned_sessions ?? 0} unassigned sessions in ${status?.unassigned_apps ?? 0} apps`
    : undefined;

  return (
    <button
      onClick={() => setCurrentPage("daemon")}
      className="flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-[11px] transition-colors hover:border-border/60 hover:bg-accent/70"
      title={attentionTitle}
    >
      <span
        className={cn(
          "relative h-2 w-2 rounded-full",
          running === true && "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.55)]",
          running === false && "bg-red-500",
          running === null && "bg-muted-foreground/40"
        )}
      >
      </span>
      <span className="text-muted-foreground">
        Daemon: {statusText}
      </span>
    </button>
  );
}

export function Sidebar() {
  const { currentPage, setCurrentPage } = useAppStore();
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [todayUnassigned, setTodayUnassigned] = useState<number>(0);
  const [syncIndicator, setSyncIndicator] = useState<OnlineSyncIndicatorSnapshot>(() =>
    getOnlineSyncIndicatorSnapshot()
  );

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      Promise.allSettled([
        getDaemonStatus(),
        getSessionCount({
          dateRange: { start: localDate, end: localDate },
          unassigned: true,
        }),
      ]).then(([statusRes, countRes]) => {
        if (statusRes.status === "fulfilled") setStatus(statusRes.value);
        else setStatus(null);
        if (countRes.status === "fulfilled") setTodayUnassigned(Math.max(0, countRes.value));
        else setTodayUnassigned(0);
      });
    };
    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return subscribeOnlineSyncIndicator(setSyncIndicator);
  }, []);

  const daemonUnassigned = Math.max(0, status?.unassigned_sessions ?? 0);
  const unassignedSessions = todayUnassigned > 0 ? todayUnassigned : daemonUnassigned;
  const unassignedApps = Math.max(0, status?.unassigned_apps ?? 0);
  const sessionsBadge = unassignedSessions > 99 ? "99+" : String(unassignedSessions);
  const sessionsAttentionTitle =
    unassignedSessions > 0
      ? todayUnassigned > 0
        ? `${unassignedSessions} unassigned sessions today`
        : `${unassignedSessions} unassigned sessions in ${unassignedApps} apps`
      : undefined;
  const syncBadgeVariant =
    syncIndicator.status === "error"
      ? "destructive"
      : syncIndicator.status === "syncing"
        ? "default"
        : "secondary";
  const showSyncDetail = syncIndicator.status !== "disabled" && !!syncIndicator.detail;
  const syncDetailLines = showSyncDetail
    ? String(syncIndicator.detail)
        .split(/\s+[·•]\s+/)
        .map((line) => line.trim())
        .filter(Boolean)
      : [];

  const handleSidebarDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!hasTauriRuntime()) return;
    void getCurrentWindow().startDragging().catch((error) => {
      console.warn("Window dragging failed (permissions/capability?):", error);
    });
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border/35 bg-background">
      <div
        data-tauri-drag-region
        className="flex h-12 select-none items-center border-b border-border/25 px-4"
        onMouseDown={handleSidebarDragMouseDown}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          TIMEFLOW
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentPage(item.id)}
            title={item.id === "sessions" ? sessionsAttentionTitle : undefined}
            className={cn(
              "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              currentPage === item.id
                ? "border-border/40 bg-accent/75 text-card-foreground"
                : "border-transparent text-muted-foreground hover:border-border/35 hover:bg-accent/50 hover:text-accent-foreground"
            )}
          >
            <span className="flex items-center gap-2.5">
              <item.icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </span>
            {item.id === "sessions" && unassignedSessions > 0 && (
              <span className="rounded-sm border border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">
                *{sessionsBadge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border/25 p-2">
        <div className="px-2.5 py-1.5">
          <Badge
            variant={syncBadgeVariant}
            className="max-w-full whitespace-nowrap px-2 py-0.5 text-[10px]"
            title={syncIndicator.detail || undefined}
          >
            {syncIndicator.label}
          </Badge>
          {showSyncDetail && (
            <div className="mt-1 space-y-0.5 text-[10px] leading-4 text-muted-foreground" title={syncIndicator.detail || undefined}>
              {(syncDetailLines.length > 0 ? syncDetailLines : [String(syncIndicator.detail)]).map((line, idx) => (
                <p key={`${line}-${idx}`} className="break-all">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
        <DaemonStatusIndicator status={status} />
        <button
          onClick={() => setCurrentPage("settings")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
            currentPage === "settings"
              ? "border-border/40 bg-accent/75 text-card-foreground"
              : "border-transparent text-muted-foreground hover:border-border/35 hover:bg-accent/50 hover:text-accent-foreground"
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>
    </aside>
  );
}

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(win.__TAURI__ || win.__TAURI_INTERNALS__);
}

