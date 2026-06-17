import { PmProjectsDesktopTable } from '@/components/pm/PmProjectsDesktopTable';
import { PmProjectsMobileList } from '@/components/pm/PmProjectsMobileList';
import { PmProjectsStatusBar } from '@/components/pm/PmProjectsStatusBar';
import { PmProjectsToolbar } from '@/components/pm/PmProjectsToolbar';
import {
  usePmProjectsListController,
  type UsePmProjectsListControllerOptions,
} from '@/hooks/usePmProjectsListController';

export function PmProjectsList(props: UsePmProjectsListControllerOptions) {
  const controller = usePmProjectsListController(props);
  const {
    displayed,
    hasAnyFilter,
    projects,
    savedMsg,
    t,
    clientGroupOf,
  } = controller;

  if (projects.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        {t('pm.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <PmProjectsToolbar {...controller} />

      {hasAnyFilter && (
        <p className="text-[10px] text-muted-foreground shrink-0">
          {t('pm.filter.showing')}: {displayed.length} / {projects.length}
        </p>
      )}

      {savedMsg && (
        <p className="text-[10px] text-green-400 shrink-0">{savedMsg}</p>
      )}

      <PmProjectsMobileList {...controller} />
      <PmProjectsDesktopTable {...controller} />

      <PmProjectsStatusBar
        projects={displayed}
        clientGroupOf={clientGroupOf}
        t={t}
      />
    </div>
  );
}
