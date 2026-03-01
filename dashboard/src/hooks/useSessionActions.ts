import { useCallback } from 'react';
import {
  assignSessionToProject,
  deleteManualSession,
  deleteSession,
  updateSessionComment,
  updateSessionRateMultiplier,
} from '@/lib/tauri';

type SessionIdsInput = number | number[];

interface UseSessionActionsOptions {
  onAfterMutation?: () => void;
  onError?: (action: string, error: unknown) => void;
}

function toSessionIds(input: SessionIdsInput): number[] {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.filter((id) => Number.isFinite(id) && id > 0)));
  }
  return Number.isFinite(input) && input > 0 ? [input] : [];
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

  const assignSessions = useCallback(
    async (
      sessionIdsInput: SessionIdsInput,
      projectId: number | null,
      source?: string,
    ) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('assignSessions', async () => {
        await Promise.all(
          sessionIds.map((sessionId) =>
            assignSessionToProject(sessionId, projectId, source),
          ),
        );
      });
    },
    [runMutation],
  );

  const updateSessionRateMultipliers = useCallback(
    async (sessionIdsInput: SessionIdsInput, multiplier: number | null) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('updateSessionRateMultipliers', async () => {
        await Promise.all(
          sessionIds.map((sessionId) =>
            updateSessionRateMultiplier(sessionId, multiplier),
          ),
        );
      });
    },
    [runMutation],
  );

  const updateSessionComments = useCallback(
    async (sessionIdsInput: SessionIdsInput, comment: string | null) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('updateSessionComments', async () => {
        await Promise.all(
          sessionIds.map((sessionId) => updateSessionComment(sessionId, comment)),
        );
      });
    },
    [runMutation],
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
        await Promise.all(sessionIds.map((sessionId) => deleteSession(sessionId)));
      });
    },
    [runMutation],
  );

  const deleteManualSessions = useCallback(
    async (sessionIdsInput: SessionIdsInput) => {
      const sessionIds = toSessionIds(sessionIdsInput);
      if (sessionIds.length === 0) return;
      await runMutation('deleteManualSessions', async () => {
        await Promise.all(
          sessionIds.map((sessionId) => deleteManualSession(sessionId)),
        );
      });
    },
    [runMutation],
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
