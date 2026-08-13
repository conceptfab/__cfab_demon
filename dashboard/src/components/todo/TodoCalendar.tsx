import { CheckCircle2, Circle, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import type { TodoCalendarWeek } from '@/lib/todo-calendar';
import type { Todo } from '@/lib/tauri/todos';

/** Priorytet na lewej krawędzi kafelka — kropka jest zajęta przez kolor encji. */
const PRIORITY_EDGE = [
  'border-l-transparent',
  'border-l-sky-400/70',
  'border-l-rose-400',
];

interface TodoCalendarProps {
  weeks: TodoCalendarWeek[];
  /** NAZWA projektu/klienta → kolor, do oznaczenia zakresu zadania na kafelku. */
  colorByName: Map<string, string>;
  onDayClick: (date: string) => void;
  onTodoClick: (todo: Todo) => void;
  onToggleStatus: (todo: Todo) => void;
}

/**
 * Siatka kalendarza zadań — ten sam układ co „Miesięczna mapa kalendarza"
 * w Analizie czasu (`MonthlyHeatmap`): kolumna etykiet tygodni po lewej,
 * siedem komórek dni, ta sama paleta tła i numeracja tygodni. Różnica jest
 * wyłącznie w treści komórki: zamiast pasków czasu — lista zadań.
 */
export function TodoCalendar({
  weeks,
  colorByName,
  onDayClick,
  onTodoClick,
  onToggleStatus,
}: TodoCalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const weekDays = [
    t('time_analysis_page.weekdays_short.mon'),
    t('time_analysis_page.weekdays_short.tue'),
    t('time_analysis_page.weekdays_short.wed'),
    t('time_analysis_page.weekdays_short.thu'),
    t('time_analysis_page.weekdays_short.fri'),
    t('time_analysis_page.weekdays_short.sat'),
    t('time_analysis_page.weekdays_short.sun'),
  ];

  // Widok dnia ma jedną kolumnę — nagłówek z siedmioma nazwami dni byłby wtedy
  // kłamstwem. Im mniej kolumn, tym wyższa komórka: przy jednym dniu jest miejsce
  // na pełną listę zadań, przy miesiącu liczy się zwartość siatki.
  const columns = weeks[0]?.days.length ?? 7;
  const cellHeight =
    columns === 1 ? 'min-h-[320px]' : columns <= 7 && weeks.length === 1
      ? 'min-h-[220px]'
      : 'min-h-[96px]';

  return (
    <div className="min-w-[400px]">
      {columns === 7 && (
        <div className="mb-1 flex pl-16 text-xs text-muted-foreground">
          {weekDays.map((d) => (
            <div key={d} className="flex-1 text-center">
              {d}
            </div>
          ))}
        </div>
      )}

      {weeks.map((week) => (
        <div key={week.label + week.subLabel} className="mb-1 flex items-stretch gap-1">
          <div className="flex w-14 flex-col items-end pr-2 pt-2 leading-tight">
            <span className="text-[11px] font-bold text-muted-foreground">
              {week.label}
            </span>
            <span className="text-[9px] text-muted-foreground/60">
              {week.subLabel}
            </span>
          </div>

          <div className="flex flex-1 gap-1">
            {week.days.map((day) => (
              // Komórka jest kontenerem, NIE przyciskiem — w środku są przyciski
              // (zadania + „dodaj"), a zagnieżdżanie kontrolek interaktywnych
              // psuje nawigację klawiaturą i czytniki ekranu.
              <div
                key={day.date}
                className={cn(
                  'group relative flex flex-1 flex-col gap-1 overflow-hidden rounded-md p-1.5',
                  cellHeight,
                  day.inMonth
                    ? 'bg-[rgba(41,46,66,0.45)]'
                    : 'bg-[rgba(41,46,66,0.2)]',
                  day.isToday && 'ring-1 ring-sky-400/60',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* Dzisiejszy dzień: wypełniona plakietka + podpis. Sama
                        ramka nie mówi nic — trzeba nazwać, co oznacza. */}
                    <span
                      className={cn(
                        'text-xs font-medium',
                        day.isToday &&
                          'flex size-5 items-center justify-center rounded-full bg-sky-500 text-background',
                        !day.isToday && day.inMonth
                          ? 'text-foreground/90'
                          : !day.isToday
                            ? 'text-muted-foreground/40'
                            : '',
                      )}
                    >
                      {format(parseISO(day.date), 'd', { locale })}
                    </span>
                    {day.isToday && (
                      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-sky-300">
                        {t('ui.date_presets.today')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDayClick(day.date)}
                    aria-label={`${t('todo.add')} — ${format(parseISO(day.date), 'EEE, MMM d', { locale })}`}
                    // Widoczny przy hoverze i zawsze przy fokusie klawiatury,
                    // żeby nie był nieosiągalny bez myszy.
                    className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-background/60 hover:text-foreground focus-visible:text-foreground group-hover:text-muted-foreground"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>

                {day.todos.map((todo) => {
                  const entity = todo.project_name ?? todo.client_name ?? null;
                  const dotColor = entity ? colorByName.get(entity) : undefined;
                  const done = todo.status === 'done';
                  // Zadanie od–do: dzień początkowy niesie pełny opis, kolejne
                  // dni zakresu to kontynuacja — bez powtarzania przycisków,
                  // żeby pasek czytał się jak jedna ciągła belka.
                  const ranged = Boolean(
                    todo.end_date && todo.end_date > (todo.due_date ?? ''),
                  );
                  const isStart = !ranged || todo.due_date === day.date;
                  // Zadanie od–do zajmuje kilka komórek naraz, więc w pełnej
                  // sile przytłacza siatkę i zagłusza jednodniowe terminy —
                  // stąd półprzezroczystość. Zakończone gaśnie mocniej
                  // („ledwo widoczne"); hover przywraca pełny kontrast.
                  const dimming = done
                    ? 'opacity-40 hover:opacity-100 focus-within:opacity-100'
                    : ranged
                      ? 'opacity-60 hover:opacity-100 focus-within:opacity-100'
                      : '';
                  if (ranged && !isStart) {
                    return (
                      <span
                        key={todo.uid}
                        title={todo.title}
                        className={cn(
                          'flex h-[18px] w-full items-center bg-background/50 px-1 transition-opacity',
                          dimming,
                        )}
                      >
                        <span
                          className="h-1 flex-1 rounded-full bg-muted-foreground/40"
                          style={
                            dotColor ? { backgroundColor: dotColor } : undefined
                          }
                        />
                      </span>
                    );
                  }
                  return (
                    <span
                      key={todo.uid}
                      className={cn(
                        'flex w-full items-center gap-1 border-l-2 bg-background/50 pl-1 pr-0.5 text-[10px] leading-tight transition-opacity',
                        PRIORITY_EDGE[todo.priority] ?? PRIORITY_EDGE[1],
                        ranged ? 'rounded-l' : 'rounded',
                        dimming,
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onToggleStatus(todo)}
                        aria-label={done ? t('todo.mark_open') : t('todo.mark_done')}
                        className={cn(
                          'shrink-0 rounded p-0.5 hover:bg-background hover:text-foreground',
                          done ? 'text-emerald-500' : 'text-muted-foreground',
                        )}
                      >
                        {/* Semantyka checkboxa: puste kółko = do zrobienia, ptaszek = zrobione. */}
                        {done ? (
                          <CheckCircle2 className="size-2.5" />
                        ) : (
                          <Circle className="size-2.5" />
                        )}
                      </button>
                      {/* Kropka = kolor projektu/klienta, tak jak wszędzie
                          w aplikacji. Szara = zadanie globalne. */}
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                        style={dotColor ? { backgroundColor: dotColor } : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => onTodoClick(todo)}
                        title={entity ?? t('todo.scope_global')}
                        className={cn(
                          'min-w-0 flex-1 truncate rounded px-0.5 text-left hover:bg-background/80',
                          // Bez przekreślenia — o „zakończone" mówi ptaszek
                          // i wygaszenie całego kafelka, a tytuł zostaje czytelny.
                          done && 'text-muted-foreground',
                        )}
                      >
                        {todo.title}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
