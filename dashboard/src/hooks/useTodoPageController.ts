import { useCallback, useEffect, useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';

import { todoPresetToRange, shiftTodoAnchor } from '@/lib/todo-period';
import type { TimePreset } from '@/store/data-store';

import { useTranslation } from 'react-i18next';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import {
  buildTodoDayCalendar,
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
  endDate: null,
  dueTime: null,
  priority: 1,
};

export function useTodoPageController() {
  const { t, i18n } = useTranslation();
  // Okres LOKALNY, nie ze wspólnego store'a: tamten liczy zakresy wstecz i blokuje
  // ruch w przyszłość, a to jest kalendarz do planowania. Pasek i słownik presetów
  // zostają wspólne — różni się tylko arytmetyka i brak blokady „do przodu".
  const [timePreset, setTimePresetState] = useState<TimePreset>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const dateRange = useMemo(
    () => todoPresetToRange(timePreset, anchor),
    [timePreset, anchor],
  );
  const setTimePreset = useCallback((preset: TimePreset) => {
    setTimePresetState(preset);
    // Zmiana presetu wraca do „teraz" — inaczej po cofnięciu o 3 miesiące
    // kliknięcie „Dziś" pokazywałoby dzień sprzed kwartału.
    setAnchor(new Date());
  }, []);
  const shiftDateRange = useCallback(
    (direction: -1 | 1) =>
      setAnchor((current) => shiftTodoAnchor(timePreset, current, direction)),
    [timePreset],
  );
  // Planowanie wymaga ruchu w przód; ograniczenie ma sens tylko dla czasu pracy.
  const canShiftForward = timePreset !== 'all';
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
      return true;
    });
    // ŚWIADOMIE bez filtra po zakresie dat: to SIATKA decyduje, co widać —
    // zadanie trafia do komórki swojego dnia, a dni spoza widoku po prostu się
    // nie renderują. Wcześniejszy filtr powodował, że przy presecie „Dziś"
    // rysowany był cały miesiąc, ale przepuszczany jeden dzień, więc kalendarz
    // wyglądał na pusty mimo istniejących zadań.
  }, [todos, search, scopeFilter, showDone]);

  const groups = useMemo(() => groupTodosByDue(filtered), [filtered]);

  // Kalendarz — ta sama siatka co „Miesięczna mapa kalendarza" w Analizie czasu.
  // Kotwicą jest początek wybranego zakresu, więc strzałki paska dat przewijają
  // kalendarz; preset 'week' daje jeden tydzień, pozostałe pełny miesiąc.
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const calendarWeeks = useMemo(() => {
    // Kotwica na END, nie START: zakresy w `data-store` liczą się WSTECZ
    // (tydzień = dziś − 6 dni), więc `start` wpadał w poprzedni tydzień
    // kalendarzowy. `end` zawsze wskazuje ostatni dzień wybranego okresu.
    const anchor = new Date(`${dateRange.end}T12:00:00`);
    if (timePreset === 'today') return buildTodoDayCalendar(anchor, filtered, locale);
    if (timePreset === 'week') return buildTodoWeekCalendar(anchor, filtered, locale);
    return buildTodoMonthCalendar(anchor, filtered, locale);
  }, [dateRange.end, timePreset, filtered, locale]);

  // Trzy tryby widoku:
  //  • 'list'     — „Cały Okres" kotwiczy się na 2020-01-01, więc siatka
  //                 pokazywałaby styczeń 2020; lista gwarantuje, że żadne
  //                 zadanie nie zniknie z widoku.
  //  • 'day'      — dla jednego dnia siatka degeneruje się do wielkiego pustego
  //                 prostokąta; zwykła lista czyta się lepiej.
  //  • 'calendar' — tydzień i miesiąc.
  //  • wpisana fraza — wyniki muszą być widoczne niezależnie od okresu, inaczej
  //    trafienie w innym miesiącu jest niewidoczne i szukajka wygląda na zepsutą.
  const searching = search.trim().length > 0;
  const viewMode: 'calendar' | 'list' | 'day' = searching
    ? 'list'
    : timePreset === 'all'
      ? 'list'
      : timePreset === 'today'
        ? 'day'
        : 'calendar';

  // Podgląd szerszego kontekstu pod widokiem głównym: pod dniem tydzień,
  // pod tygodniem miesiąc, pod miesiącem miesiąc następny. Kalendarz do
  // planowania musi pokazywać, co jest tuż obok wybranego okresu.
  const secondary = useMemo(() => {
    if (searching || timePreset === 'all') return null;
    if (timePreset === 'today') {
      const weekEnd = todoPresetToRange('week', anchor).end;
      return {
        weeks: buildTodoWeekCalendar(anchor, filtered, locale),
        label: `${format(anchor, 'MMM d', { locale })} – ${format(
          new Date(`${weekEnd}T12:00:00`),
          'MMM d',
          { locale },
        )}`,
      };
    }
    if (timePreset === 'week') {
      return {
        weeks: buildTodoMonthCalendar(anchor, filtered, locale),
        label: format(anchor, 'LLLL yyyy', { locale }),
      };
    }
    const next = addMonths(anchor, 1);
    return {
      weeks: buildTodoMonthCalendar(next, filtered, locale),
      label: format(next, 'LLLL yyyy', { locale }),
    };
  }, [searching, timePreset, anchor, filtered, locale]);

  /** Zadania wybranego dnia — wejście dla widoku 'day'. */
  const dayTodos = useMemo(
    () => calendarWeeks[0]?.days[0]?.todos ?? [],
    [calendarWeeks],
  );

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
      endDate: todo.end_date,
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
    if (form.endDate && form.dueDate && form.endDate < form.dueDate) {
      setDialogError(t('todo.invalid_range'));
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
    shiftDateRange,
    canShiftForward,
    todos,
    groups,
    calendarWeeks,
    viewMode,
    secondary,
    dayTodos,
    withoutDate,
    openCreateForDate,
    hasAnyTodo: todos.length > 0,
    searching,
    shownCount: filtered.length,
    // Licznik odniesienia: otwarte zadania, tak jak plakietka w nawigacji —
    // żeby „1 z 2" znaczyło to samo w obu miejscach.
    totalCount: todos.filter((todo) => todo.status === 'open').length,
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
