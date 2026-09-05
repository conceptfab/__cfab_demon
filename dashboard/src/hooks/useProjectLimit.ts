import { useCallback, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
import {
  applyProjectLimitBoost,
  getProjectLimitStatus,
  updateProjectLimit,
  type ProjectLimitStatus,
} from '@/lib/tauri/project-limits';

export interface LimitFormValues {
  /** Puste = limit wyłączony. */
  limitHours: string;
  cycleStartDay: string;
  multiplier: string;
  commentTemplate: string;
}

const EMPTY_FORM: LimitFormValues = {
  limitHours: '',
  cycleStartDay: '1',
  multiplier: '1.5',
  commentTemplate: '',
};

function parseNumber(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Stan limitu godzin jednej karty projektu: odczyt na bieżąco, edycja ustawień
 * i zatwierdzanie boostu sesji ponad limitem.
 *
 * Trzymane osobno od `useProjectPageController` (już ~680 linii) — limit nie zależy
 * od timeline'u ani listy sesji, więc nie ma powodu, żeby dzielił z nimi stan.
 */
export function useProjectLimit(projectId: number | undefined) {
  const [status, setStatus] = useState<ProjectLimitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LimitFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [boostDialogOpen, setBoostDialogOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await getProjectLimitStatus(projectId));
    } catch (e) {
      logger.error('[project-limit] load failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Ten sam callback obsługuje montowanie i przeładowanie po każdej mutacji
    // (zapis ustawień, boost) — rozdzielenie ich zduplikowałoby logikę ładowania.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam callback reużyty w handlerach mutacji
    void reload();
  }, [reload]);

  const openEditor = useCallback(() => {
    setForm(
      status
        ? {
            limitHours: String(status.limit_hours),
            cycleStartDay: String(status.cycle_start_day),
            multiplier: String(status.over_limit_multiplier),
            commentTemplate: status.over_limit_comment ?? '',
          }
        : EMPTY_FORM,
    );
    setError(null);
    setEditing(true);
  }, [status]);

  const closeEditor = useCallback(() => setEditing(false), []);

  const formError = useMemo(() => {
    const limit = parseNumber(form.limitHours);
    if (form.limitHours.trim() && (limit === null || limit <= 0)) {
      return 'invalid_limit';
    }
    const day = parseNumber(form.cycleStartDay);
    if (day === null || !Number.isInteger(day) || day < 1 || day > 28) {
      return 'invalid_day';
    }
    const multiplier = parseNumber(form.multiplier);
    if (multiplier === null || multiplier < 1 || multiplier > 10) {
      return 'invalid_multiplier';
    }
    return null;
  }, [form]);

  const save = useCallback(async () => {
    if (!projectId || formError) return;
    setSaving(true);
    setError(null);
    try {
      await updateProjectLimit(
        projectId,
        parseNumber(form.limitHours),
        parseNumber(form.cycleStartDay),
        parseNumber(form.multiplier),
        form.commentTemplate.trim() || null,
      );
      setEditing(false);
      await reload();
    } catch (e) {
      logger.error('[project-limit] save failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [projectId, form, formError, reload]);

  /**
   * `fallbackComment` jest używany tylko wtedy, gdy projekt nie ma własnego szablonu —
   * backend odrzuca boost bez komentarza, więc UI musi mieć czym go wypełnić.
   */
  const applyBoost = useCallback(
    async (sessionIds: number[], fallbackComment: string) => {
      if (!projectId || sessionIds.length === 0) return;
      setApplying(true);
      setError(null);
      try {
        await applyProjectLimitBoost(projectId, sessionIds, fallbackComment);
        setBoostDialogOpen(false);
        await reload();
      } catch (e) {
        logger.error('[project-limit] boost failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setApplying(false);
      }
    },
    [projectId, reload],
  );

  return {
    status,
    loading,
    error,
    editing,
    form,
    setForm,
    formError,
    saving,
    openEditor,
    closeEditor,
    save,
    reload,
    boostDialogOpen,
    setBoostDialogOpen,
    applying,
    applyBoost,
  };
}

export type ProjectLimitController = ReturnType<typeof useProjectLimit>;
