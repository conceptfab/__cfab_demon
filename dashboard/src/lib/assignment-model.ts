import type { AssignmentModelStatus } from '@/lib/db-types';

export function hasPendingAssignmentModelTrainingData(
  status: AssignmentModelStatus | null | undefined,
): boolean {
  return !status?.is_training && (status?.feedback_since_train ?? 0) > 0;
}
