import { fmtHourMinute } from '@/components/dashboard/project-day-timeline/timeline-calculations';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

type ProjectDayTimelineManualMenuProps = Pick<
  ProjectDayTimelineController,
  | 'ctxMenu'
  | 'ctxMenuPlacement'
  | 'ctxRef'
  | 'handleAddSession'
  | 'onAddManualSession'
  | 't'
>;

export function ProjectDayTimelineManualMenu({
  ctxMenu,
  ctxMenuPlacement,
  ctxRef,
  handleAddSession,
  onAddManualSession,
  t,
}: ProjectDayTimelineManualMenuProps) {
  if (!ctxMenu || ctxMenu.type !== 'timeline' || !onAddManualSession) {
    return null;
  }

  return (
    <div
      ref={ctxRef}
      className="fixed z-50 min-w-[180px] max-w-[min(92vw,22rem)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: ctxMenuPlacement?.left ?? ctxMenu.x,
        top: ctxMenuPlacement?.top ?? ctxMenu.y,
      }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
        onClick={handleAddSession}
      >
        {ctxMenu.editSession
          ? t('project_day_timeline.text.edit_delete_session')
          : t('project_day_timeline.text.add_session', {
              time: fmtHourMinute(ctxMenu.timeMs),
            })}
      </button>
    </div>
  );
}
