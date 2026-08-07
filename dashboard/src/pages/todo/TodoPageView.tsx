import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { TodoDialog } from '@/components/todo/TodoDialog';
import { TodoCalendar } from '@/components/todo/TodoCalendar';
import { TodoDayView } from '@/components/todo/TodoDayView';
import { TodoGroupList } from '@/components/todo/TodoGroupList';
import { TodoToolbar } from '@/components/todo/TodoToolbar';
import type { PickerOption } from '@/components/todo/TodoEntityPicker';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { clientsList, projectsWithClient } from '@/lib/tauri/clients';
import { logger } from '@/lib/logger';
import { mobileLayout } from '@/lib/mobile-layout';
import type { TodoPageController } from '@/hooks/useTodoPageController';

const byPickerName = (a: PickerOption, b: PickerOption) =>
  a.name.localeCompare(b.name);

interface TodoPageViewProps {
  controller: TodoPageController;
}

export function TodoPageView({ controller }: TodoPageViewProps) {
  const { t } = useTranslation();
  const [projectOptions, setProjectOptions] = useState<PickerOption[]>([]);
  const [clientOptions, setClientOptions] = useState<PickerOption[]>([]);

  useEffect(() => {
    // Listy do selectów w dialogu. Ładowane raz — nie zmieniają się w trakcie
    // pracy z zadaniami, a odświeżenie następuje przy powrocie na stronę.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; listy referencyjne do selectów
    void (async () => {
      try {
        const [projects, clients] = await Promise.all([
          projectsWithClient(),
          clientsList(),
        ]);
        // Tylko AKTYWNE projekty — menu przypisania sesji filtruje tak samo
        // (`!frozen_at`), więc zamrożone, wykluczone i zarchiwizowane nie
        // zaśmiecają listy dziesiątkami pozycji.
        const activeProjects: PickerOption[] = [];
        for (const project of projects) {
          if (project.status !== 'active') continue;
          activeProjects.push({ name: project.name, color: project.color });
        }
        setProjectOptions(activeProjects.toSorted(byPickerName));
        setClientOptions(
          clients
            .map((c) => ({ name: c.name, color: c.color }))
            .toSorted(byPickerName),
        );
      } catch (e) {
        logger.error('[todos] reference lists failed:', e);
      }
    })();
  }, []);

  // Jedna mapa NAZWA → kolor dla projektów i klientów: kafelek kalendarza
  // oznacza zadanie kolorem jego encji, tak jak reszta aplikacji.
  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of [...projectOptions, ...clientOptions]) {
      map.set(option.name, option.color);
    }
    return map;
  }, [projectOptions, clientOptions]);

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
          onToggle={(todo) => void controller.toggleStatus(todo)}
          onEdit={controller.openEdit}
          onDelete={(todo) => void controller.remove(todo)}
        />
      ) : (
        <div className="overflow-x-auto">
          <TodoCalendar
            weeks={controller.calendarWeeks}
            colorByName={colorByName}
            onDayClick={controller.openCreateForDate}
            onTodoClick={controller.openEdit}
            onToggleStatus={(todo) => void controller.toggleStatus(todo)}
          />
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
