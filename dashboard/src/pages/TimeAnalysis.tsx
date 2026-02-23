import { useEffect, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { getTimeline, getProjectTimeline, getProjects, getTopProjects } from "@/lib/tauri";
import {
  TOOLTIP_CONTENT_STYLE,
  TOKYO_NIGHT_CHART_PALETTE,
  CHART_AXIS_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";
import {
  addDays, addMonths, subMonths, format, parseISO, subDays,
  startOfMonth, endOfMonth, endOfWeek, eachWeekOfInterval,
  isBefore, isAfter,
} from "date-fns";
import type { DateRange, TimelinePoint, StackedBarData, ProjectTimeRow } from "@/lib/db-types";

const PALETTE = TOKYO_NIGHT_CHART_PALETTE;
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type RangeMode = "daily" | "weekly" | "monthly";

/* ─── Shared types & helpers ─── */

type ProjectSlot = { name: string; seconds: number; color: string };
type HourSlot = { hour: number; projects: ProjectSlot[]; totalSeconds: number };

/** Parse StackedBarData[] into a date->hour->projects lookup */
function parseHourlyProjects(
  rows: StackedBarData[],
  projectColors: Map<string, string>,
) {
  const projectSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key !== "date") projectSet.add(key);
    }
  }
  const allProjects = Array.from(projectSet);
  const colorMap = new Map<string, string>();
  allProjects.forEach((name, i) => {
    colorMap.set(name, projectColors.get(name) || PALETTE[i % PALETTE.length]);
  });

  const byDateHour = new Map<string, Map<number, ProjectSlot[]>>();
  for (const row of rows) {
    let datePart = "";
    let hour = -1;
    try {
      const parts = row.date.split("T");
      datePart = parts[0];
      if (parts[1]) hour = parseInt(parts[1].substring(0, 2), 10);
    } catch { /* ignore */ }
    if (!datePart || hour < 0 || hour > 23) continue;

    if (!byDateHour.has(datePart)) byDateHour.set(datePart, new Map());
    const projects: ProjectSlot[] = [];
    for (const [key, val] of Object.entries(row)) {
      if (key === "date" || typeof val !== "number") continue;
      projects.push({ name: key, seconds: val, color: colorMap.get(key) || PALETTE[0] });
    }
    projects.sort((a, b) => b.seconds - a.seconds);
    byDateHour.get(datePart)!.set(hour, projects);
  }

  return { byDateHour, allProjects, colorMap };
}

/** Build 24 HourSlots for a single day from the parsed lookup */
function buildDaySlots(hourMap: Map<number, ProjectSlot[]> | undefined): { slots: HourSlot[]; maxVal: number } {
  let maxVal = 1;
  const slots: HourSlot[] = Array.from({ length: 24 }, (_, h) => {
    const projects = hourMap?.get(h) ?? [];
    const totalSeconds = projects.reduce((s, p) => s + p.seconds, 0);
    if (totalSeconds > maxVal) maxVal = totalSeconds;
    return { hour: h, projects, totalSeconds };
  });
  return { slots, maxVal };
}

/* ─── Component ─── */

