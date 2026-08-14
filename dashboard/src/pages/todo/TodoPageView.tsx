import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { TodoDialog } from '@/components/todo/TodoDialog';
import { TodoCalendar } from '@/components/todo/TodoCalendar';
import { TodoCalendarLegend } from '@/components/todo/TodoCalendarLegend';
import { TodoDayView } from '@/components/todo/TodoDayView';
import { TodoGroupList } from '@/components/todo/TodoGroupList';
import { TodoToolbar } from '@/components/todo/TodoToolbar';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { mobileLayout } from '@/lib/mobile-layout';
import { useTodoReferenceOptions } from '@/hooks/useTodoReferenceOptions';
import type { TodoPageController } from '@/hooks/useTodoPageController';

interface TodoPageViewProps {
  controller: TodoPageController;
}

export function TodoPageView({ controller }: TodoPageViewProps) {
  const { t } = useTranslation();
  const { projectOptions, clientOptions, colorByName } =
    useTodoReferenceOptions();

  return (
    <div className={mobileLayout.pageContainer}>
      <h1 className="text-lg font-semibold">{t('todo.page_title')}</h1>

      <DateRangeToolbar
        dateRange={controller.dateRange}
        timePreset={controller.timePreset}
        setTimePreset={controller.setTimePreset}
        shiftDateRange={controller.shiftDateRange}
        canShiftForward={controller.canShiftForward}
      />

      <TodoToolbar
        search={controller.search}
        setSearch={controller.setSearch}
        scopeFilter={controller.scopeFilter}
        setScopeFilter={controller.setScopeFilter}
        showDone={controller.showDone}
        setShowDone={controller.setShowDone}
        onAdd={controller.openCreate}
      />

      {(controller.searching ||
        controller.scopeFilter !== 'all' ||
        controller.showDone) && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-secondary/10 px-3 py-2 text-xs">
          <span className="font-medium">
            {controller.searching
              ? t('todo.search_results')
              : t('todo.filtered_note')}
          </span>
          <span className="text-muted-foreground">
            {t('todo.results_count', {
              shown: controller.shownCount,
              total: controller.totalCount,
            })}
          </span>
          {controller.searching && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6"
              onClick={() => controller.setSearch('')}
            >
              {t('todo.clear_search')}
            </Button>
          )}
        </div>
      )}

      {controller.loading ? (
        <p className="py-6 text-sm text-muted-foreground">
          {t('todo.loading')}
        </p>
      ) : controller.error ? (
        <p className="py-6 text-sm text-destructive">{controller.error}</p>
      ) : controller.viewMode === 'day' ? (
        <TodoDayView
          date={controller.dateRange.end}
          todos={controller.dayTodos}
          recentlyDone={controller.recentlyDone}
          onAdd={controller.openCreateForDate}
          onToggle={(todo) => void controller.toggleStatus(todo)}
          onEdit={controller.openEdit}
          onDelete={(todo) => void controller.remove(todo)}
        />
      ) : controller.viewMode === 'list' ? (
        <TodoGroupList
          groups={controller.groups}
          hasAnyTodo={controller.hasAnyTodo}
          loading={false}
          error={null}
          recentlyDone={controller.recentlyDone}
          onToggle={(todo) => void controller.toggleStatus(todo)}
          onEdit={controller.openEdit}
          onDelete={(todo) => void controller.remove(todo)}
        />
      ) : (
        <div className="space-y-2">
          <TodoCalendarLegend />
          <div className="overflow-x-auto">
            <TodoCalendar
              weeks={controller.calendarWeeks}
              colorByName={colorByName}
              onDayClick={controller.openCreateForDate}
              onTodoClick={controller.openEdit}
              onToggleStatus={(todo) => void controller.toggleStatus(todo)}
              onShowDay={controller.showDay}
            />
          </div>
        </div>
      )}

      {controller.secondary && (
        <div className="space-y-2 border-t border-border/40 pt-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {controller.secondary.label}
          </h2>
          <div className="overflow-x-auto opacity-80">
            <TodoCalendar
              weeks={controller.secondary.weeks}
              colorByName={colorByName}
              onDayClick={controller.openCreateForDate}
              onTodoClick={controller.openEdit}
              onToggleStatus={(todo) => void controller.toggleStatus(todo)}
              onShowDay={controller.showDay}
            />
          </div>
        </div>
      )}

      {controller.viewMode === 'calendar' && controller.withoutDate.length > 0 && (
        <TodoGroupList
          groups={{
            overdue: [],
            today: [],
            this_week: [],
            later: [],
            no_date: controller.withoutDate,
          }}
          hasAnyTodo={controller.hasAnyTodo}
          loading={false}
          error={null}
          recentlyDone={controller.recentlyDone}
          onToggle={(todo) => void controller.toggleStatus(todo)}
          onEdit={controller.openEdit}
          onDelete={(todo) => void controller.remove(todo)}
        />
      )}

      <TodoDialog
        controller={controller}
        projectOptions={projectOptions}
        clientOptions={clientOptions}
      />
    </div>
  );
}
