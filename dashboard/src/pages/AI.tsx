import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Brain, PlayCircle, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-notification';
import { useDataStore } from '@/store/data-store';
import {
  getAssignmentModelStatus,
  getAssignmentModelMetrics,
  resetAssignmentModelKnowledge,
  rollbackLastAutoSafeRun,
  runAutoSafeAssignment,
  setAssignmentModelCooldown,
  setAssignmentMode,
  setTrainingBlacklists,
  setTrainingHorizonDays as setTrainingHorizonDaysApi,
  trainAssignmentModel,
  getFeedbackWeight,
  setFeedbackWeight as setFeedbackWeightApi,
} from '@/lib/tauri';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
} from '@/lib/db-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  saveIndicatorSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_TEXT_COLOR,
  CHART_TOOLTIP_TITLE_COLOR,
  TOOLTIP_CONTENT_STYLE,
} from '@/lib/chart-styles';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AiSessionIndicatorsCard } from '@/components/ai/AiSessionIndicatorsCard';
import { AiBatchActionsCard } from '@/components/ai/AiBatchActionsCard';
import { AiHowToCard } from '@/components/ai/AiHowToCard';

const FEEDBACK_TRIGGER = 30;
const RETRAIN_INTERVAL_HOURS = 24;
const REMINDER_SNOOZE_HOURS = 24;

const AUTO_LIMIT_STORAGE_KEY = 'timeflow.ai.auto-limit';
const DEFAULT_AUTO_LIMIT = 500;

