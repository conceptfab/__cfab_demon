import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Flame,
  PenLine,
  MessageSquare,
  RefreshCw,
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
import { useRechartsAnimationConfig } from "@/lib/chart-animation";
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
import { resolveDateFnsLocale } from "@/lib/date-helpers";
import {
  buildStackedSeriesMetaMap,
  getStackedSeriesColor,
  getStackedSeriesKeys,
  getStackedSeriesLabel,
  OTHER_STACKED_SERIES_KEY,
} from "@/lib/stacked-bar-series";

interface TimelineChartPresentationProps {
  projectColors?: Record<string, string>;
  granularity?: "hour" | "day";
  dateRange?: DateRange;
  trimLeadingToFirstData?: boolean;
  title?: string;
  heightClassName?: string;
  disableAnimation?: boolean;
}

interface TimelineChartInteractionProps {
  onBarClick?: (date: string) => void;
  onBarContextMenu?: (date: string, x: number, y: number) => void;
}

interface TimelineChartStateProps {
  isLoading?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  loadingMessage?: string;
}

interface TimelineChartProps {
  data: StackedBarData[];
  presentation?: TimelineChartPresentationProps;
  interaction?: TimelineChartInteractionProps;
  state?: TimelineChartStateProps;
}

const PALETTE = TOKYO_NIGHT_CHART_PALETTE;

type AxisTickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
};

type ChartInteractionState = {
  activeLabel?: string | number;
  activePayload?: Array<{ payload?: { date?: string } }>;
};

type BarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: { has_manual?: boolean };
  radius?: number | [number, number, number, number];
};

function extractDateFromChartState(state: unknown): string | null {
  const chartState = (state ?? {}) as ChartInteractionState;
  const activeLabel =
    typeof chartState.activeLabel === "string" ? chartState.activeLabel : null;
  const payloadDate = chartState.activePayload?.[0]?.payload?.date;
  const date = activeLabel ?? payloadDate ?? null;
  return typeof date === "string" && date.length > 0 ? date : null;
}

