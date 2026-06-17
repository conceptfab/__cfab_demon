import { format, parseISO } from 'date-fns';
import {
  Clock,
  Info,
  MessageSquare,
  Trash2,
  UserMinus,
} from 'lucide-react';
import { useMemo } from 'react';

import { RateMultiplierPanel } from '@/components/project-page/RateMultiplierPanel';
import type { ProjectPageContextMenusProps } from '@/components/project-page/project-page-context-menu-props';
import { getProjectPageContextMenuStyle } from '@/components/project-page/project-page-context-menu-utils';
import type { ProjectPageContextMenu } from '@/components/project-page/project-page-context-menu-utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

type ChartContextMenu = Extract<ProjectPageContextMenu, { type: 'chart' }>;

type ProjectPageChartContextMenuProps = Omit<
  ProjectPageContextMenusProps,
  'ctxMenu'
> & {
  ctxMenu: ChartContextMenu;
};

export function ProjectPageChartContextMenu({
  ctxMenu,
  ctxRef,
  t,
  i18n,
  sessionCountLabel,
  appCountLabel,
  setCtxMenu,
  setSessionDialogDate,
  setEditManualSession,
  setSessionDialogOpen,
  setSelectedSessionDetail,
  setSessionDetailOpen,
  handleSetRateMultiplier,
  handleCustomRateMultiplier,
  handleEditComment,
  handleBulkUnassign,
  handleBulkDelete,
}: ProjectPageChartContextMenuProps) {
  const { date, sessions } = ctxMenu;
  const hasSessions = sessions.length > 0;

  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);
  const formattedDate = format(parseISO(`${date}T12:00:00`), 'PPPP', {
    locale,
  });

  const uniqueApps = useMemo(
    () => [...new Set(sessions.map((s) => s.app_name))],
    [sessions],
  );

  const autoSessionIds = useMemo(
    () =>
      sessions.reduce<number[]>((acc, s) => {
        if (!s.isManual) acc.push(s.id);
        return acc;
      }, []),
    [sessions],
  );

  const currentMultiplier =
    sessions.find((s) => !s.isManual)?.rate_multiplier ??
    sessions[0]?.rate_multiplier ??
    1;

  const menuStyle = getProjectPageContextMenuStyle(ctxMenu.x, ctxMenu.y, 260);

  if (!hasSessions) {
    return (
      <div
        ref={ctxRef}
        className="fixed z-50 min-w-[220px] max-w-[min(92vw,26rem)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        style={menuStyle}
      >
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          {t('project_page.text.zone_actions')}
        </div>
        <div className="px-2 pb-1 text-[11px] text-muted-foreground">
          {formattedDate}
        </div>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            setSessionDialogDate(date);
            setEditManualSession(null);
            setSessionDialogOpen(true);
            setCtxMenu(null);
          }}
        >
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <span>{t('project_page.text.log_time_for_this_slot')}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ctxRef}
      className="fixed z-50 min-w-[260px] max-w-[min(92vw,30rem)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={menuStyle}
    >
      <div className="px-2 py-1.5 text-xs font-semibold leading-snug text-muted-foreground">
        {t('project_page.text.bulk_action_on_sessions_apps_affected', {
          count: sessions.length,
          apps: uniqueApps.join(', '),
        })}
      </div>
      <div className="px-2 pb-1 text-[10px] text-muted-foreground/80">
        {sessionCountLabel(sessions.length)} ·{' '}
        {appCountLabel(uniqueApps.length)}
      </div>

      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          setSelectedSessionDetail(sessions[0] ?? null);
          setSessionDetailOpen(true);
          setCtxMenu(null);
        }}
      >
        <span className="flex items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" />
          {t('project_page.text.session_details')}
        </span>
        <span className="font-mono text-[10px] opacity-80">
          {sessions.length}
        </span>
      </button>

      {autoSessionIds.length > 0 && (
        <>
          <div className="my-1 h-px bg-border" />
          <RateMultiplierPanel
            description={t(
              'project_page.text.applies_to_all_sessions_in_this_visual_chunk',
              { count: autoSessionIds.length },
            )}
            currentMultiplierLabel={t(
              'project_page.text.rate_multiplier_default_x2',
            )}
            currentMultiplier={currentMultiplier}
            boostLabel={t('project_page.text.boost_x2')}
            customLabel={t('project_page.text.custom')}
            onBoost={() => {
              void handleSetRateMultiplier(2, autoSessionIds);
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
              {sessions.some((s) => s.comment)
                ? t('project_page.text.edit_comment')
                : t('project_page.text.add_comment')}
            </span>
          </button>
        </>
      )}

      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => void handleBulkUnassign(sessions)}
      >
        <UserMinus className="size-4 shrink-0 text-muted-foreground" />
        <span>{t('project_page.text.unassign_group_from_project')}</span>
      </button>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
        onClick={() => void handleBulkDelete(sessions)}
      >
        <Trash2 className="size-4 shrink-0" />
        <span>{t('project_page.text.delete_group')}</span>
      </button>
    </div>
  );
}
