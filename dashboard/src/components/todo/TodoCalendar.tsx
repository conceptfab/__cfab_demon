import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import type { TodoCalendarWeek } from '@/lib/todo-calendar';
import type { Todo } from '@/lib/tauri/todos';

const PRIORITY_DOT = ['bg-muted-foreground/50', 'bg-sky-400', 'bg-rose-400'];

interface TodoCalendarProps {
  weeks: TodoCalendarWeek[];
  onDayClick: (date: string) => void;
  onTodoClick: (todo: Todo) => void;
}

/**
 * Siatka kalendarza zadań — ten sam układ co „Miesięczna mapa kalendarza"
 * w Analizie czasu (`MonthlyHeatmap`): kolumna etykiet tygodni po lewej,
 * siedem komórek dni, ta sama paleta tła i numeracja tygodni. Różnica jest
 * wyłącznie w treści komórki: zamiast pasków czasu — lista zadań.
 */
export function TodoCalendar({
  weeks,
  onDayClick,
  onTodoClick,
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

  return (
    <div className="min-w-[400px]">
      <div className="mb-1 flex pl-16 text-xs text-muted-foreground">
        {weekDays.map((d) => (
          <div key={d} className="flex-1 text-center">
            {d}
          </div>
        ))}
      </div>

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
              <button
                type="button"
                key={day.date}
                onClick={() => onDayClick(day.date)}
                aria-label={format(parseISO(day.date), 'EEE, MMM d', { locale })}
                className={cn(
                  'relative flex min-h-[120px] flex-1 flex-col gap-1 overflow-hidden rounded-md p-1.5 text-left transition-colors',
                  day.inMonth
                    ? 'bg-[rgba(41,46,66,0.45)] hover:bg-[rgba(41,46,66,0.7)]'
                    : 'bg-[rgba(41,46,66,0.2)] hover:bg-[rgba(41,46,66,0.35)]',
                  day.isToday && 'ring-1 ring-sky-400/60',
                )}
              >
                <span
                  className={cn(
                    'text-xs font-medium',
                    day.inMonth
                      ? 'text-foreground/90'
                      : 'text-muted-foreground/40',
                    day.isToday && 'text-sky-300',
                  )}
                >
                  {format(parseISO(day.date), 'd', { locale })}
                </span>

                {day.todos.map((todo) => (
                  <span
                    key={todo.uid}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTodoClick(todo);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        onTodoClick(todo);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight',
                      'bg-background/50 hover:bg-background/80',
                      todo.status === 'done' &&
                        'text-muted-foreground line-through',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        PRIORITY_DOT[todo.priority] ?? PRIORITY_DOT[1],
                      )}
                    />
                    <span className="min-w-0 truncate">{todo.title}</span>
                  </span>
                ))}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
