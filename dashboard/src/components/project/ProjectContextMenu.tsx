import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";

interface ProjectMenuState {
  x: number;
  y: number;
  projectId: number;
  projectName: string;
}

const MENU_WIDTH = 260;
const MENU_HEIGHT = 92;
const MENU_EDGE_PADDING = 8;

function clampToViewport(x: number, y: number) {
  const maxX = Math.max(MENU_EDGE_PADDING, window.innerWidth - MENU_WIDTH - MENU_EDGE_PADDING);
  const maxY = Math.max(MENU_EDGE_PADDING, window.innerHeight - MENU_HEIGHT - MENU_EDGE_PADDING);
  return {
    x: Math.min(Math.max(MENU_EDGE_PADDING, x), maxX),
    y: Math.min(Math.max(MENU_EDGE_PADDING, y), maxY),
  };
}

export function ProjectContextMenu() {
  const [menu, setMenu] = useState<ProjectMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const setProjectPageId = useAppStore((s) => s.setProjectPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      const targetElement =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      if (!targetElement) return;

      const holder = targetElement.closest<HTMLElement>("[data-project-id]");
      if (!holder) return;

      const rawProjectId = holder.dataset.projectId;
      const projectId = Number.parseInt(rawProjectId ?? "", 10);
      if (!Number.isFinite(projectId) || projectId <= 0) return;

      event.preventDefault();
      event.stopPropagation();

      const projectName = holder.dataset.projectName?.trim() || `#${projectId}`;
      const point = clampToViewport(event.clientX, event.clientY);
      setMenu({
        x: point.x,
        y: point.y,
        projectId,
        projectName,
      });
    };

    document.addEventListener("contextmenu", handleContextMenu, true);
    return () => document.removeEventListener("contextmenu", handleContextMenu, true);
  }, []);

  useEffect(() => {
    if (!menu) return;

    const closeOnPointer = (event: MouseEvent) => {
      if (!menuRef.current) {
        setMenu(null);
        return;
      }
      if (event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      setMenu(null);
    };

    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };

    const closeOnViewportChange = () => setMenu(null);

    document.addEventListener("mousedown", closeOnPointer, true);
    document.addEventListener("keydown", closeOnEsc);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", closeOnPointer, true);
      document.removeEventListener("keydown", closeOnEsc);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[120] min-w-[240px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="px-2 py-1 text-[11px] text-muted-foreground">
        Project: <span className="font-medium text-foreground">{menu.projectName}</span>
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
        onClick={() => {
          setProjectPageId(menu.projectId);
          setCurrentPage("project-card");
          setMenu(null);
        }}
      >
        Przejdz do karty projektu
      </button>
    </div>
  );
}
