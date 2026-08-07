import {
  addDays,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getWeek,
  isAfter,
  isBefore,
  startOfMonth,
} from 'date-fns';
import type { Locale } from 'date-fns';

import type { Todo } from '@/lib/tauri/todos';

/**
 * Dzień siatki kalendarza zadań. Kształt celowo lustrzany do `CalendarDay`
 * z `components/time-analysis/types.ts` — kalendarz zadań ma wyglądać i działać
 * identycznie jak „Miesięczna mapa kalendarza" w Analizie czasu, tylko z zadaniami
 * zamiast czasu pracy.
 */
export interface TodoCalendarDay {
  /** YYYY-MM-DD */
  date: string;
  inMonth: boolean;
  isToday: boolean;
  todos: Todo[];
}

export interface TodoCalendarWeek {
  /** np. „W31" */
  label: string;
  /** np. „sie 3" */
  subLabel: string;
  days: TodoCalendarDay[];
}

/**
 * Buduje pełne tygodnie (pon–niedz) dla miesiąca zawierającego `anchor`.
 * Etykiety tygodni liczone tak samo jak w `useTimeAnalysisData`, żeby numeracja
 * zgadzała się między oboma ekranami.
 */
export function buildTodoMonthCalendar(
  anchor: Date,
  todos: readonly Todo[],
  locale: Locale,
  today: Date = new Date(),
): TodoCalendarWeek[] {
  const mStart = startOfMonth(anchor);
  const mEnd = endOfMonth(anchor);
  const byDate = groupByDueDate(todos);
  const todayKey = format(today, 'yyyy-MM-dd');

  const weekStarts = eachWeekOfInterval(
    { start: mStart, end: mEnd },
    { weekStartsOn: 1 },
  );

  return weekStarts.map((ws) => {
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const days: TodoCalendarDay[] = [];
    for (let d = ws; !isAfter(d, we); d = addDays(d, 1)) {
      const key = format(d, 'yyyy-MM-dd');
      days.push({
        date: key,
        inMonth: !isBefore(d, mStart) && !isAfter(d, mEnd),
        isToday: key === todayKey,
        todos: byDate.get(key) ?? [],
      });
    }
    return {
      label: `W${getWeek(ws, { weekStartsOn: 1 })}`,
      subLabel: format(ws, 'MMM d', { locale }),
      days,
    };
  });
}

/** Pojedynczy tydzień zawierający `anchor` — wszystkie dni traktowane jako „w zakresie". */
export function buildTodoWeekCalendar(
  anchor: Date,
  todos: readonly Todo[],
  locale: Locale,
  today: Date = new Date(),
): TodoCalendarWeek[] {
  const ws = addDays(anchor, -((anchor.getDay() + 6) % 7));
  const we = endOfWeek(ws, { weekStartsOn: 1 });
  const byDate = groupByDueDate(todos);
  const todayKey = format(today, 'yyyy-MM-dd');

  const days: TodoCalendarDay[] = [];
  for (let d = ws; !isAfter(d, we); d = addDays(d, 1)) {
    const key = format(d, 'yyyy-MM-dd');
    days.push({
      date: key,
      inMonth: true,
      isToday: key === todayKey,
      todos: byDate.get(key) ?? [],
    });
  }
  return [
    {
      label: `W${getWeek(ws, { weekStartsOn: 1 })}`,
      subLabel: format(ws, 'MMM d', { locale }),
      days,
    },
  ];
}

/** Zadania bez terminu nie mają miejsca w siatce — widok pokazuje je pod kalendarzem. */
export function undatedTodos(todos: readonly Todo[]): Todo[] {
  return todos.filter((todo) => !todo.due_date);
}

function groupByDueDate(todos: readonly Todo[]): Map<string, Todo[]> {
  const map = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (!todo.due_date) continue;
    const bucket = map.get(todo.due_date);
    if (bucket) bucket.push(todo);
    else map.set(todo.due_date, [todo]);
  }
  // W obrębie dnia: priorytet malejąco, potem godzina, na końcu uid (determinizm).
  for (const bucket of map.values()) {
    bucket.sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.due_time ?? '').localeCompare(b.due_time ?? '') ||
        a.uid.localeCompare(b.uid),
    );
  }
  return map;
}
