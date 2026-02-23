import { TOKYO_NIGHT_CHART_PALETTE } from "@/lib/chart-styles";
import type { StackedBarData } from "@/lib/db-types";

export const PALETTE = TOKYO_NIGHT_CHART_PALETTE;

export type ProjectSlot = { name: string; seconds: number; color: string };
export type HourSlot = { hour: number; projects: ProjectSlot[]; totalSeconds: number };

export type WeekDaySlot = {
  dayLabel: string;
  dateStr: string;
  hours: HourSlot[];
  totalSeconds: number;
};

export type CalendarDay = { date: string; seconds: number; inMonth: boolean; projects: ProjectSlot[] };
export type CalendarWeek = { label: string; subLabel: string; days: CalendarDay[] };

/** Parse StackedBarData[] into a date->hour->projects lookup */
export function parseHourlyProjects(
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
export function buildDaySlots(hourMap: Map<number, ProjectSlot[]> | undefined): { slots: HourSlot[]; maxVal: number } {
  let maxVal = 1;
  const slots: HourSlot[] = Array.from({ length: 24 }, (_, h) => {
    const projects = hourMap?.get(h) ?? [];
    const totalSeconds = projects.reduce((s, p) => s + p.seconds, 0);
    if (totalSeconds > maxVal) maxVal = totalSeconds;
    return { hour: h, projects, totalSeconds };
  });
  return { slots, maxVal };
}
