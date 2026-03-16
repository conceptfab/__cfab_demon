import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { logTauriError } from '@/lib/utils';
import { requiresCommentForMultiplierBoost } from '@/lib/session-utils';
import { parsePositiveRateMultiplierInput } from '@/lib/rate-utils';
import { useToast } from '@/components/ui/toast-notification';
import type { SessionWithApp } from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';

interface ContextMenu {
  x: number;
  y: number;
  session: SessionWithApp;
}

interface UseSessionContextMenuActionsOptions {
  ctxMenu: ContextMenu | null;
  setCtxMenu: (menu: ContextMenu | null) => void;
  setPromptConfig: (config: PromptConfig | null) => void;
  setMultiSplitSession: (session: SessionWithApp | null) => void;
  assignSessions: (
    sessionId: number,
    projectId: number | null,
    source?: string,
  ) => Promise<void>;
  updateSessionRateMultipliers: (
    sessionId: number,
    multiplier: number | null,
  ) => Promise<void>;
  updateOneSessionComment: (
    sessionId: number,
    comment: string | null,
  ) => Promise<void>;
  setSessions: (fn: (prev: SessionWithApp[]) => SessionWithApp[]) => void;
  sessionsRef: React.MutableRefObject<SessionWithApp[]>;
  isSessionSplittable: (session: SessionWithApp) => boolean;
  ensureCommentForBoost: (sessionIds: number[]) => Promise<boolean>;
}

export function useSessionContextMenuActions({
  ctxMenu,
  setCtxMenu,
  setPromptConfig,
  setMultiSplitSession,
  assignSessions,
  updateSessionRateMultipliers,
  updateOneSessionComment,
  setSessions,
  sessionsRef,
  isSessionSplittable,
  ensureCommentForBoost,
}: UseSessionContextMenuActionsOptions) {
  const { t } = useTranslation();
  const { showError } = useToast();

  const handleAssign = useCallback(
    async (projectId: number | null, source?: string) => {
      if (!ctxMenu) return;
      try {
        await assignSessions(ctxMenu.session.id, projectId, source);
      } catch (err) {
        logTauriError('assign session to project', err);
      }
      setCtxMenu(null);
    },
    [assignSessions, ctxMenu, setCtxMenu],
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (!ctxMenu) return;
      const sessionId = ctxMenu.session.id;
      try {
        if (requiresCommentForMultiplierBoost(multiplier)) {
          const ok = await ensureCommentForBoost([sessionId]);
          if (!ok) return;
        }
        await updateSessionRateMultipliers(sessionId, multiplier);
        setCtxMenu(null);
      } catch (err) {
        logTauriError('update session rate multiplier', err);
        showError(
          t('sessions.errors.update_multiplier', { error: String(err) }),
        );
      }
    },
    [
      ctxMenu,
      ensureCommentForBoost,
      showError,
      t,
      updateSessionRateMultipliers,
      setCtxMenu,
    ],
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu) return;
    const current =
      typeof ctxMenu.session.rate_multiplier === 'number'
        ? ctxMenu.session.rate_multiplier
        : 1;
    const suggested = current > 1 ? current : 2;

    setPromptConfig({
      title: t('sessions.prompts.multiplier_title'),
      description: t('sessions.prompts.multiplier_desc'),
      initialValue: String(suggested),
      onConfirm: async (raw) => {
        const parsed = parsePositiveRateMultiplierInput(raw);
        if (parsed == null) {
          showError(t('sessions.prompts.multiplier_positive'));
          return;
        }
        await handleSetRateMultiplier(parsed);
      },
    });
    setCtxMenu(null);
  }, [
    ctxMenu,
    handleSetRateMultiplier,
    showError,
    t,
    setPromptConfig,
    setCtxMenu,
  ]);

  const handleEditComment = useCallback(async () => {
    if (!ctxMenu) return;
    const current = ctxMenu.session.comment ?? '';
    const sessionId = ctxMenu.session.id;

    setPromptConfig({
      title: t('sessions.prompts.session_comment_title'),
      description: t('sessions.prompts.session_comment_desc'),
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await updateOneSessionComment(sessionId, trimmed || null);
          setSessions((prev) => {
            const next = prev.map((s) =>
              s.id === sessionId ? { ...s, comment: trimmed || null } : s,
            );
            sessionsRef.current = next;
            return next;
          });
        } catch (err) {
          logTauriError('update session comment', err);
        }
      },
    });
    setCtxMenu(null);
  }, [ctxMenu, sessionsRef, setCtxMenu, setPromptConfig, setSessions, t, updateOneSessionComment]);

  const openMultiSplitModal = useCallback(
    (session: SessionWithApp) => {
      if (!isSessionSplittable(session)) return;
      setCtxMenu(null);
      setMultiSplitSession(session);
    },
    [isSessionSplittable, setCtxMenu, setMultiSplitSession],
  );

  return {
    handleAssign,
    handleSetRateMultiplier,
    handleCustomRateMultiplier,
    handleEditComment,
    openMultiSplitModal,
  };
}