function loadAutoLimit(): number {
  try {
    if (typeof window === 'undefined') return DEFAULT_AUTO_LIMIT;
    const raw = window.localStorage.getItem(AUTO_LIMIT_STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_LIMIT;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : DEFAULT_AUTO_LIMIT;
  } catch {
    return DEFAULT_AUTO_LIMIT;
  }
}

function saveAutoLimit(value: number): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTO_LIMIT_STORAGE_KEY, String(value));
    }
  } catch {
    // ignore
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseMultilineList(value: string): string[] {
  const unique = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function formatMultilineList(values: string[]): string {
  return values.join('\n');
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTrainingReminder(
  status: AssignmentModelStatus | null,
  translate: (
    key: string,
    interpolation?: Record<string, string | number>,
  ) => string,
): {
  shouldShow: boolean;
  reason: string | null;
  cooldownUntil: Date | null;
} {
  if (!status) {
    return { shouldShow: false, reason: null, cooldownUntil: null };
  }

  const now = Date.now();
  const lastTrain = parseDate(status.last_train_at);
  const cooldownUntil = parseDate(status.cooldown_until);
  const hasFeedback = status.feedback_since_train > 0;
  const dueToFeedback = status.feedback_since_train >= FEEDBACK_TRIGGER;
  const dueToInterval =
    hasFeedback &&
    lastTrain !== null &&
    now - lastTrain.getTime() >= RETRAIN_INTERVAL_HOURS * 60 * 60 * 1000;
  const coldStart = hasFeedback && !lastTrain;

  let reason: string | null = null;
  if (dueToFeedback) {
    reason = translate(
      'ai_page.text.you_have_corrections_since_last_training_threshold',
      {
        feedbackCount: status.feedback_since_train,
        threshold: FEEDBACK_TRIGGER,
      },
    );
  } else if (dueToInterval) {
    reason = translate(
      'ai_page.text.over_h_passed_since_last_training_and_there_are',
      { hours: RETRAIN_INTERVAL_HOURS },
    );
  } else if (coldStart) {
    reason = translate(
      'ai_page.text.the_model_has_correction_data_but_has_never_been',
    );
  }

  if (!reason) {
    return { shouldShow: false, reason: null, cooldownUntil };
  }

  const suppressed = cooldownUntil !== null && cooldownUntil.getTime() > now;
  return {
    shouldShow: !suppressed,
    reason,
    cooldownUntil,
  };
}

export function AIPage() {
  const { t: tr } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const isFetchingRef = useRef(false);
  const isFetchingMetricsRef = useRef(false);
  const showErrorRef = useRef(showError);
  const translateRef = useRef(tr);
  const [status, setStatus] = useState<AssignmentModelStatus | null>(null);
  const [metrics, setMetrics] = useState<AssignmentModelMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [training, setTraining] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [resettingKnowledge, setResettingKnowledge] = useState(false);
  const [snoozingReminder, setSnoozingReminder] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  const [mode, setMode] = useState<AssignmentMode>('suggest');
  const [suggestConf, setSuggestConf] = useState<number>(0.6);
  const [autoConf, setAutoConf] = useState<number>(0.85);
  const [autoEvidence, setAutoEvidence] = useState<number>(3);
  const [trainingHorizonDays, setTrainingHorizonDays] = useState<number>(730);
  const [trainingAppBlacklistText, setTrainingAppBlacklistText] =
    useState<string>('');
  const [trainingFolderBlacklistText, setTrainingFolderBlacklistText] =
    useState<string>('');
  const [autoLimit, setAutoLimit] = useState<number>(loadAutoLimit);
  const [feedbackWeight, setFeedbackWeight] = useState<number>(5.0);
  const dirtyRef = useRef(false);
  const [indicators, setIndicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );

  const syncFromStatus = (nextStatus: AssignmentModelStatus, force = false) => {
    setStatus(nextStatus);
    if (force || !dirtyRef.current) {
      setMode(nextStatus.mode);
      setSuggestConf(nextStatus.min_confidence_suggest);
      setAutoConf(nextStatus.min_confidence_auto);
      setAutoEvidence(nextStatus.min_evidence_auto);
      setTrainingHorizonDays(nextStatus.training_horizon_days);
      setTrainingAppBlacklistText(
        formatMultilineList(nextStatus.training_app_blacklist),
      );
      setTrainingFolderBlacklistText(
        formatMultilineList(nextStatus.training_folder_blacklist),
      );
    }
  };

  const trainingReminder = useMemo(
    () =>
      buildTrainingReminder(status, (key, interpolation) =>
        tr(key, interpolation),
      ),
    [status, tr],
  );

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  useEffect(() => {
    translateRef.current = tr;
  }, [tr]);


  const fetchStatus = useCallback(
    async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        const nextStatus = await getAssignmentModelStatus();
        syncFromStatus(nextStatus);
        const fw = await getFeedbackWeight();
        if (!dirtyRef.current) setFeedbackWeight(fw);
      } catch (e) {
        console.error(e);
        showErrorRef.current(
          `${translateRef.current('ai_page.errors.status_load_failed')} ${String(e)}`,
        );
      } finally {
        isFetchingRef.current = false;
      }
    },
    [],
  );

  const fetchMetrics = useCallback(
    async (silent = false) => {
      if (isFetchingMetricsRef.current) return;
      isFetchingMetricsRef.current = true;
      if (!silent) setLoadingMetrics(true);
      try {
        const nextMetrics = await getAssignmentModelMetrics(30);
        setMetrics(nextMetrics);
      } catch (e) {
        console.error(e);
        showErrorRef.current(
          `${translateRef.current('ai_page.errors.metrics_load_failed')} ${String(e)}`,
        );
      } finally {
        if (!silent) setLoadingMetrics(false);
        isFetchingMetricsRef.current = false;
      }
    },
    [],
  );

  const refreshModelData = useCallback(
    async (silent = false) => {
      await Promise.all([fetchStatus(), fetchMetrics(silent)]);
    },
    [fetchMetrics, fetchStatus],
  );

  useEffect(() => {
    void refreshModelData();
    const interval = setInterval(() => {
      void refreshModelData(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [refreshModelData]);

  const handleRefreshStatus = async () => {
    if (refreshingStatus) return;

    setRefreshingStatus(true);
    try {
      await refreshModelData();
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleSaveMode = async () => {
    setSavingMode(true);
    try {
      const normalizedSuggest = clampNumber(suggestConf, 0, 1);
      const normalizedAuto = clampNumber(autoConf, 0, 1);
      const normalizedEvidence = Math.round(clampNumber(autoEvidence, 1, 50));

      await setAssignmentMode(
        mode,
        normalizedSuggest,
        normalizedAuto,
        normalizedEvidence,
      );
      await setTrainingHorizonDaysApi(
        Math.round(clampNumber(trainingHorizonDays, 30, 730)),
      );
      await setTrainingBlacklists(
        parseMultilineList(trainingAppBlacklistText),
        parseMultilineList(trainingFolderBlacklistText),
      );
      const clampedFw = Math.max(1, Math.min(50, feedbackWeight));
      await setFeedbackWeightApi(clampedFw);
      dirtyRef.current = false;
      showInfo(tr('ai_page.text.model_settings_saved'));
      // Force-sync form fields from backend after save
      const freshStatus = await getAssignmentModelStatus();
      syncFromStatus(freshStatus, true);
      const freshFw = await getFeedbackWeight();
      setFeedbackWeight(freshFw);
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.failed_to_save_model_settings') + ` ${String(e)}`,
      );
    } finally {
      setSavingMode(false);
    }
  };

  const handleTrainNow = async () => {
    setTraining(true);
    try {
      const nextStatus = await trainAssignmentModel(true);
      syncFromStatus(nextStatus);
      await fetchMetrics(true);
      showInfo(tr('ai_page.text.model_training_completed'));
    } catch (e) {
      console.error(e);
      await fetchStatus();
      showError(
        tr('ai_page.text.model_training_failed') +
          ` ${String(e)}`,
      );
    } finally {
      setTraining(false);
    }
  };

  const handleResetKnowledge = async () => {
    const confirmed = await confirm(
      tr('ai_page.prompts.reset_knowledge_confirm'),
    );
    if (!confirmed) return;

    setResettingKnowledge(true);
    try {
      const nextStatus = await resetAssignmentModelKnowledge();
      dirtyRef.current = false;
      syncFromStatus(nextStatus, true);
      await fetchMetrics(true);
      triggerRefresh();
      showInfo(tr('ai_page.info.knowledge_reset'));
    } catch (e) {
      console.error(e);
      showError(`${tr('ai_page.errors.knowledge_reset_failed')} ${String(e)}`);
    } finally {
      setResettingKnowledge(false);
    }
  };

  const handleRunAutoSafe = async () => {
    if (status?.mode !== 'auto_safe') {
      showError(
        tr('ai_page.text.auto_safe_is_disabled_set_mode_to_auto_safe_and'),
      );
      return;
    }

    setRunningAuto(true);
    try {
      const minDuration =
        loadSessionSettings().minSessionDurationSeconds || undefined;
      const result = await runAutoSafeAssignment(
        Math.round(clampNumber(autoLimit, 1, 10_000)),
        undefined,
        minDuration,
      );
      showInfo(
        tr('ai_page.text.auto_safe_completed_assigned_scanned_sessions', { assigned: result.assigned, scanned: result.scanned }),
      );
      triggerRefresh();
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.auto_safe_failed') + ` ${String(e)}`,
      );
    } finally {
      setRunningAuto(false);
    }
  };

  const handleRollback = async () => {
    if (!status?.can_rollback_last_auto_run) return;

    const confirmed = await confirm(
      tr('ai_page.text.rollback_the_last_auto_safe_batch_this_will_only'),
    );
    if (!confirmed) return;

    setRollingBack(true);
    try {
      const result = await rollbackLastAutoSafeRun();
      showInfo(
        tr('ai_page.text.rollback_completed_reverted_skipped', { reverted: result.reverted, skipped: result.skipped }),
      );
      triggerRefresh();
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.rollback_failed') + ` ${String(e)}`,
      );
    } finally {
      setRollingBack(false);
    }
  };

  const handleSnoozeReminder = async () => {
    setSnoozingReminder(true);
    try {
      const nextStatus = await setAssignmentModelCooldown(
        REMINDER_SNOOZE_HOURS,
      );
      syncFromStatus(nextStatus);
      showInfo(
        tr('ai_page.text.reminder_snoozed_for_h', { hours: REMINDER_SNOOZE_HOURS }),
      );
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.failed_to_snooze_reminder') + ` ${String(e)}`,
      );
    } finally {
      setSnoozingReminder(false);
    }
  };

  const metricsChartData = useMemo(
    () =>
      (metrics?.points ?? []).map((point) => ({
        ...point,
        label: formatDateLabel(point.date),
      })),
    [metrics],
  );

  const metricsSummary = metrics?.summary ?? null;
  const indicatorItems = [
    {
      key: 'showAiBadge' as const,
      label: tr('ai_page.text.ai_badge'),
      description: tr('ai_page.text.show_sparkle_icon_on_sessions_assigned_by_ai_aut'),
    },
    {
      key: 'showSuggestions' as const,
      label: tr('ai_page.text.ai_suggestions'),
      description: tr('ai_page.text.show_project_suggestions_for_unassigned_sessions'),
    },
    {
      key: 'showScoreBreakdown' as const,
      label: tr('ai_page.text.score_breakdown_button'),
      description: tr('ai_page.text.show_the_score_details_button_barchart3_on_each'),
    },
  ];
  const howToSections = [
    {
      title: tr('ai_page.text.when_to_train_the_model'),
      paragraphs: [
        tr('ai_page.text.train_after_a_larger_series_of_manual_correction'),
        tr('ai_page.text.the_reminder_appears_automatically_when_you_have', {
            feedbackTrigger: FEEDBACK_TRIGGER,
            retrainHours: RETRAIN_INTERVAL_HOURS,
          }),
      ],
    },
    {
      title: tr('ai_page.text.what_parameters_mean'),
      paragraphs: [
        tr('ai_page.text.mode_off_disables_suggestions_suggest_shows_sugg'),
        tr('ai_page.text.suggest_min_confidence_minimum_confidence_to_sho'),
        tr('ai_page.text.auto_safe_min_confidence_required_confidence_thr'),
        tr('ai_page.text.auto_safe_min_evidence_how_many_signals_e_g_app'),
        tr('ai_page.text.session_limit_how_many_unassigned_sessions_auto'),
        tr('ai_page.text.feedback_weight_how_much_manual_corrections_thum'),
      ],
    },
    {
      title: tr('ai_page.text.recommended_starting_settings'),
      paragraphs: [
        tr('ai_page.text.start_with_mode_suggest_suggest_0_60_auto_0_85_e'),
        tr('ai_page.text.if_auto_safe_makes_wrong_assignments_raise_auto'),
      ],
    },
  ];

  return (
    <>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Brain className="h-4 w-4" />
              {tr('ai_page.text.model_status')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.mode')}
                </p>
                <p className="mt-1 font-medium">{status?.mode ?? '-'}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.training_state')}
                </p>
                <p className="mt-1 font-medium">
                  {status?.is_training
                    ? tr('ai_page.text.in_progress')
                    : tr('ai_page.text.idle')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.last_training')}
                </p>
                <p className="mt-1 font-medium">
                  {formatDateTime(status?.last_train_at) || tr('ai_page.text.never')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.corrections_since_last_training')}
                </p>
                <p className="mt-1 font-medium">
                  {status?.feedback_since_train ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.last_training_metrics')}
                </p>
                <p className="mt-1 font-medium">
                  {(status?.last_train_samples ?? 0) > 0
                    ? `${status?.last_train_samples} samples / ${status?.last_train_duration_ms ?? 0} ms`
                    : tr('ai_page.text.no_data')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {tr('ai_page.text.last_auto_safe_run')}
                </p>
                <p className="mt-1 font-medium">
                  {status?.last_auto_run_at
                    ? `${formatDateTime(status.last_auto_run_at)} (${status.last_auto_assigned_count} assigned)`
                    : tr('ai_page.text.never')}
                </p>
              </div>
            </div>

            {status?.train_error_last && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {tr('ai_page.text.last_training_error')}{' '}
                {status.train_error_last}
              </div>
            )}

            {trainingReminder.cooldownUntil && !trainingReminder.shouldShow && (
              <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                {tr('ai_page.text.training_reminder_snoozed_until')}{' '}
                {formatDateTime(trainingReminder.cooldownUntil.toISOString())}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-8"
                onClick={handleTrainNow}
                disabled={training || status?.is_training}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {training || status?.is_training
                  ? tr('ai_page.text.training')
                  : tr('ai_page.text.train_now')}
              </Button>
              <Button
                variant="outline"
                className="h-8"
                onClick={() => {
                  void handleRefreshStatus();
                }}
                disabled={refreshingStatus}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    refreshingStatus ? 'animate-spin' : ''
                  }`}
                />
                {refreshingStatus
                  ? tr('ai_page.text.refreshing')
                  : tr('ai_page.text.refresh_status')}
              </Button>
              <Button
                variant="destructive"
                className="h-8"
                onClick={handleResetKnowledge}
                disabled={resettingKnowledge}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {resettingKnowledge
                  ? tr('ai_page.text.resetting')
                  : tr('ai_page.text.reset_ai_knowledge')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {tr('ai_page.titles.progress_and_quality', {
                days: metrics?.window_days ?? 30,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingMetrics && !metrics ? (
              <p className="text-sm text-muted-foreground">
                {tr('ai_page.text.loading_ai_metrics')}
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
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {trainingReminder.shouldShow && trainingReminder.reason && (
          <Card className="border-amber-500/40 bg-amber-500/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-amber-100">
                {tr('ai_page.text.time_for_model_training')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-amber-100/90">{trainingReminder.reason}</p>
              <p className="text-xs text-amber-100/80">
                {tr('ai_page.text.estimated_cost_light_training_usually_under_10_s')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-8"
                  onClick={handleTrainNow}
                  disabled={training || status?.is_training}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {training || status?.is_training
                    ? tr('ai_page.text.training')
                    : tr('ai_page.text.train_now')}
                </Button>
                <Button
                  variant="outline"
                  className="h-8 border-amber-500/60 text-amber-100 hover:bg-amber-500/15"
                  onClick={handleSnoozeReminder}
                  disabled={snoozingReminder}
                >
                  {snoozingReminder
                    ? tr('ai_page.text.saving')
                    : tr('ai_page.text.remind_me_later_h', { hours: REMINDER_SNOOZE_HOURS })}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {tr('ai_page.text.mode_and_thresholds')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.model_operation_mode')}
                </span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as AssignmentMode);
                    dirtyRef.current = true;
                  }}
                >
                  <option value="off">
                    {tr('ai_page.text.off_manual')}
                  </option>
                  <option value="suggest">
                    {tr('ai_page.text.ai_suggestions')}
                  </option>
                  <option value="auto_safe">
                    {tr('ai_page.text.auto_safe')}
                  </option>
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.suggest_min_confidence_0_1')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={suggestConf}
                  onChange={(e) => {
                    const next = Number.parseFloat(e.target.value);
                    setSuggestConf(Number.isNaN(next) ? 0 : next);
                    dirtyRef.current = true;
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.auto_safe_min_confidence_0_1')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={autoConf}
                  onChange={(e) => {
                    const next = Number.parseFloat(e.target.value);
                    setAutoConf(Number.isNaN(next) ? 0 : next);
                    dirtyRef.current = true;
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.auto_safe_min_evidence_1_50')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={autoEvidence}
                  onChange={(e) => {
                    const next = Number.parseInt(e.target.value, 10);
                    setAutoEvidence(Number.isNaN(next) ? 1 : next);
                    dirtyRef.current = true;
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.training_horizon_days')}
                </span>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={30}
                    max={730}
                    step={1}
                    className="h-9 w-full"
                    value={trainingHorizonDays}
                    onChange={(e) => {
                      const next = Number.parseInt(e.target.value, 10);
                      setTrainingHorizonDays(Number.isNaN(next) ? 730 : next);
                      dirtyRef.current = true;
                    }}
                  />
                  <span className="min-w-[5rem] text-right text-xs text-muted-foreground">
                    {trainingHorizonDays} {tr('ai_page.text.days')}
                  </span>
                </div>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.feedback_weight_1_50')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={0.5}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={feedbackWeight}
                  onChange={(e) => {
                    const next = Number.parseFloat(e.target.value);
                    setFeedbackWeight(Number.isNaN(next) ? 5 : next);
                    dirtyRef.current = true;
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.text.applications_blacklist_exe_one_per_line')}
                </span>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={trainingAppBlacklistText}
                  onChange={(e) => {
                    setTrainingAppBlacklistText(e.target.value);
                    dirtyRef.current = true;
                  }}
                  placeholder={tr('ai_page.text.e_g_chrome_exe')}
                />
              </label>

              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className="text-xs text-muted-foreground">
                  {tr('ai_page.fields.folders_blacklist')}
                </span>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={trainingFolderBlacklistText}
                  onChange={(e) => {
                    setTrainingFolderBlacklistText(e.target.value);
                    dirtyRef.current = true;
                  }}
                  placeholder={tr('ai_page.text.e_g_c_users_me_downloads')}
                />
              </label>
            </div>

            <div className="flex justify-end">
              <Button
                className="h-9 min-w-[9rem]"
                onClick={handleSaveMode}
                disabled={savingMode}
              >
                <Save className="mr-2 h-4 w-4" />
                {savingMode
                  ? tr('ai_page.text.saving')
                  : tr('ai_page.text.save_model_settings')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <AiSessionIndicatorsCard
          title={tr('ai_page.text.session_indicators')}
          description={tr('ai_page.text.configure_which_ai_indicators_and_feedback_contr')}
          items={indicatorItems}
          indicators={indicators}
          onToggle={(key, checked) => {
            const next = { ...indicators, [key]: checked };
            setIndicators(next);
            saveIndicatorSettings(next);
          }}
        />

        <AiBatchActionsCard
          title={tr('ai_page.text.batch_auto_safe_actions')}
          sessionLimitLabel={tr('ai_page.text.session_limit_per_run')}
          autoLimit={autoLimit}
          onAutoLimitChange={(value) => {
            const nextValue = Math.max(1, Math.min(10_000, value));
            setAutoLimit(nextValue);
            saveAutoLimit(nextValue);
          }}
          runLabel={tr('ai_page.text.run_auto_safe')}
          runStartingLabel={tr('ai_page.text.starting')}
          rollbackLabel={tr('ai_page.text.rollback_last_auto_safe_batch')}
          rollbackRunningLabel={tr('ai_page.text.rolling_back')}
          rollbackHint={tr('ai_page.text.rollback_only_reverts_sessions_that_have_not_bee')}
          modeIsAutoSafe={status?.mode === 'auto_safe'}
          runningAuto={runningAuto}
          rollingBack={rollingBack}
          canRollbackLastRun={Boolean(status?.can_rollback_last_auto_run)}
          onRun={handleRunAutoSafe}
          onRollback={handleRollback}
        />

        <AiHowToCard
          title={tr('ai_page.text.how_to_train_and_configure')}
          sections={howToSections}
        />
      </div>
      <ConfirmDialog />
    </>
  );
}