export function TimeAnalysis() {
  const { refreshKey } = useAppStore();
  const [rangeMode, setRangeMode] = useState<RangeMode>("daily");
  const [anchorDate, setAnchorDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));

  const [data, setData] = useState<{
    projectTime: ProjectTimeRow[];
    timeline: TimelinePoint[];
    hourlyProjects: StackedBarData[];
    projectColors: Map<string, string>;
  }>({ projectTime: [], timeline: [], hourlyProjects: [], projectColors: new Map() });
  const { projectTime, timeline, hourlyProjects, projectColors } = data;

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const canShiftForward = anchorDate < today;

  const activeDateRange = useMemo<DateRange>(() => {
    const d = parseISO(anchorDate);
    switch (rangeMode) {
      case "daily":
        return { start: anchorDate, end: anchorDate };
      case "weekly":
        return { start: format(subDays(d, 6), "yyyy-MM-dd"), end: anchorDate };
      case "monthly":
        return { start: format(startOfMonth(d), "yyyy-MM-dd"), end: format(endOfMonth(d), "yyyy-MM-dd") };
    }
  }, [rangeMode, anchorDate]);

  const shiftDateRange = (direction: -1 | 1) => {
    const current = parseISO(anchorDate);
    let next: string;
    if (rangeMode === "monthly") {
      next = format(direction === 1 ? addMonths(current, 1) : subMonths(current, 1), "yyyy-MM-dd");
    } else {
      const step = rangeMode === "weekly" ? 7 : 1;
      next = format(addDays(current, direction * step), "yyyy-MM-dd");
    }
    if (next > today) return;
    setAnchorDate(next);
  };

  useEffect(() => {
    const hpPromise = rangeMode !== "monthly"
      ? getProjectTimeline(activeDateRange, 10, "hour")
      : Promise.resolve<StackedBarData[]>([]);

    Promise.all([
      getTopProjects(activeDateRange, 10),
      getTimeline(activeDateRange),
      hpPromise,
      getProjects(),
    ]).then(([pt, tl, hp, projects]) => {
      const colorMap = new Map<string, string>();
      for (const p of projects) colorMap.set(p.name, p.color);
      setData({ projectTime: pt, timeline: tl, hourlyProjects: hp, projectColors: colorMap });
    }).catch(console.error);
  }, [activeDateRange, refreshKey, rangeMode]);

  // Parsed hourly project data (shared between daily & weekly)
  const parsed = useMemo(
    () => parseHourlyProjects(hourlyProjects, projectColors),
    [hourlyProjects, projectColors],
  );

  // Pie chart — project breakdown
  const pieData = useMemo(() => {
    return projectTime.map((p, i) => ({
      name: p.name,
      value: p.seconds,
      fill: p.color || PALETTE[i % PALETTE.length],
    }));
  }, [projectTime]);

  // Weekly heatmap grid
  type WeekDaySlot = {
    dayLabel: string;
    dateStr: string;
    hours: HourSlot[];
    totalSeconds: number;
  };
  const weeklyHourlyGrid = useMemo(() => {
    if (rangeMode !== "weekly") return { days: [] as WeekDaySlot[], allProjects: parsed.allProjects, maxVal: 1 };

    let maxVal = 1;
    const days: WeekDaySlot[] = [];
    const startDate = parseISO(activeDateRange.start);
    for (let di = 0; di < 7; di++) {
      const d = addDays(startDate, di);
      const dateStr = format(d, "yyyy-MM-dd");
      const dayLabel = format(d, "EEE");
      const { slots, maxVal: dayMax } = buildDaySlots(parsed.byDateHour.get(dateStr));
      if (dayMax > maxVal) maxVal = dayMax;
      const dayTotal = slots.reduce((s, h) => s + h.totalSeconds, 0);
      days.push({ dayLabel, dateStr, hours: slots, totalSeconds: dayTotal });
    }

    return { days, allProjects: parsed.allProjects, maxVal };
  }, [rangeMode, parsed, activeDateRange]);

  // Daily heatmap grid
  const dailyHourlyGrid = useMemo(() => {
    if (rangeMode !== "daily") return { hours: [] as HourSlot[], allProjects: parsed.allProjects, maxVal: 1 };
    const { slots, maxVal } = buildDaySlots(parsed.byDateHour.get(anchorDate));
    return { hours: slots, allProjects: parsed.allProjects, maxVal };
  }, [rangeMode, parsed, anchorDate]);

  // Bar data — monthly (simple bars)
  const monthlyBarData = useMemo(() =>
    timeline.map((t) => ({ date: t.date, hours: +(t.seconds / 3600).toFixed(2) })),
    [timeline],
  );

  // Daily hourly bar data: stacked by project per hour
  const dailyBarData = useMemo(() => {
    if (rangeMode !== "daily") return { data: [] as Record<string, unknown>[], projectNames: [] as string[] };
    const projectSet = new Set<string>();
    const data = dailyHourlyGrid.hours.map((slot) => {
      const row: Record<string, unknown> = { hour: `${slot.hour.toString().padStart(2, "0")}:00` };
      for (const proj of slot.projects) {
        row[proj.name] = +(proj.seconds / 3600).toFixed(3);
        projectSet.add(proj.name);
      }
      return row;
    });
    return { data, projectNames: Array.from(projectSet) };
  }, [rangeMode, dailyHourlyGrid]);

  // Weekly daily bar data: stacked by project per day
  const weeklyBarData = useMemo(() => {
    if (rangeMode !== "weekly") return { data: [] as Record<string, unknown>[], projectNames: [] as string[] };
    const projectSet = new Set<string>();
    const data = weeklyHourlyGrid.days.map((day) => {
      const row: Record<string, unknown> = { date: day.dateStr };
      for (const hourSlot of day.hours) {
        for (const proj of hourSlot.projects) {
          row[proj.name] = +((row[proj.name] as number || 0) + proj.seconds / 3600).toFixed(3);
          projectSet.add(proj.name);
        }
      }
      return row;
    });
    return { data, projectNames: Array.from(projectSet) };
  }, [rangeMode, weeklyHourlyGrid]);

  // Project color map for stacked bars
  const stackedBarColorMap = useMemo(() => {
    const names = rangeMode === "daily" ? dailyBarData.projectNames : weeklyBarData.projectNames;
    const map = new Map<string, string>();
    names.forEach((name, i) => {
      map.set(name, projectColors.get(name) || PALETTE[i % PALETTE.length]);
    });
    return map;
  }, [rangeMode, dailyBarData.projectNames, weeklyBarData.projectNames, projectColors]);

  // Daily total hours
  const dailyTotalHours = useMemo(() => {
    if (rangeMode !== "daily") return 0;
    return dailyHourlyGrid.hours.reduce((s, h) => s + h.totalSeconds, 0) / 3600;
  }, [rangeMode, dailyHourlyGrid]);

  // Weekly total hours
  const weeklyTotalHours = useMemo(() => {
    if (rangeMode !== "weekly") return 0;
    return weeklyHourlyGrid.days.reduce((s, d) => s + d.totalSeconds, 0) / 3600;
  }, [rangeMode, weeklyHourlyGrid]);

  // Monthly calendar heatmap
  const monthCalendar = useMemo(() => {
    if (rangeMode !== "monthly") return { weeks: [] as { label: string; days: { date: string; seconds: number; inMonth: boolean }[] }[], maxVal: 1 };
    const mStart = parseISO(activeDateRange.start);
    const mEnd = parseISO(activeDateRange.end);
    const weekStarts = eachWeekOfInterval({ start: mStart, end: mEnd }, { weekStartsOn: 1 });

    const timeMap = new Map<string, number>();
    for (const t of timeline) timeMap.set(t.date, t.seconds);

    let maxVal = 1;
    const weeks = weekStarts.map((ws) => {
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const days: { date: string; seconds: number; inMonth: boolean }[] = [];
      for (let d = ws; !isAfter(d, we); d = addDays(d, 1)) {
        const key = format(d, "yyyy-MM-dd");
        const sec = timeMap.get(key) || 0;
        const inMonth = !isBefore(d, mStart) && !isAfter(d, mEnd);
        if (sec > maxVal) maxVal = sec;
        days.push({ date: key, seconds: sec, inMonth });
      }
      return { label: format(ws, "MMM d"), days };
    });
    return { weeks, maxVal };
  }, [rangeMode, activeDateRange, timeline]);

  // Monthly total
  const monthTotalHours = useMemo(() => {
    if (rangeMode !== "monthly") return 0;
    return timeline.reduce((s, t) => s + t.seconds, 0) / 3600;
  }, [rangeMode, timeline]);

  const handleExport = () => {
    let csv: string;
    if (rangeMode === "daily") {
      const projects = dailyBarData.projectNames;
      const header = `Hour,${projects.join(",")},Total`;
      const rows = dailyBarData.data.map((row) => {
        const hour = row.hour as string;
        const vals = projects.map((p) => ((row[p] as number) || 0).toFixed(3));
        const total = projects.reduce((s, p) => s + ((row[p] as number) || 0), 0).toFixed(2);
        return `${hour},${vals.join(",")},${total}`;
      });
      csv = [header, ...rows].join("\n");
    } else if (rangeMode === "weekly") {
      const projects = weeklyBarData.projectNames;
      const header = `Date,${projects.join(",")},Total`;
      const rows = weeklyBarData.data.map((row) => {
        const date = row.date as string;
        const vals = projects.map((p) => ((row[p] as number) || 0).toFixed(3));
        const total = projects.reduce((s, p) => s + ((row[p] as number) || 0), 0).toFixed(2);
        return `${date},${vals.join(",")},${total}`;
      });
      csv = [header, ...rows].join("\n");
    } else {
      const header = "Date,Hours";
      const rows = timeline.map((t) => `${t.date},${(t.seconds / 3600).toFixed(2)}`);
      csv = [header, ...rows].join("\n");
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-analysis-${activeDateRange.start}-${activeDateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dateLabel = useMemo(() => {
    if (rangeMode === "monthly") return format(parseISO(activeDateRange.start), "MMMM yyyy");
    if (activeDateRange.start === activeDateRange.end) return format(parseISO(activeDateRange.start), "EEE, MMM d");
    return `${format(parseISO(activeDateRange.start), "MMM d")} – ${format(parseISO(activeDateRange.end), "MMM d")}`;
  }, [rangeMode, activeDateRange]);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={rangeMode === "daily" ? "default" : "ghost"} size="sm" onClick={() => setRangeMode("daily")}>Today</Button>
          <Button variant={rangeMode === "weekly" ? "default" : "ghost"} size="sm" onClick={() => setRangeMode("weekly")}>Week</Button>
          <Button variant={rangeMode === "monthly" ? "default" : "ghost"} size="sm" onClick={() => setRangeMode("monthly")}>Month</Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDateRange(-1)} title="Previous period">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">{dateLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDateRange(1)} disabled={!canShiftForward} title="Next period">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {rangeMode === "daily"
                ? `Hourly Activity — ${dailyTotalHours.toFixed(1)}h total`
                : rangeMode === "weekly"
                  ? `Daily Activity — ${weeklyTotalHours.toFixed(1)}h total`
                  : `Daily Activity — ${monthTotalHours.toFixed(1)}h total`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {rangeMode === "daily" ? (
                /* Daily: stacked bar per hour */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyBarData.data}>
                    <XAxis dataKey="hour" stroke={CHART_AXIS_COLOR} fontSize={10} tickLine={false} axisLine={false} interval={2} />
                    <YAxis stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
                      itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                      formatter={(value, name) => [`${(Number(value) * 60).toFixed(0)}min`, name]}
                    />
                    {dailyBarData.projectNames.map((name) => (
                      <Bar key={name} dataKey={name} stackId="stack" fill={stackedBarColorMap.get(name) || PALETTE[0]} radius={[0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : rangeMode === "weekly" ? (
                /* Weekly: stacked bar per day */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyBarData.data}>
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => { try { return format(parseISO(v), "MMM d"); } catch { return v; } }}
                      stroke={CHART_AXIS_COLOR} fontSize={11} tickLine={false} axisLine={false}
                    />
                    <YAxis stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
                      itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                      formatter={(value, name) => [`${Number(value).toFixed(1)}h`, name]}
                      labelFormatter={(v) => { try { return format(parseISO(v as string), "EEE, MMM d"); } catch { return v as string; } }}
                    />
                    {weeklyBarData.projectNames.map((name) => (
                      <Bar key={name} dataKey={name} stackId="stack" fill={stackedBarColorMap.get(name) || PALETTE[0]} radius={[0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                /* Monthly: simple bar */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyBarData}>
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => { try { return format(parseISO(v), "d"); } catch { return v; } }}
                      stroke={CHART_AXIS_COLOR} fontSize={10} tickLine={false} axisLine={false}
                    />
                    <YAxis stroke={CHART_AXIS_COLOR} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
                      itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                      formatter={(value) => [`${value}h`, "Time"]}
                      labelFormatter={(v) => { try { return format(parseISO(v as string), "EEE, MMM d"); } catch { return v as string; } }}
                    />
                    <Bar dataKey="hours" fill={CHART_PRIMARY_COLOR} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pie chart — Project Time Distribution */}
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
                      labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
                      itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
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
          <CardTitle className="text-sm font-medium">
            {rangeMode === "daily"
              ? "Daily Project Timeline"
              : rangeMode === "monthly"
                ? "Monthly Calendar Heatmap"
                : "Weekly Project Timeline"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {rangeMode === "daily" ? (
              /* ───── Daily: hourly project timeline ───── */
              <div className="min-w-[600px]">
                {/* Hour labels */}
                <div className="flex text-xs text-muted-foreground mb-2">
                  {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} className="flex-1 text-center">{i.toString().padStart(2, "0")}</div>
                  ))}
                </div>

                {/* Main timeline bar — height proportional to actual time */}
                <div className="flex gap-0.5 mb-3">
                  {dailyHourlyGrid.hours.map((slot) => {
                    const hasData = slot.totalSeconds > 0;
                    const fillPct = Math.min(100, (slot.totalSeconds / 3600) * 100);
                    return (
                      <div
                        key={slot.hour}
                        className="flex-1 rounded-sm overflow-hidden flex flex-col justify-end"
                        style={{ height: "32px", backgroundColor: "rgba(41, 46, 66, 0.45)" }}
                        title={
                          hasData
                            ? `${slot.hour}:00 — ${formatDuration(slot.totalSeconds)}\n${slot.projects.map((p) => `${p.name}: ${formatDuration(p.seconds)}`).join("\n")}`
                            : `${slot.hour}:00 — No activity`
                        }
                      >
                        {hasData && (
                          <div className="flex flex-col w-full" style={{ height: `${fillPct}%` }}>
                            {slot.projects.map((proj, pi) => {
                              const pct = (proj.seconds / slot.totalSeconds) * 100;
                              return (
                                <div
                                  key={pi}
                                  style={{
                                    height: `${pct}%`,
                                    minHeight: slot.projects.length > 1 ? "2px" : undefined,
                                    backgroundColor: proj.color,
                                    opacity: 0.85,
                                  }}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Detailed rows per hour (only hours with data) */}
                <div className="space-y-1 mt-4">
                  {dailyHourlyGrid.hours.filter((s) => s.totalSeconds > 0).map((slot) => (
                    <div key={slot.hour} className="flex items-center gap-2">
                      <span className="w-12 text-xs text-muted-foreground text-right font-mono">
                        {slot.hour.toString().padStart(2, "0")}:00
                      </span>
                      <div className="flex-1 flex gap-1 items-center h-6">
                        {slot.projects.map((proj, pi) => {
                          const pct = Math.max(3, (proj.seconds / 3600) * 100);
                          return (
                            <div
                              key={pi}
                              className="h-full rounded-sm flex items-center justify-center text-[10px] font-medium px-1 truncate"
                              style={{
                                width: `${pct}%`,
                                minWidth: "24px",
                                backgroundColor: proj.color,
                                color: "#fff",
                                opacity: 0.85,
                              }}
                              title={`${proj.name}: ${formatDuration(proj.seconds)}`}
                            >
                              {proj.seconds >= 120 ? proj.name : ""}
                            </div>
                          );
                        })}
                      </div>
                      <span className="w-12 text-xs text-muted-foreground text-right">
                        {formatDuration(slot.totalSeconds)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                {dailyHourlyGrid.allProjects.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-3">
                    {dailyHourlyGrid.allProjects.map((name, i) => (
                      <div key={name} className="flex items-center gap-1.5 text-xs">
                        <div
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: projectColors.get(name) || PALETTE[i % PALETTE.length] }}
                        />
                        <span className="text-muted-foreground">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : rangeMode === "monthly" ? (
              /* ───── Monthly: calendar grid ───── */
              <div className="min-w-[400px]">
                <div className="flex text-xs text-muted-foreground mb-1 pl-16">
                  {WEEK_DAYS.map((d) => (
                    <div key={d} className="flex-1 text-center">{d}</div>
                  ))}
                </div>
                {monthCalendar.weeks.map((week, wi) => (
                  <div key={wi} className="flex items-center gap-1 mb-1">
                    <span className="w-14 text-xs text-muted-foreground text-right pr-1">{week.label}</span>
                    <div className="flex flex-1 gap-1">
                      {week.days.map((day, di) => {
                        const intensity = day.seconds / monthCalendar.maxVal;
                        const hrs = (day.seconds / 3600).toFixed(1);
                        return (
                          <div
                            key={di}
                            className="flex-1 h-10 rounded-md flex items-center justify-center text-xs font-medium"
                            style={{
                              backgroundColor: !day.inMonth
                                ? "rgba(41, 46, 66, 0.2)"
                                : day.seconds > 0
                                  ? `rgba(122, 162, 247, ${0.15 + intensity * 0.85})`
                                  : "rgba(41, 46, 66, 0.45)",
                              color: !day.inMonth
                                ? "rgba(123, 131, 148, 0.4)"
                                : day.seconds > 0
                                  ? (intensity > 0.5 ? "#fff" : "rgba(200, 210, 230, 0.9)")
                                  : "rgba(123, 131, 148, 0.6)",
                            }}
                            title={`${format(parseISO(day.date), "EEE, MMM d")} — ${formatDuration(day.seconds)}`}
                          >
                            {format(parseISO(day.date), "d")}
                            {day.inMonth && day.seconds > 0 && (
                              <span className="ml-1 opacity-80">{hrs}h</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* ───── Weekly: Day x Hour project timeline ───── */
              <div className="min-w-[600px]">
                {/* Hour labels */}
                <div className="flex text-xs text-muted-foreground mb-1 pl-24">
                  {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} className="flex-1 text-center">{i.toString().padStart(2, "0")}</div>
                  ))}
                </div>

                {/* Day rows */}
                {weeklyHourlyGrid.days.map((day) => (
                  <div key={day.dateStr} className="flex items-center gap-1 mb-1">
                    <div className="w-22 flex flex-col items-end pr-1">
                      <span className="text-xs text-muted-foreground font-medium">{day.dayLabel}</span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : ""}
                      </span>
                    </div>
                    <div className="flex flex-1 gap-0.5">
                      {day.hours.map((slot) => {
                        const hasData = slot.totalSeconds > 0;
                        const fillPct = Math.min(100, (slot.totalSeconds / 3600) * 100);
                        return (
                          <div
                            key={slot.hour}
                            className="flex-1 rounded-sm overflow-hidden flex flex-col justify-end"
                            style={{ height: "28px", backgroundColor: "rgba(41, 46, 66, 0.45)" }}
                            title={
                              hasData
                                ? `${day.dayLabel} ${slot.hour}:00 — ${formatDuration(slot.totalSeconds)}\n${slot.projects.map((p) => `${p.name}: ${formatDuration(p.seconds)}`).join("\n")}`
                                : `${day.dayLabel} ${slot.hour}:00 — No activity`
                            }
                          >
                            {hasData && (
                              <div className="flex flex-col w-full" style={{ height: `${fillPct}%` }}>
                                {slot.projects.map((proj, pi) => {
                                  const pct = (proj.seconds / slot.totalSeconds) * 100;
                                  return (
                                    <div
                                      key={pi}
                                      style={{
                                        height: `${pct}%`,
                                        minHeight: slot.projects.length > 1 ? "2px" : undefined,
                                        backgroundColor: proj.color,
                                        opacity: 0.85,
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Legend */}
                {weeklyHourlyGrid.allProjects.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-3">
                    {weeklyHourlyGrid.allProjects.map((name, i) => (
                      <div key={name} className="flex items-center gap-1.5 text-xs">
                        <div
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: projectColors.get(name) || PALETTE[i % PALETTE.length] }}
                        />
                        <span className="text-muted-foreground">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
