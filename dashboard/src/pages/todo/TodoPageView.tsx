import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TodoDialog } from '@/components/todo/TodoDialog';
import { TodoCalendar } from '@/components/todo/TodoCalendar';
import { TodoGroupList } from '@/components/todo/TodoGroupList';
import { TodoToolbar } from '@/components/todo/TodoToolbar';
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
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [clientNames, setClientNames] = useState<string[]>([]);

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
        setProjectNames(
          projects.map((p) => p.name).sort((a, b) => a.localeCompare(b)),
        );
        setClientNames(
          clients.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
        );
      } catch (e) {
        logger.error('[todos] reference lists failed:', e);
      }
    })();
  }, []);

  return (
    <div className={`${mobileLayout.pageContainer} max-w-5xl`}>
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
      ) : (
        <div className="overflow-x-auto">
          <TodoCalendar
            weeks={controller.calendarWeeks}
            onDayClick={controller.openCreateForDate}
            onTodoClick={controller.openEdit}
          />
        </div>
      )}

      {controller.withoutDate.length > 0 && (
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
        projectNames={projectNames}
        clientNames={clientNames}
      />
    </div>
  );
}
