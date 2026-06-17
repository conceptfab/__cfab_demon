/* eslint-disable react-doctor/prefer-dynamic-import -- lazy-loaded by sibling wrapper (.tsx → .impl.tsx) */
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
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
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { mobileLayout } from '@/lib/mobile-layout';

const MOBILE_SIDE_SLOT = 'size-9 shrink-0';

function SegmentedToolbar({
  className,
  'aria-label': ariaLabel,
  children,
}: {
  className?: string;
  'aria-label': string;
  children: ReactNode;
}) {
  return (
    <fieldset
      className={cn(
        'm-0 flex min-w-0 w-full rounded-lg border border-border/70 bg-muted/15 p-0.5 md:hidden',
        className,
      )}
    >
      <legend className="sr-only">{ariaLabel}</legend>
      {children}
    </fieldset>
  );
}

function SegmentedToolbarButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 min-w-0 flex-1 rounded-md px-0.5 text-[10px] leading-tight whitespace-normal shadow-none',
        active
          ? 'border border-primary/30 bg-primary/14 text-foreground'
          : 'border border-transparent text-muted-foreground hover:bg-accent/50',
      )}
    >
      {children}
    </Button>
  );
}

export function TimeAnalysis() {
  const { t } = useTranslation();
  const isAnimationActive = useSettingsStore((s) => s.chartAnimations);
  const d = useTimeAnalysisData();
  const hasPieProjectData = d.pieData.length > 0;
  const pieChartData = hasPieProjectData
    ? d.pieData
    : [
        {
          name: t('time_analysis_page.no_project_data'),
          value: 1,
          fill: '#334155',
        },
      ];

  return (
    <div className={mobileLayout.pageStack}>
      {/* Toolbar */}
      <div className="flex w-full min-w-0 flex-col gap-2">
        <SegmentedToolbar aria-label={t('time_analysis_page.group.toolbar_label')}>
          <SegmentedToolbarButton
            active={d.groupBy === 'projects'}
            onClick={() => d.setGroupBy('projects')}
          >
            {t('time_analysis_page.group.projects')}
          </SegmentedToolbarButton>
          <SegmentedToolbarButton
            active={d.groupBy === 'clients'}
            onClick={() => d.setGroupBy('clients')}
          >
            {t('time_analysis_page.group.clients')}
          </SegmentedToolbarButton>
        </SegmentedToolbar>

        <SegmentedToolbar aria-label={t('time_analysis_page.range.toolbar_label')}>
          <SegmentedToolbarButton
            active={d.rangeMode === 'daily'}
            onClick={() => d.setRangeMode('daily')}
          >
            {t('time_analysis_page.range.today')}
          </SegmentedToolbarButton>
          <SegmentedToolbarButton
            active={d.rangeMode === 'weekly'}
            onClick={() => d.setRangeMode('weekly')}
          >
            {t('time_analysis_page.range.week')}
          </SegmentedToolbarButton>
          <SegmentedToolbarButton
            active={d.rangeMode === 'monthly'}
            onClick={() => d.setRangeMode('monthly')}
          >
            {t('time_analysis_page.range.month')}
          </SegmentedToolbarButton>
        </SegmentedToolbar>

        <div className="grid w-full min-w-0 grid-cols-[2.25rem_1fr_2.25rem] items-center md:hidden">
          <span className={MOBILE_SIDE_SLOT} aria-hidden />
          <div className="flex min-w-0 items-center justify-center gap-0.5">
            <AppTooltip content={t('time_analysis_page.previous_period')}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('time_analysis_page.previous_period')}
                className={MOBILE_SIDE_SLOT}
                onClick={() => d.shiftDateRange(-1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            </AppTooltip>
            <span className="min-w-[5.5rem] whitespace-nowrap text-center text-xs text-muted-foreground">
              {d.dateLabel}
            </span>
            <AppTooltip content={t('time_analysis_page.next_period')}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('time_analysis_page.next_period')}
                className={MOBILE_SIDE_SLOT}
                onClick={() => d.shiftDateRange(1)}
                disabled={!d.canShiftForward}
              >
                <ChevronRight className="size-4" />
              </Button>
            </AppTooltip>
          </div>
          <span className={MOBILE_SIDE_SLOT} aria-hidden />
        </div>

        <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
          <Button
            variant={d.groupBy === 'projects' ? 'default' : 'outline'}
            size="sm"
            onClick={() => d.setGroupBy('projects')}
          >
            {t('time_analysis_page.group.projects')}
          </Button>
          <Button
            variant={d.groupBy === 'clients' ? 'default' : 'outline'}
            size="sm"
            onClick={() => d.setGroupBy('clients')}
          >
            {t('time_analysis_page.group.clients')}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant={d.rangeMode === 'daily' ? 'default' : 'outline'}
            size="sm"
            onClick={() => d.setRangeMode('daily')}
          >
            {t('time_analysis_page.range.today')}
          </Button>
          <Button
            variant={d.rangeMode === 'weekly' ? 'default' : 'outline'}
            size="sm"
            onClick={() => d.setRangeMode('weekly')}
          >
            {t('time_analysis_page.range.week')}
          </Button>
          <Button
            variant={d.rangeMode === 'monthly' ? 'default' : 'outline'}
            size="sm"
            onClick={() => d.setRangeMode('monthly')}
          >
            {t('time_analysis_page.range.month')}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <AppTooltip content={t('time_analysis_page.previous_period')}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('time_analysis_page.previous_period')}
              onClick={() => d.shiftDateRange(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </AppTooltip>
          <span className="min-w-[5rem] text-center text-xs text-muted-foreground">
            {d.dateLabel}
          </span>
          <AppTooltip content={t('time_analysis_page.next_period')}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('time_analysis_page.next_period')}
              onClick={() => d.shiftDateRange(1)}
              disabled={!d.canShiftForward}
            >
              <ChevronRight className="size-4" />
            </Button>
          </AppTooltip>
        </div>
      </div>

      {d.isLoading && (
        <output
          aria-live="polite"
          aria-label={t('time_analysis_page.fallbacks.loading_chart_data')}
          className="block rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground"
        >
          {t('time_analysis_page.fallbacks.loading_chart_data')}
        </output>
      )}

      {!d.isLoading && d.loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {t('time_analysis_page.fallbacks.load_chart_failed')} {d.loadError}
        </div>
      )}

      {/* Charts row */}
      <div className={mobileLayout.chartGrid}>
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
          <h3 className="pb-4 text-sm font-medium">
            {t('time_analysis_page.time_distribution_title')}
          </h3>
          <div className="flex flex-col gap-4 px-0 md:h-80 md:flex-row md:items-center md:gap-6 md:pl-8 lg:pl-12">
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
                  {pieChartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
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
                      t('time_analysis_page.time_label'),
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
                d.pieData.map((entry) => (
                  <div
                    key={entry.name}
                    className="flex items-center justify-between gap-4 text-[11px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="size-2.5 rounded-full shrink-0"
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
                  <div className="size-2.5 rounded-full shrink-0 bg-slate-600" />
                  <span>{t('time_analysis_page.awaiting_project_activity')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="flex flex-col">
        <h3 className="pb-4 text-sm font-medium">
          {d.rangeMode === 'daily'
            ? t('time_analysis_page.heatmap.daily_timeline')
            : d.rangeMode === 'monthly'
              ? t('time_analysis_page.heatmap.monthly_heatmap')
              : t('time_analysis_page.heatmap.weekly_timeline')}
        </h3>
        <div className="px-0">
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
