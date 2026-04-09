import { logger } from '@/lib/logger';
import { aiApi } from '@/lib/tauri';
import { loadSessionSettings } from '@/lib/user-settings';

export const AI_AND_SPLIT_OPERATION_KEY = 'ai_and_split_pipeline';
export const AUTO_PROJECT_SYNC_STORAGE_KEY = 'timeflow.projects.auto-sync-meta';
export const AUTO_PROJECT_FOLDER_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
export const AUTO_PROJECT_DETECTION_TTL_MS = 24 * 60 * 60 * 1000;

export interface AutoProjectSyncMeta {
  lastFolderSyncAt: number | null;
  lastDetectionAt: number | null;
}

export function loadAutoProjectSyncMeta(): AutoProjectSyncMeta {
  if (typeof window === 'undefined') {
    return {
      lastFolderSyncAt: null,
      lastDetectionAt: null,
    };
  }

  try {
    const raw = window.localStorage.getItem(AUTO_PROJECT_SYNC_STORAGE_KEY);
    if (!raw) {
      return {
        lastFolderSyncAt: null,
        lastDetectionAt: null,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AutoProjectSyncMeta>;
    return {
      lastFolderSyncAt:
        typeof parsed.lastFolderSyncAt === 'number'
          ? parsed.lastFolderSyncAt
          : null,
      lastDetectionAt:
        typeof parsed.lastDetectionAt === 'number'
          ? parsed.lastDetectionAt
          : null,
    };
  } catch (error) {
    logger.warn('Failed to read auto project sync metadata:', error);
    return {
      lastFolderSyncAt: null,
      lastDetectionAt: null,
    };
  }
}

export function saveAutoProjectSyncMeta(next: Partial<AutoProjectSyncMeta>): void {
  if (typeof window === 'undefined') return;

  try {
    const current = loadAutoProjectSyncMeta();
    window.localStorage.setItem(
      AUTO_PROJECT_SYNC_STORAGE_KEY,
      JSON.stringify({
        ...current,
        ...next,
      }),
    );
  } catch (error) {
    logger.warn('Failed to persist auto project sync metadata:', error);
  }
}

export function isExpired(lastRunAt: number | null, ttlMs: number, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= ttlMs;
}

// THREADING: Prevents concurrent heavy operations (rebuild, AI train/assign)
// from overloading the backend. Simple module-level flag — safe in single-threaded JS.
const heavyOperations = new Map<string, boolean>();

export async function runHeavyOperation<T>(
  key: string,
  fn_: () => Promise<T>,
): Promise<T | null> {
  if (heavyOperations.get(key)) {
    logger.warn(`Heavy operation '${key}' is already in progress. Skipping.`);
    return null;
  }
  heavyOperations.set(key, true);
  try {
    return await fn_();
  } finally {
    heavyOperations.set(key, false);
  }
}

export type AiAssignmentResult = {
  needsRefresh: boolean;
  deterministicAssigned: number;
  aiAssigned: number;
};

export async function runAutoAiAssignmentCycle(): Promise<AiAssignmentResult> {
  const result = await runHeavyOperation(
    AI_AND_SPLIT_OPERATION_KEY,
    async () => {
      let deterministicAssigned = 0;
      let aiAssigned = 0;
      try {
        const det = await aiApi.applyDeterministicAssignment();
        deterministicAssigned = det.sessions_assigned;
      } catch (e) {
        logger.warn('Deterministic assignment failed:', e);
      }

      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const aiResult = await aiApi.autoRunIfNeeded(minDuration);
        if (aiResult) aiAssigned = aiResult.assigned;
      } catch (e) {
        logger.warn('AI auto-assignment failed:', e);
      }

      const needsRefresh = deterministicAssigned > 0 || aiAssigned > 0;
      return { needsRefresh, deterministicAssigned, aiAssigned };
    },
  );

  return result ?? { needsRefresh: false, deterministicAssigned: 0, aiAssigned: 0 };
}

// === Event dispatch ===

export const AI_ASSIGNMENT_DONE_EVENT = 'timeflow:ai-assignment-done';
export const ONLINE_SYNC_DONE_EVENT = 'timeflow:online-sync-done';
export const LAN_SYNC_DONE_EVENT = 'timeflow:lan-sync-done';

export function dispatchOnlineSyncDone(action: string, reason: string) {
  if (action !== 'none') {
    window.dispatchEvent(
      new CustomEvent(ONLINE_SYNC_DONE_EVENT, { detail: { action, reason } }),
    );
  }
}

export function dispatchLanSyncDone(peerName: string) {
  window.dispatchEvent(
    new CustomEvent(LAN_SYNC_DONE_EVENT, { detail: { peerName } }),
  );
}

export function dispatchAiAssignmentDone(result: AiAssignmentResult) {
  const total = result.deterministicAssigned + result.aiAssigned;
  if (total > 0) {
    window.dispatchEvent(
      new CustomEvent(AI_ASSIGNMENT_DONE_EVENT, { detail: total }),
    );
  }
}
