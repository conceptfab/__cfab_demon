import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { AiSettingsFormValues } from '@/components/ai/AiSettingsForm';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import {
  areAssignmentMetricsEqual,
  buildTrainingReminder,
} from '@/lib/ai-page-utils';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
  FolderScanStatus,
} from '@/lib/db-types';
import { hasPendingAssignmentModelTrainingData } from '@/lib/assignment-model';
import {
  loadAiAutoAssignmentSettings,
  loadIndicatorSettings,
  loadSessionSettings,
  saveAiAutoAssignmentSettings,
  saveIndicatorSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import { aiApi } from '@/lib/tauri';
import { clampNumber } from '@/lib/utils';
import {
  AI_FEEDBACK_TRIGGER,
  AI_REMINDER_SNOOZE_HOURS,
  AI_RETRAIN_INTERVAL_HOURS,
} from '@/pages/ai/ai-page-constants';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { useDataStore } from '@/store/data-store';
import { useToast } from '@/components/ui/toast-notification';

export function useAiPageController() {
  const { t: tr } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const status = useBackgroundStatusStore((s) => s.aiStatus);
  const refreshAiStatus = useBackgroundStatusStore((s) => s.refreshAiStatus);
  const setAiStatus = useBackgroundStatusStore((s) => s.setAiStatus);
  const { showError, showInfo } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();

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
  const [scanStatus, setScanStatus] = useState<FolderScanStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [clearingScan, setClearingScan] = useState(false);

  const [mode, setMode] = useState<AssignmentMode>('suggest');
  const [suggestConf, setSuggestConf] = useState<number>(0.6);
  const [autoConf, setAutoConf] = useState<number>(0.85);
  const [autoEvidence, setAutoEvidence] = useState<number>(3);
  const [trainingHorizonDays, setTrainingHorizonDays] = useState<number>(365);
  const [decayHalfLifeDays, setDecayHalfLifeDays] = useState<number>(60);
  const [autoLimit, setAutoLimit] = useState<number>(
    () => loadAiAutoAssignmentSettings().autoLimit,
  );
  const [feedbackWeight, setFeedbackWeight] = useState<number>(3.0);
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
        setFeedbackWeight(nextStatus.feedback_weight);
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

  const highlightTrainAction = hasPendingAssignmentModelTrainingData(status);

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
      if (patch.suggestConf !== undefined) {
        setSuggestConf(clampNumber(patch.suggestConf, 0, 1));
      }
      if (patch.autoConf !== undefined) {
        setAutoConf(clampNumber(patch.autoConf, 0, 1));
      }
      if (patch.autoEvidence !== undefined) {
        setAutoEvidence(Math.round(clampNumber(patch.autoEvidence, 1, 50)));
      }
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
      const [, scan] = await Promise.all([
        refreshAiStatus(),
        aiApi.getFolderScanStatus(),
      ]);
      setScanStatus(scan);
    } catch (e) {
      console.error(e);
      showTranslatedError('ai_page.errors.status_load_failed', e);
    }
  }, [refreshAiStatus, showTranslatedError]);

  const fetchMetrics = useCallback(
    async (silent = false) => {
      if (isFetchingMetricsRef.current) return;
      isFetchingMetricsRef.current = true;
      const safetyTimer = setTimeout(() => {
        isFetchingMetricsRef.current = false;
        setLoadingMetrics(false);
      }, 30_000);
      if (!silent) setLoadingMetrics(true);
      try {
        const nextMetrics = await aiApi.getAssignmentModelMetrics(30);
        setMetrics((current) =>
          areAssignmentMetricsEqual(current, nextMetrics) ? current : nextMetrics,
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
    // refreshModelData() orkiestruje fetchStatus()+fetchMetrics() i jest reużywany
    // przez handleRefreshStatus/visibility listener/usePageRefreshListener.
    // Ustawia wiele stanów (metrics, scanStatus, loadingMetrics, aiStatus w store).
    // useAsyncData nie obsługuje tej wielowarstwowej orkiestracji.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- multi-state orchestration (metrics + scanStatus + store); reused in multiple handlers; useAsyncData doesn't fit
    void refreshModelData();
  }, [refreshModelData]);

  usePageRefreshListener(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshModelData(true);
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshModelData(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

      if (normalizedAuto < normalizedSuggest) {
        showError(tr('ai_page.text.auto_confidence_must_be_at_least_suggest'));
        return;
      }

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

      const freshStatus = await aiApi.getAssignmentModelStatus();
      setAiStatus(freshStatus);
      syncFormWithStatus(freshStatus, true);
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

  const handleTrainNow = async (fullRebuild = false) => {
    setTraining(true);
    try {
      const nextStatus = await aiApi.trainAssignmentModel(true, fullRebuild);
      setAiStatus(nextStatus);
      syncFormWithStatus(nextStatus);
      await fetchMetrics(true);
      showInfo(tr('ai_page.text.model_training_completed'));
    } catch (e) {
      console.error(e);
      await fetchStatus();
      showError(tr('ai_page.text.model_training_failed') + ` ${String(e)}`);
    } finally {
      setTraining(false);
    }
  };

  const runReset = useCallback(
    async (
      resetMode: 'weights' | 'full',
      apiCall: () => Promise<AssignmentModelStatus>,
    ) => {
      const confirmed = await confirm(
        tr(
          resetMode === 'weights'
            ? 'ai_page.prompts.reset_weights_confirm'
            : 'ai_page.prompts.reset_full_confirm',
        ),
      );
      if (!confirmed) return;

      setResettingKnowledge(true);
      try {
        const nextStatus = await apiCall();
        dirtyRef.current = false;
        setAiStatus(nextStatus);
        syncFormWithStatus(nextStatus, true);
        await fetchMetrics(true);
        triggerRefresh(
          resetMode === 'weights' ? 'ai_weights_reset' : 'ai_knowledge_reset',
        );
        showInfo(
          tr(
            resetMode === 'weights'
              ? 'ai_page.info.weights_reset'
              : 'ai_page.info.knowledge_reset',
          ),
        );
      } catch (e) {
        console.error(e);
        showError(`${tr('ai_page.errors.knowledge_reset_failed')} ${String(e)}`);
      } finally {
        setResettingKnowledge(false);
      }
    },
    [
      confirm,
      fetchMetrics,
      setAiStatus,
      showError,
      showInfo,
      syncFormWithStatus,
      tr,
      triggerRefresh,
    ],
  );

  const handleResetWeights = useCallback(
    () => runReset('weights', aiApi.resetModelWeights),
    [runReset],
  );

  const handleResetFull = useCallback(
    () => runReset('full', aiApi.resetModelFull),
    [runReset],
  );

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
        tr('ai_page.text.auto_safe_completed_assigned_scanned_sessions', {
          assigned: result.assigned,
          scanned: result.scanned,
        }),
      );
      triggerRefresh('ai_auto_safe_run');
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(tr('ai_page.text.auto_safe_failed') + ` ${String(e)}`);
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
        tr('ai_page.text.rollback_completed_reverted_skipped', {
          reverted: result.reverted,
          skipped: result.skipped,
        }),
      );
      triggerRefresh('ai_auto_safe_rollback');
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(tr('ai_page.text.rollback_failed') + ` ${String(e)}`);
    } finally {
      setRollingBack(false);
    }
  };

  const handleSnoozeReminder = async () => {
    setSnoozingReminder(true);
    try {
      const nextStatus = await aiApi.setAssignmentModelCooldown(
        AI_REMINDER_SNOOZE_HOURS,
      );
      setAiStatus(nextStatus);
      syncFormWithStatus(nextStatus);
      showInfo(
        tr('ai_page.text.reminder_snoozed_for_h', {
          hours: AI_REMINDER_SNOOZE_HOURS,
        }),
      );
    } catch (e) {
      console.error(e);
      showError(tr('ai_page.text.failed_to_snooze_reminder') + ` ${String(e)}`);
    } finally {
      setSnoozingReminder(false);
    }
  };

  const handleFolderScan = async () => {
    setScanning(true);
    try {
      const result = await aiApi.scanProjectFoldersForAi();
      showInfo(
        tr('ai_page.folder_scan.scan_completed', {
          projects: result.projects_scanned,
          tokens: result.tokens_total,
          duration: result.duration_ms,
        }),
      );
      setScanStatus(await aiApi.getFolderScanStatus());
    } catch (e) {
      console.error(e);
      showError(`${tr('ai_page.errors.status_load_failed')} ${String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  const handleClearFolderScan = async () => {
    const confirmed = await confirm(tr('ai_page.folder_scan.clear_confirm'));
    if (!confirmed) return;

    setClearingScan(true);
    try {
      await aiApi.clearFolderScanData();
      showInfo(tr('ai_page.folder_scan.cleared'));
      setScanStatus(await aiApi.getFolderScanStatus());
    } catch (e) {
      console.error(e);
      showError(`${tr('ai_page.errors.status_load_failed')} ${String(e)}`);
    } finally {
      setClearingScan(false);
    }
  };

  const handleIndicatorToggle = (
    key: keyof SessionIndicatorSettings,
    checked: boolean,
  ) => {
    const next = { ...indicators, [key]: checked };
    setIndicators(next);
    saveIndicatorSettings(next);
  };

  const handleAutoLimitChange = (value: number) => {
    const nextValue = Math.max(1, Math.min(10_000, value));
    setAutoLimit(nextValue);
    saveAiAutoAssignmentSettings({ autoLimit: nextValue });
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
            feedbackTrigger: AI_FEEDBACK_TRIGGER,
            retrainHours: AI_RETRAIN_INTERVAL_HOURS,
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

  const translate = useCallback(
    (key: string, interpolation?: Record<string, string | number>) =>
      tr(key, interpolation),
    [tr],
  );

  return {
    autoLimit,
    confirmDialogProps,
    handleAutoLimitChange,
    handleClearFolderScan,
    handleFolderScan,
    handleIndicatorToggle,
    handleRefreshStatus,
    handleResetFull,
    handleResetWeights,
    handleRollback,
    handleRunAutoSafe,
    handleSaveMode,
    handleSettingsChange,
    handleSnoozeReminder,
    handleTrainNow,
    highlightTrainAction,
    howToSections,
    indicatorItems,
    indicators,
    loadingMetrics,
    metrics,
    resettingKnowledge,
    refreshingStatus,
    rollingBack,
    runningAuto,
    savingMode,
    scanStatus,
    scanning,
    clearingScan,
    settingsFormValues,
    snoozingReminder,
    status,
    training,
    trainingReminder,
    translate,
    tr,
  };
}

export type AiPageController = ReturnType<typeof useAiPageController>;
