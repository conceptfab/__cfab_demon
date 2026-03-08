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
import { createInlineTranslator } from '@/lib/inline-i18n';
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
  translate?: (
    pl: string,
    en: string,
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
    reason = (translate ?? ((_: string, en: string) => en))(
      'Masz {{feedbackCount}} korekt od ostatniego treningu (próg: {{threshold}}).',
      'You have {{feedbackCount}} corrections since last training (threshold: {{threshold}}).',
      {
        feedbackCount: status.feedback_since_train,
        threshold: FEEDBACK_TRIGGER,
      },
    );
  } else if (dueToInterval) {
    reason = (translate ?? ((_: string, en: string) => en))(
      'Minęło ponad {{hours}}h od ostatniego treningu i są nowe korekty.',
      'Over {{hours}}h passed since last training and there are new corrections.',
      { hours: RETRAIN_INTERVAL_HOURS },
    );
  } else if (coldStart) {
    reason = (translate ?? ((_: string, en: string) => en))(
      'Model ma dane korekt, ale nigdy nie był trenowany.',
      'The model has correction data but has never been trained.',
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
  const { t: tr, i18n } = useTranslation();
  const t = useMemo(
    () => createInlineTranslator(tr, i18n.resolvedLanguage ?? i18n.language),
    [tr, i18n.resolvedLanguage, i18n.language],
  );
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const isFetchingRef = useRef(false);
  const isFetchingMetricsRef = useRef(false);
  const showErrorRef = useRef(showError);
  const translateRef = useRef(tr);
  const inlineTranslateRef = useRef(t);
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
    () => buildTrainingReminder(status, t),
    [status, t],
  );

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  useEffect(() => {
    translateRef.current = tr;
  }, [tr]);

  useEffect(() => {
    inlineTranslateRef.current = t;
  }, [t]);

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
          inlineTranslateRef.current(
            'Nie udało się wczytać statusu modelu AI:',
            'Failed to load AI model status:',
          ) + ` ${String(e)}`,
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
      showInfo(t('Ustawienia modelu zapisane.', 'Model settings saved.'));
      // Force-sync form fields from backend after save
      const freshStatus = await getAssignmentModelStatus();
      syncFromStatus(freshStatus, true);
      const freshFw = await getFeedbackWeight();
      setFeedbackWeight(freshFw);
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        t(
          'Nie udało się zapisać ustawień modelu:',
          'Failed to save model settings:',
        ) + ` ${String(e)}`,
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
      showInfo(t('Trening modelu zakończony.', 'Model training completed.'));
    } catch (e) {
      console.error(e);
      await fetchStatus();
      showError(
        t('Trening modelu nie powiódł się:', 'Model training failed:') +
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
        t(
          'Auto-safe jest wyłączone. Ustaw tryb na auto_safe i zapisz ustawienia.',
          'Auto-safe is disabled. Set mode to auto_safe and save settings.',
        ),
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
        t(
          'Auto-safe zakończone. Przypisano {{assigned}} z {{scanned}} przeskanowanych sesji.',
          'Auto-safe completed. Assigned {{assigned}} / {{scanned}} scanned sessions.',
          { assigned: result.assigned, scanned: result.scanned },
        ),
      );
      triggerRefresh();
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        t('Auto-safe nie powiodło się:', 'Auto-safe failed:') + ` ${String(e)}`,
      );
    } finally {
      setRunningAuto(false);
    }
  };

  const handleRollback = async () => {
    if (!status?.can_rollback_last_auto_run) return;

    const confirmed = await confirm(
      t(
        'Cofnąć ostatnią paczkę auto-safe? Cofnięte zostaną tylko sesje, które od tego czasu nie były ręcznie zmieniane.',
        "Rollback the last auto-safe batch? This will only revert sessions that haven't been manually changed since.",
      ),
    );
    if (!confirmed) return;

    setRollingBack(true);
    try {
      const result = await rollbackLastAutoSafeRun();
      showInfo(
        t(
          'Cofanie zakończone. Cofnięto {{reverted}}, pominięto {{skipped}}.',
          'Rollback completed. Reverted {{reverted}}, skipped {{skipped}}.',
          { reverted: result.reverted, skipped: result.skipped },
        ),
      );
      triggerRefresh();
      await fetchStatus();
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        t('Cofanie nie powiodło się:', 'Rollback failed:') + ` ${String(e)}`,
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
        t(
          'Przypomnienie odroczone na {{hours}}h.',
          'Reminder snoozed for {{hours}}h.',
          { hours: REMINDER_SNOOZE_HOURS },
        ),
      );
    } catch (e) {
      console.error(e);
      showError(
        t(
          'Nie udało się odroczyć przypomnienia:',
          'Failed to snooze reminder:',
        ) + ` ${String(e)}`,
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
      label: t('Odznaka AI', 'AI badge'),
      description: t(
        'Pokaż ikonę iskry na sesjach przypisanych przez AI auto-safe',
        'Show sparkle icon on sessions assigned by AI auto-safe',
      ),
    },
    {
      key: 'showSuggestions' as const,
      label: t('Sugestie AI', 'AI suggestions'),
      description: t(
        'Pokaż sugestie projektu dla nieprzypisanych sesji',
        'Show project suggestions for unassigned sessions',
      ),
    },
    {
      key: 'showScoreBreakdown' as const,
      label: t('Przycisk rozbicia punktacji', 'Score breakdown button'),
      description: t(
        'Pokaż przycisk szczegółów punktacji (BarChart3) na każdej sesji',
        'Show the score details button (BarChart3) on each session',
      ),
    },
  ];
  const howToSections = [
    {
      title: t('Kiedy trenować model', 'When to train the model'),
      paragraphs: [
        t(
          'Trenuj po większej serii ręcznych korekt, po imporcie nowych danych lub gdy przypomnienie wskazuje potrzebę odświeżenia modelu.',
          'Train after a larger series of manual corrections, after importing new data, or when the reminder indicates that the model needs refreshing.',
        ),
        t(
          'Przypomnienie pojawia się automatycznie, gdy masz co najmniej {{feedbackTrigger}} nowych korekt lub minęło ponad {{retrainHours}}h od ostatniego treningu i są nowe korekty.',
          'The reminder appears automatically when: you have at least {{feedbackTrigger}} new corrections or over {{retrainHours}}h passed since last training and there are new corrections.',
          {
            feedbackTrigger: FEEDBACK_TRIGGER,
            retrainHours: RETRAIN_INTERVAL_HOURS,
          },
        ),
      ],
    },
    {
      title: t('Znaczenie parametrów', 'What parameters mean'),
      paragraphs: [
        t(
          'Mode: off wyłącza sugestie, suggest pokazuje sugestie bez auto-zmian, auto_safe pozwala na automatyczne przypisania tylko przy wysokiej pewności.',
          'Mode: off disables suggestions, suggest shows suggestions without auto-changes, auto_safe allows automatic assignments only with high confidence.',
        ),
        t(
          'Suggest Min Confidence: minimalna pewność, by pokazać sugestię w sesjach.',
          'Suggest Min Confidence: minimum confidence to show suggestion in sessions.',
        ),
        t(
          'Auto-safe Min Confidence: wymagany próg pewności dla automatycznego przypisania.',
          'Auto-safe Min Confidence: required confidence threshold for automatic assignment.',
        ),
        t(
          'Auto-safe Min Evidence: ile sygnałów (np. app/token/historia czasu) musi potwierdzić decyzję.',
          'Auto-safe Min Evidence: how many signals (e.g. app/token/time history) must confirm decision.',
        ),
        t(
          'Session Limit: ile nieprzypisanych sesji auto-safe przeskanuje w jednej paczce.',
          'Session Limit: how many unassigned sessions auto-safe will scan in one batch.',
        ),
        t(
          'Feedback Weight: jak mocno ręczne korekty (kciuki/reassign) wpływają na model podczas treningu. Wyższa wartość = większy wpływ korekt. Domyślnie: 5.',
          'Feedback Weight: how much manual corrections (thumbs up/down, reassignments) influence the model during training. Higher = corrections dominate more. Default: 5.',
        ),
      ],
    },
    {
      title: t(
        'Rekomendowane ustawienia startowe',
        'Recommended starting settings',
      ),
      paragraphs: [
        t(
          'Zacznij od mode=suggest, suggest=0.60, auto=0.85, evidence=3. Gdy sugestie są trafne, włącz auto_safe.',
          'Start with mode=suggest, suggest=0.60, auto=0.85, evidence=3. When suggestions are accurate, enable auto_safe.',
        ),
        t(
          'Jeśli auto-safe robi błędne przypisania: podnieś Auto-safe Min Confidence do 0.9+ albo Min Evidence do 4-5.',
          'If auto-safe makes wrong assignments: raise Auto-safe Min Confidence to 0.9+ or Min Evidence to 4-5.',
        ),
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
              {t('Status modelu', 'Model Status')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('Tryb', 'Mode')}
                </p>
                <p className="mt-1 font-medium">{status?.mode ?? '-'}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('Stan treningu', 'Training State')}
                </p>
                <p className="mt-1 font-medium">
                  {status?.is_training
                    ? t('W trakcie', 'In progress')
                    : t('Bezczynny', 'Idle')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('Ostatni trening', 'Last Training')}
                </p>
                <p className="mt-1 font-medium">
                  {formatDateTime(status?.last_train_at) || t('Nigdy', 'Never')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t(
                    'Korekty od ostatniego treningu',
                    'Corrections since last training',
                  )}
                </p>
                <p className="mt-1 font-medium">
                  {status?.feedback_since_train ?? 0}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('Metryki ostatniego treningu', 'Last training metrics')}
                </p>
                <p className="mt-1 font-medium">
                  {(status?.last_train_samples ?? 0) > 0
                    ? `${status?.last_train_samples} samples / ${status?.last_train_duration_ms ?? 0} ms`
                    : t('Brak danych', 'No data')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">
                  {t('Ostatni przebieg auto-safe', 'Last auto-safe run')}
                </p>
                <p className="mt-1 font-medium">
                  {status?.last_auto_run_at
                    ? `${formatDateTime(status.last_auto_run_at)} (${status.last_auto_assigned_count} assigned)`
                    : t('Nigdy', 'Never')}
                </p>
              </div>
            </div>

            {status?.train_error_last && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t('Błąd ostatniego treningu:', 'Last training error:')}{' '}
                {status.train_error_last}
              </div>
            )}

            {trainingReminder.cooldownUntil && !trainingReminder.shouldShow && (
              <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                {t(
                  'Przypomnienie o treningu odroczone do:',
                  'Training reminder snoozed until:',
                )}{' '}
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
                  ? t('Trening...', 'Training...')
                  : t('Trenuj teraz', 'Train Now')}
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
                  ? t('Odświeżanie...', 'Refreshing...')
                  : t('Odśwież status', 'Refresh Status')}
              </Button>
              <Button
                variant="destructive"
                className="h-8"
                onClick={handleResetKnowledge}
                disabled={resettingKnowledge}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {resettingKnowledge
                  ? t('Resetowanie...', 'Resetting...')
                  : t('Reset wiedzy AI', 'Reset AI knowledge')}
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
                {t('Ładowanie metryk AI...', 'Loading AI metrics...')}
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t('Precision AI', 'AI precision')}
                    </p>
                    <p className="mt-1 font-medium">
                      {formatPercent(metricsSummary?.feedback_precision ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t('Feedback łącznie', 'Total feedback')}
                    </p>
                    <p className="mt-1 font-medium">
                      {metricsSummary?.feedback_total ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t('Auto-safe przypisania', 'Auto-safe assignments')}
                    </p>
                    <p className="mt-1 font-medium">
                      {metricsSummary?.auto_assigned ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t('Pokrycie detected_path', 'Detected path coverage')}
                    </p>
                    <p className="mt-1 font-medium">
                      {formatPercent(
                        metricsSummary?.coverage_detected_path_ratio ?? 0,
                      )}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t(
                    'Pokrycie title_history: {{titleCoverage}}, activity_type: {{activityCoverage}}.',
                    'title_history coverage: {{titleCoverage}}, activity_type: {{activityCoverage}}.',
                    {
                      titleCoverage: formatPercent(
                        metricsSummary?.coverage_title_history_ratio ?? 0,
                      ),
                      activityCoverage: formatPercent(
                        metricsSummary?.coverage_activity_type_ratio ?? 0,
                      ),
                    },
                  )}
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'Trend feedbacku (accept/reject/manual)',
                        'Feedback trend (accept/reject/manual)',
                      )}
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
                            name={t('Accept', 'Accept')}
                          />
                          <Bar
                            dataKey="feedback_rejected"
                            stackId="feedback"
                            fill="#ef4444"
                            name={t('Reject', 'Reject')}
                          />
                          <Bar
                            dataKey="feedback_manual_change"
                            stackId="feedback"
                            fill={CHART_PRIMARY_COLOR}
                            name={t('Manual', 'Manual')}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-md border border-border/70 bg-background/35 p-3">
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'Auto-safe runs vs rollback',
                        'Auto-safe runs vs rollback',
                      )}
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
                            name={t('Assigned', 'Assigned')}
                          />
                          <Line
                            type="monotone"
                            dataKey="auto_runs"
                            stroke="#a78bfa"
                            strokeWidth={2}
                            dot={false}
                            name={t('Runs', 'Runs')}
                          />
                          <Line
                            type="monotone"
                            dataKey="auto_rollbacks"
                            stroke="#f97316"
                            strokeWidth={2}
                            dot={false}
                            name={t('Rollbacks', 'Rollbacks')}
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
                {t('Czas na trening modelu', 'Time for model training')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-amber-100/90">{trainingReminder.reason}</p>
              <p className="text-xs text-amber-100/80">
                {t(
                  'Szacowany koszt: lekki trening, zwykle poniżej 10 sekund.',
                  'Estimated cost: light training, usually under 10 seconds.',
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-8"
                  onClick={handleTrainNow}
                  disabled={training || status?.is_training}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {training || status?.is_training
                    ? t('Trening...', 'Training...')
                    : t('Trenuj teraz', 'Train Now')}
                </Button>
                <Button
                  variant="outline"
                  className="h-8 border-amber-500/60 text-amber-100 hover:bg-amber-500/15"
                  onClick={handleSnoozeReminder}
                  disabled={snoozingReminder}
                >
                  {snoozingReminder
                    ? t('Zapisywanie...', 'Saving...')
                    : t(
                        'Przypomnij później ({{hours}}h)',
                        'Remind me later ({{hours}}h)',
                        { hours: REMINDER_SNOOZE_HOURS },
                      )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {t('Tryb i progi', 'Mode and Thresholds')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t('Tryb działania modelu', 'Model operation mode')}
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
                    {t('Wyłączony (ręczny)', 'Off (manual)')}
                  </option>
                  <option value="suggest">
                    {t('Sugestie AI', 'AI suggestions')}
                  </option>
                  <option value="auto_safe">
                    {t('Auto-safe', 'Auto-safe')}
                  </option>
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t(
                    'Minimalna pewność sugestii (0..1)',
                    'Suggest Min Confidence (0..1)',
                  )}
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
                  {t(
                    'Minimalna pewność auto-safe (0..1)',
                    'Auto-safe Min Confidence (0..1)',
                  )}
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
                  {t(
                    'Minimalny próg dowodów auto-safe (1..50)',
                    'Auto-safe Min Evidence (1..50)',
                  )}
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
                  {t('Horyzont treningu (dni)', 'Training horizon (days)')}
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
                    {trainingHorizonDays} {t('dni', 'days')}
                  </span>
                </div>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t('Waga feedbacku (1..50)', 'Feedback Weight (1..50)')}
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
                  {t(
                    'Blacklist aplikacji (exe, po jednej linii)',
                    'Applications blacklist (exe, one per line)',
                  )}
                </span>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={trainingAppBlacklistText}
                  onChange={(e) => {
                    setTrainingAppBlacklistText(e.target.value);
                    dirtyRef.current = true;
                  }}
                  placeholder={t('np. chrome.exe', 'e.g. chrome.exe')}
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
                  placeholder={t(
                    'np. C:\\Users\\me\\Downloads',
                    'e.g. C:\\Users\\me\\Downloads',
                  )}
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
                  ? t('Zapisywanie...', 'Saving...')
                  : t('Zapisz ustawienia modelu', 'Save model settings')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <AiSessionIndicatorsCard
          title={t('Wskaźniki sesji', 'Session Indicators')}
          description={t(
            'Skonfiguruj, które wskaźniki AI i kontrolki feedbacku są widoczne w wierszach sesji.',
            'Configure which AI indicators and feedback controls are visible on session rows.',
          )}
          items={indicatorItems}
          indicators={indicators}
          onToggle={(key, checked) => {
            const next = { ...indicators, [key]: checked };
            setIndicators(next);
            saveIndicatorSettings(next);
          }}
        />

        <AiBatchActionsCard
          title={t('Akcje paczkowe auto-safe', 'Batch auto-safe actions')}
          sessionLimitLabel={t(
            'Limit sesji na przebieg',
            'Session limit per run',
          )}
          autoLimit={autoLimit}
          onAutoLimitChange={(value) => {
            const nextValue = Math.max(1, Math.min(10_000, value));
            setAutoLimit(nextValue);
            saveAutoLimit(nextValue);
          }}
          runLabel={t('Uruchom auto-safe', 'Run auto-safe')}
          runStartingLabel={t('Uruchamianie...', 'Starting...')}
          rollbackLabel={t(
            'Cofnij ostatnią paczkę auto-safe',
            'Rollback last auto-safe batch',
          )}
          rollbackRunningLabel={t('Cofanie...', 'Rolling back...')}
          rollbackHint={t(
            'Cofanie przywraca tylko sesje, które od przebiegu auto-safe nie zostały ręcznie zmienione.',
            'Rollback only reverts sessions that have not been manually changed since the auto-safe run.',
          )}
          modeIsAutoSafe={status?.mode === 'auto_safe'}
          runningAuto={runningAuto}
          rollingBack={rollingBack}
          canRollbackLastRun={Boolean(status?.can_rollback_last_auto_run)}
          onRun={handleRunAutoSafe}
          onRollback={handleRollback}
        />

        <AiHowToCard
          title={t('Jak trenować i konfigurować', 'How to train and configure')}
          sections={howToSections}
        />
      </div>
      <ConfirmDialog />
    </>
  );
}
