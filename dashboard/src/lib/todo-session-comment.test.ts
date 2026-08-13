import { describe, expect, it } from 'vitest';

import { applyTodoAutoComments, findTodoForSession } from '@/lib/todo-session-comment';
import type { SessionWithApp } from '@/lib/db-types';
import type { Todo } from '@/lib/tauri/todos';

function todo(overrides: Partial<Todo>): Todo {
  return {
    uid: 'u1',
    scope: 'project',
    project_name: 'ACME',
    client_name: null,
    title: 'Poprawki eksportu',
    notes: null,
    due_date: '2026-08-13',
    end_date: null,
    due_time: null,
    priority: 1,
    status: 'open',
    completed_at: null,
    sort_order: null,
    created_at: null,
    updated_at: '2026-08-13T00:00:00Z',
    ...overrides,
  };
}

function session(overrides: Partial<SessionWithApp> = {}): SessionWithApp {
  return {
    id: 1,
    app_id: 1,
    app_name: 'Blender',
    executable_name: 'blender',
    project_id: 1,
    project_name: 'ACME',
    project_color: null,
    files: [],
    start_time: '2026-08-13T10:00:00+02:00',
    end_time: '2026-08-13T11:00:00+02:00',
    duration_seconds: 3600,
    ...overrides,
  };
}

describe('findTodoForSession', () => {
  it('dopasowuje zadanie tego samego projektu w pokrywającym się dniu', () => {
    expect(findTodoForSession(session(), [todo({})])?.title).toBe(
      'Poprawki eksportu',
    );
  });

  it('ignoruje zadanie innego projektu', () => {
    expect(
      findTodoForSession(session(), [todo({ project_name: 'INNY' })]),
    ).toBeNull();
  });

  it('ignoruje zadania globalne i klienckie — nie wskazują jednoznacznie pracy', () => {
    expect(
      findTodoForSession(session(), [
        todo({ scope: 'global', project_name: null }),
        todo({ scope: 'client', project_name: null, client_name: 'ACME' }),
      ]),
    ).toBeNull();
  });

  it('ignoruje zadanie z innego dnia', () => {
    expect(
      findTodoForSession(session(), [todo({ due_date: '2026-08-20' })]),
    ).toBeNull();
  });

  it('łapie sesję wewnątrz wielodniowego zakresu zadania', () => {
    const match = findTodoForSession(session(), [
      todo({ due_date: '2026-08-11', end_date: '2026-08-15' }),
    ]);
    expect(match).not.toBeNull();
  });

  it('nie dopasowuje sesji sprzed godziny startu zadania', () => {
    expect(
      findTodoForSession(
        session({
          start_time: '2026-08-13T07:00:00+02:00',
          end_time: '2026-08-13T08:00:00+02:00',
        }),
        [todo({ due_time: '10:00' })],
      ),
    ).toBeNull();
  });

  it('przy kilku dopasowaniach wygrywa wyższy priorytet', () => {
    const match = findTodoForSession(session(), [
      todo({ uid: 'a', title: 'Zwykłe', priority: 1 }),
      todo({ uid: 'b', title: 'Pilne', priority: 2 }),
    ]);
    expect(match?.title).toBe('Pilne');
  });

  it('sesja bez projektu nie dostaje dopasowania', () => {
    expect(
      findTodoForSession(session({ project_name: null }), [todo({})]),
    ).toBeNull();
  });
});

describe('applyTodoAutoComments', () => {
  it('nie nadpisuje własnego komentarza użytkownika', () => {
    const [result] = applyTodoAutoComments(
      [session({ comment: 'moja notatka' })],
      [todo({})],
    );
    expect(result.comment).toBe('moja notatka');
    expect(result.comment_from_todo).toBeUndefined();
  });

  it('uzupełnia pusty komentarz i oznacza jego pochodzenie', () => {
    const [result] = applyTodoAutoComments([session({ comment: '  ' })], [todo({})]);
    expect(result.comment).toBe('Poprawki eksportu');
    expect(result.comment_from_todo).toBe(true);
  });

  it('zwraca tę samą referencję, gdy nic nie pasuje — memo nie przerenderuje listy', () => {
    const input = [session({ project_name: 'INNY' })];
    expect(applyTodoAutoComments(input, [todo({})])).toBe(input);
  });

  it('pusta lista zadań to brak pracy i brak zmian', () => {
    const input = [session()];
    expect(applyTodoAutoComments(input, [])).toBe(input);
  });
});
