// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';

export type TodoScope = 'global' | 'client' | 'project';
export type TodoStatus = 'open' | 'done';

/**
 * Zadanie. `uid` jest kluczem synchronizacji (nie `id` — ten jest lokalny per
 * maszyna); projekt i klient linkowane NAZWĄ z tego samego powodu.
 * Pola `gcal_*` celowo nieobecne — są per-maszyna i nie jadą w sync.
 */
export interface Todo {
  uid: string;
  scope: TodoScope;
  project_name: string | null;
  client_name: string | null;
  title: string;
  notes: string | null;
  /** Początek zakresu, YYYY-MM-DD */
  due_date: string | null;
  /** Koniec zakresu, YYYY-MM-DD. `null` = zadanie jednodniowe. */
  end_date: string | null;
  /** HH:MM */
  due_time: string | null;
  /** 0 niski, 1 normalny, 2 wysoki */
  priority: number;
  status: TodoStatus;
  completed_at: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string;
}

export interface TodoInput {
  scope: TodoScope;
  projectName?: string | null;
  clientName?: string | null;
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  endDate?: string | null;
  dueTime?: string | null;
  priority: number;
}

export const todosList = () => invoke<Todo[]>('todos_list');

export const todosCreate = (input: TodoInput) =>
  invokeMutation<Todo>('todos_create', { ...input });

export const todosUpdate = (uid: string, input: TodoInput) =>
  invokeMutation<Todo>('todos_update', { uid, ...input });

export const todosSetStatus = (uid: string, status: TodoStatus) =>
  invokeMutation<Todo>('todos_set_status', { uid, status });

export const todosDelete = (uid: string) =>
  invokeMutation<void>('todos_delete', { uid });
