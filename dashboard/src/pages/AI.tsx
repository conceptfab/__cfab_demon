import { useEffect, useMemo, useState } from "react";
import { Brain, PlayCircle, RotateCcw, Save, WandSparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-notification";
import { useAppStore } from "@/store/app-store";
import {
  getAssignmentModelStatus,
  rollbackLastAutoSafeRun,
  runAutoSafeAssignment,
  setAssignmentModelCooldown,
  setAssignmentMode,
  trainAssignmentModel,
} from "@/lib/tauri";
import type { AssignmentMode, AssignmentModelStatus } from "@/lib/db-types";
import { loadSessionSettings } from "@/lib/user-settings";

const FEEDBACK_TRIGGER = 30;
const RETRAIN_INTERVAL_HOURS = 24;
const REMINDER_SNOOZE_HOURS = 24;

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
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

function buildTrainingReminder(status: AssignmentModelStatus | null): {
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
    reason = `You have ${status.feedback_since_train} corrections since last training (threshold: ${FEEDBACK_TRIGGER}).`;
  } else if (dueToInterval) {
    reason = `Over ${RETRAIN_INTERVAL_HOURS}h passed since last training and there are new corrections.`;
  } else if (coldStart) {
    reason = "The model has correction data but has never been trained.";
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
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);
  const { showError, showInfo } = useToast();

  const [status, setStatus] = useState<AssignmentModelStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [training, setTraining] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [snoozingReminder, setSnoozingReminder] = useState(false);

  const [mode, setMode] = useState<AssignmentMode>("suggest");
  const [suggestConf, setSuggestConf] = useState<number>(0.6);
  const [autoConf, setAutoConf] = useState<number>(0.85);
  const [autoEvidence, setAutoEvidence] = useState<number>(3);
  const [autoLimit, setAutoLimit] = useState<number>(500);

  const syncFromStatus = (nextStatus: AssignmentModelStatus) => {
    setStatus(nextStatus);
    setMode(nextStatus.mode);
    setSuggestConf(nextStatus.min_confidence_suggest);
    setAutoConf(nextStatus.min_confidence_auto);
    setAutoEvidence(nextStatus.min_evidence_auto);
  };

  const trainingReminder = useMemo(() => buildTrainingReminder(status), [status]);

  const fetchStatus = async (silent = false) => {
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await getAssignmentModelStatus();
      syncFromStatus(nextStatus);
    } catch (e) {
      console.error(e);
      showError(`Failed to load AI model status: ${String(e)}`);
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveMode = async () => {
    setSavingMode(true);
    try {
      const normalizedSuggest = clampNumber(suggestConf, 0, 1);
      const normalizedAuto = clampNumber(autoConf, 0, 1);
      const normalizedEvidence = Math.round(clampNumber(autoEvidence, 1, 50));

      await setAssignmentMode(mode, normalizedSuggest, normalizedAuto, normalizedEvidence);
      showInfo("Model settings saved.");
      await fetchStatus(true);
    } catch (e) {
      console.error(e);
      showError(`Failed to save model settings: ${String(e)}`);
    } finally {
      setSavingMode(false);
    }
  };

  const handleTrainNow = async () => {
    setTraining(true);
    try {
      const nextStatus = await trainAssignmentModel(true);
      syncFromStatus(nextStatus);
      showInfo("Model training completed.");
    } catch (e) {
      console.error(e);
      showError(`Model training failed: ${String(e)}`);
    } finally {
      setTraining(false);
    }
  };

  const handleRunAutoSafe = async () => {
    if (status?.mode !== "auto_safe") {
      showError("Auto-safe is disabled. Set mode to auto_safe and save settings.");
      return;
    }

    setRunningAuto(true);
    try {
      const minDuration = loadSessionSettings().minSessionDurationSeconds || undefined;
      const result = await runAutoSafeAssignment(
        Math.round(clampNumber(autoLimit, 1, 10_000)),
        undefined,
        minDuration
      );
      showInfo(
        `Auto-safe completed. Assigned ${result.assigned} / ${result.scanned} scanned sessions.`
      );
      triggerRefresh();
      await fetchStatus(true);
    } catch (e) {
      console.error(e);
      showError(`Auto-safe failed: ${String(e)}`);
    } finally {
      setRunningAuto(false);
    }
  };

  const handleRollback = async () => {
    if (!status?.can_rollback_last_auto_run) return;

    const confirmed = window.confirm(
      "Rollback the last auto-safe batch? This will only revert sessions that haven't been manually changed since."
    );
    if (!confirmed) return;

    setRollingBack(true);
    try {
      const result = await rollbackLastAutoSafeRun();
      showInfo(`Rollback completed. Reverted ${result.reverted}, skipped ${result.skipped}.`);
      triggerRefresh();
      await fetchStatus(true);
    } catch (e) {
      console.error(e);
      showError(`Rollback failed: ${String(e)}`);
    } finally {
      setRollingBack(false);
    }
  };

  const handleSnoozeReminder = async () => {
    setSnoozingReminder(true);
    try {
      const nextStatus = await setAssignmentModelCooldown(REMINDER_SNOOZE_HOURS);
      syncFromStatus(nextStatus);
      showInfo(`Reminder snoozed for ${REMINDER_SNOOZE_HOURS}h.`);
    } catch (e) {
      console.error(e);
      showError(`Failed to snooze reminder: ${String(e)}`);
    } finally {
      setSnoozingReminder(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Brain className="h-4 w-4" />
            Model Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Mode</p>
              <p className="mt-1 font-medium">{status?.mode ?? "-"}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Training State</p>
              <p className="mt-1 font-medium">{status?.is_training ? "In progress" : "Idle"}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Last Training</p>
              <p className="mt-1 font-medium">{formatDateTime(status?.last_train_at)}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Corrections since last training</p>
              <p className="mt-1 font-medium">{status?.feedback_since_train ?? 0}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Last training metrics</p>
              <p className="mt-1 font-medium">
                {(status?.last_train_samples ?? 0) > 0
                  ? `${status?.last_train_samples} samples / ${status?.last_train_duration_ms ?? 0} ms`
                  : "No data"}
              </p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <p className="text-xs text-muted-foreground">Last auto-safe run</p>
              <p className="mt-1 font-medium">
                {status?.last_auto_run_at
                  ? `${formatDateTime(status.last_auto_run_at)} (${status.last_auto_assigned_count} assigned)`
                  : "Never"}
              </p>
            </div>
          </div>

          {status?.train_error_last && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Last training error: {status.train_error_last}
            </div>
          )}

          {trainingReminder.cooldownUntil && !trainingReminder.shouldShow && (
            <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
              Training reminder snoozed until: {formatDateTime(trainingReminder.cooldownUntil.toISOString())}
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
              {training || status?.is_training ? "Training..." : "Train Now"}
            </Button>
            <Button
              variant="outline"
              className="h-8"
              onClick={() => fetchStatus()}
              disabled={loadingStatus}
            >
              Refresh Status
            </Button>
          </div>
        </CardContent>
      </Card>

      {trainingReminder.shouldShow && trainingReminder.reason && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-amber-100">
              Time for model training
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-amber-100/90">{trainingReminder.reason}</p>
            <p className="text-xs text-amber-100/80">Estimated cost: light training, usually under 10 seconds.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-8"
                onClick={handleTrainNow}
                disabled={training || status?.is_training}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {training || status?.is_training ? "Training..." : "Train Now"}
              </Button>
              <Button
                variant="outline"
                className="h-8 border-amber-500/60 text-amber-100 hover:bg-amber-500/15"
                onClick={handleSnoozeReminder}
                disabled={snoozingReminder}
              >
                {snoozingReminder
                  ? "Saving..."
                  : `Remind me later (${REMINDER_SNOOZE_HOURS}h)`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Mode and Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Model operation mode</span>
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
              <span className="text-xs text-muted-foreground">Suggest Min Confidence (0..1)</span>
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
              <span className="text-xs text-muted-foreground">Auto-safe Min Confidence (0..1)</span>
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
              <span className="text-xs text-muted-foreground">Auto-safe Min Evidence (1..50)</span>
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
          </div>

          <div className="flex justify-end">
            <Button className="h-9 min-w-[9rem]" onClick={handleSaveMode} disabled={savingMode}>
              <Save className="mr-2 h-4 w-4" />
              {savingMode ? "Saving..." : "Save model settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Batch auto-safe actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block max-w-xs space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">Session limit per run</span>
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
              disabled={runningAuto || status?.mode !== "auto_safe"}
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              {runningAuto ? "Starting..." : "Run auto-safe"}
            </Button>

            <Button
              variant="outline"
              className="h-9"
              onClick={handleRollback}
              disabled={rollingBack || !status?.can_rollback_last_auto_run}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {rollingBack ? "Rolling back..." : "Rollback last auto-safe batch"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Rollback only reverts sessions that have not been manually changed since the auto-safe run.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">How to train and configure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="font-medium">When to train the model</p>
            <p className="text-muted-foreground">
              Train after a larger series of manual corrections, after importing new data, or when the reminder
              indicates that the model needs refreshing.
            </p>
            <p className="mt-2 text-muted-foreground">
              The reminder appears automatically when: you have at least {FEEDBACK_TRIGGER} new corrections or over
              {RETRAIN_INTERVAL_HOURS}h passed since last training and there are new corrections.
            </p>
          </div>

          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="font-medium">What parameters mean</p>
            <p className="mt-2 text-muted-foreground">
              <strong>Mode</strong>: <code>off</code> disables suggestions, <code>suggest</code> shows suggestions without
              auto-changes, <code>auto_safe</code> allows automatic assignments only with high confidence.
            </p>
            <p className="mt-2 text-muted-foreground">
              <strong>Suggest Min Confidence</strong>: minimum confidence to show suggestion in sessions.
            </p>
            <p className="mt-2 text-muted-foreground">
              <strong>Auto-safe Min Confidence</strong>: required confidence threshold for automatic assignment.
            </p>
            <p className="mt-2 text-muted-foreground">
              <strong>Auto-safe Min Evidence</strong>: how many signals (e.g. app/token/time history) must confirm decision.
            </p>
            <p className="mt-2 text-muted-foreground">
              <strong>Session Limit</strong>: how many unassigned sessions auto-safe will scan in one batch.
            </p>
          </div>

          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="font-medium">Recommended starting settings</p>
            <p className="text-muted-foreground">
              Start with <code>mode=suggest</code>, <code>suggest=0.60</code>, <code>auto=0.85</code>,{" "}
              <code>evidence=3</code>. When suggestions are accurate, enable <code>auto_safe</code>.
            </p>
            <p className="mt-2 text-muted-foreground">
              If auto-safe makes wrong assignments: raise <code>Auto-safe Min Confidence</code> to 0.9+ or{" "}
              <code>Min Evidence</code> to 4-5.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
