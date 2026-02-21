import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  AppWindow,
  BarChart3,
  List,
  Settings,
  Import,
  Power,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { getDaemonStatus, getSessionCount } from "@/lib/tauri";
import type { DaemonStatus } from "@/lib/db-types";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
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
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors hover:bg-accent"
      title={attentionTitle}
    >
      <span
        className={cn(
          "relative h-2 w-2 rounded-full",
          running === true && "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]",
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

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-6">
        <BarChart3 className="h-5 w-5 text-primary" />
        <span className="text-lg font-semibold">Cfab Tracker</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentPage(item.id)}
            title={item.id === "sessions" ? sessionsAttentionTitle : undefined}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
              currentPage === item.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <span className="flex items-center gap-3">
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </span>
            {item.id === "sessions" && unassignedSessions > 0 && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                *{sessionsBadge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t p-3 space-y-1">
        <DaemonStatusIndicator status={status} />
        <button
          onClick={() => setCurrentPage("settings")}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            currentPage === "settings"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}
