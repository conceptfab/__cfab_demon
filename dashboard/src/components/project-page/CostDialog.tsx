import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProjectCostsController } from '@/hooks/useProjectCosts';

interface CostDialogProps {
  controller: ProjectCostsController;
}

export function CostDialog({ controller }: CostDialogProps) {
  const { t } = useTranslation();
  const {
    dialogOpen,
    editing,
    values,
    setValues,
    dialogError,
    saving,
    parsedAmount,
    closeDialog,
    submit,
  } = controller;

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(values.costDate);
  const canSubmit = parsedAmount !== null && dateValid && !saving;

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('costs.edit') : t('costs.add')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('costs.field_date')}
            </span>
            <input
              type="date"
              value={values.costDate}
              onChange={(e) =>
                setValues({ ...values, costDate: e.target.value })
              }
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
            {!dateValid && values.costDate ? (
              <span className="text-xs text-destructive">
                {t('costs.invalid_date')}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('costs.field_amount')}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={values.amount}
              onChange={(e) => setValues({ ...values, amount: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
            {parsedAmount === null && values.amount ? (
              <span className="text-xs text-destructive">
                {t('costs.invalid_amount')}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('costs.field_comment')}
            </span>
            <textarea
              rows={3}
              value={values.comment}
              onChange={(e) => setValues({ ...values, comment: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          {dialogError ? (
            <p className="text-sm text-destructive">{dialogError}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeDialog}>
            {t('ui.buttons.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {t('ui.buttons.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
