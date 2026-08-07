import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
        setProjectOptions(
          projects
            // Tylko AKTYWNE — menu przypisania sesji filtruje tak samo
            // (`!frozen_at`), więc zamrożone, wykluczone i zarchiwizowane
            // projekty nie zaśmiecają listy dziesiątkami pozycji.
            .filter((p) => p.status === 'active')
            .map((p) => ({ name: p.name, color: p.color }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setClientOptions(
          clients
            .map((c) => ({ name: c.name, color: c.color }))
            .sort((a, b) => a.name.localeCompare(b.name)),
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
