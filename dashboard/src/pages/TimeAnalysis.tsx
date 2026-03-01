import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Button } from '@/components/ui/button';
import {
  TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
} from '@/lib/chart-styles';
import { formatDuration } from '@/lib/utils';
import { useTimeAnalysisData } from '@/components/time-analysis/useTimeAnalysisData';
import {
  DailyBarChart,
  DailyHeatmap,
} from '@/components/time-analysis/DailyView';
import {
  WeeklyBarChart,
  WeeklyHeatmap,
} from '@/components/time-analysis/WeeklyView';
import {
  MonthlyBarChart,
  MonthlyHeatmap,
} from '@/components/time-analysis/MonthlyView';
import { useSettingsStore } from '@/store/settings-store';
import { useInlineT } from '@/lib/inline-i18n';

export function TimeAnalysis() {
  const t = useInlineT();
  const isAnimationActive = useSettingsStore((s) => s.chartAnimations);
  const d = useTimeAnalysisData();
  const hasPieProjectData = d.pieData.length > 0;
  const pieChartData = hasPieProjectData
    ? d.pieData
    : [{ name: t('Brak danych projektowych', 'No project data'), value: 1, fill: '#334155' }];

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={d.rangeMode === 'daily' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => d.setRangeMode('daily')}
          >
            {t('Dzisiaj', 'Today')}
          </Button>
          <Button
            variant={d.rangeMode === 'weekly' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => d.setRangeMode('weekly')}
          >
            {t('Tydzień', 'Week')}
          </Button>
          <Button
            variant={d.rangeMode === 'monthly' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => d.setRangeMode('monthly')}
          >
            {t('Miesiąc', 'Month')}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => d.shiftDateRange(-1)}
            title={t('Poprzedni okres', 'Previous period')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">
            {d.dateLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => d.shiftDateRange(1)}
            disabled={!d.canShiftForward}
            title={t('Następny okres', 'Next period')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bar chart — delegates to view-specific component */}
        {d.rangeMode === 'daily' ? (
          <DailyBarChart {...d} />
        ) : d.rangeMode === 'weekly' ? (
          <WeeklyBarChart {...d} />
        ) : (
          <MonthlyBarChart {...d} />
        )}

        {/* Pie chart — Project Time Distribution */}
        <div className="flex flex-col">
          <h3 className="text-sm font-medium px-2 pb-4">{t('Rozkład czasu', 'Time Distribution')}</h3>
          <div className="flex flex-col gap-4 px-2 md:h-80 md:flex-row md:items-center md:gap-6 md:pl-8 lg:pl-12">
            <div className="flex w-full items-center justify-center md:h-full md:w-[340px] md:min-w-[300px] md:max-w-[380px] md:flex-none">
              <PieChart width={320} height={320}>
                <Pie
                  data={pieChartData}
                  cx={160}
                  cy={160}
                  innerRadius={90}
                  outerRadius={130}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                  isAnimationActive={isAnimationActive}
                >
                  {pieChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                {hasPieProjectData && (
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={{
                      color: CHART_TOOLTIP_TITLE_COLOR,
                      fontWeight: 600,
                    }}
                    itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                    formatter={(value) => [
                      formatDuration(value as number),
                      t('Czas', 'Time'),
                    ]}
                  />
                )}
              </PieChart>
              {!hasPieProjectData && (
                <p
                  className={`mt-2 w-full text-center text-sm ${d.loadError ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {d.pieFallbackMessage}
                </p>
              )}
            </div>
            <div className="flex w-full flex-col gap-2.5 overflow-y-auto pr-1 md:max-h-full md:min-w-[220px] md:flex-1 md:pr-4">
              {hasPieProjectData ? (
                d.pieData.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 text-[11px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: entry.fill }}
                      />
                      <span className="text-muted-foreground line-clamp-1 font-medium">
                        {entry.name}
                      </span>
                    </div>
                    <span className="text-muted-foreground/80 font-mono whitespace-nowrap">
                      {formatDuration(entry.value)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                  <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-slate-600" />
                  <span>{t('Oczekiwanie na dane aktywności projektów', 'Awaiting project activity data')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="flex flex-col">
        <h3 className="text-sm font-medium px-2 pb-4">
          {d.rangeMode === 'daily'
            ? t('Dzienna oś projektów', 'Daily Project Timeline')
            : d.rangeMode === 'monthly'
              ? t('Miesięczna mapa kalendarza', 'Monthly Calendar Heatmap')
              : t('Tygodniowa oś projektów', 'Weekly Project Timeline')}
        </h3>
        <div className="px-2">
          <div className="overflow-x-auto">
            {d.rangeMode === 'daily' ? (
              <DailyHeatmap {...d} />
            ) : d.rangeMode === 'monthly' ? (
              <MonthlyHeatmap {...d} />
            ) : (
              <WeeklyHeatmap {...d} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
