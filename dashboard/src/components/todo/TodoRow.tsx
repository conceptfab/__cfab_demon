import { Check, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Todo } from '@/lib/tauri/todos';

interface TodoRowProps {
  todo: Todo;
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

export function TodoRow({ todo, onToggle, onEdit, onDelete }: TodoRowProps) {
  const { t } = useTranslation();
  const done = todo.status === 'done';
  const scopeLabel =
    todo.scope === 'project'
      ? todo.project_name
      : todo.scope === 'client'
        ? todo.client_name
        : t('todo.scope_global');

  return (
    <li className="flex items-start gap-3 border-t py-2 first:border-t-0">
      <Button
        size="sm"
        variant="ghost"
        className="mt-0.5 shrink-0"
        onClick={() => onToggle(todo)}
        aria-label={done ? t('todo.mark_open') : t('todo.mark_done')}
      >
        {done ? (
          <RotateCcw className="h-4 w-4" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <p
          className={cn('text-sm', done && 'text-muted-foreground line-through')}
        >
          {todo.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {scopeLabel ? <Badge variant="secondary">{scopeLabel}</Badge> : null}
          {todo.priority === 2 ? (
            <Badge variant="destructive">{t('todo.priority_high')}</Badge>
          ) : null}
          {todo.due_date ? (
            <span className="tabular-nums">
              {todo.due_date}
              {todo.due_time ? ` ${todo.due_time}` : ''}
            </span>
          ) : null}
        </div>
        {todo.notes ? (
          <p className="mt-1 text-xs text-muted-foreground">{todo.notes}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEdit(todo)}
          aria-label={t('todo.edit')}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(todo)}
          aria-label={t('todo.delete')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}
