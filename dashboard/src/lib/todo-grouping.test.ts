import { describe, expect, it } from 'vitest';

import { groupTodosByDue, TODO_GROUP_ORDER } from '@/lib/todo-grouping';
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
