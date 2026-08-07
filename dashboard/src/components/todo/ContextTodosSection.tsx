import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUIStore } from '@/store/ui-store';
import { logger } from '@/lib/logger';
import { todosList, type Todo, type TodoScope } from '@/lib/tauri/todos';

interface ContextTodosSectionProps {
  scope: Extract<TodoScope, 'project' | 'client'>;
  /** Nazwa projektu albo klienta — link idzie po NAZWIE, nie po id. */
  name: string;
  titleKey: string;
}

/**
 * Zadania przypięte do konkretnego projektu albo klienta, pokazywane na jego
 * karcie. Klik przenosi na ekran Zadania — formularz edycji żyje tam, żeby nie
 * dublować jego logiki w trzech miejscach.
 */
export function ContextTodosSection({
  scope,
  name,
  titleKey,
}: ContextTodosSectionProps) {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void (async () => {
      try {
        setTodos(await todosList());
      } catch (e) {
        logger.error('[todos] context section load failed:', e);
      }
    })();
  }, []);

  const mine = useMemo(
    () =>
      todos.filter(
        (todo) =>
          todo.status === 'open' &&
          todo.scope === scope &&
          (scope === 'project' ? todo.project_name : todo.client_name) === name,
      ),
    [todos, scope, name],
  );

  if (mine.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t(titleKey)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {mine.map((todo) => (
            <li key={todo.uid}>
              <button
                type="button"
                onClick={() => setCurrentPage('todo')}
                aria-label={`${t('todo.edit')}: ${todo.title}`}
                className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="min-w-0 truncate">{todo.title}</span>
                {todo.due_date ? (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {todo.due_date}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
