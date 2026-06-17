import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import { Database, Clock, Briefcase, Layout } from "lucide-react";
import { getActivityDateSpan, getDashboardStats } from "@/lib/tauri";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationSlim, logTauriError } from "@/lib/utils";
import { mobileLayout } from "@/lib/mobile-layout";
import { loadProjectsAllTime } from "@/store/projects-cache-store";

export function DataStats() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<{
    sessions: number;
    projects: number;
    apps: number;
    totalTime: number;
  }>({ sessions: 0, projects: 0, apps: 0, totalTime: 0 });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [range, projects] = await Promise.all([
          getActivityDateSpan(),
          loadProjectsAllTime(),
        ]);
        if (cancelled) return;

        if (!range) {
          setStats({
            sessions: 0,
            projects: projects.length,
            apps: 0,
            totalTime: 0,
          });
          return;
        }

        const dStats = await getDashboardStats(range);
        if (cancelled) return;

        setStats({
          sessions: dStats.session_count,
          projects: projects.length,
          apps: dStats.app_count,
          totalTime: dStats.total_seconds
        });
      } catch (e) {
        logTauriError('load data stats', e);
      }
    };
    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const items = [
    { label: t("data_page.stats.total_sessions"), value: stats.sessions, icon: Database, color: "text-blue-500" },
    { label: t("data_page.stats.projects"), value: stats.projects, icon: Briefcase, color: "text-emerald-500" },
    { label: t("data_page.stats.applications"), value: stats.apps, icon: Layout, color: "text-purple-500" },
    { label: t("data_page.stats.total_time"), value: formatDurationSlim(stats.totalTime), icon: Clock, color: "text-amber-500" },
  ];

  return (
    <div className={mobileLayout.metricGrid}>
      {items.map((item) => (
        <Card key={item.label} className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center gap-y-0.5 p-2.5 text-center sm:gap-y-1 sm:p-4">
            <item.icon className={`hidden size-4 sm:block ${item.color} opacity-80`} />
            <div className="text-base font-bold tracking-tight sm:text-xl">{item.value}</div>
            <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground sm:text-[10px]">
              {item.label}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
