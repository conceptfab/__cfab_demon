import {
  Info,
  MessageSquare,
  Pencil,
  Trash2,
  UserMinus,
} from 'lucide-react';

import { RateMultiplierPanel } from '@/components/project-page/RateMultiplierPanel';
import type { ProjectPageContextMenusProps } from '@/components/project-page/project-page-context-menu-props';
import { getProjectPageContextMenuStyle } from '@/components/project-page/project-page-context-menu-utils';
import type { ProjectPageContextMenu } from '@/components/project-page/project-page-context-menu-utils';
import { logger } from '@/lib/logger';

type SessionContextMenu = Extract<ProjectPageContextMenu, { type: 'session' }>;

type ProjectPageSessionContextMenuProps = Omit<
  ProjectPageContextMenusProps,
  'ctxMenu'
> & {
  ctxMenu: SessionContextMenu;
};

export function ProjectPageSessionContextMenu({
  ctxMenu,
  ctxRef,
  t,
  setCtxMenu,
  setSelectedSessionDetail,
  setSessionDetailOpen,
  setEditManualSession,
  setSessionDialogOpen,
  handleSetRateMultiplier,
  handleCustomRateMultiplier,
  handleEditComment,
  handleAssign,
  confirm,
  deleteManualSessions,
  deleteSessions,
}: ProjectPageSessionContextMenuProps) {
  const { session } = ctxMenu;
  const isManual = session.isManual;

  const handleDelete = async () => {
    if (!(await confirm(t('project_page.text.delete_this_session')))) return;
    try {
      if (isManual) {
        await deleteManualSessions(session.id);
      } else {
        await deleteSessions(session.id);
      }
    } catch (err) {
      logger.error(err);
    }
    setCtxMenu(null);
  };

  return (
    <div
      ref={ctxRef}
      className="fixed z-50 min-w-[240px] max-w-[min(92vw,30rem)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={getProjectPageContextMenuStyle(ctxMenu.x, ctxMenu.y, 240)}
    >
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
        {t('project_page.text.session_actions_1_app')}
      </div>

      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          setSelectedSessionDetail(session);
          setSessionDetailOpen(true);
          setCtxMenu(null);
        }}
      >
        <Info className="size-4 shrink-0 text-muted-foreground" />
        <span>{t('project_page.text.session_details')}</span>
      </button>

      {isManual ? (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            setEditManualSession(session);
            setSessionDialogOpen(true);
            setCtxMenu(null);
          }}
        >
          <Pencil className="size-4 shrink-0 text-muted-foreground" />
          <span>{t('project_page.text.edit_manual_session_2')}</span>
        </button>
      ) : (
        <>
          <div className="my-1 h-px bg-border" />
          <RateMultiplierPanel
            description={t('project_page.text.applies_to_this_session_record')}
            currentMultiplierLabel={t('project_page.text.rate_multiplier_default_x2')}
            currentMultiplier={session.rate_multiplier}
            boostLabel={t('project_page.text.boost_x2')}
            customLabel={t('project_page.text.custom')}
            onBoost={() => {
              void handleSetRateMultiplier(2, [session.id]);
              setCtxMenu(null);
            }}
            onCustom={handleCustomRateMultiplier}
          />
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={handleEditComment}
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span>
              {session.comment
                ? t('project_page.text.edit_comment')
                : t('project_page.text.add_comment')}
            </span>
          </button>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => void handleAssign(null)}
          >
            <UserMinus className="size-4 shrink-0 text-muted-foreground" />
            <span>{t('project_page.text.unassign_from_project')}</span>
          </button>
        </>
      )}

      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
        onClick={() => void handleDelete()}
      >
        <Trash2 className="size-4 shrink-0" />
        <span>{t('project_page.text.delete_session')}</span>
      </button>
    </div>
  );
}
