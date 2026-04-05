import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PlayCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-notification';
import { useDataStore } from '@/store/data-store';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { aiApi } from '@/lib/tauri';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
} from '@/lib/db-types';
import {
  loadSessionSettings,
  loadAiAutoAssignmentSettings,
  loadIndicatorSettings,
  saveAiAutoAssignmentSettings,
  saveIndicatorSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import { clampNumber } from '@/lib/utils';
import { hasPendingAssignmentModelTrainingData } from '@/lib/assignment-model';
import { AiSessionIndicatorsCard } from '@/components/ai/AiSessionIndicatorsCard';
import { AiBatchActionsCard } from '@/components/ai/AiBatchActionsCard';
import { AiHowToCard } from '@/components/ai/AiHowToCard';
import { AiModelStatusCard } from '@/components/ai/AiModelStatusCard';
import {
  AiSettingsForm,
  type AiSettingsFormValues,
} from '@/components/ai/AiSettingsForm';
import { AiMetricsCharts } from '@/components/ai/AiMetricsCharts';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';

const FEEDBACK_TRIGGER = 30;
const RETRAIN_INTERVAL_HOURS = 24;
const REMINDER_SNOOZE_HOURS = 24;

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

function areMetricsEqual(
  current: AssignmentModelMetrics | null,
  next: AssignmentModelMetrics,
): boolean {
  if (!current) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}

export function AIPage() {
  const { t: tr } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const status = useBackgroundStatusStore((s) => s.aiStatus);
  const refreshAiStatus = useBackgroundStatusStore((s) => s.refreshAiStatus);
  const setAiStatus = useBackgroundStatusStore((s) => s.setAiStatus);
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const isFetchingMetricsRef = useRef(false);
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
  const [decayHalfLifeDays, setDecayHalfLifeDays] = useState<number>(90);
  const [autoLimit, setAutoLimit] = useState<number>(
    () => loadAiAutoAssignmentSettings().autoLimit,
  );
  const [feedbackWeight, setFeedbackWeight] = useState<number>(5.0);
  const dirtyRef = useRef(false);
  const [indicators, setIndicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );

  const syncFormWithStatus = useCallback(
    (nextStatus: AssignmentModelStatus, force = false) => {
      if (force || !dirtyRef.current) {
        setMode(nextStatus.mode);
        setSuggestConf(nextStatus.min_confidence_suggest);
        setAutoConf(nextStatus.min_confidence_auto);
        setAutoEvidence(nextStatus.min_evidence_auto);
        setTrainingHorizonDays(nextStatus.training_horizon_days);
        setDecayHalfLifeDays(nextStatus.decay_half_life_days);
      }
    },
    [],
  );

  const trainingReminder = useMemo(
    () =>
      buildTrainingReminder(status, (key, interpolation) =>
        tr(key, interpolation),
      ),
    [status, tr],
  );
  const highlightTrainAction =
    hasPendingAssignmentModelTrainingData(status);
  const showTranslatedError = useCallback(
    (messageKey: string, error: unknown) => {
      showError(`${tr(messageKey)} ${String(error)}`);
    },
    [showError, tr],
  );

  const handleSettingsChange = useCallback(
    (patch: Partial<AiSettingsFormValues>) => {
      dirtyRef.current = true;
      if (patch.mode !== undefined) setMode(patch.mode);
      if (patch.suggestConf !== undefined) setSuggestConf(patch.suggestConf);
      if (patch.autoConf !== undefined) setAutoConf(patch.autoConf);
      if (patch.autoEvidence !== undefined) setAutoEvidence(patch.autoEvidence);
      if (patch.trainingHorizonDays !== undefined) {
        setTrainingHorizonDays(patch.trainingHorizonDays);
      }
      if (patch.decayHalfLifeDays !== undefined) {
        setDecayHalfLifeDays(patch.decayHalfLifeDays);
      }
      if (patch.feedbackWeight !== undefined) {
        setFeedbackWeight(patch.feedbackWeight);
      }
    },
    [],
  );

  const settingsFormValues = useMemo<AiSettingsFormValues>(
    () => ({
      mode,
      suggestConf,
      autoConf,
      autoEvidence,
      trainingHorizonDays,
      decayHalfLifeDays,
      feedbackWeight,
    }),
    [
      mode,
      suggestConf,
      autoConf,
      autoEvidence,
      trainingHorizonDays,
      decayHalfLifeDays,
      feedbackWeight,
    ],
  );

  useEffect(() => {
    if (!status) return;
    syncFormWithStatus(status);
  }, [status, syncFormWithStatus]);

  const fetchStatus = useCallback(async () => {
    try {
      const results = await Promise.all([
        refreshAiStatus(),
        aiApi.getFeedbackWeight(),
      ]);
      const fw = results[1];
      if (!dirtyRef.current) setFeedbackWeight(fw);
    } catch (e) {
      console.error(e);
      showTranslatedError('ai_page.errors.status_load_failed', e);
    }
  }, [refreshAiStatus, showTranslatedError]);

  const fetchMetrics = useCallback(
    async (silent = false) => {
      if (isFetchingMetricsRef.current) return;
      isFetchingMetricsRef.current = true;
      // Safety timeout: reset guard and loading state after 30s to prevent
      // permanent blocking if the IPC call hangs indefinitely.
      const safetyTimer = setTimeout(() => {
        isFetchingMetricsRef.current = false;
        setLoadingMetrics(false);
      }, 30_000);
      if (!silent) setLoadingMetrics(true);
      try {
        const nextMetrics = await aiApi.getAssignmentModelMetrics(30);
        setMetrics((current) =>
          areMetricsEqual(current, nextMetrics) ? current : nextMetrics,
        );
      } catch (e) {
        console.error(e);
        showTranslatedError('ai_page.errors.metrics_load_failed', e);
      } finally {
        clearTimeout(safetyTimer);
        if (!silent) setLoadingMetrics(false);
        isFetchingMetricsRef.current = false;
      }
    },
    [showTranslatedError],
  );

  const refreshModelData = useCallback(
    async (silent = false) => {
      await Promise.all([fetchStatus(), fetchMetrics(silent)]);
    },
    [fetchMetrics, fetchStatus],
  );

  useEffect(() => {
    void refreshModelData();
  }, [refreshModelData]);

  // Refresh on local data changes (daemon writes, settings saved, etc.)
  usePageRefreshListener(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshModelData(true);
  });

  // Refresh on tab visibility / window focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshModelData(true);
    };
    const handleWindowFocus = () => {
      void refreshModelData(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
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

      await Promise.all([
        aiApi.setAssignmentMode(
          mode,
          normalizedSuggest,
          normalizedAuto,
          normalizedEvidence,
        ),
        aiApi.setTrainingHorizonDays(trainingHorizonDays),
        aiApi.setDecayHalfLifeDays(decayHalfLifeDays),
        aiApi.setFeedbackWeight(feedbackWeight),
      ]);

      await refreshAiStatus();
      const freshStatus = useBackgroundStatusStore.getState().aiStatus;
      if (freshStatus) {
        syncFormWithStatus(freshStatus, true);
      }
      const freshFw = await aiApi.getFeedbackWeight();
      setFeedbackWeight(freshFw);
      dirtyRef.current = false;
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
      const nextStatus = await aiApi.trainAssignmentModel(true);
      setAiStatus(nextStatus);
      syncFormWithStatus(nextStatus);
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
      const nextStatus = await aiApi.resetAssignmentModelKnowledge();
      dirtyRef.current = false;
      setAiStatus(nextStatus);
      syncFormWithStatus(nextStatus, true);
      await fetchMetrics(true);
      triggerRefresh('ai_knowledge_reset');
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
      const result = await aiApi.runAutoSafeAssignment(
        Math.round(clampNumber(autoLimit, 1, 10_000)),
        undefined,
        minDuration,
      );
      showInfo(
        tr('ai_page.text.auto_safe_completed_assigned_scanned_sessions', { assigned: result.assigned, scanned: result.scanned }),
      );
      triggerRefresh('ai_auto_safe_run');
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
      const result = await aiApi.rollbackLastAutoSafeRun();
      showInfo(
        tr('ai_page.text.rollback_completed_reverted_skipped', { reverted: result.reverted, skipped: result.skipped }),
      );
      triggerRefresh('ai_auto_safe_rollback');
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
      const nextStatus = await aiApi.setAssignmentModelCooldown(
        REMINDER_SNOOZE_HOURS,
      );
      setAiStatus(nextStatus);
      syncFormWithStatus(nextStatus);
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

  const indicatorItems = useMemo(
    () => [
      {
        key: 'showAiBadge' as const,
        label: tr('ai_page.text.ai_badge'),
        description: tr(
          'ai_page.text.show_sparkle_icon_on_sessions_assigned_by_ai_aut',
        ),
      },
      {
        key: 'showSuggestions' as const,
        label: tr('ai_page.text.ai_suggestions'),
        description: tr(
          'ai_page.text.show_project_suggestions_for_unassigned_sessions',
        ),
      },
      {
        key: 'showScoreBreakdown' as const,
        label: tr('ai_page.text.score_breakdown_button'),
        description: tr(
          'ai_page.text.show_the_score_details_button_barchart3_on_each',
        ),
      },
    ],
    [tr],
  );
  const howToSections = useMemo(
    () => [
      {
        title: tr('ai_page.text.when_to_train_the_model'),
        paragraphs: [
          tr('ai_page.text.train_after_a_larger_series_of_manual_corrections'),
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
    ],
    [tr],
  );

  return (
    <>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <AiModelStatusCard
          status={status}
          training={training}
          refreshingStatus={refreshingStatus}
          resettingKnowledge={resettingKnowledge}
          highlightTrainAction={highlightTrainAction}
          snoozedUntil={trainingReminder.cooldownUntil}
          reminderSuppressed={!trainingReminder.shouldShow}
          onTrainNow={handleTrainNow}
          onRefreshStatus={() => {
            void handleRefreshStatus();
          }}
          onResetKnowledge={handleResetKnowledge}
        />

        <AiMetricsCharts metrics={metrics} loading={loadingMetrics} />

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

        <AiSettingsForm
          values={settingsFormValues}
          saving={savingMode}
          onChange={handleSettingsChange}
          onSave={() => {
            void handleSaveMode();
          }}
        />

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
            saveAiAutoAssignmentSettings({ autoLimit: nextValue });
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
