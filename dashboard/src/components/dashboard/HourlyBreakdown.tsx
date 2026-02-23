import { useMemo } from "react";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HourlyData } from "@/lib/db-types";

interface Props {
  data: HourlyData[];
}

export function HourlyBreakdown({ data }: Props) {
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Hourly Breakdown</CardTitle>
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
                formatter={(value) => [`${value} min`, "Time"]}
              />
              <Bar dataKey="minutes" fill={CHART_PRIMARY_COLOR} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
