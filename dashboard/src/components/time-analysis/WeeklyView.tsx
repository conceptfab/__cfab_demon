import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { PALETTE } from "./types";
import type { WeekDaySlot } from "./types";

interface WeeklyViewProps {
  weeklyHourlyGrid: { days: WeekDaySlot[]; allProjects: string[]; maxVal: number };
  weeklyBarData: { data: Record<string, unknown>[]; projectNames: string[] };
  weeklyTotalHours: number;
  stackedBarColorMap: Map<string, string>;
  projectColors: Map<string, string>;
}

export function WeeklyBarChart({ weeklyBarData, weeklyTotalHours, stackedBarColorMap }: WeeklyViewProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {`Daily Activity — ${weeklyTotalHours.toFixed(1)}h total`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
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
        </div>
      </CardContent>
    </Card>
  );
}

export function WeeklyHeatmap({ weeklyHourlyGrid, projectColors }: WeeklyViewProps) {
  return (
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
  );
}
