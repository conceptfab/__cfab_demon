import { useEffect, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { getHeatmap, getApplications, getTimeline } from "@/lib/tauri";
import { TOOLTIP_CONTENT_STYLE } from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";
import { addDays, format, parseISO, subDays } from "date-fns";
import type { DateRange, HeatmapCell, AppWithStats, TimelinePoint } from "@/lib/db-types";

const CHART_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type RangeMode = "daily" | "weekly";

export function TimeAnalysis() {
  const { refreshKey } = useAppStore();
  const [rangeMode, setRangeMode] = useState<RangeMode>("daily");
  const [anchorDate, setAnchorDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const today = format(new Date(), "yyyy-MM-dd");
  const canShiftForward = anchorDate < today;
  const shiftStepDays = rangeMode === "weekly" ? 7 : 1;

  const activeDateRange = useMemo<DateRange>(() => {
    const selectedDay = anchorDate || today;
    const selectedDateObj = parseISO(selectedDay);

    switch (rangeMode) {
      case "daily":
        return { start: selectedDay, end: selectedDay };
      case "weekly":
        return { start: format(subDays(selectedDateObj, 6), "yyyy-MM-dd"), end: selectedDay };
    }
  }, [rangeMode, anchorDate, today]);

  const shiftDateRange = (direction: -1 | 1) => {
    const current = parseISO(anchorDate);
    const next = format(addDays(current, direction * shiftStepDays), "yyyy-MM-dd");
    if (next > today) return;
    setAnchorDate(next);
  };

  useEffect(() => {
    Promise.all([
      getHeatmap(activeDateRange),
      getApplications(activeDateRange),
      getTimeline(activeDateRange),
    ])
      .then(([heatmapRes, appsRes, timelineRes]) => {
        setHeatmap(heatmapRes);
        setApps(appsRes);
        setTimeline(timelineRes);
      })
      .catch(console.error);
  }, [activeDateRange, refreshKey]);

  // Pie chart data - top apps
  const pieData = useMemo(() => {
    const sorted = [...apps].sort((a, b) => b.total_seconds - a.total_seconds).slice(0, 8);
    return sorted.map((a, i) => ({
      name: a.display_name,
      value: a.total_seconds,
      fill: a.color ?? CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [apps]);

  // Heatmap grid
  const heatmapGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of heatmap) {
      if (cell.day >= 0 && cell.day < 7 && cell.hour >= 0 && cell.hour < 24) {
        grid[cell.day][cell.hour] = cell.seconds;
      }
    }
    const maxVal = Math.max(1, ...heatmap.map((c) => c.seconds));
    return { grid, maxVal };
  }, [heatmap]);

  // Stacked bar data from timeline
  const barData = useMemo(() =>
    timeline.map((t) => ({
      date: t.date,
      hours: +(t.seconds / 3600).toFixed(2),
    })),
    [timeline]
  );

  const handleExport = () => {
    const header = "Date,Hours\n";
    const rows = timeline.map((t) => `${t.date},${(t.seconds / 3600).toFixed(2)}`).join("\n");
    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-analysis-${activeDateRange.start}-${activeDateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={rangeMode === "daily" ? "default" : "ghost"}
            size="sm"
            onClick={() => setRangeMode("daily")}
          >
            Today
          </Button>
          <Button
            variant={rangeMode === "weekly" ? "default" : "ghost"}
            size="sm"
            onClick={() => setRangeMode("weekly")}
          >
            Week
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftDateRange(-1)}
            title="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">
            {activeDateRange.start === activeDateRange.end
              ? format(parseISO(activeDateRange.start), "MMM d")
              : `${format(parseISO(activeDateRange.start), "MMM d")} – ${format(parseISO(activeDateRange.end), "MMM d")}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftDateRange(1)}
            disabled={!canShiftForward}
            title="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stacked bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => { try { return format(parseISO(v), "MMM d"); } catch { return v; } }}
                    stroke="#475569" fontSize={11} tickLine={false} axisLine={false}
                  />
                  <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={{ color: "#f1f5f9", fontWeight: 600 }}
                    itemStyle={{ color: "#e2e8f0" }}
                    formatter={(value) => [`${value}h`, "Time"]}
                  />
                  <Bar dataKey="hours" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Time Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={{ color: "#f1f5f9", fontWeight: 600 }}
                      itemStyle={{ color: "#e2e8f0" }}
                      formatter={(value) => [formatDuration(value as number), "Time"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="w-full text-center text-sm text-muted-foreground">No data</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {pieData.map((d, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Activity Heatmap (Day x Hour)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="flex text-xs text-muted-foreground mb-1 pl-10">
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className="flex-1 text-center">{i.toString().padStart(2, "0")}</div>
                ))}
              </div>
              {DAYS.map((day, di) => (
                <div key={di} className="flex items-center gap-1 mb-1">
                  <span className="w-8 text-xs text-muted-foreground text-right">{day}</span>
                  <div className="flex flex-1 gap-0.5">
                    {Array.from({ length: 24 }, (_, hi) => {
                      const val = heatmapGrid.grid[di][hi];
                      const intensity = val / heatmapGrid.maxVal;
                      return (
                        <div
                          key={hi}
                          className="flex-1 h-5 rounded-sm"
                          style={{
                            backgroundColor: val > 0
                              ? `rgba(56, 189, 248, ${0.1 + intensity * 0.9})`
                              : "rgba(30, 41, 59, 0.5)",
                          }}
                          title={`${day} ${hi}:00 — ${formatDuration(val)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
