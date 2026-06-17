import type {
  ManualSessionRow,
  ProjectSessionRow,
} from '@/components/project-page/ProjectSessionsList';

export type ProjectPageContextMenu =
  | {
      x: number;
      y: number;
      session: ProjectSessionRow;
      type: 'session';
    }
  | {
      x: number;
      y: number;
      type: 'chart';
      date: string;
      sessions: ProjectSessionRow[];
    };

export function getProjectPageContextMenuStyle(
  x: number,
  y: number,
  minWidth: number,
) {
  const padding = 8;
  const viewportWidth =
    typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportHeight =
    typeof window !== 'undefined' ? window.innerHeight : 1080;
  const left = Math.min(
    Math.max(x, padding),
    viewportWidth - minWidth - padding,
  );
  const openUpward = y > viewportHeight * 0.62;
  const top = Math.min(Math.max(y, padding), viewportHeight - padding);
  return {
    left,
    top,
    transform: openUpward ? 'translateY(-100%)' : 'none',
  } as const;
}

export type { ManualSessionRow };
