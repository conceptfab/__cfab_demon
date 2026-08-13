import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildTodayDate } from '@/lib/date-helpers';
import { logger } from '@/lib/logger';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { shouldRefreshTodos } from '@/lib/page-refresh-reasons';
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

  const load = useCallback(async () => {
    try {
      setTodos(await todosList());
    } catch (e) {
      logger.error('[todos] upcoming-by-project load failed:', e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam loader reużywa listener odświeżania
    void load();
  }, [load]);

  // Zadania dochodzą też z merge demona (sync), nie tylko z ekranu Zadań.
  usePageRefreshListener((reasons) => {
    if (!reasons.some(shouldRefreshTodos)) return;
    void load();
  });

  return useMemo(() => {
    const today = buildTodayDate();
    const map = new Map<string, number>();
    for (const todo of todos) {
      if (todo.status !== 'open') continue;
      if (todo.scope !== 'project' || !todo.project_name) continue;
      if (!todo.due_date) continue;
      // O „minęło" decyduje KONIEC zakresu: zadanie od–do trwające dziś nie
      // jest zaległe tylko dlatego, że zaczęło się wczoraj.
      const end =
        todo.end_date && todo.end_date > todo.due_date
          ? todo.end_date
          : todo.due_date;
      if (end < today) continue;
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

  const load = useCallback(async () => {
    try {
      const todos = await todosList();
      setCount(todos.filter((todo) => todo.status === 'open').length);
    } catch (e) {
      logger.error('[todos] sidebar count load failed:', e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam loader reużywa listener odświeżania
    void load();
  }, [load]);

  usePageRefreshListener((reasons) => {
    if (!reasons.some(shouldRefreshTodos)) return;
    void load();
  });

  return count;
}
