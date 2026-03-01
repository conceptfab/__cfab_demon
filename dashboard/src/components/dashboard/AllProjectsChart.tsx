import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { getRechartsAnimationConfig } from "@/lib/chart-animation";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";
import type { ProjectTimeRow } from "@/lib/db-types";

interface Props {
  projects: ProjectTimeRow[];
}

export function AllProjectsChart({ projects }: Props) {
  const { t } = useTranslation();
  const [sortMode, setSortMode] = useState<"name" | "time_desc">("name");

  const sorted = useMemo(() => {
    const out = [...projects];
    if (sortMode === "time_desc") {
      out.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    } else {
      out.sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }, [projects, sortMode]);
  const barAnimation = getRechartsAnimationConfig({
    complexity: sorted.length,
    maxComplexity: 45,
    minDuration: 170,
    maxDuration: 300,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span>{t("components.all_projects.title")}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={sortMode === "name" ? "default" : "outline"}
              onClick={() => setSortMode("name")}
            >
              {t("components.all_projects.sort_name")}
            </Button>
            <Button
              size="sm"
              variant={sortMode === "time_desc" ? "default" : "outline"}
              onClick={() => setSortMode("time_desc")}
            >
              {t("components.all_projects.sort_most_time")}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">{t("components.all_projects.no_projects")}</p>
        ) : (
          <div className="h-[11rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sorted} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} barCategoryGap="12%">
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} opacity={0.35} />
                <XAxis
                  dataKey="name"
                  tick={false}
                  height={0}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatDuration(Number(v))}
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                  formatter={(value) => [formatDuration(Number(value)), t("components.all_projects.tooltip_time")]}
                  labelFormatter={(label) => String(label)}
                />
                <Bar
                  dataKey="seconds"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={barAnimation.isAnimationActive}
                  animationDuration={barAnimation.animationDuration}
                  animationEasing={barAnimation.animationEasing}
                >
                  {sorted.map((p) => (
                    <Cell key={p.name} fill={p.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
