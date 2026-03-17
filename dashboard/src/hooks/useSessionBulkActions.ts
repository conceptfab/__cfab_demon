import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { logTauriError } from '@/lib/utils';
import { findSessionIdsMissingComment } from '@/lib/session-utils';
import { useToast } from '@/components/ui/toast-notification';
import type { SessionWithApp } from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';

interface UseSessionBulkActionsOptions {
  assignSessions: (
    sessionId: number,
    projectId: number | null,
    source?: string,
  ) => Promise<void>;
  updateSessionComments: (
    sessionIds: number[],
    comment: string | null,
  ) => Promise<void>;
  setSessions: (fn: (prev: SessionWithApp[]) => SessionWithApp[]) => void;
  sessionsRef: React.MutableRefObject<SessionWithApp[]>;
  setDismissedSuggestions: (
    fn: (prev: Set<number>) => Set<number>,
  ) => void;
  setPromptConfig: (config: PromptConfig | null) => void;
  mergedSessions: SessionWithApp[];
}

export function useSessionBulkActions({
  assignSessions,
  updateSessionComments,
  setSessions,
  sessionsRef,
  setDismissedSuggestions,
  setPromptConfig,
  mergedSessions,
}: UseSessionBulkActionsOptions) {
  const { t } = useTranslation();
  const { showError } = useToast();

  const ensureCommentForBoost = useCallback(
    async (sessionIds: number[]) => {
      if (sessionIds.length === 0) return true;

      const commentById = new Map(mergedSessions.map((s) => [s.id, s.comment]));
      const missingIds = findSessionIdsMissingComment(
        sessionIds,
        (id) => commentById.get(id) ?? null,
      );

      if (missingIds.length === 0) return true;

      const label =
        missingIds.length === 1
          ? t('sessions.prompts.boost_label_single')
          : t('sessions.prompts.boost_label_multi', {
              count: missingIds.length,
            });
      const entered = await new Promise<string | null>((resolve) => {
        setPromptConfig({
          title: t('sessions.prompts.boost_requires_comment_prompt', { label }),
          initialValue: '',
          onConfirm: (val) => resolve(val),
          onCancel: () => resolve(null),
        });
      });
      const normalized = entered?.trim() ?? '';

      if (!normalized) {
        showError(t('sessions.prompts.boost_comment_required'));
        return false;
      }

      try {
        await updateSessionComments(missingIds, normalized);
        const missingSet = new Set(missingIds);
        setSessions((prev) => {
          const next = prev.map((s) =>
            missingSet.has(s.id) ? { ...s, comment: normalized } : s,
          );
          sessionsRef.current = next;
          return next;
        });
        return true;
      } catch (err) {
        logTauriError('save required boost comment', err);
        showError(
          t('sessions.prompts.boost_comment_save_failed', {
            error: String(err),
          }),
        );
        return false;
      }
    },
    [mergedSessions, sessionsRef, setPromptConfig, setSessions, showError, t, updateSessionComments],
  );

  const handleAcceptSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessions(
          session.id,
          session.suggested_project_id ?? null,
          'ai_suggestion_accept',
        );
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
      } catch (err) {
        logTauriError('accept AI suggestion', err);
      }
    },
    [assignSessions, setDismissedSuggestions],
  );

  const handleRejectSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessions(session.id, null, 'ai_suggestion_reject');
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.add(session.id);
          return next;
        });
        setSessions((prev) => {
          const next = prev.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  suggested_project_id: undefined,
                  suggested_project_name: undefined,
                  suggested_confidence: undefined,
                }
              : item,
          );
          sessionsRef.current = next;
          return next;
        });
      } catch (err) {
        logTauriError('reject AI suggestion', err);
      }
    },
    [assignSessions, sessionsRef, setDismissedSuggestions, setSessions],
  );

  return {
    ensureCommentForBoost,
    handleAcceptSuggestion,
    handleRejectSuggestion,
  };
}
