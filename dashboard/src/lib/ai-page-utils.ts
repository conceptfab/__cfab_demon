import type { AssignmentModelMetrics, AssignmentModelStatus } from '@/lib/db-types';
import {
  AI_FEEDBACK_TRIGGER,
  AI_RETRAIN_INTERVAL_HOURS,
} from '@/pages/ai/ai-page-constants';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildTrainingReminder(
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
  const dueToFeedback = status.feedback_since_train >= AI_FEEDBACK_TRIGGER;
  const dueToInterval =
    hasFeedback &&
    lastTrain !== null &&
    now - lastTrain.getTime() >= AI_RETRAIN_INTERVAL_HOURS * 60 * 60 * 1000;
  const coldStart = hasFeedback && !lastTrain;

  let reason: string | null = null;
  if (dueToFeedback) {
    reason = translate(
      'ai_page.text.you_have_corrections_since_last_training_threshold',
      {
        feedbackCount: status.feedback_since_train,
        threshold: AI_FEEDBACK_TRIGGER,
      },
    );
  } else if (dueToInterval) {
    reason = translate(
      'ai_page.text.over_h_passed_since_last_training_and_there_are',
      { hours: AI_RETRAIN_INTERVAL_HOURS },
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

export function areAssignmentMetricsEqual(
  current: AssignmentModelMetrics | null,
  next: AssignmentModelMetrics,
): boolean {
  if (!current) return false;
  if (current.window_days !== next.window_days) return false;
  if (current.points.length !== next.points.length) return false;
  const cs = current.summary;
  const ns = next.summary;
  return (
    cs.feedback_total === ns.feedback_total &&
    cs.feedback_precision === ns.feedback_precision &&
    cs.auto_runs === ns.auto_runs &&
    cs.auto_assigned === ns.auto_assigned
  );
}
