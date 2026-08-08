import { describe, expect, it } from 'vitest';

import {
  buildUpcomingTodoWindow,
  groupTodosByDue,
  TODO_GROUP_ORDER,
} from '@/lib/todo-grouping';
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
    updated_at: '2026-05-10 10:00:00',
  };
}

// Czwartek. Tydzień liczymy do niedzieli włącznie (locale PL), więc „ten tydzień"
// kończy się 2026-06-07.
const TODAY = new Date('2026-06-04T12:00:00');

describe('groupTodosByDue', () => {
  it('puts a past due date into overdue', () => {
    const groups = groupTodosByDue([todo('a', '2026-06-03')], TODAY);
    expect(groups.overdue.map((x) => x.uid)).toEqual(['a']);
  });

  it('puts today into its own group, not overdue', () => {
    const groups = groupTodosByDue([todo('a', '2026-06-04')], TODAY);
    expect(groups.today.map((x) => x.uid)).toEqual(['a']);
    expect(groups.overdue).toHaveLength(0);
  });

  it('puts the rest of the current week into this_week', () => {
    const groups = groupTodosByDue(
      [todo('sobota', '2026-06-06'), todo('niedziela', '2026-06-07')],
      TODAY,
    );
    expect(groups.this_week.map((x) => x.uid)).toEqual(['sobota', 'niedziela']);
  });

  it('puts the day after the week ends into later', () => {
    const groups = groupTodosByDue([todo('a', '2026-06-08')], TODAY);
    expect(groups.later.map((x) => x.uid)).toEqual(['a']);
  });

  it('puts a missing due date into no_date', () => {
    const groups = groupTodosByDue([todo('a', null)], TODAY);
    expect(groups.no_date.map((x) => x.uid)).toEqual(['a']);
  });

  it('sorts by priority descending inside a group', () => {
    const groups = groupTodosByDue(
      [todo('niski', '2026-06-04', 0), todo('wysoki', '2026-06-04', 2)],
      TODAY,
    );
    expect(groups.today.map((x) => x.uid)).toEqual(['wysoki', 'niski']);
  });

  it('returns every group even when empty', () => {
    const groups = groupTodosByDue([], TODAY);
    for (const key of TODO_GROUP_ORDER) {
      expect(groups[key]).toEqual([]);
    }
  });
});

// Sobota — kalendarzowy tydzień kończy się nazajutrz, więc to najostrzejszy
// test na to, że okno jest kroczące, a nie ucięte na niedzieli.
const SATURDAY = new Date('2026-08-08T12:00:00');

describe('buildUpcomingTodoWindow', () => {
  it('returns exactly N day columns starting today, empty ones included', () => {
    const { columns } = buildUpcomingTodoWindow([], 7, SATURDAY);
    expect(columns.map((c) => c.date)).toEqual([
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
    ]);
    expect(columns[0].isToday).toBe(true);
    expect(columns.every((c) => c.todos.length === 0)).toBe(true);
  });

  it('keeps next week inside a 7-day window opened on a Saturday', () => {
    const { columns, rest } = buildUpcomingTodoWindow(
      [todo('poniedzialek', '2026-08-10'), todo('wtorek', '2026-08-11')],
      7,
      SATURDAY,
    );
    const byDate = new Map(columns.map((c) => [c.date, c.todos]));
    expect(byDate.get('2026-08-10')?.map((x) => x.uid)).toEqual([
      'poniedzialek',
    ]);
    expect(byDate.get('2026-08-11')?.map((x) => x.uid)).toEqual(['wtorek']);
    expect(rest).toHaveLength(0);
  });

  it('separates overdue from the day columns', () => {
    const { overdue, columns } = buildUpcomingTodoWindow(
      [todo('zalegle', '2026-08-01'), todo('dzis', '2026-08-08')],
      7,
      SATURDAY,
    );
    expect(overdue.map((x) => x.uid)).toEqual(['zalegle']);
    expect(columns[0].todos.map((x) => x.uid)).toEqual(['dzis']);
  });

  it('pushes later dates and undated tasks into rest', () => {
    const { columns, rest } = buildUpcomingTodoWindow(
      [todo('poza', '2026-08-15'), todo('bez', null)],
      7,
      SATURDAY,
    );
    expect(columns.every((c) => c.todos.length === 0)).toBe(true);
    expect(rest.map((x) => x.uid)).toEqual(['poza', 'bez']);
  });

  it('sorts a single day by priority descending', () => {
    const { columns } = buildUpcomingTodoWindow(
      [
        todo('niski', '2026-08-10', 0),
        todo('wysoki', '2026-08-10', 2),
      ],
      7,
      SATURDAY,
    );
    const monday = columns.find((c) => c.date === '2026-08-10');
    expect(monday?.todos.map((x) => x.uid)).toEqual(['wysoki', 'niski']);
  });
});
