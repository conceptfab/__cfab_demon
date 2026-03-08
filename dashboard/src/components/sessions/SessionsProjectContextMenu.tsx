import type { RefObject } from 'react';

interface ProjectContextMenuState {
  x: number;
  y: number;
  projectId: number | null;
  projectName: string;
}

interface SessionsProjectContextMenuProps {
  menu: ProjectContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;
  projectLabel: string;
  projectNameDisplay: string;
  goToProjectCardLabel: string;
  noLinkedProjectCardLabel: string;
  onNavigateToProject: (projectId: number) => void;
  onClose: () => void;
}

export function SessionsProjectContextMenu({
  menu,
  menuRef,
  projectLabel,
  projectNameDisplay,
  goToProjectCardLabel,
  noLinkedProjectCardLabel,
  onNavigateToProject,
  onClose,
}: SessionsProjectContextMenuProps) {
  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[130] min-w-[240px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="px-2 py-1 text-[11px] text-muted-foreground">
        {projectLabel}{' '}
        <span className="font-medium text-foreground">{projectNameDisplay}</span>
      </div>
      <button
        type="button"
        disabled={menu.projectId == null}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          if (menu.projectId == null) return;
          onNavigateToProject(menu.projectId);
          onClose();
        }}
      >
        {menu.projectId == null ? noLinkedProjectCardLabel : goToProjectCardLabel}
      </button>
    </div>
  );
}
