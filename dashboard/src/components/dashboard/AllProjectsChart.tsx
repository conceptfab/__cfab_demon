import { useMemo, useState } from "react";
import { TOOLTIP_CONTENT_STYLE } from "@/lib/chart-styles";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";
import type { ProjectTimeRow } from "@/lib/db-types";

interface Props {
  projects: ProjectTimeRow[];
}

export function AllProjectsChart({ projects }: Props) {
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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span>All Projects</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={sortMode === "name" ? "default" : "outline"}
              onClick={() => setSortMode("name")}
            >
              Name / Folder
            </Button>
            <Button
              size="sm"
              variant={sortMode === "time_desc" ? "default" : "outline"}
              onClick={() => setSortMode("time_desc")}
            >
              Most Time
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">No projects found.</p>
        ) : (
          <div className="h-[11rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sorted} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} barCategoryGap="12%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.35} />
                <XAxis
                  dataKey="name"
                  tick={false}
                  height={0}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatDuration(Number(v))}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={{ color: "#f1f5f9", fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ color: "#e2e8f0" }}
                  formatter={(value) => [formatDuration(Number(value)), "Time"]}
                  labelFormatter={(label) => String(label)}
                />
                <Bar dataKey="seconds" radius={[4, 4, 0, 0]}>
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