export function TimelineChart({
  data,
  presentation,
  interaction,
  state,
}: TimelineChartProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const {
    projectColors = {},
    granularity = "day",
    dateRange,
    trimLeadingToFirstData = false,
    title,
    heightClassName,
    disableAnimation = false,
  } = presentation ?? {};
  const { onBarClick, onBarContextMenu } = interaction ?? {};
  const {
    isLoading = false,
    errorMessage = null,
    emptyMessage = t("components.timeline_chart.no_data"),
    loadingMessage = t("components.timeline_chart.loading"),
  } = state ?? {};
  const effectiveTitle = title ?? t("components.timeline_chart.default_title");
  const hoveredDateRef = useRef<string | null>(null);
  const seriesMetaByKey = useMemo(() => buildStackedSeriesMetaMap(data), [data]);
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    const totals = new Map<string, number>();
    for (const row of data) {
      for (const key of getStackedSeriesKeys(row)) {
        keys.add(key);
        const value = row[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          totals.set(key, (totals.get(key) ?? 0) + value);
        }
      }
    }
    return Array.from(keys).sort((a, b) => {
      if (a === OTHER_STACKED_SERIES_KEY) return 1;
      if (b === OTHER_STACKED_SERIES_KEY) return -1;
      const diff = (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
      if (Math.abs(diff) > 0.001) return diff;
      return getStackedSeriesLabel(seriesMetaByKey, a).localeCompare(
        getStackedSeriesLabel(seriesMetaByKey, b),
        undefined,
        { sensitivity: "base" },
      );
    });
  }, [data, seriesMetaByKey]);

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
          const out: StackedBarData = { date: dateKey };
          for (const key of seriesKeys) {
            const val = row?.[key];
            out[key] = typeof val === "number" ? val : 0;
          }
          out.comments = row?.comments;
          out.has_boost = row?.has_boost;
          out.has_manual = row?.has_manual;
          out.series_meta = row?.series_meta;
          return out;
        });
      }
    }

    return data.map((row) => {
      const out: StackedBarData = { date: row.date };
      for (const key of seriesKeys) {
        const val = row[key];
        out[key] = typeof val === "number" ? val : 0;
      }
      out.comments = row.comments;
      out.has_boost = row.has_boost;
      out.has_manual = row.has_manual;
      out.series_meta = row.series_meta;
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
  const chartHeightClassName = heightClassName ?? (isHourly ? "h-64" : "h-56");
  const chartComplexity = chartData.length * Math.max(seriesKeys.length, 1);
  const useSimpleRendering = chartComplexity > 180;
  const barAnimation = useRechartsAnimationConfig({
    complexity: chartComplexity,
    maxComplexity: isHourly ? 240 : 300,
    minDuration: isHourly ? 150 : 170,
    maxDuration: isHourly ? 250 : 320,
  });
  const effectiveBarAnimation = useSimpleRendering
    ? {
        isAnimationActive: false,
        animationDuration: 0,
        animationEasing: "ease-out" as const,
      }
    : barAnimation;
  const finalBarAnimation = disableAnimation
    ? {
        isAnimationActive: false,
        animationDuration: 0,
        animationEasing: "ease-out" as const,
      }
    : effectiveBarAnimation;
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
  const xTickFormatter = useCallback((v: unknown) => {
    const raw = String(v);
    try {
      if (isHourly) return format(parseISO(raw), "HH:mm");
      if (daySpan <= 7) return format(parseISO(raw), "EEE", { locale });
      return format(parseISO(raw), "MMM d", { locale });
    } catch {
      return raw;
    }
  }, [isHourly, daySpan, locale]);
  const xLabelFormatter = useCallback((v: unknown) => {
    const raw = String(v);
    try {
      return format(
        parseISO(raw),
        isHourly ? "MMM d, yyyy HH:mm" : "MMM d, yyyy",
        { locale },
      );
    } catch {
      return raw;
    }
  }, [isHourly, locale]);

  const renderTooltip = useCallback((props: unknown) => {
    const { active, label, payload } = (props ?? {}) as {
      active?: boolean;
      label?: unknown;
      payload?: Array<{ name?: string; color?: string; value?: number | string; payload: StackedBarData }>;
    };
    if (!active || !payload || payload.length === 0) return null;

    const items = payload
      .map((entry) => ({
        name: getStackedSeriesLabel(
          seriesMetaByKey,
          String(entry.name ?? ""),
        ),
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
                "{c}"
              </div>
            ))}
          </div>
        )}
        {row?.has_boost && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, color: '#f87171', fontSize: 10, fontWeight: 700 }}>
            <Flame className="h-3 w-3" />
            {t("components.timeline_chart.boosted_activity")}
          </div>
        )}
        {row?.has_manual && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#34d399', fontSize: 10, fontWeight: 700 }}>
            <PenLine className="h-3 w-3" />
            {t("components.timeline_chart.manual_data_included")}
          </div>
        )}
      </div>
    );
  }, [seriesMetaByKey, t, xLabelFormatter]);

  const renderCustomAxisTick = useCallback((props: unknown) => {
    const { x = 0, y = 0, payload } = (props ?? {}) as AxisTickProps;
    const dateKey = String(payload?.value ?? "");
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
  }, [chartDataByDate, xTickFormatter]);
  const hasChartData = useMemo(
    () =>
      seriesKeys.length > 0 &&
      chartData.some((row) =>
        seriesKeys.some((key) => {
          const value = row[key];
          return typeof value === "number" && Number.isFinite(value) && value > 0;
        }),
      ),
    [chartData, seriesKeys],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{effectiveTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            className={`${chartHeightClassName} flex flex-col items-center justify-center gap-3 text-muted-foreground`}
          >
            <RefreshCw className="h-5 w-5 animate-spin" />
            <p className="text-xs font-medium">{loadingMessage}</p>
          </div>
        ) : errorMessage ? (
          <div
            className={`${chartHeightClassName} flex flex-col items-center justify-center gap-3 text-center`}
          >
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="max-w-sm text-xs text-muted-foreground">{errorMessage}</p>
          </div>
        ) : !hasChartData ? (
          <div
            className={`${chartHeightClassName} flex items-center justify-center text-center`}
          >
            <p className="max-w-sm text-xs text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <div 
            className={chartHeightClassName + " outline-none focus:outline-none focus:ring-0"}
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
                  onMouseMove={(state: unknown) => {
                      hoveredDateRef.current = extractDateFromChartState(state);
                  }}
                  onMouseLeave={() => {
                    hoveredDateRef.current = null;
                  }}
                  onClick={(state: unknown) => {
                    const date = extractDateFromChartState(state);
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
                    const label = getStackedSeriesLabel(seriesMetaByKey, key);
                    const color =
                      key === OTHER_STACKED_SERIES_KEY
                        ? CHART_MUTED_SERIES_COLOR
                        : (
                          getStackedSeriesColor(seriesMetaByKey, key) ??
                          projectColors[label] ??
                          projectColors[key] ??
                          PALETTE[idx % PALETTE.length]
                        );
                    return (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={label}
                        stackId="projects"
                        fill={color}
                        radius={isHourly ? [2, 2, 0, 0] : [4, 4, 0, 0]}
                        isAnimationActive={finalBarAnimation.isAnimationActive}
                        animationDuration={finalBarAnimation.animationDuration}
                        animationEasing={finalBarAnimation.animationEasing}
                        shape={
                          useSimpleRendering
                            ? undefined
                            : ((props: unknown) => {
                                const {
                                  x = 0,
                                  y = 0,
                                  width = 0,
                                  height = 0,
                                  fill,
                                  payload,
                                  radius,
                                } = (props ?? {}) as BarShapeProps;
                                if (height <= 0 || width <= 0) return null;
                                const cornerRadius = Array.isArray(radius)
                                  ? (radius[0] ?? 0)
                                  : (radius ?? 0);
                                return (
                                  <g>
                                    <rect
                                      x={x}
                                      y={y}
                                      width={width}
                                      height={height}
                                      fill={fill}
                                      rx={cornerRadius}
                                    />
                                    {payload?.has_manual && (
                                      <rect
                                        x={x}
                                        y={y}
                                        width={width}
                                        height={height}
                                        fill="url(#hatch)"
                                        rx={cornerRadius}
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
        )}
      </CardContent>
    </Card>
  );
}


