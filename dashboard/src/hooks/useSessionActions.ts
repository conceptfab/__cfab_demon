import { useCallback } from 'react';
import {
  assignSessionToProject,
  assignSessionsToProjectBatch,
  deleteManualSession,
  deleteManualSessionsBatch,
  deleteSession,
  deleteSessionsBatch,
  updateSessionComment,
  updateSessionCommentsBatch,
  updateSessionRateMultiplier,
  updateSessionRateMultipliersBatch,
} from '@/lib/tauri';

type SessionIdsInput = number | number[];

interface UseSessionActionsOptions {
  onAfterMutation?: () => void;
  onError?: (action: string, error: unknown) => void;
}

function toSessionIds(input: SessionIdsInput): number[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(input.filter((id) => Number.isFinite(id) && id > 0)),
    );
  }
  return Number.isFinite(input) && input > 0 ? [input] : [];
}

export function requiresCommentForMultiplierBoost(
  multiplier: number | null | undefined,
): boolean {
  return multiplier != null && multiplier > 1.000_001;
}

export function findSessionIdsMissingComment(
  sessionIdsInput: SessionIdsInput,
  getCommentById: (sessionId: number) => string | null | undefined,
): number[] {
  return toSessionIds(sessionIdsInput).filter((sessionId) => {
    const comment = getCommentById(sessionId);
    return !comment || !comment.trim();
  });
}

export function parsePositiveRateMultiplierInput(raw: string): number | null {
  const parsed = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function useSessionActions(options: UseSessionActionsOptions = {}) {
  const { onAfterMutation, onError } = options;

  const runMutation = useCallback(
    async (action: string, fn: () => Promise<void>) => {
      try {
        await fn();
        onAfterMutation?.();
      } catch (error) {
        onError?.(action, error);
        throw error;
      }
    },
    [onAfterMutation, onError],
  );

  const runForSessionIds = useCallback(
    async (
      sessionIds: number[],
      runSingle: (sessionId: number) => Promise<unknown>,
      runBatch: (sessionIds: number[]) => Promise<unknown>,
    ) => {
      if (sessionIds.length === 1) {
        await runSingle(sessionIds[0]);
        return;
      }
      await runBatch(sessionIds);
    },
    [],
  );

  const assignSessions = useCallback(
    async (
      sessionIdsInput: SessionIdsInput,
      projectId: number | null,
      source?: string,
    ) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('assignSessions', async () => {
        await runForSessionIds(
          sessionIds,
          (sessionId) => assignSessionToProject(sessionId, projectId, source),
          (ids) => assignSessionsToProjectBatch(ids, projectId, source),
        );
      });
    },
    [runForSessionIds, runMutation],
  );

  const updateSessionRateMultipliers = useCallback(
    async (sessionIdsInput: SessionIdsInput, multiplier: number | null) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('updateSessionRateMultipliers', async () => {
        await runForSessionIds(
          sessionIds,
          (sessionId) => updateSessionRateMultiplier(sessionId, multiplier),
          (ids) => updateSessionRateMultipliersBatch(ids, multiplier),
        );
      });
    },
    [runForSessionIds, runMutation],
  );

  const updateSessionComments = useCallback(
    async (sessionIdsInput: SessionIdsInput, comment: string | null) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('updateSessionComments', async () => {
        await runForSessionIds(
          sessionIds,
          (sessionId) => updateSessionComment(sessionId, comment),
          (ids) => updateSessionCommentsBatch(ids, comment),
        );
      });
    },
    [runForSessionIds, runMutation],
  );

  const updateOneSessionComment = useCallback(
    async (sessionId: number, comment: string | null) => {
      await updateSessionComments(sessionId, comment);
    },
    [updateSessionComments],
  );

  const deleteSessions = useCallback(
    async (sessionIdsInput: SessionIdsInput) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('deleteSessions', async () => {
        await runForSessionIds(
          sessionIds,
          (sessionId) => deleteSession(sessionId),
          (ids) => deleteSessionsBatch(ids),
        );
      });
    },
    [runForSessionIds, runMutation],
  );

  const deleteManualSessions = useCallback(
    async (sessionIdsInput: SessionIdsInput) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('deleteManualSessions', async () => {
        await runForSessionIds(
          sessionIds,
          (sessionId) => deleteManualSession(sessionId),
          (ids) => deleteManualSessionsBatch(ids),
        );
      });
    },
    [runForSessionIds, runMutation],
  );

  return {
    assignSessions,
    updateSessionRateMultipliers,
    updateSessionComments,
    updateSessionComment: updateOneSessionComment,
    deleteSessions,
    deleteManualSessions,
  };
}
