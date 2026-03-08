import { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import { Database, Clock, Briefcase, Layout } from "lucide-react";
import { getActivityDateSpan, getDashboardStats, getProjects } from "@/lib/tauri";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationSlim } from "@/lib/utils";

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
        const [range, projects] = await Promise.all([getActivityDateSpan(), getProjects()]);
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
        console.error("Failed to load data stats:", e);
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <Card key={item.label} className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-1">
            <item.icon className={`h-4 w-4 ${item.color} opacity-80`} />
            <div className="text-xl font-bold tracking-tight">{item.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {item.label}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
