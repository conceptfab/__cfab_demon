import { useEffect, useState } from "react";
import { Database, Clock, Briefcase, Layout } from "lucide-react";
import { getDashboardStats, getProjects } from "@/lib/tauri";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationSlim } from "@/lib/utils";

export function DataStats() {
  const [stats, setStats] = useState<{
    sessions: number;
    projects: number;
    apps: number;
    totalTime: number;
  }>({ sessions: 0, projects: 0, apps: 0, totalTime: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const range = { start: "2000-01-01", end: "2100-01-01" };
        const [dStats, projects] = await Promise.all([
          getDashboardStats(range),
          getProjects()
        ]);
        
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
  }, []);

  const items = [
    { label: "Total Sessions", value: stats.sessions, icon: Database, color: "text-blue-500" },
    { label: "Projects", value: stats.projects, icon: Briefcase, color: "text-emerald-500" },
    { label: "Applications", value: stats.apps, icon: Layout, color: "text-purple-500" },
    { label: "Total Time", value: formatDurationSlim(stats.totalTime), icon: Clock, color: "text-amber-500" },
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
