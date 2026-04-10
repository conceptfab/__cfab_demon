import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AssignmentModelMetrics } from '@/lib/db-types';
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
  TOOLTIP_CONTENT_STYLE,
} from '@/lib/chart-styles';
import { formatDateLabel, formatPercent } from '@/lib/utils';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface AiMetricsChartsProps {
  metrics: AssignmentModelMetrics | null;
  loading: boolean;
}

export function AiMetricsCharts({ metrics, loading }: AiMetricsChartsProps) {
  const { t: tr } = useTranslation();

  const metricsChartData = useMemo(
    () =>
      (metrics?.points ?? []).map((point) => ({
        ...point,
        label: formatDateLabel(point.date),
      })),
    [metrics],
  );

  const metricsSummary = metrics?.summary ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          {tr('ai_page.titles.progress_and_quality', {
            days: metrics?.window_days ?? 30,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !metrics ? (
          <p className="text-sm text-muted-foreground">
            {tr('ai_page.text.loading_ai_metrics')}
          </p>
        ) : !metrics ? (
          <p className="text-sm text-muted-foreground">
            {tr('ai_page.text.no_ai_metrics', 'No AI metrics data available.')}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.ai_precision')}
                </p>
                <p className="mt-1 font-medium">
                  {formatPercent(metricsSummary?.feedback_precision ?? 0)}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.total_feedback')}
                </p>
                <p className="mt-1 font-medium">
                  {metricsSummary?.feedback_total ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.auto_safe_assignments')}
                </p>
                <p className="mt-1 font-medium">
                  {metricsSummary?.auto_assigned ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.detected_path_coverage')}
                </p>
                <p className="mt-1 font-medium">
                  {formatPercent(
                    metricsSummary?.coverage_detected_path_ratio ?? 0,
                  )}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.title_history_coverage_activity_type', {
                titleCoverage: formatPercent(
                  metricsSummary?.coverage_title_history_ratio ?? 0,
                ),
                activityCoverage: formatPercent(
                  metricsSummary?.coverage_activity_type_ratio ?? 0,
                ),
              })}
            </p>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.feedback_trend_accept_reject_manual')}
                </p>
                <div className="mt-2 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metricsChartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID_COLOR}
                        opacity={0.45}
                      />
                      <XAxis
                        dataKey="label"
                        stroke={CHART_AXIS_COLOR}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={CHART_AXIS_COLOR}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR }}
                        itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="feedback_accepted"
                        stackId="feedback"
                        fill="#22c55e"
                        name={tr('ai_page.text.accept')}
                      />
                      <Bar
                        dataKey="feedback_rejected"
                        stackId="feedback"
                        fill="#ef4444"
                        name={tr('ai_page.text.reject')}
                      />
                      <Bar
                        dataKey="feedback_manual_change"
                        stackId="feedback"
                        fill={CHART_PRIMARY_COLOR}
                        name={tr('ai_page.text.manual')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.auto_safe_runs_vs_rollback')}
                </p>
                <div className="mt-2 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={metricsChartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID_COLOR}
                        opacity={0.45}
                      />
                      <XAxis
                        dataKey="label"
                        stroke={CHART_AXIS_COLOR}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={CHART_AXIS_COLOR}
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={{ color: CHART_TOOLTIP_TITLE_COLOR }}
                        itemStyle={{ color: CHART_TOOLTIP_TEXT_COLOR }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar
                        dataKey="auto_assigned"
                        fill={CHART_PRIMARY_COLOR}
                        name={tr('ai_page.text.assigned')}
                      />
                      <Line
                        type="monotone"
                        dataKey="auto_runs"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={false}
                        name={tr('ai_page.text.runs')}
                      />
                      <Line
                        type="monotone"
                        dataKey="auto_rollbacks"
                        stroke="#f97316"
                        strokeWidth={2}
                        dot={false}
                        name={tr('ai_page.text.rollbacks')}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
