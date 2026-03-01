import { useMemo } from "react";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { getRechartsAnimationConfig } from "@/lib/chart-animation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HourlyData } from "@/lib/db-types";
import { useInlineT } from "@/lib/inline-i18n";

interface Props {
  data: HourlyData[];
}

export function HourlyBreakdown({ data }: Props) {
  const t = useInlineT();
  const chartData = useMemo(() => {
    const full = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, "0")}:00`,
      minutes: 0,
    }));
    for (const d of data) {
      if (d.hour >= 0 && d.hour < 24) {
        full[d.hour].minutes = +(d.seconds / 60).toFixed(1);
      }
    }
    return full;
  }, [data]);
  const barAnimation = getRechartsAnimationConfig({
    complexity: chartData.length,
    maxComplexity: 36,
    minDuration: 150,
    maxDuration: 260,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("Rozkład godzinowy", "Hourly Breakdown")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis
                dataKey="hour"
                stroke={CHART_AXIS_COLOR}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                stroke={CHART_AXIS_COLOR}
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}m`}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
                itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                formatter={(value) => [`${value} ${t("min", "min")}`, t("Czas", "Time")]}
              />
              <Bar
                dataKey="minutes"
                fill={CHART_PRIMARY_COLOR}
                radius={[2, 2, 0, 0]}
                isAnimationActive={barAnimation.isAnimationActive}
                animationDuration={barAnimation.animationDuration}
                animationEasing={barAnimation.animationEasing}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
