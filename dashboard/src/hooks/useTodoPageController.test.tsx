/**
 * Regresja: zadanie zmienione na DRUGIEJ maszynie (np. przesunięte na inny
 * dzień) trafia do lokalnej bazy przez merge demona, całkowicie poza UI.
 * Widok zadań musi się przeładować na sygnał odświeżenia, inaczej pokazuje
 * starą datę tak długo, jak strona jest zamontowana — i wygląda to jak
 * „zadania się nie synchronizują".
 *
 * Środowisko jsdom (*.test.tsx), bo hook renderuje się w Reakcie.
 */
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTodoPageController } from '@/hooks/useTodoPageController';
import { APP_REFRESH_EVENT, LOCAL_DATA_CHANGED_EVENT } from '@/lib/sync-events';
import type { Todo } from '@/lib/tauri/todos';

const todosList = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tauri/todos', () => ({
  todosList,
  todosCreate: vi.fn(),
  todosUpdate: vi.fn(),
  todosSetStatus: vi.fn(),
  todosDelete: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

function todo(dueDate: string): Todo {
  return {
    uid: 'todo-1',
    scope: 'global',
    project_name: null,
    client_name: null,
    title: 'wyslac EXE',
    notes: null,
    due_date: dueDate,
    end_date: null,
    due_time: null,
    priority: 1,
    status: 'open',
    completed_at: null,
    sort_order: 1000,
    created_at: '2026-08-10 12:38:27',
    updated_at: '2026-08-10 12:38:27',
  };
}

function Probe() {
  const controller = useTodoPageController();
  return <span data-testid="due">{controller.todos[0]?.due_date ?? '-'}</span>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useTodoPageController refresh on sync', () => {
  it('reloads todos after the daemon sync finishes', async () => {
    todosList
      .mockResolvedValueOnce([todo('2026-08-11')])
      .mockResolvedValue([todo('2026-08-13')]);

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('due').textContent).toBe('2026-08-11'));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(APP_REFRESH_EVENT, {
          detail: { reasons: ['daemon_sync_finished'], at: '', anonymous: false },
        }),
      );
    });

    await waitFor(() => expect(screen.getByTestId('due').textContent).toBe('2026-08-13'));
  });

  it('ignores refresh reasons unrelated to todos', async () => {
    todosList.mockResolvedValue([todo('2026-08-11')]);

    render(<Probe />);
    await waitFor(() => expect(todosList).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(LOCAL_DATA_CHANGED_EVENT, {
          detail: { reason: 'update_session_comment', at: '' },
        }),
      );
    });

    expect(todosList).toHaveBeenCalledTimes(1);
  });
});
