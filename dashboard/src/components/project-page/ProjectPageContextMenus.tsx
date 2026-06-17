import { ProjectPageChartContextMenu } from '@/components/project-page/ProjectPageChartContextMenu';
import { ProjectPageSessionContextMenu } from '@/components/project-page/ProjectPageSessionContextMenu';
import type { ProjectPageContextMenusProps } from '@/components/project-page/project-page-context-menu-props';

export type { ProjectPageContextMenusProps } from '@/components/project-page/project-page-context-menu-props';

export function ProjectPageContextMenus({
  ctxMenu,
  ctxRef,
  ...rest
}: ProjectPageContextMenusProps) {
  if (!ctxMenu) return null;

  if (ctxMenu.type === 'chart') {
    return (
      <ProjectPageChartContextMenu ctxMenu={ctxMenu} ctxRef={ctxRef} {...rest} />
    );
  }

  return (
    <ProjectPageSessionContextMenu ctxMenu={ctxMenu} ctxRef={ctxRef} {...rest} />
  );
}
