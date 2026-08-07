import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { groupTodosByDue } from '@/lib/todo-grouping';
import { logger } from '@/lib/logger';
import { todosList, type Todo } from '@/lib/tauri/todos';

/**
 * Zadania wymagające uwagi: zaległe + dziś + ten tydzień, bez zrobionych.
 * Świadomie NIE pokazuje grupy „Później" ani „Bez terminu" — widżet ma
 * odpowiadać na pytanie „co mnie goni", nie zastępować pełnego ekranu.
 */
export function UpcomingTodosCard() {
  const { t } = useTranslation();
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void (async () => {
      try {
        setTodos(await todosList());
      } catch (e) {
        logger.error('[todos] dashboard widget load failed:', e);
      }
    })();
  }, []);

  const urgent = useMemo(() => {
    const open = todos.filter((todo) => todo.status === 'open');
    const groups = groupTodosByDue(open);
    return [...groups.overdue, ...groups.today, ...groups.this_week];
  }, [todos]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('todo.upcoming_title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {urgent.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('todo.upcoming_empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {urgent.slice(0, 8).map((todo) => (
              <li
                key={todo.uid}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate">{todo.title}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {todo.due_date}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
