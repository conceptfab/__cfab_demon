import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import type { CalendarWeek } from "./types";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface MonthlyViewProps {
  monthCalendar: { weeks: CalendarWeek[]; maxVal: number };
  monthlyBarData: { date: string; hours: number }[];
  monthTotalHours: number;
}

export function MonthlyBarChart({ monthlyBarData, monthTotalHours }: MonthlyViewProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {`Daily Activity — ${monthTotalHours.toFixed(1)}h total`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
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
        </div>
      </CardContent>
    </Card>
  );
}

export function MonthlyHeatmap({ monthCalendar }: MonthlyViewProps) {
  return (
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
  );
}
