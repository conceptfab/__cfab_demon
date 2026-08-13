import { CheckCircle2, Circle, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HIGH_PRIORITY_BADGE, isHighPriority } from '@/lib/todo-priority';
import type { Todo } from '@/lib/tauri/todos';

interface TodoRowProps {
  todo: Todo;
  /** Odhaczone przed chwilą — wiersz świeci na zielono w oknie „Cofnij". */
  justCompleted?: boolean;
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

export function TodoRow({
  todo,
  justCompleted = false,
  onToggle,
  onEdit,
  onDelete,
}: TodoRowProps) {
  const { t } = useTranslation();
  const done = todo.status === 'done';
  const scopeLabel =
    todo.scope === 'project'
      ? todo.project_name
      : todo.scope === 'client'
        ? todo.client_name
        : t('todo.scope_global');

  return (
    <li
      className={cn(
        'flex items-start gap-3 border-t py-2 first:border-t-0 transition-[opacity,background-color] duration-500',
        justCompleted && 'rounded-md bg-emerald-500/10',
        // Zakończone: CAŁE zadanie półprzezroczyste — wszystkie jego elementy.
        // Do zrobienia: 100% krycia. Wyjątkiem jest okno „Cofnij", gdzie
        // zadanie musi jeszcze przez chwilę być w pełni widoczne.
        done && !justCompleted && 'opacity-50',
      )}
    >
      <Button
        size="sm"
        variant="ghost"
        className={cn(
          // Kolor rozróżnia stan także przy przygaszonym wierszu:
          // zielony ptaszek vs szare kółko.
          'mt-0.5 shrink-0 transition-colors',
          done ? 'text-emerald-400' : 'text-muted-foreground/70',
        )}
        onClick={() => onToggle(todo)}
        aria-label={done ? t('todo.mark_open') : t('todo.mark_done')}
      >
        {/* Semantyka checkboxa: puste kółko = do zrobienia, ptaszek = zrobione.
            Ptaszek na zadaniu otwartym czytał się jak „już ukończone". */}
        {done ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        {/* Bez przekreślenia — przekreślony tekst przestaje być czytelny.
            Za „zakończone" odpowiada ptaszek i krycie całego wiersza. */}
        <p className="text-sm">{todo.title}</p>
        {justCompleted && (
          <p className="mt-0.5 text-[11px] font-medium text-emerald-500">
            {t('todo.completed_badge')}
          </p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {scopeLabel ? <Badge variant="secondary">{scopeLabel}</Badge> : null}
          {/* `destructive` znaczy w tym UI „błąd" — wysoki priorytet dostaje
              własny, bursztynowy akcent, ten sam co pasek w kalendarzu. */}
          {isHighPriority(todo.priority) ? (
            <Badge variant="outline" className={HIGH_PRIORITY_BADGE}>
              {t('todo.priority_high')}
            </Badge>
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
