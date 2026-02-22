import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
  type OnlineSyncIndicatorSnapshot,
} from "@/lib/online-sync";
import { useAppStore } from "@/store/app-store";

const pageTitles: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  estimates: "Estimates",
  applications: "Applications",
  analysis: "Time Analysis",
  sessions: "Sessions",
  ai: "AI & Model",
  data: "Data",
  import: "Data",
  settings: "Settings",
  daemon: "Daemon",
};

export function TopBar() {
  const { currentPage } = useAppStore();
  const [syncIndicator, setSyncIndicator] = useState<OnlineSyncIndicatorSnapshot>(() =>
    getOnlineSyncIndicatorSnapshot()
  );

  useEffect(() => {
    return subscribeOnlineSyncIndicator(setSyncIndicator);
  }, []);

  const badgeVariant =
    syncIndicator.status === "error"
      ? "destructive"
      : syncIndicator.status === "syncing"
        ? "default"
        : "secondary";

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b px-6">
      <h1 className="text-lg font-semibold">{pageTitles[currentPage] ?? "Dashboard"}</h1>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={badgeVariant} className="whitespace-nowrap">
          {syncIndicator.label}
        </Badge>
        <span className="hidden max-w-[24rem] truncate text-xs text-muted-foreground md:inline">
          {syncIndicator.detail}
        </span>
      </div>
    </header>
  );
}
