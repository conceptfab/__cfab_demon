import { useMemo } from "react";
import { TOOLTIP_CONTENT_STYLE } from "@/lib/chart-styles";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { formatDuration } from "@/lib/utils";
import type { DateRange, StackedBarData } from "@/lib/db-types";

interface Props {
  data: StackedBarData[];
  projectColors?: Record<string, string>;
  granularity?: "hour" | "day";
  dateRange?: DateRange;
  title?: string;
  heightClassName?: string;
}

const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee", "#14b8a6", "#e879f9"];

export function TimelineChart({
  data,
  projectColors = {},
  granularity = "day",
  dateRange,
  title = "Activity Timeline",
  heightClassName,
}: Props) {
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data) {
      for (const key of Object.keys(row)) {
        if (key !== "date") keys.add(key);
      }
    }
    return Array.from(keys);
  }, [data]);

  const chartData = useMemo(() => {
    if (granularity === "day" && dateRange?.start && dateRange?.end) {
      let days: Date[] = [];
      try {
        days = eachDayOfInterval({
          start: parseISO(`${dateRange.start}T00:00:00`),
          end: parseISO(`${dateRange.end}T00:00:00`),
        });
      } catch {
        days = [];
      }
      if (days.length > 0) {
        const byDate = new Map<string, StackedBarData>();
        for (const row of data) byDate.set(row.date, row);
        return days.map((day) => {
          const dateKey = format(day, "yyyy-MM-dd");
          const row = byDate.get(dateKey);
          const out: Record<string, string | number> = { date: dateKey };
          for (const key of seriesKeys) {
            const val = row?.[key];
            out[key] = typeof val === "number" ? val : 0;
          }
          return out;
        });
      }
    }

    return data.map((row) => {
      const out: Record<string, string | number> = { date: row.date };
      for (const key of seriesKeys) {
        const val = row[key];
        out[key] = typeof val === "number" ? val : 0;
      }
      return out;
    });
  }, [data, seriesKeys, granularity, dateRange]);

  const isHourly = granularity === "hour";
  const daySpan = useMemo(() => {
    if (!dateRange?.start || !dateRange?.end) return 0;
    try {
      return eachDayOfInterval({
        start: parseISO(`${dateRange.start}T00:00:00`),
        end: parseISO(`${dateRange.end}T00:00:00`),
      }).length;
    } catch {
      return 0;
    }
  }, [dateRange]);
  const xTickFormatter = (v: unknown) => {
    const raw = String(v);
    try {
      if (isHourly) return format(parseISO(raw), "HH:mm");
      if (daySpan <= 7) return format(parseISO(raw), "EEE");
      return format(parseISO(raw), "MMM d");
    } catch {
      return raw;
    }
  };
  const xLabelFormatter = (v: unknown) => {
    const raw = String(v);
    try {
      return format(parseISO(raw), isHourly ? "MMM d, yyyy HH:mm" : "MMM d, yyyy");
    } catch {
      return raw;
    }
  };

  const renderTooltip = (props: unknown) => {
    const { active, label, payload } = (props ?? {}) as {
      active?: boolean;
      label?: unknown;
      payload?: Array<{ name?: string; color?: string; value?: number | string }>;
    };
    if (!active || !payload || payload.length === 0) return null;

    const items = payload
      .map((entry) => ({
        name: String(entry.name ?? ""),
        color: entry.color ?? "#94a3b8",
        value: Number(entry.value ?? 0),
      }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
      .sort((a, b) => b.value - a.value);

    if (items.length === 0) return null;

    return (
      <div style={TOOLTIP_CONTENT_STYLE}>
        <div style={{ color: "#f1f5f9", fontWeight: 600, marginBottom: 6 }}>
          {xLabelFormatter(label)}
        </div>
        {items.map((item) => (
          <div
            key={item.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#e2e8f0",
              marginBottom: 2,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                backgroundColor: item.color,
                flexShrink: 0,
              }}
            />
            <span>{item.name}</span>
            <span style={{ marginLeft: "auto" }}>{formatDuration(item.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={heightClassName ?? (isHourly ? "h-64" : "h-56")}>
          <ResponsiveContainer width="100%" height="100%">
            {isHourly ? (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.45} />
                <XAxis
                  dataKey="date"
                  tickFormatter={xTickFormatter}
                  stroke="#475569"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  stroke="#475569"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatDuration(Number(v))}
                />
                <Tooltip
                  content={renderTooltip}
                />
                {seriesKeys.map((key, idx) => {
                  const color = projectColors[key] ?? PALETTE[idx % PALETTE.length];
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key}
                      stackId="projects"
                      fill={color}
                      radius={[2, 2, 0, 0]}
                    />
                  );
                })}
              </BarChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.45} />
                <XAxis
                  dataKey="date"
                  tickFormatter={xTickFormatter}
                  stroke="#475569"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis
                  stroke="#475569"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatDuration(Number(v))}
                  domain={[0, (dataMax: number) => Math.max(86_400, Number(dataMax || 0))]}
                />
                <Tooltip
                  content={renderTooltip}
                />
                {seriesKeys.map((key, idx) => {
                  const color = projectColors[key] ?? PALETTE[idx % PALETTE.length];
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key}
                      stackId="projects"
                      fill={color}
                      radius={[2, 2, 0, 0]}
                    />
                  );
                })}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
