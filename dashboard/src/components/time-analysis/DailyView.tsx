import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from '@/lib/chart-styles';
import { useAppStore } from '@/store/app-store';
import { formatDuration } from '@/lib/utils';
import { PALETTE } from './types';
import type { HourSlot } from './types';

interface DailyViewProps {
  dailyHourlyGrid: { hours: HourSlot[]; allProjects: string[]; maxVal: number };
  dailyBarData: { data: Record<string, unknown>[]; projectNames: string[] };
  dailyTotalHours: number;
  stackedBarColorMap: Map<string, string>;
}

export function DailyBarChart({
  dailyBarData,
  dailyTotalHours,
  stackedBarColorMap,
}: DailyViewProps) {
  const isAnimationActive = useAppStore((s) => s.chartAnimations);

  return (
    <div className="flex flex-col">
      <h3 className="text-sm font-medium px-2 pb-4">
        {`Hourly Activity — ${dailyTotalHours.toFixed(1)}h total`}
      </h3>
      <div className="h-64 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dailyBarData.data}>
            <XAxis
              dataKey="hour"
              stroke={CHART_AXIS_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis
              stroke={CHART_AXIS_COLOR}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}h`}
            />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR, fontWeight: 600 }}
              itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
              formatter={(value, name) => [
                `${(Number(value) * 60).toFixed(0)}min`,
                name,
              ]}
            />
            {dailyBarData.projectNames.map((name) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="stack"
                fill={stackedBarColorMap.get(name) || PALETTE[0]}
                radius={[0, 0, 0, 0]}
                isAnimationActive={isAnimationActive}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DailyHeatmap({ dailyHourlyGrid }: DailyViewProps) {
  return (
    <div className="min-w-[600px]">
      {/* Hour labels */}
      <div className="flex text-xs text-muted-foreground mb-2">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="flex-1 text-center">
            {i.toString().padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* Main timeline bar — height proportional to actual time */}
      <div className="flex gap-0.5 mb-3">
        {dailyHourlyGrid.hours.map((slot) => {
          const hasData = slot.totalSeconds > 0;
          const fillPct = Math.min(100, (slot.totalSeconds / 3600) * 100);
          return (
            <div
              key={slot.hour}
              className="flex-1 rounded-sm overflow-hidden flex flex-col justify-end"
              style={{
                height: '32px',
                backgroundColor: 'rgba(41, 46, 66, 0.45)',
              }}
              title={
                hasData
                  ? `${slot.hour}:00 — ${formatDuration(slot.totalSeconds)}\n${slot.projects.map((p) => `${p.name}: ${formatDuration(p.seconds)}`).join('\n')}`
                  : `${slot.hour}:00 — No activity`
              }
            >
              {hasData && (
                <div
                  className="flex flex-col w-full"
                  style={{ height: `${fillPct}%` }}
                >
                  {slot.projects.map((proj, pi) => {
                    const pct = (proj.seconds / slot.totalSeconds) * 100;
                    return (
                      <div
                        key={pi}
                        style={{
                          height: `${pct}%`,
                          minHeight:
                            slot.projects.length > 1 ? '2px' : undefined,
                          backgroundColor: proj.color,
                          opacity: 0.85,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detailed rows per hour (only hours with data) */}
      <div className="space-y-1 mt-4">
        {dailyHourlyGrid.hours
          .filter((s) => s.totalSeconds > 0)
          .map((slot) => (
            <div key={slot.hour} className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground text-right font-mono">
                {slot.hour.toString().padStart(2, '0')}:00
              </span>
              <div className="flex-1 flex gap-1 items-center h-6">
                {slot.projects.map((proj, pi) => {
                  const pct = Math.max(3, (proj.seconds / 3600) * 100);
                  return (
                    <div
                      key={pi}
                      className="h-full rounded-sm flex items-center justify-center text-[10px] font-medium px-1 truncate"
                      style={{
                        width: `${pct}%`,
                        minWidth: '24px',
                        backgroundColor: proj.color,
                        color: '#fff',
                        opacity: 0.85,
                      }}
                      title={`${proj.name}: ${formatDuration(proj.seconds)}`}
                    >
                      {proj.seconds >= 120 ? proj.name : ''}
                    </div>
                  );
                })}
              </div>
              <span className="w-12 text-xs text-muted-foreground text-right">
                {formatDuration(slot.totalSeconds)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
