import { endOfWeek, isAfter, isBefore, isSameDay, parseISO, startOfDay } from 'date-fns';

import type { Todo } from '@/lib/tauri/todos';

export type TodoGroupKey =
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'later'
  | 'no_date';

/** Kolejność wyświetlania grup — najpilniejsze u góry, bezterminowe na końcu. */
export const TODO_GROUP_ORDER: readonly TodoGroupKey[] = [
  'overdue',
  'today',
  'this_week',
  'later',
  'no_date',
] as const;

export type TodoGroups = Record<TodoGroupKey, Todo[]>;

function emptyGroups(): TodoGroups {
  return { overdue: [], today: [], this_week: [], later: [], no_date: [] };
}

function classify(dueDate: string | null, today: Date): TodoGroupKey {
  if (!dueDate) return 'no_date';
  const due = startOfDay(parseISO(dueDate));
  const todayStart = startOfDay(today);
  if (isSameDay(due, todayStart)) return 'today';
  if (isBefore(due, todayStart)) return 'overdue';
  // weekStartsOn: 1 — tydzień PL zaczyna się w poniedziałek, więc „ten tydzień"
  // kończy się w najbliższą niedzielę.
  const weekEnd = endOfWeek(todayStart, { weekStartsOn: 1 });
  return isAfter(due, weekEnd) ? 'later' : 'this_week';
}

/**
 * Dzieli zadania na grupy terminowe i sortuje wewnątrz każdej.
 *
 * Kolejność sortowania: najpierw TERMIN rosnąco, potem priorytet malejąco, dalej
 * `sort_order` (ręczna kolejność), na końcu `uid` jako deterministyczny
 * tie-breaker. Termin jest pierwszy, bo grupy „Zaległe", „Ten tydzień" i „Później"
 * obejmują wiele dni — w nich chronologia jest tym, czego użytkownik szuka.
 * Priorytet rozstrzyga dopiero w obrębie jednego dnia (i całą grupę „Dziś").
 *
 * Ta sama kolejność co `ORDER BY` w `list_todos` po stronie Rusta.
 */
export function groupTodosByDue(
  todos: readonly Todo[],
  today: Date = new Date(),
): TodoGroups {
  const groups = emptyGroups();
  for (const todo of todos) {
    groups[classify(todo.due_date, today)].push(todo);
  }
  for (const key of TODO_GROUP_ORDER) {
    groups[key].sort(
      (a, b) =>
        // Format YYYY-MM-DD sortuje się leksykograficznie tak samo jak chronologicznie.
        (a.due_date ?? '').localeCompare(b.due_date ?? '') ||
        b.priority - a.priority ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        a.uid.localeCompare(b.uid),
    );
  }
  return groups;
}
