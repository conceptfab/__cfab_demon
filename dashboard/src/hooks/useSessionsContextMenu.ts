import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

import type { SessionWithApp } from '@/lib/db-types';
import {
  useClickOutsideDismiss,
  useEscapeKey,
} from '@/hooks/useDismissable';

export interface SessionsContextMenuState {
  x: number;
  y: number;
  session: SessionWithApp;
}

export interface SessionsProjectContextMenuState {
  x: number;
  y: number;
  projectId: number | null;
  projectName: string;
  sessionIds: number[];
}

interface SessionsContextMenuGroup {
  projectName: string;
  sessions: Array<Pick<SessionWithApp, 'id'>>;
}

interface UseSessionsContextMenuParams {
  groupedByProject: SessionsContextMenuGroup[];
}

interface ContextMenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export function useSessionsContextMenu({
  groupedByProject,
}: UseSessionsContextMenuParams) {
  const [ctxMenu, setCtxMenu] = useState<SessionsContextMenuState | null>(null);
  const [projectCtxMenu, setProjectCtxMenu] =
    useState<SessionsProjectContextMenuState | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const projectCtxRef = useRef<HTMLDivElement>(null);
  const [ctxMenuPlacement, setCtxMenuPlacement] =
    useState<ContextMenuPlacement | null>(null);

  // TODO: Extract shared context menu placement logic with ProjectDayTimeline (timeline-calculations.ts)
  const resolveContextMenuPlacement = useCallback(
    (
      x: number,
      y: number,
      viewportWidth: number,
      viewportHeight: number,
      menuSize: { width: number; height: number } | null,
    ) => {
      const width = Math.max(240, menuSize?.width ?? 0);
      const maxHeight = Math.max(200, viewportHeight - 16);
      const height = Math.min(Math.max(400, menuSize?.height ?? 0), maxHeight);

      const maxLeft = Math.max(8, viewportWidth - width - 8);
      const left = Math.min(Math.max(x, 8), maxLeft);

      const overflowsDown = y + height > viewportHeight - 8;
      const canFlipUp = y - height >= 8;
      const maxTop = Math.max(8, viewportHeight - height - 8);
      const top =
        overflowsDown && canFlipUp
          ? y - height
          : Math.min(Math.max(y, 8), maxTop);

      return { left, top, maxHeight };
    },
    [],
  );

  useEffect(() => {
    if (!ctxMenu || typeof window === 'undefined') return;

    const updatePlacement = () => {
      const next = resolveContextMenuPlacement(
        ctxMenu.x,
        ctxMenu.y,
        window.innerWidth,
        window.innerHeight,
        ctxRef.current
          ? {
              width: ctxRef.current.offsetWidth,
              height: ctxRef.current.offsetHeight,
            }
          : null,
      );
      setCtxMenuPlacement(next);
    };

    updatePlacement();
    const raf = window.requestAnimationFrame(updatePlacement);
    window.addEventListener('resize', updatePlacement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePlacement);
    };
  }, [ctxMenu, resolveContextMenuPlacement]);

  const closeSessionContextMenu = useCallback(() => setCtxMenu(null), []);
  const closeProjectContextMenu = useCallback(() => setProjectCtxMenu(null), []);
  const closeContextMenus = useCallback(() => {
    setCtxMenu(null);
    setProjectCtxMenu(null);
  }, []);

  useClickOutsideDismiss(ctxRef, closeSessionContextMenu, Boolean(ctxMenu));
  useClickOutsideDismiss(
    projectCtxRef,
    closeProjectContextMenu,
    Boolean(projectCtxMenu),
  );
  useEscapeKey(closeContextMenus, Boolean(ctxMenu || projectCtxMenu));

  const handleContextMenu = useCallback(
    (event: MouseEvent, session: SessionWithApp) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectCtxMenu(null);
      setCtxMenu({ x: event.clientX, y: event.clientY, session });
    },
    [],
  );

  const handleProjectContextMenu = useCallback(
    (event: MouseEvent, projectId: number | null, projectName: string) => {
      event.preventDefault();
      event.stopPropagation();
      setCtxMenu(null);
      const group = groupedByProject.find(
        (item) => item.projectName === projectName,
      );
      const sessionIds = group?.sessions.map((session) => session.id) ?? [];
      setProjectCtxMenu({
        x: event.clientX,
        y: event.clientY,
        projectId,
        projectName,
        sessionIds,
      });
    },
    [groupedByProject],
  );

  return {
    ctxMenu,
    ctxMenuPlacement,
    ctxRef,
    handleContextMenu,
    handleProjectContextMenu,
    projectCtxMenu,
    projectCtxRef,
    setCtxMenu,
    setProjectCtxMenu,
  };
}
