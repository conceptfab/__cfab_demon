import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";
import { useTimeAnalysisData } from "@/components/time-analysis/useTimeAnalysisData";
import { DailyBarChart, DailyHeatmap } from "@/components/time-analysis/DailyView";
import { WeeklyBarChart, WeeklyHeatmap } from "@/components/time-analysis/WeeklyView";
import { MonthlyBarChart, MonthlyHeatmap } from "@/components/time-analysis/MonthlyView";

export function TimeAnalysis() {
  const d = useTimeAnalysisData();

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={d.rangeMode === "daily" ? "default" : "ghost"} size="sm" onClick={() => d.setRangeMode("daily")}>Today</Button>
          <Button variant={d.rangeMode === "weekly" ? "default" : "ghost"} size="sm" onClick={() => d.setRangeMode("weekly")}>Week</Button>
          <Button variant={d.rangeMode === "monthly" ? "default" : "ghost"} size="sm" onClick={() => d.setRangeMode("monthly")}>Month</Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => d.shiftDateRange(-1)} title="Previous period">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">{d.dateLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => d.shiftDateRange(1)} disabled={!d.canShiftForward} title="Next period">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={d.handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bar chart — delegates to view-specific component */}
        {d.rangeMode === "daily" ? (
          <DailyBarChart {...d} />
        ) : d.rangeMode === "weekly" ? (
          <WeeklyBarChart {...d} />
        ) : (
          <MonthlyBarChart {...d} />
        )}

        {/* Pie chart — Project Time Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Time Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center">
              {d.pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={d.pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                      {d.pieData.map((entry, i) => (
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
              {d.pieData.map((entry, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                  <span className="text-muted-foreground">{entry.name}</span>
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
            {d.rangeMode === "daily"
              ? "Daily Project Timeline"
              : d.rangeMode === "monthly"
                ? "Monthly Calendar Heatmap"
                : "Weekly Project Timeline"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {d.rangeMode === "daily" ? (
              <DailyHeatmap {...d} />
            ) : d.rangeMode === "monthly" ? (
              <MonthlyHeatmap {...d} />
            ) : (
              <WeeklyHeatmap {...d} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
