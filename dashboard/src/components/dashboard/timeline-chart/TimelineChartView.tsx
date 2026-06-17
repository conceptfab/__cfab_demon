/* eslint-disable react-doctor/prefer-dynamic-import -- imported via React.lazy from TimelineChart.impl.tsx */
import { useCallback, useRef, type ComponentProps } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_MUTED_SERIES_COLOR,
  TOKYO_NIGHT_CHART_PALETTE,
} from '@/lib/chart-styles';
import { formatDuration } from '@/lib/utils';
import {
  getStackedSeriesColor,
  getStackedSeriesLabel,
  OTHER_STACKED_SERIES_KEY,
} from '@/lib/stacked-bar-series';
import { extractTimelineChartDate } from '@/lib/timeline-chart-data';
import { TimelineChartAxisTick } from '@/components/dashboard/timeline-chart/TimelineChartAxisTick';
import { TimelineChartManualBarShape } from '@/components/dashboard/timeline-chart/TimelineChartBarShape';
import { TimelineChartTooltip } from '@/components/dashboard/timeline-chart/TimelineChartTooltip';
import type { TimelineChartModel } from '@/hooks/useTimelineChartModel';

const PALETTE = TOKYO_NIGHT_CHART_PALETTE;

interface TimelineChartViewProps {
  model: TimelineChartModel;
  onBarClick?: (date: string) => void;
  onBarContextMenu?: (date: string, x: number, y: number) => void;
}

export function TimelineChartView({
  model,
  onBarClick,
  onBarContextMenu,
}: TimelineChartViewProps) {
  const hoveredDateRef = useRef<string | null>(null);
  const {
    boostedLabel,
    chartData,
    chartDataByDate,
    chartHeightClassName,
    effectiveTitle,
    emptyMessage,
    errorMessage,
    finalBarAnimation,
    hasChartData,
    isHourly,
    isLoading,
    loadingMessage,
    manualLabel,
    projectColors,
    seriesKeys,
    seriesMetaByKey,
    useSimpleRendering,
    xLabelFormatter,
    xTickFormatter,
  } = model;

  const renderCustomAxisTick = useCallback(
    (props: unknown) => {
      const { x, y, payload } = (props ?? {}) as {
        x?: number;
        y?: number;
        payload?: { value?: string | number };
      };
      return (
        <TimelineChartAxisTick
          x={x}
          y={y}
          payload={payload}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
        />
      );
    },
    [chartDataByDate, xTickFormatter],
  );

  const renderTooltip = useCallback(
    (props: unknown) => {
      const tooltipProps = (props ?? {}) as ComponentProps<
        typeof TimelineChartTooltip
      >;
      return (
        <TimelineChartTooltip
          {...tooltipProps}
          seriesMetaByKey={seriesMetaByKey}
          xLabelFormatter={xLabelFormatter}
          boostedLabel={boostedLabel}
          manualLabel={manualLabel}
        />
      );
    },
    [boostedLabel, manualLabel, seriesMetaByKey, xLabelFormatter],
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
            <RefreshCw className="size-5 animate-spin" />
            <p className="text-xs font-medium">{loadingMessage}</p>
          </div>
        ) : errorMessage ? (
          <div
            className={`${chartHeightClassName} flex flex-col items-center justify-center gap-3 text-center`}
          >
            <AlertTriangle className="size-5 text-destructive" />
            <p className="max-w-sm text-xs text-muted-foreground">
              {errorMessage}
            </p>
          </div>
        ) : !hasChartData ? (
          <div
            className={`${chartHeightClassName} flex items-center justify-center text-center`}
          >
            <p className="max-w-sm text-xs text-muted-foreground">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <div
            className={
              chartHeightClassName +
              ' outline-none focus:outline-none focus:ring-0'
            }
            onContextMenu={(e) => {
              e.preventDefault();
              if (hoveredDateRef.current && onBarContextMenu) {
                onBarContextMenu(
                  hoveredDateRef.current,
                  e.clientX,
                  e.clientY,
                );
              }
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                onMouseMove={(state: unknown) => {
                  hoveredDateRef.current = extractTimelineChartDate(state);
                }}
                onMouseLeave={() => {
                  hoveredDateRef.current = null;
                }}
                onClick={(state: unknown) => {
                  const date = extractTimelineChartDate(state);
                  if (date) onBarClick?.(date);
                }}
                accessibilityLayer={false}
                tabIndex={-1}
              >
                <defs>
                  <pattern
                    id="hatch"
                    width="4"
                    height="4"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="2" height="4" fill="rgba(255,255,255,0.15)" />
                  </pattern>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={CHART_GRID_COLOR}
                  opacity={0.45}
                />
                <XAxis
                  dataKey="date"
                  tick={useSimpleRendering ? undefined : renderCustomAxisTick}
                  tickFormatter={
                    useSimpleRendering ? xTickFormatter : undefined
                  }
                  stroke={CHART_AXIS_COLOR}
                  fontSize={12}
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
                  domain={
                    isHourly
                      ? undefined
                      : [0, (dataMax: number) => Math.max(86_400, Number(dataMax || 0))]
                  }
                />
                <Tooltip content={renderTooltip} cursor={false} />
                {seriesKeys.map((key, idx) => {
                  const label = getStackedSeriesLabel(seriesMetaByKey, key);
                  const color =
                    key === OTHER_STACKED_SERIES_KEY
                      ? CHART_MUTED_SERIES_COLOR
                      : (getStackedSeriesColor(seriesMetaByKey, key) ??
                        projectColors[label] ??
                        projectColors[key] ??
                        PALETTE[idx % PALETTE.length]);
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
                          : TimelineChartManualBarShape
                      }
                      style={{
                        cursor: onBarClick ? 'pointer' : 'default',
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
