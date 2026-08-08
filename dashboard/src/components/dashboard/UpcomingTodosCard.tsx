import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { buildUpcomingTodoWindow } from '@/lib/todo-grouping';
import { logger } from '@/lib/logger';
import { todosList, type Todo } from '@/lib/tauri/todos';

/** Okno kafelka w dniach — ta sama liczba trafia do tekstów w UI. */
const WINDOW_DAYS = 7;

/** Priorytet na lewej krawędzi kafelka — jak w kalendarzu zadań. */
const PRIORITY_EDGE = [
  'border-l-transparent',
  'border-l-sky-400/70',
  'border-l-rose-400',
];

interface UpcomingTodosCardProps {
  /** NAZWA projektu → kolor, do oznaczenia zakresu zadania kropką. */
  colorByName?: Record<string, string>;
}

/**
 * Pasek terminów na całą szerokość: kolumna „Zaległe" (tylko gdy są) i siedem
 * kolumn dni, licząc od dziś. Dalsze terminy oraz zadania bez terminu są
 * wyłącznie zliczone w stopce — widżet odpowiada na pytanie „co mnie goni
 * w tym tygodniu", nie zastępuje pełnego ekranu Zadań.
 */
export function UpcomingTodosCard({ colorByName }: UpcomingTodosCardProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const [todos, setTodos] = useState<Todo[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void (async () => {
      try {
        setTodos(await todosList());
      } catch (e) {
        logger.error('[todos] dashboard widget load failed:', e);
      }
    })();
  }, []);

  const { overdue, columns, rest } = useMemo(() => {
    const open = todos.filter((todo) => todo.status === 'open');
    return buildUpcomingTodoWindow(open, WINDOW_DAYS);
  }, [todos]);

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
              colorByName={colorByName}
              tone="overdue"
            />
          )}

          {columns.map((day) => (
            <DayColumn
              key={day.date}
              label={format(parseISO(day.date), 'EEE', { locale })}
              sublabel={format(parseISO(day.date), 'd MMM', { locale })}
              todos={day.todos}
              colorByName={colorByName}
              tone={day.isToday ? 'today' : 'default'}
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
    </Card>
  );
}

interface DayColumnProps {
  label: string;
  sublabel: string;
  todos: Todo[];
  colorByName?: Record<string, string>;
  tone: 'default' | 'today' | 'overdue';
}

function DayColumn({
  label,
  sublabel,
  todos,
  colorByName,
  tone,
}: DayColumnProps) {
  return (
    <div
      className={cn(
        'flex min-h-[7rem] flex-col gap-1 rounded-md p-1.5',
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
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {sublabel}
        </span>
      </div>

      {todos.map((todo) => {
        const entity = todo.project_name ?? todo.client_name ?? null;
        const dotColor = entity ? colorByName?.[entity] : undefined;
        return (
          <div
            key={todo.uid}
            title={entity ? `${todo.title} — ${entity}` : todo.title}
            className={cn(
              'flex flex-col gap-0.5 rounded border-l-2 bg-background/50 px-1 py-1 text-[11px] leading-tight',
              PRIORITY_EDGE[todo.priority] ?? PRIORITY_EDGE[1],
            )}
          >
            <span className="flex items-center gap-1">
              {/* Kropka = kolor projektu, tak jak wszędzie w aplikacji.
                  Szara = zadanie globalne albo klienckie. */}
              <span
                className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                style={dotColor ? { backgroundColor: dotColor } : undefined}
              />
              <span className="min-w-0 flex-1 truncate">{todo.title}</span>
            </span>
            {(entity || todo.due_time) && (
              <span className="flex items-baseline justify-between gap-1 text-[10px] text-muted-foreground">
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
