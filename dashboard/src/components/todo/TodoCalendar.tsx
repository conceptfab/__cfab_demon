import { CheckCircle2, Circle, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import type { TodoCalendarWeek } from '@/lib/todo-calendar';
import type { Todo } from '@/lib/tauri/todos';

/**
 * Akcent wysokiego priorytetu — PROSTY pasek wstawiany jako element potomny,
 * nie `border-l`. Zaokrąglona krawędź o grubości 2 px wyginała się w łuk i cały
 * pasek zadania czytał się jak tekst w nawiasie: „( … )". Priorytety niski
 * i normalny nie mają akcentu — były czystą dekoracją na prawie każdym kaflu.
 */
const HIGH_PRIORITY = 2;

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
                  // Jedyna reguła przezroczystości w kalendarzu:
                  //   zakończone  → CAŁE zadanie półprzezroczyste (wszystkie
                  //                 jego elementy: ikona, kropka, tytuł, tło),
                  //   do zrobienia → 100% krycia, bez wyjątków — także zadania
                  //                 wielodniowe.
                  // Krycie siedzi na elemencie zadania, nigdy na komórce dnia,
                  // więc zrobione i niezrobione w tym samym dniu różnią się
                  // między sobą, a sam dzień wygląda jak każdy inny.
                  const doneDimming = done ? 'opacity-50' : '';
                  if (ranged && !isStart) {
                    return (
                      <span
                        key={todo.uid}
                        title={todo.title}
                        className={cn(
                          'flex h-[18px] w-full items-center bg-background/50 px-1',
                          doneDimming,
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
                        'relative flex w-full items-center gap-1 overflow-hidden bg-background/50 pl-1.5 pr-0.5 text-[10px] leading-tight',
                        ranged ? 'rounded-l' : 'rounded',
                        doneDimming,
                      )}
                    >
                      {todo.priority === HIGH_PRIORITY && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-[3px] bg-rose-400"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleStatus(todo)}
                        aria-label={done ? t('todo.mark_open') : t('todo.mark_done')}
                        className={cn(
                          'shrink-0 rounded p-0.5 hover:bg-background',
                          // Kolor rozróżnia stan także wtedy, gdy całe zadanie
                          // jest przygaszone: zielony ptaszek vs szare kółko.
                          done
                            ? 'text-emerald-400'
                            : 'text-muted-foreground/70 hover:text-foreground',
                        )}
                      >
                        {/* Semantyka checkboxa: puste kółko = do zrobienia,
                            wypełniony ptaszek = zrobione. `size-2.5` (10 px) było
                            za małe — ptaszek zlewał się w pierścień nie do
                            odróżnienia od pustego kółka. */}
                        {done ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <Circle className="size-3.5" />
                        )}
                      </button>
                      {/* Kropka = kolor projektu/klienta, tak jak wszędzie
                          w aplikacji. Szara = zadanie globalne. */}
                      <span
                        className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
                        style={dotColor ? { backgroundColor: dotColor } : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => onTodoClick(todo)}
                        title={entity ?? t('todo.scope_global')}
                        // Bez przekreślenia i bez własnego wygaszania tytułu —
                        // o stanie mówi ptaszek i krycie CAŁEGO zadania.
                        className="min-w-0 flex-1 truncate rounded px-0.5 text-left hover:bg-background/80"
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
