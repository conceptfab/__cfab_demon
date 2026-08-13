import { useMemo } from 'react';
import { Circle, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TodoDialog } from '@/components/todo/TodoDialog';
import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { buildUpcomingTodoWindow } from '@/lib/todo-grouping';
import { HIGH_PRIORITY, HIGH_PRIORITY_BAR } from '@/lib/todo-priority';
import { useTodoPageController } from '@/hooks/useTodoPageController';
import { useTodoReferenceOptions } from '@/hooks/useTodoReferenceOptions';
import type { Todo } from '@/lib/tauri/todos';

/** Okno kafelka w dniach — ta sama liczba trafia do tekstów w UI. */
const WINDOW_DAYS = 7;

/**
 * Pasek terminów na całą szerokość: kolumna „Zaległe" (tylko gdy są) i siedem
 * kolumn dni, licząc od dziś. Dalsze terminy oraz zadania bez terminu są
 * wyłącznie zliczone w stopce — widżet odpowiada na pytanie „co mnie goni
 * w tym tygodniu", nie zastępuje pełnego ekranu Zadań.
 *
 * Dodawanie i edycja idą przez ten sam kontroler i ten sam dialog co ekran
 * Zadań, więc walidacja, zapis i odświeżanie zachowują się identycznie.
 */
