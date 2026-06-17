import type { AssignmentModelStatus } from '@/lib/db-types';

export function hasPendingAssignmentModelTrainingData(
  status: AssignmentModelStatus | null | undefined,
): boolean {
  return !status?.is_training && (status?.feedback_since_train ?? 0) > 0;
}

/** Get localized AI assignment mode label. */
export function getAiModeLabel(
  mode: string | undefined | null,
  t: (key: string) => string,
): string {
  switch (mode) {
    case 'off':
      return t('layout.status.off');
    case 'suggest':
      return t('layout.status.suggestions');
    case 'auto_safe':
      return t('layout.status.auto_safe');
    default:
      return t('ui.common.not_available');
  }
}
