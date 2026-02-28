import { useMemo, useRef } from "react";
import {
  Flame,
  PenLine,
  MessageSquare,
} from "lucide-react";
import {
  TOOLTIP_CONTENT_STYLE,
  TOKYO_NIGHT_CHART_PALETTE,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_MUTED_SERIES_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from "@/lib/chart-styles";
import { getRechartsAnimationConfig } from "@/lib/chart-animation";
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
  const hoveredDateRef = useRef<string | null>(null);
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data) {
      for (const key of Object.keys(row)) {
        if (key !== "date" && key !== "comments" && key !== "has_boost" && key !== "has_manual") keys.add(key);
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
          const out: Record<string, string | number | string[] | boolean | undefined> = { date: dateKey };
          for (const key of seriesKeys) {
            const val = row?.[key];
            out[key] = typeof val === "number" ? val : 0;
          }
          out.comments = row?.comments;
          out.has_boost = row?.has_boost;
          out.has_manual = row?.has_manual;
          return out;
        });
      }
    }

    return data.map((row) => {
      const out: Record<string, string | number | string[] | boolean | undefined> = { date: row.date };
      for (const key of seriesKeys) {
        const val = row[key];
        out[key] = typeof val === "number" ? val : 0;
      }
      out.comments = row.comments;
      out.has_boost = row.has_boost;
      out.has_manual = row.has_manual;
      return out;
    });
  }, [data, seriesKeys, granularity, dateRange, trimLeadingToFirstData]);
  const chartDataByDate = useMemo(() => {
    const map = new Map<string, (typeof chartData)[number]>();
    for (const row of chartData) {
      map.set(String(row.date), row);
    }
    return map;
  }, [chartData]);

  const isHourly = granularity === "hour";
  const chartComplexity = chartData.length * Math.max(seriesKeys.length, 1);
  const useSimpleRendering = chartComplexity > 180;
  const barAnimation = useMemo(
    () =>
      getRechartsAnimationConfig({
        complexity: chartComplexity,
        maxComplexity: isHourly ? 240 : 300,
        minDuration: isHourly ? 150 : 170,
        maxDuration: isHourly ? 250 : 320,
      }),
    [chartComplexity, isHourly]
  );
  const effectiveBarAnimation = useSimpleRendering
    ? {
        isAnimationActive: false,
        animationDuration: 0,
        animationEasing: "ease-out" as const,
      }
    : barAnimation;
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
        {row?.has_boost && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: '#f87171', fontSize: 10, fontWeight: 700 }}>
            <Flame className="h-3 w-3" />
            BOOSTED ACTIVITY
          </div>
        )}
        {row?.has_manual && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#34d399', fontSize: 10, fontWeight: 700 }}>
            <PenLine className="h-3 w-3" />
            MANUAL DATA INCLUDED
          </div>
        )}
      </div>
    );
  };

  const renderCustomAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const dateKey = String(payload.value);
    const row = chartDataByDate.get(dateKey);
    if (!row) return null;

    const hasComments = Array.isArray(row.comments) && row.comments.length > 0;
    const hasBoost = row.has_boost;
    const hasManual = row.has_manual;

    return (
      <g transform={`translate(${x}, ${y})`}>
        <text 
          x={0} 
          y={10} 
          dy={4} 
          textAnchor="middle" 
          fill={CHART_AXIS_COLOR} 
          fontSize={12}
        >
          {xTickFormatter(dateKey)}
        </text>
        
        {(hasComments || hasBoost || hasManual) && (
          <foreignObject x="-40" y={22} width="80" height="20" style={{ pointerEvents: 'none' }}>
            <div className="flex items-center justify-center gap-1.5 overflow-visible">
              {hasBoost && (
                <Flame size={12} className="text-red-400 fill-red-400/20 drop-shadow-sm" />
              )}
              {hasComments && (
                <MessageSquare size={12} className="text-sky-400 fill-sky-400/30 drop-shadow-sm" />
              )}
              {hasManual && (
                <PenLine size={12} className="text-emerald-400 drop-shadow-sm" />
              )}
            </div>
          </foreignObject>
        )}
      </g>
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
            if (hoveredDateRef.current && onBarContextMenu) {
                onBarContextMenu(hoveredDateRef.current, e.clientX, e.clientY);
            }
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
                data={chartData}
                onMouseMove={(state: any) => {
                    const date = state?.activeLabel || (state?.activePayload?.[0]?.payload?.date);
                    hoveredDateRef.current = typeof date === "string" && date.length > 0 ? date : null;
                }}
                onMouseLeave={() => {
                  hoveredDateRef.current = null;
                }}
                onClick={(state: any) => {
                  const date = state?.activeLabel || (state?.activePayload?.[0]?.payload?.date);
                  if (date) onBarClick?.(date);
                }}
                accessibilityLayer={false}
                tabIndex={-1}
              >
                <defs>
                  <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="2" height="4" fill="rgba(255,255,255,0.15)" />
                  </pattern>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} opacity={0.45} />
                <XAxis
                  dataKey="date"
                  tick={useSimpleRendering ? undefined : renderCustomAxisTick}
                  tickFormatter={useSimpleRendering ? xTickFormatter : undefined}
                  stroke={CHART_AXIS_COLOR}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval={isHourly ? 2 : undefined}
                  minTickGap={isHourly ? undefined : 18}
                  height={useSimpleRendering ? 28 : 50}
                />
                <YAxis
                  stroke={CHART_AXIS_COLOR}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatDuration(Number(v))}
                  domain={isHourly ? undefined : [0, (dataMax: number) => Math.max(86_400, Number(dataMax || 0))]}
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
                      radius={isHourly ? [2, 2, 0, 0] : [4, 4, 0, 0]}
                      isAnimationActive={effectiveBarAnimation.isAnimationActive}
                      animationDuration={effectiveBarAnimation.animationDuration}
                      animationEasing={effectiveBarAnimation.animationEasing}
                      shape={
                        useSimpleRendering
                          ? undefined
                          : ((props: any) => {
                              const { x, y, width, height, fill, payload, radius } = props;
                              if (!height || height <= 0) return null;
                              return (
                                <g>
                                  <rect
                                    x={x}
                                    y={y}
                                    width={width}
                                    height={height}
                                    fill={fill}
                                    rx={radius?.[0] || 0}
                                  />
                                  {payload?.has_manual && (
                                    <rect
                                      x={x}
                                      y={y}
                                      width={width}
                                      height={height}
                                      fill="url(#hatch)"
                                      rx={radius?.[0] || 0}
                                      style={{ pointerEvents: "none" }}
                                    />
                                  )}
                                </g>
                              );
                            })
                      }
                      style={{ 
                        cursor: onBarClick ? "pointer" : "default",
                      }}
                    />
                  );
                })}
              </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