export function UpcomingTodosCard() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const controller = useTodoPageController();
  const { projectOptions, clientOptions, colorByName } =
    useTodoReferenceOptions();

  const { overdue, columns, rest } = useMemo(() => {
    const open = controller.todos.filter((todo) => todo.status === 'open');
    return buildUpcomingTodoWindow(open, WINDOW_DAYS);
  }, [controller.todos]);

  const inWindow =
    overdue.length + columns.reduce((sum, day) => sum + day.todos.length, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t('todo.upcoming_title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'grid gap-1 sm:grid-cols-2 lg:grid-cols-4',
            // Kolumna zaległych dochodzi do siedmiu dni tylko wtedy, gdy ma co
            // pokazać — inaczej marnowałaby ósmą część szerokości na pustkę.
            overdue.length > 0 ? 'xl:grid-cols-8' : 'xl:grid-cols-7',
          )}
        >
          {overdue.length > 0 && (
            <DayColumn
              label={t('todo.group_overdue')}
              sublabel={String(overdue.length)}
              todos={overdue}
              date={null}
              colorByName={colorByName}
              tone="overdue"
              onEdit={controller.openEdit}
              onToggle={controller.toggleStatus}
            />
          )}

          {columns.map((day, index) => (
            <DayColumn
              key={day.date}
              label={format(parseISO(day.date), 'EEE', { locale })}
              sublabel={format(parseISO(day.date), 'd MMM', { locale })}
              todos={day.todos}
              date={day.date}
              isFirstColumn={index === 0}
              colorByName={colorByName}
              tone={day.isToday ? 'today' : 'default'}
              addLabel={`${t('todo.add')} — ${format(parseISO(day.date), 'EEE, d MMM', { locale })}`}
              onAdd={() => controller.openCreateForDate(day.date)}
              onEdit={controller.openEdit}
              onToggle={controller.toggleStatus}
            />
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
          {inWindow === 0 && (
            <span>{t('todo.upcoming_empty', { days: WINDOW_DAYS })}</span>
          )}
          {/* Licznik w menu liczy WSZYSTKIE otwarte zadania, więc bez tej linii
              widżet zdawałby się gubić zadania spoza okna. */}
          {rest.length > 0 && (
            <span className="ml-auto">
              {t('todo.upcoming_hidden', { count: rest.length })}
            </span>
          )}
        </div>
      </CardContent>

      <TodoDialog
        controller={controller}
        projectOptions={projectOptions}
        clientOptions={clientOptions}
      />
    </Card>
  );
}

interface DayColumnProps {
  label: string;
  sublabel: string;
  todos: Todo[];
  /**
   * Data tej kolumny (YYYY-MM-DD) — potrzebna, by odróżnić dzień, w którym
   * zadanie od–do się ZACZYNA, od dni kontynuacji. `null` dla kolumny
   * zaległych, która nie reprezentuje konkretnego dnia.
   */
  date: string | null;
  /**
   * Pierwsza kolumna okna. Zakres, który zaczął się przed dziś, nie ma tu
   * swojego dnia startu — wtedy głowę belki (tytuł, ikona) niesie właśnie ta
   * kolumna, żeby zadanie nie zostało ciągiem bezimiennych pasków.
   */
  isFirstColumn?: boolean;
  colorByName: Map<string, string>;
  tone: 'default' | 'today' | 'overdue';
  /** Bez tej pary kolumna nie przyjmuje nowych zadań (kolumna zaległych). */
  addLabel?: string;
  onAdd?: () => void;
  onEdit: (todo: Todo) => void;
  onToggle: (todo: Todo) => Promise<void>;
}

function DayColumn({
  label,
  sublabel,
  todos,
  date,
  isFirstColumn = false,
  colorByName,
  tone,
  addLabel,
  onAdd,
  onEdit,
  onToggle,
}: DayColumnProps) {
  const { t } = useTranslation();

  return (
    // Kolumna jest kontenerem, NIE przyciskiem — w środku są przyciski
    // (zadania + „dodaj"), a zagnieżdżanie kontrolek psuje nawigację
    // klawiaturą i czytniki ekranu.
    <div
      className={cn(
        'group flex min-h-[7rem] flex-col gap-1 rounded-md p-1.5',
        tone === 'overdue'
          ? 'bg-rose-500/10 ring-1 ring-rose-400/30'
          : 'bg-[rgba(41,46,66,0.45)]',
        tone === 'today' && 'ring-1 ring-sky-400/60',
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={cn(
            'truncate text-xs font-medium capitalize',
            tone === 'overdue'
              ? 'text-rose-300'
              : tone === 'today'
                ? 'text-sky-300'
                : 'text-foreground/90',
          )}
        >
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {sublabel}
          </span>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              aria-label={addLabel}
              // Widoczny przy hoverze i zawsze przy fokusie klawiatury, żeby
              // nie był nieosiągalny bez myszy.
              className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-background/60 hover:text-foreground focus-visible:text-foreground group-hover:text-muted-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </span>
      </div>

      {todos.map((todo) => {
        const entity = todo.project_name ?? todo.client_name ?? null;
        const dotColor = entity ? colorByName.get(entity) : undefined;
        // Ta sama gramatyka co w kalendarzu zadań: dzień startu niesie pełny
        // opis, kolejne dni zakresu to belka. Bez tego zadanie na cztery dni
        // powtarzało tytuł w czterech kolumnach i wyglądało jak cztery
        // osobne zadania.
        const ranged = Boolean(
          todo.end_date && todo.due_date && todo.end_date > todo.due_date,
        );
        const isHead =
          !ranged || date === null || todo.due_date === date || isFirstColumn;
        if (!isHead) {
          return (
            <span
              key={todo.uid}
              title={entity ? `${todo.title} — ${entity}` : todo.title}
              className="flex h-[18px] w-full items-center bg-background/50 px-1"
            >
              <span
                className="h-1 flex-1 rounded-full bg-muted-foreground/40"
                style={dotColor ? { backgroundColor: dotColor } : undefined}
              />
            </span>
          );
        }
        return (
          <div
            key={todo.uid}
            className={cn(
              'relative flex flex-col gap-0.5 overflow-hidden bg-background/50 px-1.5 py-1 text-[11px] leading-tight',
              // Zakres domyka się dopiero w ostatnim dniu, więc głowa belki ma
              // zaokrąglony tylko lewy bok — tak samo jak w kalendarzu.
              ranged ? 'rounded-l' : 'rounded',
            )}
          >
            {todo.priority === HIGH_PRIORITY && (
              <span
                title={t('todo.priority_high')}
                className={cn(
                  'absolute inset-y-0 left-0 w-[3px]',
                  HIGH_PRIORITY_BAR,
                )}
              />
            )}
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void onToggle(todo)}
                aria-label={t('todo.mark_done')}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                {/* Widżet pokazuje wyłącznie zadania otwarte — puste kółko,
                    bo ptaszek sugerowałby, że są już zrobione. */}
                <Circle className="size-3.5" />
              </button>
              {/* Kropka = kolor projektu/klienta, tak jak wszędzie
                  w aplikacji. Szara = zadanie globalne. */}
              <span
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
                style={dotColor ? { backgroundColor: dotColor } : undefined}
              />
              <button
                type="button"
                onClick={() => onEdit(todo)}
                title={entity ? `${todo.title} — ${entity}` : todo.title}
                className="min-w-0 flex-1 truncate rounded px-0.5 text-left hover:bg-background/80"
              >
                {todo.title}
              </button>
            </span>
            {(entity || todo.due_time) && (
              <span className="flex items-baseline justify-between gap-1 pl-5 text-[10px] text-muted-foreground">
                <span className="min-w-0 truncate">{entity ?? ''}</span>
                {todo.due_time && (
                  <span className="shrink-0 tabular-nums">{todo.due_time}</span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
