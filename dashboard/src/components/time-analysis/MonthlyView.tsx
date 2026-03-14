import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_AXIS_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from '@/lib/chart-styles';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { useSettingsStore } from '@/store/settings-store';
import { formatDuration } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { PALETTE } from './types';
import type { CalendarWeek } from './types';

interface MonthlyBarChartProps {
  monthlyBarData: { data: Record<string, unknown>[]; projectNames: string[] };
  monthTotalHours: number;
  stackedBarColorMap: Map<string, string>;
}

export function MonthlyBarChart({
  monthlyBarData,
  monthTotalHours,
  stackedBarColorMap,
}: MonthlyBarChartProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const isAnimationActive = useSettingsStore((s) => s.chartAnimations);

  return (
    <div className="flex flex-col">
      <h3 className="text-sm font-medium px-2 pb-4">
        {t('time_analysis_page.charts.daily_activity_total', {
          hours: monthTotalHours.toFixed(1),
        })}
      </h3>
      <div className="h-64 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyBarData.data}>
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                try {
                  return format(parseISO(v), 'd', { locale });
                } catch {
                  return v;
                }
              }}
              stroke={CHART_AXIS_COLOR}
              fontSize={10}
              tickLine={false}
              axisLine={false}
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
                `${Number(value).toFixed(1)}h`,
                name,
              ]}
              labelFormatter={(v) => {
                try {
                  return format(parseISO(v as string), 'EEE, MMM d', { locale });
                } catch {
                  return v as string;
                }
              }}
            />
            {monthlyBarData.projectNames.map((name) => (
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

interface MonthlyHeatmapProps {
  monthCalendar: { weeks: CalendarWeek[] };
}

export function MonthlyHeatmap({ monthCalendar }: MonthlyHeatmapProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const weekDays = [
    t('time_analysis_page.weekdays_short.mon'),
    t('time_analysis_page.weekdays_short.tue'),
    t('time_analysis_page.weekdays_short.wed'),
    t('time_analysis_page.weekdays_short.thu'),
    t('time_analysis_page.weekdays_short.fri'),
    t('time_analysis_page.weekdays_short.sat'),
    t('time_analysis_page.weekdays_short.sun'),
  ];

  return (
    <div className="min-w-[400px]">
      <div className="flex text-xs text-muted-foreground mb-1 pl-16">
        {weekDays.map((d) => (
          <div key={d} className="flex-1 text-center">
            {d}
          </div>
        ))}
      </div>
      {monthCalendar.weeks.map((week, wi) => (
        <div key={wi} className="flex items-center gap-1 mb-1">
          <div className="w-14 flex flex-col items-end pr-2 leading-tight">
            <span className="text-[11px] font-bold text-muted-foreground">
              {week.label}
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              {week.subLabel}
            </span>
          </div>
          <div className="flex flex-1 gap-1">
            {week.days.map((day, di) => {
              const hrs = (day.seconds / 3600).toFixed(1);
              const hasData = day.inMonth && day.seconds > 0;
              return (
                <div
                  key={di}
                  className="flex-1 h-[120px] rounded-md flex flex-col items-center justify-center text-xs font-medium relative overflow-hidden"
                  style={{
                    backgroundColor: !day.inMonth
                      ? 'rgba(41, 46, 66, 0.2)'
                      : 'rgba(41, 46, 66, 0.45)',
                    color: !day.inMonth
                      ? 'rgba(123, 131, 148, 0.4)'
                      : day.seconds > 0
                        ? '#fff'
                        : 'rgba(123, 131, 148, 0.6)',
                  }}
                  title={
                    hasData
                      ? `${format(parseISO(day.date), 'EEE, MMM d', { locale })} — ${formatDuration(day.seconds)}\n${day.projects.map((p) => `${p.name}: ${formatDuration(p.seconds)}`).join('\n')}`
                      : day.inMonth
                        ? `${format(parseISO(day.date), 'EEE, MMM d', { locale })} — ${t('time_analysis_page.fallbacks.no_activity')}`
                        : ''
                  }
                >
                  {hasData && (
                    <div className="absolute inset-0 flex flex-col">
                      {day.projects.map((proj, pi) => (
                        <div
                          key={pi}
                          style={{
                            height: `${(proj.seconds / day.seconds) * 100}%`,
                            backgroundColor: proj.color,
                            opacity: 0.65,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <span className="relative z-10">
                    {format(parseISO(day.date), 'd', { locale })}
                  </span>
                  {day.inMonth && day.seconds > 0 && (
                    <span className="relative z-10 ml-1 opacity-80">
                      {hrs}h
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

