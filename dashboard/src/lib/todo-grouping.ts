import {
  addDays,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
} from 'date-fns';

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
    groups[key].sort(compareTodos);
  }
  return groups;
}

/** Wspólna kolejność dla grup i dla okna „najbliższe N dni". */
function compareTodos(a: Todo, b: Todo): number {
  return (
    // Format YYYY-MM-DD sortuje się leksykograficznie tak samo jak chronologicznie.
    (a.due_date ?? '').localeCompare(b.due_date ?? '') ||
    b.priority - a.priority ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.uid.localeCompare(b.uid)
  );
}

export interface TodoDayColumn {
  /** Format YYYY-MM-DD — ten sam co `Todo.due_date`. */
  date: string;
  isToday: boolean;
  todos: Todo[];
}

export interface UpcomingTodoWindow {
  /** Termin minął, zadanie wciąż otwarte — osobna kolumna przed dniami. */
  overdue: Todo[];
  /** Dokładnie `days` kolumn: dziś i kolejne dni, także te bez zadań. */
  columns: TodoDayColumn[];
  /** Dalsze terminy i zadania bez terminu — tylko do zliczenia. */
  rest: Todo[];
}

/**
 * Rozkłada zadania na kolumny dni: dziś + kolejne `days - 1` dni.
 *
 * Okno jest KROCZĄCE, nie kalendarzowe: w sobotę siedem kolumn sięga do piątku
 * następnego tygodnia. Grupa `this_week` z `groupTodosByDue` urywa się na
 * niedzieli, więc nie nadaje się tam, gdzie UI obiecuje „najbliższe N dni".
 *
 * Zadanie trafia do kolumny po `due_date` (zakresy od–do liczą się według dnia
 * początkowego). Puste dni zostają w wyniku — widżet ma pokazywać także to,
 * że w danym dniu nic nie ma.
 */
export function buildUpcomingTodoWindow(
  todos: readonly Todo[],
  days: number,
  today: Date = new Date(),
): UpcomingTodoWindow {
  const todayStart = startOfDay(today);
  const columns: TodoDayColumn[] = [];
  const byDate = new Map<string, Todo[]>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = format(addDays(todayStart, offset), 'yyyy-MM-dd');
    const bucket: Todo[] = [];
    byDate.set(date, bucket);
    columns.push({ date, isToday: offset === 0, todos: bucket });
  }

  const overdue: Todo[] = [];
  const rest: Todo[] = [];
  for (const todo of todos) {
    if (!todo.due_date) {
      rest.push(todo);
      continue;
    }
    const bucket = byDate.get(todo.due_date);
    if (bucket) {
      bucket.push(todo);
    } else if (isBefore(startOfDay(parseISO(todo.due_date)), todayStart)) {
      overdue.push(todo);
    } else {
      rest.push(todo);
    }
  }

  overdue.sort(compareTodos);
  for (const column of columns) {
    column.todos.sort(compareTodos);
  }
  return { overdue, columns, rest };
}
