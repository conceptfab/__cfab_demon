import { ChevronLeft, ChevronRight } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { getRechartsAnimationConfig } from "@/lib/chart-animation";
import { formatDuration } from "@/lib/utils";
import { useTimeAnalysisData } from "@/components/time-analysis/useTimeAnalysisData";
import { DailyBarChart, DailyHeatmap } from "@/components/time-analysis/DailyView";
import { WeeklyBarChart, WeeklyHeatmap } from "@/components/time-analysis/WeeklyView";
import { MonthlyBarChart, MonthlyHeatmap } from "@/components/time-analysis/MonthlyView";

export function TimeAnalysis() {
  const d = useTimeAnalysisData();
  const pieAnimation = getRechartsAnimationConfig({
    complexity: d.pieData.length,
    maxComplexity: 14,
    minDuration: 180,
    maxDuration: 320,
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        <div className="flex flex-col">
          <h3 className="text-sm font-medium px-2 pb-4">Time Distribution</h3>
          <div className="flex flex-row items-center justify-start gap-6 h-80 px-2 lg:pl-16">
            <div className="flex-1 h-full max-w-[350px] -ml-24">
              {d.pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={d.pieData} 
                      cx="50%" 
                      cy="50%" 
                      innerRadius={80} 
                      outerRadius={125} 
                      paddingAngle={2} 
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={pieAnimation.isAnimationActive}
                      animationDuration={pieAnimation.animationDuration}
                      animationEasing={pieAnimation.animationEasing}
                    >
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
            <div className="flex flex-col gap-2.5 overflow-y-auto max-h-full pr-4 min-w-[200px]">
              {d.pieData.map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-4 text-[11px]">
                  <div className="flex items-center gap-2.5">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.fill }} />
                    <span className="text-muted-foreground line-clamp-1 font-medium">{entry.name}</span>
                  </div>
                  <span className="text-muted-foreground/80 font-mono whitespace-nowrap">
                    {formatDuration(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="flex flex-col">
        <h3 className="text-sm font-medium px-2 pb-4">
          {d.rangeMode === "daily"
            ? "Daily Project Timeline"
            : d.rangeMode === "monthly"
              ? "Monthly Calendar Heatmap"
              : "Weekly Project Timeline"}
        </h3>
        <div className="px-2">
          <div className="overflow-x-auto">
            {d.rangeMode === "daily" ? (
              <DailyHeatmap {...d} />
            ) : d.rangeMode === "monthly" ? (
              <MonthlyHeatmap {...d} />
            ) : (
              <WeeklyHeatmap {...d} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
