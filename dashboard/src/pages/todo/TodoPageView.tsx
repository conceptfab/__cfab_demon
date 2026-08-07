import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TodoDialog } from '@/components/todo/TodoDialog';
import { TodoGroupList } from '@/components/todo/TodoGroupList';
import { TodoToolbar } from '@/components/todo/TodoToolbar';
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

      <TodoToolbar
        search={controller.search}
        setSearch={controller.setSearch}
        scopeFilter={controller.scopeFilter}
        setScopeFilter={controller.setScopeFilter}
        showDone={controller.showDone}
        setShowDone={controller.setShowDone}
        onAdd={controller.openCreate}
      />

      <TodoGroupList
        groups={controller.groups}
        hasAnyTodo={controller.hasAnyTodo}
        loading={controller.loading}
        error={controller.error}
        onToggle={(todo) => void controller.toggleStatus(todo)}
        onEdit={controller.openEdit}
        onDelete={(todo) => void controller.remove(todo)}
      />

      <TodoDialog
        controller={controller}
        projectNames={projectNames}
        clientNames={clientNames}
      />
    </div>
  );
}
