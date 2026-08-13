import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TodoRow } from '@/components/todo/TodoRow';
import {
  TODO_GROUP_ORDER,
  type TodoGroupKey,
  type TodoGroups,
} from '@/lib/todo-grouping';
import type { Todo } from '@/lib/tauri/todos';

const GROUP_LABEL_KEY: Record<TodoGroupKey, string> = {
  overdue: 'todo.group_overdue',
  today: 'todo.group_today',
  this_week: 'todo.group_this_week',
  later: 'todo.group_later',
  no_date: 'todo.group_no_date',
};

interface TodoGroupListProps {
  groups: TodoGroups;
  hasAnyTodo: boolean;
  loading: boolean;
  error: string | null;
  /** UID-y odhaczone w oknie „Cofnij" — patrz `useTodoPageController`. */
  recentlyDone: ReadonlySet<string>;
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

export function TodoGroupList({
  groups,
  hasAnyTodo,
  loading,
  error,
  recentlyDone,
  onToggle,
  onEdit,
  onDelete,
}: TodoGroupListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="py-6 text-sm text-muted-foreground">{t('todo.loading')}</p>
    );
  }
  if (error) {
    return <p className="py-6 text-sm text-destructive">{error}</p>;
  }

  const visible = TODO_GROUP_ORDER.filter((key) => groups[key].length > 0);
  if (visible.length === 0) {
    // Rozróżniamy „nie masz zadań" od „filtry nic nie zwróciły" — inaczej
    // użytkownik z aktywnym filtrem myśli, że stracił dane.
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {hasAnyTodo ? t('todo.empty_filtered') : t('todo.empty')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((key) => (
        <Card key={key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {`${t(GROUP_LABEL_KEY[key])} (${groups[key].length})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {groups[key].map((todo) => (
                <TodoRow
                  key={todo.uid}
                  todo={todo}
                  justCompleted={recentlyDone.has(todo.uid)}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
