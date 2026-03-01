import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Brain,
  Eye,
  PlayCircle,
  RotateCcw,
  Save,
  WandSparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-notification';
import { useDataStore } from '@/store/data-store';
import {
  getAssignmentModelStatus,
  rollbackLastAutoSafeRun,
  runAutoSafeAssignment,
  setAssignmentModelCooldown,
  setAssignmentMode,
  trainAssignmentModel,
  getFeedbackWeight,
  setFeedbackWeight as setFeedbackWeightApi,
} from '@/lib/tauri';
import type { AssignmentMode, AssignmentModelStatus } from '@/lib/db-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  saveIndicatorSettings,
  normalizeLanguageCode,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';

const FEEDBACK_TRIGGER = 30;
const RETRAIN_INTERVAL_HOURS = 24;
const REMINDER_SNOOZE_HOURS = 24;

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

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTrainingReminder(
  status: AssignmentModelStatus | null,
  translate?: (pl: string, en: string) => string,
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
      `Masz ${status.feedback_since_train} korekt od ostatniego treningu (próg: ${FEEDBACK_TRIGGER}).`,
      `You have ${status.feedback_since_train} corrections since last training (threshold: ${FEEDBACK_TRIGGER}).`,
    );
  } else if (dueToInterval) {
    reason = (translate ?? ((_: string, en: string) => en))(
      `Minęło ponad ${RETRAIN_INTERVAL_HOURS}h od ostatniego treningu i są nowe korekty.`,
      `Over ${RETRAIN_INTERVAL_HOURS}h passed since last training and there are new corrections.`,
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
  const { i18n } = useTranslation();
  const lang = normalizeLanguageCode(i18n.resolvedLanguage ?? i18n.language);
  const t = (pl: string, en: string) => (lang === 'pl' ? pl : en);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [status, setStatus] = useState<AssignmentModelStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [training, setTraining] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [snoozingReminder, setSnoozingReminder] = useState(false);

  const [mode, setMode] = useState<AssignmentMode>('suggest');
  const [suggestConf, setSuggestConf] = useState<number>(0.6);
  const [autoConf, setAutoConf] = useState<number>(0.85);
  const [autoEvidence, setAutoEvidence] = useState<number>(3);
  const [autoLimit, setAutoLimit] = useState<number>(500);
  const [feedbackWeight, setFeedbackWeight] = useState<number>(5.0);
  const [indicators, setIndicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );

  const syncFromStatus = (nextStatus: AssignmentModelStatus) => {
    setStatus(nextStatus);
    setMode(nextStatus.mode);
    setSuggestConf(nextStatus.min_confidence_suggest);
    setAutoConf(nextStatus.min_confidence_auto);
    setAutoEvidence(nextStatus.min_evidence_auto);
  };

  const trainingReminder = useMemo(
    () => buildTrainingReminder(status, t),
    [status, t],
  );

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await getAssignmentModelStatus();
      syncFromStatus(nextStatus);
      const fw = await getFeedbackWeight();
      setFeedbackWeight(fw);
    } catch (e) {
      console.error(e);
      showError(
        t('Nie udało się wczytać statusu modelu AI:', 'Failed to load AI model status:') +
          ` ${String(e)}`,
      );
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  }, [showError, t]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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
      const clampedFw = Math.max(1, Math.min(50, feedbackWeight));
      await setFeedbackWeightApi(clampedFw);
      showInfo(t('Ustawienia modelu zapisane.', 'Model settings saved.'));
      await fetchStatus(true);
    } catch (e) {
      console.error(e);
      showError(
        t('Nie udało się zapisać ustawień modelu:', 'Failed to save model settings:') +
          ` ${String(e)}`,
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
      showInfo(t('Trening modelu zakończony.', 'Model training completed.'));
    } catch (e) {
      console.error(e);
      showError(
        t('Trening modelu nie powiódł się:', 'Model training failed:') +
          ` ${String(e)}`,
      );
    } finally {
      setTraining(false);
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
          `Auto-safe zakończone. Przypisano ${result.assigned} z ${result.scanned} przeskanowanych sesji.`,
          `Auto-safe completed. Assigned ${result.assigned} / ${result.scanned} scanned sessions.`,
        ),
      );
      triggerRefresh();
      await fetchStatus(true);
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
          `Cofanie zakończone. Cofnięto ${result.reverted}, pominięto ${result.skipped}.`,
          `Rollback completed. Reverted ${result.reverted}, skipped ${result.skipped}.`,
        ),
      );
      triggerRefresh();
      await fetchStatus(true);
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
          `Przypomnienie odroczone na ${REMINDER_SNOOZE_HOURS}h.`,
          `Reminder snoozed for ${REMINDER_SNOOZE_HOURS}h.`,
        ),
      );
    } catch (e) {
      console.error(e);
      showError(
        t('Nie udało się odroczyć przypomnienia:', 'Failed to snooze reminder:') +
          ` ${String(e)}`,
      );
    } finally {
      setSnoozingReminder(false);
    }
  };

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
                <p className="text-xs text-muted-foreground">{t('Tryb', 'Mode')}</p>
                <p className="mt-1 font-medium">{status?.mode ?? '-'}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">{t('Stan treningu', 'Training State')}</p>
                <p className="mt-1 font-medium">
                  {status?.is_training
                    ? t('W trakcie', 'In progress')
                    : t('Bezczynny', 'Idle')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <p className="text-xs text-muted-foreground">{t('Ostatni trening', 'Last Training')}</p>
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
                {t('Przypomnienie o treningu odroczone do:', 'Training reminder snoozed until:')}{' '}
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
                onClick={() => fetchStatus()}
                disabled={loadingStatus}
              >
                {t('Odśwież status', 'Refresh Status')}
              </Button>
            </div>
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
                        `Przypomnij później (${REMINDER_SNOOZE_HOURS}h)`,
                        `Remind me later (${REMINDER_SNOOZE_HOURS}h)`,
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
                  onChange={(e) => setMode(e.target.value as AssignmentMode)}
                >
                  <option value="off">off</option>
                  <option value="suggest">suggest</option>
                  <option value="auto_safe">auto_safe</option>
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t('Minimalna pewność sugestii (0..1)', 'Suggest Min Confidence (0..1)')}
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
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t('Minimalna pewność auto-safe (0..1)', 'Auto-safe Min Confidence (0..1)')}
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
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  {t('Minimalny próg dowodów auto-safe (1..50)', 'Auto-safe Min Evidence (1..50)')}
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
                  }}
                />
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
                  }}
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Eye className="h-4 w-4" />
              {t('Wskaźniki sesji', 'Session Indicators')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t(
                'Skonfiguruj, które wskaźniki AI i kontrolki feedbacku są widoczne w wierszach sesji.',
                'Configure which AI indicators and feedback controls are visible on session rows.',
              )}
            </p>
            <div className="space-y-3">
              {[
                {
                  key: 'showAiBadge' as const,
                  label: t('Odznaka AI', 'AI badge'),
                  desc: t(
                    'Pokaż ikonę iskry na sesjach przypisanych przez AI auto-safe',
                    'Show sparkle icon on sessions assigned by AI auto-safe',
                  ),
                },
                {
                  key: 'showThumbsOnAi' as const,
                  label: t('Kciuki na sesjach AI', 'Thumbs on AI sessions'),
                  desc: t(
                    'Pokaż przyciski akceptuj/odrzuć na sesjach przypisanych przez AI',
                    'Show confirm/reject buttons on AI-assigned sessions',
                  ),
                },
                {
                  key: 'showThumbsOnAll' as const,
                  label: t('Kciuki na wszystkich sesjach', 'Thumbs on all sessions'),
                  desc: t(
                    'Pokaż przyciski feedbacku na każdej przypisanej sesji (nie tylko AI)',
                    'Show feedback buttons on every assigned session (not just AI)',
                  ),
                },
                {
                  key: 'showSuggestions' as const,
                  label: t('Sugestie AI', 'AI suggestions'),
                  desc: t(
                    'Pokaż sugestie projektu dla nieprzypisanych sesji',
                    'Show project suggestions for unassigned sessions',
                  ),
                },
                {
                  key: 'showScoreBreakdown' as const,
                  label: t('Przycisk rozbicia punktacji', 'Score breakdown button'),
                  desc: t(
                    'Pokaż przycisk szczegółów punktacji (BarChart3) na każdej sesji',
                    'Show the score details button (BarChart3) on each session',
                  ),
                },
              ].map(({ key, label, desc }) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary cursor-pointer"
                    checked={indicators[key]}
                    onChange={(e) => {
                      const next = { ...indicators, [key]: e.target.checked };
                      setIndicators(next);
                      saveIndicatorSettings(next);
                    }}
                  />
                  <div>
                    <span className="text-sm font-medium group-hover:text-foreground transition-colors">
                      {label}
                    </span>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {t('Akcje paczkowe auto-safe', 'Batch auto-safe actions')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block max-w-xs space-y-1.5 text-sm">
              <span className="text-xs text-muted-foreground">
                {t('Limit sesji na przebieg', 'Session limit per run')}
              </span>
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={autoLimit}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  setAutoLimit(Number.isNaN(next) ? 1 : next);
                }}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                className="h-9"
                onClick={handleRunAutoSafe}
                disabled={runningAuto || status?.mode !== 'auto_safe'}
              >
                <WandSparkles className="mr-2 h-4 w-4" />
                {runningAuto
                  ? t('Uruchamianie...', 'Starting...')
                  : t('Uruchom auto-safe', 'Run auto-safe')}
              </Button>

              <Button
                variant="outline"
                className="h-9"
                onClick={handleRollback}
                disabled={rollingBack || !status?.can_rollback_last_auto_run}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {rollingBack
                  ? t('Cofanie...', 'Rolling back...')
                  : t('Cofnij ostatnią paczkę auto-safe', 'Rollback last auto-safe batch')}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t(
                'Cofanie przywraca tylko sesje, które od przebiegu auto-safe nie zostały ręcznie zmienione.',
                'Rollback only reverts sessions that have not been manually changed since the auto-safe run.',
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {t('Jak trenować i konfigurować', 'How to train and configure')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6">
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="font-medium">{t('Kiedy trenować model', 'When to train the model')}</p>
              <p className="text-muted-foreground">
                {t(
                  'Trenuj po większej serii ręcznych korekt, po imporcie nowych danych lub gdy przypomnienie wskazuje potrzebę odświeżenia modelu.',
                  'Train after a larger series of manual corrections, after importing new data, or when the reminder indicates that the model needs refreshing.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  `Przypomnienie pojawia się automatycznie, gdy masz co najmniej ${FEEDBACK_TRIGGER} nowych korekt lub minęło ponad ${RETRAIN_INTERVAL_HOURS}h od ostatniego treningu i są nowe korekty.`,
                  `The reminder appears automatically when: you have at least ${FEEDBACK_TRIGGER} new corrections or over ${RETRAIN_INTERVAL_HOURS}h passed since last training and there are new corrections.`,
                )}
              </p>
            </div>

            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="font-medium">{t('Znaczenie parametrów', 'What parameters mean')}</p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Mode: off wyłącza sugestie, suggest pokazuje sugestie bez auto-zmian, auto_safe pozwala na automatyczne przypisania tylko przy wysokiej pewności.',
                  'Mode: off disables suggestions, suggest shows suggestions without auto-changes, auto_safe allows automatic assignments only with high confidence.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Suggest Min Confidence: minimalna pewność, by pokazać sugestię w sesjach.',
                  'Suggest Min Confidence: minimum confidence to show suggestion in sessions.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Auto-safe Min Confidence: wymagany próg pewności dla automatycznego przypisania.',
                  'Auto-safe Min Confidence: required confidence threshold for automatic assignment.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Auto-safe Min Evidence: ile sygnałów (np. app/token/historia czasu) musi potwierdzić decyzję.',
                  'Auto-safe Min Evidence: how many signals (e.g. app/token/time history) must confirm decision.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Session Limit: ile nieprzypisanych sesji auto-safe przeskanuje w jednej paczce.',
                  'Session Limit: how many unassigned sessions auto-safe will scan in one batch.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Feedback Weight: jak mocno ręczne korekty (kciuki/reassign) wpływają na model podczas treningu. Wyższa wartość = większy wpływ korekt. Domyślnie: 5.',
                  'Feedback Weight: how much manual corrections (thumbs up/down, reassignments) influence the model during training. Higher = corrections dominate more. Default: 5.',
                )}
              </p>
            </div>

            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="font-medium">{t('Rekomendowane ustawienia startowe', 'Recommended starting settings')}</p>
              <p className="text-muted-foreground">
                {t(
                  'Zacznij od mode=suggest, suggest=0.60, auto=0.85, evidence=3. Gdy sugestie są trafne, włącz auto_safe.',
                  'Start with mode=suggest, suggest=0.60, auto=0.85, evidence=3. When suggestions are accurate, enable auto_safe.',
                )}
              </p>
              <p className="mt-2 text-muted-foreground">
                {t(
                  'Jeśli auto-safe robi błędne przypisania: podnieś Auto-safe Min Confidence do 0.9+ albo Min Evidence do 4-5.',
                  'If auto-safe makes wrong assignments: raise Auto-safe Min Confidence to 0.9+ or Min Evidence to 4-5.',
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog />
    </>
  );
}
