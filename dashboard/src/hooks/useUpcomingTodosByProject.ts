import { useEffect, useMemo, useState } from 'react';

import { buildTodayDate } from '@/lib/date-helpers';
import { logger } from '@/lib/logger';
import { todosList, type Todo } from '@/lib/tauri/todos';

/**
 * Mapa NAZWA PROJEKTU → liczba otwartych zadań z terminem dziś lub w przyszłości.
 *
 * Zaległe są celowo pominięte: znacznik na Dashboardzie ma odpowiadać na pytanie
 * „co mnie czeka w tym projekcie", a nie dublować listy zaległości. Klucz to nazwa,
 * bo tak właśnie zadania linkują się do projektu (`id` jest lokalne per maszyna).
 */
export function useUpcomingTodosByProject(): Map<string, number> {
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void (async () => {
      try {
        setTodos(await todosList());
      } catch (e) {
        logger.error('[todos] upcoming-by-project load failed:', e);
      }
    })();
  }, []);

  return useMemo(() => {
    const today = buildTodayDate();
    const map = new Map<string, number>();
    for (const todo of todos) {
      if (todo.status !== 'open') continue;
      if (todo.scope !== 'project' || !todo.project_name) continue;
      if (!todo.due_date || todo.due_date < today) continue;
      map.set(todo.project_name, (map.get(todo.project_name) ?? 0) + 1);
    }
    return map;
  }, [todos]);
}

/**
 * Liczba OTWARTYCH zadań — do plakietki w nawigacji. Bez filtra terminu:
 * plakietka ma mówić „tyle masz do zrobienia", a nie „tyle na dziś".
 */
export function useUpcomingTodosCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void (async () => {
      try {
        const todos = await todosList();
        setCount(todos.filter((todo) => todo.status === 'open').length);
      } catch (e) {
        logger.error('[todos] sidebar count load failed:', e);
      }
    })();
  }, []);

  return count;
}
