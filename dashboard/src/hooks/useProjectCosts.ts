import { useCallback, useEffect, useState } from 'react';

import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { parseAmountInput } from '@/lib/costs-utils';
import { logger } from '@/lib/logger';
import {
  costsCreate,
  costsDelete,
  costsList,
  costsUpdate,
  type ProjectCost,
} from '@/lib/tauri/costs';

export interface CostDialogValues {
  costDate: string;
  amount: string;
  comment: string;
}

const EMPTY_VALUES: CostDialogValues = { costDate: '', amount: '', comment: '' };

/**
 * Stan i akcje kosztów dodatkowych jednej karty projektu.
 *
 * Wydzielone z `useProjectPageController` (już 675 linii) — koszty są samodzielnym
 * kawałkiem stanu bez zależności od sesji czy timeline'u, więc trzymają się osobno.
 * Karta projektu nie ma pickera okresu, dlatego lista jest za cały czas.
 */
export function useProjectCosts(projectName: string | undefined) {
  const [costs, setCosts] = useState<ProjectCost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectCost | null>(null);
  const [values, setValues] = useState<CostDialogValues>(EMPTY_VALUES);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!projectName) {
      setCosts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setCosts(await costsList(projectName, ALL_TIME_DATE_RANGE));
    } catch (e) {
      logger.error('[costs] load failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    // `reload` jest używany zarówno przy montowaniu, jak i po każdej mutacji
    // (create/update/delete), więc nie da się go rozdzielić bez duplikowania
    // logiki ładowania. Ten sam wzorzec co PmTemplateManager i PmSettingsCard.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam callback reużyty w handlerach mutacji
    void reload();
  }, [reload]);

  const openCreate = useCallback((defaultDate: string) => {
    setEditing(null);
    setValues({ ...EMPTY_VALUES, costDate: defaultDate });
    setDialogError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((cost: ProjectCost) => {
    setEditing(cost);
    setValues({
      costDate: cost.cost_date,
      amount: String(cost.amount),
      comment: cost.comment ?? '',
    });
    setDialogError(null);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditing(null);
    setDialogError(null);
  }, []);

  const parsedAmount = parseAmountInput(values.amount);

  const submit = useCallback(async () => {
    if (!projectName || parsedAmount === null) return;
    setSaving(true);
    setDialogError(null);
    const comment = values.comment.trim() || null;
    try {
      if (editing) {
        await costsUpdate(editing.uid, values.costDate, parsedAmount, comment);
      } else {
        await costsCreate(projectName, values.costDate, parsedAmount, comment);
      }
      closeDialog();
      await reload();
    } catch (e) {
      logger.error('[costs] save failed:', e);
      setDialogError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [projectName, parsedAmount, values, editing, closeDialog, reload]);

  const remove = useCallback(
    async (cost: ProjectCost) => {
      try {
        await costsDelete(cost.uid);
        await reload();
      } catch (e) {
        logger.error('[costs] delete failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reload],
  );

  return {
    costs,
    loading,
    error,
    dialogOpen,
    editing,
    values,
    setValues,
    dialogError,
    saving,
    parsedAmount,
    openCreate,
    openEdit,
    closeDialog,
    submit,
    remove,
    reload,
  };
}

export type ProjectCostsController = ReturnType<typeof useProjectCosts>;
