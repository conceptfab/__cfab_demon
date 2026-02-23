import { useEffect, useState, useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import { getTimeline, getProjectTimeline, getProjects, getTopProjects } from "@/lib/tauri";
import {
  addDays, addMonths, subMonths, format, parseISO, subDays,
  startOfMonth, endOfMonth, endOfWeek, eachWeekOfInterval,
  isBefore, isAfter,
} from "date-fns";
import type { DateRange, TimelinePoint, StackedBarData, ProjectTimeRow } from "@/lib/db-types";
import { parseHourlyProjects, buildDaySlots, PALETTE } from "./types";
import type { HourSlot, WeekDaySlot, CalendarWeek } from "./types";

export type RangeMode = "daily" | "weekly" | "monthly";

export function useTimeAnalysisData() {
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
    const barRows = dailyHourlyGrid.hours.map((slot) => {
      const row: Record<string, unknown> = { hour: `${slot.hour.toString().padStart(2, "0")}:00` };
      for (const proj of slot.projects) {
        row[proj.name] = +(proj.seconds / 3600).toFixed(3);
        projectSet.add(proj.name);
      }
      return row;
    });
    return { data: barRows, projectNames: Array.from(projectSet) };
  }, [rangeMode, dailyHourlyGrid]);

  // Weekly daily bar data: stacked by project per day
  const weeklyBarData = useMemo(() => {
    if (rangeMode !== "weekly") return { data: [] as Record<string, unknown>[], projectNames: [] as string[] };
    const projectSet = new Set<string>();
    const barRows = weeklyHourlyGrid.days.map((day) => {
      const row: Record<string, unknown> = { date: day.dateStr };
      for (const hourSlot of day.hours) {
        for (const proj of hourSlot.projects) {
          row[proj.name] = +((row[proj.name] as number || 0) + proj.seconds / 3600).toFixed(3);
          projectSet.add(proj.name);
        }
      }
      return row;
    });
    return { data: barRows, projectNames: Array.from(projectSet) };
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
    if (rangeMode !== "monthly") return { weeks: [] as CalendarWeek[], maxVal: 1 };
    const mStart = parseISO(activeDateRange.start);
    const mEnd = parseISO(activeDateRange.end);
    const weekStarts = eachWeekOfInterval({ start: mStart, end: mEnd }, { weekStartsOn: 1 });

    const timeMap = new Map<string, number>();
    for (const t of timeline) timeMap.set(t.date, t.seconds);

    let maxVal = 1;
    const weeks: CalendarWeek[] = weekStarts.map((ws) => {
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

  // Date label
  const dateLabel = useMemo(() => {
    if (rangeMode === "monthly") return format(parseISO(activeDateRange.start), "MMMM yyyy");
    if (activeDateRange.start === activeDateRange.end) return format(parseISO(activeDateRange.start), "EEE, MMM d");
    return `${format(parseISO(activeDateRange.start), "MMM d")} – ${format(parseISO(activeDateRange.end), "MMM d")}`;
  }, [rangeMode, activeDateRange]);

  // Export handler
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

  return {
    rangeMode,
    setRangeMode,
    canShiftForward,
    shiftDateRange,
    dateLabel,
    handleExport,
    pieData,
    projectColors,
    // Daily
    dailyHourlyGrid,
    dailyBarData,
    dailyTotalHours,
    // Weekly
    weeklyHourlyGrid,
    weeklyBarData,
    weeklyTotalHours,
    // Monthly
    monthCalendar,
    monthlyBarData,
    monthTotalHours,
    // Shared
    stackedBarColorMap,
  };
}
