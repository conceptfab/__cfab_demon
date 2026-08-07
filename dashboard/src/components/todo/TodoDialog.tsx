import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TodoEntityPicker, type PickerOption } from '@/components/todo/TodoEntityPicker';
import { cn } from '@/lib/utils';
import type { TodoPageController } from '@/hooks/useTodoPageController';
import type { TodoScope } from '@/lib/tauri/todos';

const SCOPES: { id: TodoScope; labelKey: string }[] = [
  { id: 'global', labelKey: 'todo.scope_global' },
  { id: 'client', labelKey: 'todo.field_client' },
  { id: 'project', labelKey: 'todo.field_project' },
];

const PRIORITIES = [
  { value: 0, labelKey: 'todo.priority_low' },
  { value: 1, labelKey: 'todo.priority_normal' },
  { value: 2, labelKey: 'todo.priority_high' },
];

/** Przełącznik segmentowy w stylu menu sesji (`SessionContextMenu`). */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
      {options.map((option) => (
        <button
          type="button"
          key={String(option.id)}
          onClick={() => onChange(option.id)}
          className={cn(
            'cursor-pointer rounded-sm px-2.5 py-1 text-xs transition-colors',
            value === option.id
              ? 'bg-background text-sky-200 shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface TodoDialogProps {
  controller: TodoPageController;
  /** Projekty do wyboru przy zakresie „projekt" (nazwa + kolor). */
  projectOptions: PickerOption[];
  /** Klienci do wyboru przy zakresie „klient" (nazwa + kolor). */
  clientOptions: PickerOption[];
}

export function TodoDialog({
  controller,
  projectOptions,
  clientOptions,
}: TodoDialogProps) {
  const { t } = useTranslation();
  const {
    dialogOpen,
    editing,
    form,
    setForm,
    dialogError,
    saving,
    closeDialog,
    submit,
  } = controller;

  const setScope = (scope: TodoScope) => {
    // Zmiana zakresu czyści link nieużywany w nowym zakresie — inaczej rekord
    // wpadłby do backendu z polem sprzecznym z `scope` i został odrzucony.
    setForm({
      ...form,
      scope,
      projectName: scope === 'project' ? form.projectName : null,
      clientName: scope === 'client' ? form.clientName : null,
    });
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('todo.edit') : t('todo.add')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_title')}
            </span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_scope')}
            </span>
            <Segmented
              value={form.scope}
              options={SCOPES.map((sc) => ({ id: sc.id, label: t(sc.labelKey) }))}
              onChange={setScope}
            />
          </label>

          {form.scope === 'project' && (
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_project')}
              </span>
              <TodoEntityPicker
                options={projectOptions}
                value={form.projectName ?? null}
                onChange={(name) => setForm({ ...form, projectName: name })}
                emptyLabel={t('ui.common.unassigned')}
                emptyText={t('sessions.menu.no_projects')}
              />
            </label>
          )}

          {form.scope === 'client' && (
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_client')}
              </span>
              <TodoEntityPicker
                options={clientOptions}
                value={form.clientName ?? null}
                onChange={(name) => setForm({ ...form, clientName: name })}
                emptyLabel={t('ui.common.unassigned')}
                emptyText={t('sessions.menu.no_projects')}
              />
            </label>
          )}

          <div className="flex gap-2">
            <label className="block flex-1 space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_due_date')}
              </span>
              <input
                type="date"
                value={form.dueDate ?? ''}
                onChange={(e) =>
                  setForm({ ...form, dueDate: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block w-28 space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_due_time')}
              </span>
              <input
                type="time"
                value={form.dueTime ?? ''}
                onChange={(e) =>
                  setForm({ ...form, dueTime: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_priority')}
            </span>
            <Segmented
              value={form.priority}
              options={PRIORITIES.map((pr) => ({
                id: pr.value,
                label: t(pr.labelKey),
              }))}
              onChange={(priority) => setForm({ ...form, priority })}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_notes')}
            </span>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) =>
                setForm({ ...form, notes: e.target.value || null })
              }
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
          <Button
            onClick={() => void submit()}
            disabled={saving || !form.title.trim()}
          >
            {t('ui.buttons.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
