import { pl } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import {
  buildTodoDayCalendar,
  buildTodoMonthCalendar,
  buildTodoWeekCalendar,
  undatedTodos,
} from '@/lib/todo-calendar';
import type { Todo } from '@/lib/tauri/todos';

function todo(uid: string, dueDate: string | null, priority = 1): Todo {
  return {
    uid,
    scope: 'global',
    project_name: null,
    client_name: null,
    title: uid,
    notes: null,
    due_date: dueDate,
    end_date: null,
    due_time: null,
    priority,
    status: 'open',
    completed_at: null,
    sort_order: 1000,
    created_at: null,
    updated_at: '2026-08-01 10:00:00',
  };
}

// Sobota 8 sierpnia 2026. Tydzień PL: pon 3 sie – niedz 9 sie.
const TODAY = new Date('2026-08-08T12:00:00');

describe('buildTodoWeekCalendar', () => {
  it('renders the week CONTAINING the anchor, Monday through Sunday', () => {
    const week = buildTodoWeekCalendar(TODAY, [], pl, TODAY)[0]!;
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.date).toBe('2026-08-03');
    expect(week.days[6]!.date).toBe('2026-08-09');
  });

  it('places a task in its own day cell', () => {
    const week = buildTodoWeekCalendar(
      TODAY,
      [todo('a', '2026-08-05')],
      pl,
      TODAY,
    )[0]!;
    const wednesday = week.days.find((d) => d.date === '2026-08-05');
    expect(wednesday!.todos.map((x) => x.uid)).toEqual(['a']);
  });

  it('marks today', () => {
    const week = buildTodoWeekCalendar(TODAY, [], pl, TODAY)[0]!;
    expect(week.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([
      '2026-08-08',
    ]);
  });
});

describe('zadanie od–do', () => {
  function ranged(uid: string, from: string, to: string): Todo {
    return { ...todo(uid, from), end_date: to };
  }

  it('fills every day between start and end', () => {
    const [week] = [
      buildTodoWeekCalendar(TODAY, [ranged('a', '2026-08-04', '2026-08-06')], pl, TODAY)[0]!,
    ];
    const withTask = week.days
      .filter((d) => d.todos.some((x) => x.uid === 'a'))
      .map((d) => d.date);
    expect(withTask).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);
  });

  it('treats an end date equal to the start as a single day', () => {
    const week = buildTodoWeekCalendar(
      TODAY,
      [ranged('a', '2026-08-04', '2026-08-04')],
      pl,
      TODAY,
    )[0]!;
    const withTask = week.days.filter((d) => d.todos.length > 0).map((d) => d.date);
    expect(withTask).toEqual(['2026-08-04']);
  });

  it('spans across a month boundary', () => {
    const weeks = buildTodoMonthCalendar(
      TODAY,
      [ranged('a', '2026-07-30', '2026-08-02')],
      pl,
      TODAY,
    );
    const withTask = weeks
      .flatMap((w) => w.days)
      .filter((d) => d.todos.length > 0)
      .map((d) => d.date);
    expect(withTask).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});

describe('buildTodoDayCalendar', () => {
  it('renders exactly one day', () => {
    const weeks = buildTodoDayCalendar(TODAY, [todo('a', '2026-08-08')], pl, TODAY);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.days).toHaveLength(1);
    expect(weeks[0]!.days[0]!.date).toBe('2026-08-08');
    expect(weeks[0]!.days[0]!.todos.map((x) => x.uid)).toEqual(['a']);
  });
});

describe('buildTodoMonthCalendar', () => {
  it('pads the grid to whole weeks and flags days outside the month', () => {
    const weeks = buildTodoMonthCalendar(TODAY, [], pl, TODAY);
    for (const week of weeks) {
      expect(week.days).toHaveLength(7);
    }
    // Sierpień 2026 zaczyna się w sobotę → pierwszy tydzień ma 5 dni lipca.
    expect(weeks[0]!.days[0]!.date).toBe('2026-07-27');
    expect(weeks[0]!.days[0]!.inMonth).toBe(false);
    expect(weeks[0]!.days.filter((d) => d.inMonth).map((d) => d.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('covers every day of the month exactly once', () => {
    const weeks = buildTodoMonthCalendar(TODAY, [], pl, TODAY);
    const inMonth = weeks.flatMap((w) => w.days.filter((d) => d.inMonth));
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth.map((d) => d.date)).size).toBe(31);
  });

  it('sorts tasks inside a day by priority descending', () => {
    const weeks = buildTodoMonthCalendar(
      TODAY,
      [todo('niski', '2026-08-05', 0), todo('wysoki', '2026-08-05', 2)],
      pl,
      TODAY,
    );
    const day = weeks
      .flatMap((w) => w.days)
      .find((d) => d.date === '2026-08-05');
    expect(day!.todos.map((x) => x.uid)).toEqual(['wysoki', 'niski']);
  });
});

describe('undatedTodos', () => {
  it('returns only tasks without a due date', () => {
    const result = undatedTodos([todo('a', null), todo('b', '2026-08-05')]);
    expect(result.map((x) => x.uid)).toEqual(['a']);
  });
});
