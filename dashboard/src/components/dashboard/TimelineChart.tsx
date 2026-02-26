import { useMemo, useState } from "react";
import {
  TOOLTIP_CONTENT_STYLE,
  TOKYO_NIGHT_CHART_PALETTE,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_MUTED_SERIES_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
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
  trimLeadingToFirstData?: boolean;
  title?: string;
  heightClassName?: string;
  onBarClick?: (date: string) => void;
  onBarContextMenu?: (date: string, x: number, y: number) => void;
}

const PALETTE = TOKYO_NIGHT_CHART_PALETTE;

export function TimelineChart({
  data,
  projectColors = {},
  granularity = "day",
  dateRange,
  trimLeadingToFirstData = false,
  title = "Activity Timeline",
  heightClassName,
  onBarClick,
  onBarContextMenu,
}: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data) {
      for (const key of Object.keys(row)) {
        if (key !== "date" && key !== "comments") keys.add(key);
      }
    }
    return Array.from(keys);
  }, [data]);

  const chartData = useMemo(() => {
    if (granularity === "day" && dateRange?.start && dateRange?.end) {
      let fillStart = dateRange.start;
      if (trimLeadingToFirstData && data.length > 0) {
        const firstDataDate = data
          .map((row) => row.date)
          .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
          .sort()[0];
        if (firstDataDate && firstDataDate > fillStart) {
          fillStart = firstDataDate;
        }
      }

      let days: Date[] = [];
      try {
        days = eachDayOfInterval({
          start: parseISO(`${fillStart}T00:00:00`),
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
          const out: Record<string, string | number | string[] | undefined> = { date: dateKey };
          for (const key of seriesKeys) {
            const val = row?.[key];
            out[key] = typeof val === "number" ? val : 0;
          }
          out.comments = row?.comments;
          return out;
        });
      }
    }

    return data.map((row) => {
      const out: Record<string, string | number | string[] | undefined> = { date: row.date };
      for (const key of seriesKeys) {
        const val = row[key];
        out[key] = typeof val === "number" ? val : 0;
      }
      out.comments = row.comments;
      return out;
    });
  }, [data, seriesKeys, granularity, dateRange, trimLeadingToFirstData]);

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
      payload?: Array<{ name?: string; color?: string; value?: number | string; payload: StackedBarData }>;
    };
    if (!active || !payload || payload.length === 0) return null;

    const items = payload
      .map((entry) => ({
        name: String(entry.name ?? ""),
        color: entry.color ?? CHART_MUTED_SERIES_COLOR,
        value: Number(entry.value ?? 0),
      }))
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
      .sort((a, b) => b.value - a.value);

    const row = payload[0]?.payload;
    const comments = row?.comments;

    if (items.length === 0 && (!comments || comments.length === 0)) return null;

    return (
      <div style={{ ...TOOLTIP_CONTENT_STYLE, pointerEvents: "none" }}>
        <div style={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600, marginBottom: 6 }}>
          {xLabelFormatter(label)}
        </div>
        {items.map((item) => (
          <div
            key={item.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: CHART_TOOLTIP_TEXT_COLOR,
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
        {comments && comments.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${CHART_GRID_COLOR}` }}>
            {comments.map((c, i) => (
              <div key={i} style={{ color: CHART_TOOLTIP_TITLE_COLOR, fontSize: 11, fontStyle: "italic", marginBottom: 2 }}>
                “{c}”
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div 
          className={(heightClassName ?? (isHourly ? "h-64" : "h-56")) + " outline-none focus:outline-none focus:ring-0"}
          onContextMenu={(e) => {
            e.preventDefault();
            if (hoveredDate && onBarContextMenu) {
                onBarContextMenu(hoveredDate, e.clientX, e.clientY);
            }
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {isHourly ? (
              <BarChart 
                data={chartData}
                onMouseMove={(state: any) => {
                    const date = state?.activeLabel || (state?.activePayload?.[0]?.payload?.date);
                    if (date) setHoveredDate(date);
                }}
                onMouseLeave={() => setHoveredDate(null)}
                onClick={(state: any) => {
                  if (state && state.activePayload && state.activePayload.length > 0) {
                    const date = state.activePayload[0].payload.date;
                    if (date) onBarClick?.(date);
                  }
                }}
                accessibilityLayer={false}
                tabIndex={-1}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} opacity={0.45} />
                <XAxis
                  dataKey="date"
                  tickFormatter={xTickFormatter}
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
                  tickFormatter={(v) => formatDuration(Number(v))}
                />
                <Tooltip
                  content={renderTooltip}
                  cursor={false}
                />
                {seriesKeys.map((key, idx) => {
                  const color =
                    key === "Other"
                      ? CHART_MUTED_SERIES_COLOR
                      : (projectColors[key] ?? PALETTE[idx % PALETTE.length]);
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key}
                      stackId="projects"
                      fill={color}
                      radius={[2, 2, 0, 0]}
                      style={{ cursor: onBarClick ? "pointer" : "default" }}
                    />
                  );
                })}
              </BarChart>
            ) : (
              <BarChart 
                data={chartData}
                onMouseMove={(state: any) => {
                    const date = state?.activeLabel || (state?.activePayload?.[0]?.payload?.date);
                    if (date) setHoveredDate(date);
                }}
                onMouseLeave={() => setHoveredDate(null)}
                onClick={(state: any) => {
                  const date = state?.activeLabel || (state?.activePayload?.[0]?.payload?.date);
                  if (date) onBarClick?.(date);
                }}
                accessibilityLayer={false}
                tabIndex={-1}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} opacity={0.45} />
                <XAxis
                  dataKey="date"
                  tickFormatter={xTickFormatter}
                  stroke={CHART_AXIS_COLOR}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis
                  stroke={CHART_AXIS_COLOR}
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
                  const color =
                    key === "Other"
                      ? CHART_MUTED_SERIES_COLOR
                      : (projectColors[key] ?? PALETTE[idx % PALETTE.length]);
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key}
                      stackId="projects"
                      fill={color}
                      radius={[4, 4, 0, 0]}
                      style={{ cursor: onBarClick ? "pointer" : "default" }}
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
