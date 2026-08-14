import { useMemo } from 'react';
import { ArrowUp, Circle, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TodoDialog } from '@/components/todo/TodoDialog';
import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { buildUpcomingTodoWindow } from '@/lib/todo-grouping';
import { HIGH_PRIORITY, HIGH_PRIORITY_ICON } from '@/lib/todo-priority';
import { useTodoPageController } from '@/hooks/useTodoPageController';
import { useUIStore } from '@/store/ui-store';
import { useTodoReferenceOptions } from '@/hooks/useTodoReferenceOptions';
import type { Todo } from '@/lib/tauri/todos';

/** Okno kafelka w dniach — ta sama liczba trafia do tekstów w UI. */
const WINDOW_DAYS = 7;

/**
 * Ile zadań pokazuje kolumna dnia, zanim reszta schowa się za „+N więcej".
 *
 * Kolumny siatki rozciągają się do najwyższej, więc BEZ tego limitu jeden
 * zawalony dzień windował wysokość CAŁEGO paska, a sześć pozostałych kolumn
 * stało puste. Kafelek ma pokazywać, co goni — pełną listę ma ekran Zadań.
 */
const COLUMN_VISIBLE_TODOS = 4;

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
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setTodoFocusDate = useUIStore((s) => s.setTodoFocusDate);
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
              // Zaległe nie mają jednego dnia — otwieramy ekran Zadań bez
              // zawężania do daty, żeby zobaczyć całą zaległość.
              onShowMore={() => setCurrentPage('todo')}
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
              onShowMore={() => {
                setTodoFocusDate(day.date);
                setCurrentPage('todo');
              }}
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
  /** Przejście na ekran Zadań z tym dniem — cel kliknięcia w „+N więcej". */
  onShowMore: () => void;
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
  onShowMore,
}: DayColumnProps) {
  const { t } = useTranslation();

  return (
    // Kolumna jest kontenerem, NIE przyciskiem — w środku są przyciski
    // (zadania + „dodaj"), a zagnieżdżanie kontrolek psuje nawigację
    // klawiaturą i czytniki ekranu.
    <div
      className={cn(
        'group flex min-h-[7rem] flex-col gap-0.5 rounded-md p-1.5',
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

      {todos.slice(0, COLUMN_VISIBLE_TODOS).map((todo) => {
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
              // JEDEN wiersz na zadanie. Osobna linia z nazwą projektu zjadała
              // trzecią część wysokości kafelka, przez co w kolumnie dnia
              // mieściły się dwa zadania. Encja jest teraz w tooltipie, a na
              // skróty rozpoznaje ją kolor kropki — ten sam co w całej aplikacji.
              'relative flex items-center gap-1 overflow-hidden bg-background/50 px-1.5 py-0.5 text-[11px] leading-tight',
              // Zakres domyka się dopiero w ostatnim dniu, więc głowa belki ma
              // zaokrąglony tylko lewy bok — tak samo jak w kalendarzu.
              ranged ? 'rounded-l' : 'rounded',
            )}
          >
              <button
                type="button"
                onClick={() => void onToggle(todo)}
                aria-label={t('todo.mark_done')}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                {/* Widżet pokazuje wyłącznie zadania otwarte — puste kółko,
                    bo ptaszek sugerowałby, że są już zrobione. */}
                <Circle className="size-3" />
              </button>
              {/* Kropka = kolor projektu/klienta, tak jak wszędzie
                  w aplikacji. Szara = zadanie globalne. */}
              <span
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
                style={dotColor ? { backgroundColor: dotColor } : undefined}
              />
              {/* Priorytet w rzędzie z tekstem — patrz `todo-priority.ts`. */}
              {todo.priority === HIGH_PRIORITY && (
                <span
                  title={t('todo.priority_high')}
                  className="flex shrink-0 items-center"
                >
                  <ArrowUp className={cn('size-3', HIGH_PRIORITY_ICON)} />
                </span>
              )}
              <button
                type="button"
                onClick={() => onEdit(todo)}
                // Tooltip niesie pełny tytuł ORAZ projekt/klienta — to jedyne
                // miejsce, w którym nazwa encji jest teraz czytelna wprost.
                title={entity ? `${todo.title} — ${entity}` : todo.title}
                className="min-w-0 flex-1 truncate rounded px-0.5 text-left hover:bg-background/80"
              >
                {todo.title}
              </button>
              {todo.due_time && (
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {todo.due_time}
                </span>
              )}
          </div>
        );
      })}

      {todos.length > COLUMN_VISIBLE_TODOS && (
        <button
          type="button"
          onClick={onShowMore}
          // Tytuły ukrytych zadań w dymku — sam licznik mówi „coś tu jest",
          // ale nie mówi CO, a to jedyny powód, by klikać w ciemno.
          title={todos
            .slice(COLUMN_VISIBLE_TODOS)
            .map((todo) => todo.title)
            .join('\n')}
          className="rounded px-1 text-left text-[10px] text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          {t('todo.more_in_day', {
            count: todos.length - COLUMN_VISIBLE_TODOS,
          })}
        </button>
      )}
    </div>
  );
}
