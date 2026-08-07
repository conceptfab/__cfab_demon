import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDataStore } from '@/store/data-store';

import { useTranslation } from 'react-i18next';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import {
  buildTodoMonthCalendar,
  buildTodoWeekCalendar,
  undatedTodos,
} from '@/lib/todo-calendar';
import { groupTodosByDue } from '@/lib/todo-grouping';
import { logger } from '@/lib/logger';
import {
  todosCreate,
  todosDelete,
  todosList,
  todosSetStatus,
  todosUpdate,
  type Todo,
  type TodoInput,
  type TodoScope,
} from '@/lib/tauri/todos';

export type ScopeFilter = 'all' | TodoScope;

const EMPTY_FORM: TodoInput = {
  scope: 'global',
  projectName: null,
  clientName: null,
  title: '',
  notes: null,
  dueDate: null,
  dueTime: null,
  priority: 1,
};

export function useTodoPageController() {
  const { t, i18n } = useTranslation();
  // Ten sam zakres dat co reszta aplikacji (Dashboard, Sesje, Wyceny) — zadania
  // muszą dać się przeglądać na tej samej osi czasu, a nie tylko względem dziś.
  const dateRange = useDataStore((s) => s.dateRange);
  const timePreset = useDataStore((s) => s.timePreset);
  const setTimePreset = useDataStore((s) => s.setTimePreset);
  const setDateRange = useDataStore((s) => s.setDateRange);
  const shiftDateRange = useDataStore((s) => s.shiftDateRange);
  const canShiftForward = useDataStore((s) => s.canShiftForward);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [showDone, setShowDone] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [form, setForm] = useState<TodoInput>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTodos(await todosList());
    } catch (e) {
      logger.error('[todos] load failed:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `reload` jest używany zarówno przy montowaniu, jak i po każdej mutacji,
    // więc nie da się go rozdzielić bez duplikowania logiki ładowania.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam callback reużyty w handlerach mutacji
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return todos.filter((todo) => {
      if (!showDone && todo.status === 'done') return false;
      if (scopeFilter !== 'all' && todo.scope !== scopeFilter) return false;
      if (needle && !todo.title.toLowerCase().includes(needle)) return false;
      // Filtr okresu po terminie. Zadania BEZ terminu przechodzą zawsze — nie mają
      // daty, po której można je odsiać, a ukrycie ich czyniłoby je nieosiągalnymi
      // w każdym zakresie poza „wszystko".
      if (timePreset !== 'all' && todo.due_date) {
        if (todo.due_date < dateRange.start || todo.due_date > dateRange.end) {
          return false;
        }
      }
      return true;
    });
  }, [todos, search, scopeFilter, showDone, timePreset, dateRange]);

  const groups = useMemo(() => groupTodosByDue(filtered), [filtered]);

  // Kalendarz — ta sama siatka co „Miesięczna mapa kalendarza" w Analizie czasu.
  // Kotwicą jest początek wybranego zakresu, więc strzałki paska dat przewijają
  // kalendarz; preset 'week' daje jeden tydzień, pozostałe pełny miesiąc.
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const calendarWeeks = useMemo(() => {
    const anchor = new Date(`${dateRange.start}T12:00:00`);
    return timePreset === 'week'
      ? buildTodoWeekCalendar(anchor, filtered, locale)
      : buildTodoMonthCalendar(anchor, filtered, locale);
  }, [dateRange.start, timePreset, filtered, locale]);

  const withoutDate = useMemo(() => undatedTodos(filtered), [filtered]);

  /** Klik w dzień kalendarza — nowe zadanie z wypełnionym terminem. */
  const openCreateForDate = useCallback((date: string) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, dueDate: date });
    setDialogError(null);
    setDialogOpen(true);
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((todo: Todo) => {
    setEditing(todo);
    setForm({
      scope: todo.scope,
      projectName: todo.project_name,
      clientName: todo.client_name,
      title: todo.title,
      notes: todo.notes,
      dueDate: todo.due_date,
      dueTime: todo.due_time,
      priority: todo.priority,
    });
    setDialogError(null);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditing(null);
    setDialogError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!form.title.trim()) {
      setDialogError(t('todo.invalid_title'));
      return;
    }
    if (form.scope === 'project' && !form.projectName) {
      setDialogError(t('todo.invalid_scope_project'));
      return;
    }
    if (form.scope === 'client' && !form.clientName) {
      setDialogError(t('todo.invalid_scope_client'));
      return;
    }
    setSaving(true);
    setDialogError(null);
    try {
      if (editing) {
        await todosUpdate(editing.uid, form);
      } else {
        await todosCreate(form);
      }
      closeDialog();
      await reload();
    } catch (e) {
      logger.error('[todos] save failed:', e);
      setDialogError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, editing, closeDialog, reload, t]);

  const toggleStatus = useCallback(
    async (todo: Todo) => {
      try {
        await todosSetStatus(todo.uid, todo.status === 'done' ? 'open' : 'done');
        await reload();
      } catch (e) {
        logger.error('[todos] status change failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (todo: Todo) => {
      try {
        await todosDelete(todo.uid);
        await reload();
      } catch (e) {
        logger.error('[todos] delete failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reload],
  );

  return {
    t,
    dateRange,
    timePreset,
    setTimePreset,
    setDateRange,
    shiftDateRange,
    canShiftForward,
    todos,
    groups,
    calendarWeeks,
    withoutDate,
    openCreateForDate,
    hasAnyTodo: todos.length > 0,
    loading,
    error,
    search,
    setSearch,
    scopeFilter,
    setScopeFilter,
    showDone,
    setShowDone,
    dialogOpen,
    editing,
    form,
    setForm,
    dialogError,
    saving,
    openCreate,
    openEdit,
    closeDialog,
    submit,
    toggleStatus,
    remove,
  };
}

export type TodoPageController = ReturnType<typeof useTodoPageController>;
