import { Flame, MessageSquare, Sparkles, Type } from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { formatMultiplierLabel } from '@/lib/utils';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

type ProjectDayTimelineAssignMenuProps = Pick<
  ProjectDayTimelineController,
  | 'assignProjectListMode'
  | 'assignProjectSections'
  | 'assignProjectsCount'
  | 'ctxMenu'
  | 'ctxMenuPlacement'
  | 'ctxRef'
  | 'handleAssign'
  | 'handleCustomRateMultiplier'
  | 'handleEditComment'
  | 'handleOpenClusterDetails'
  | 'handleSetRateMultiplier'
  | 'onAssignSession'
  | 'onUpdateSessionComment'
  | 'onUpdateSessionRateMultiplier'
  | 'setAssignProjectListMode'
  | 'showAssignSectionHeaders'
  | 't'
>;

export function ProjectDayTimelineAssignMenu({
  assignProjectListMode,
  assignProjectSections,
  assignProjectsCount,
  ctxMenu,
  ctxMenuPlacement,
  ctxRef,
  handleAssign,
  handleCustomRateMultiplier,
  handleEditComment,
  handleOpenClusterDetails,
  handleSetRateMultiplier,
  onAssignSession,
  onUpdateSessionComment,
  onUpdateSessionRateMultiplier,
  setAssignProjectListMode,
  showAssignSectionHeaders,
  t,
}: ProjectDayTimelineAssignMenuProps) {
  if (!ctxMenu || ctxMenu.type !== 'assign') return null;

  return (
    <div
      ref={ctxRef}
      className="fixed z-50 min-w-[240px] max-w-[min(92vw,30rem)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: ctxMenuPlacement?.left ?? ctxMenu.x,
        top: ctxMenuPlacement?.top ?? ctxMenu.y,
        maxHeight: `${ctxMenuPlacement?.maxHeight ?? 560}px`,
      }}
    >
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
        {t('project_day_timeline.text.session_actions')} (
        {ctxMenu.segment.appName})
        {!ctxMenu.segment.isManual &&
        (ctxMenu.segment.fragmentCount ?? 1) > 1 ? (
          <span className="ml-1 text-[10px] font-normal">
            - {ctxMenu.segment.fragmentCount ?? 1} sessions
          </span>
        ) : null}
      </div>

      {ctxMenu.segment.hasSuggestion && !ctxMenu.segment.isManual && (
        <div className="mx-1 mb-1 rounded-sm bg-sky-500/15 border border-sky-500/25 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3 shrink-0 text-sky-400" />
            <span className="text-[11px] text-sky-200">
              {t('project_day_timeline.text.ai_suggests')}{' '}
              <span className="font-medium">
                {ctxMenu.segment.suggestedProjectName ||
                  t('project_day_timeline.text.unknown')}
              </span>
              {ctxMenu.segment.suggestedConfidence != null && (
                <span className="ml-1 opacity-75">
                  ({(ctxMenu.segment.suggestedConfidence * 100).toFixed(0)}%)
                </span>
              )}
            </span>
          </div>
          {onAssignSession && ctxMenu.segment.suggestedProjectId != null && (
            <div className="flex items-center gap-1 mt-1.5">
              <button
                type="button"
                className="rounded-sm bg-sky-500/25 hover:bg-sky-500/40 px-2 py-1 text-[11px] text-sky-100 transition-colors cursor-pointer"
                onClick={() =>
                  void handleAssign(ctxMenu.segment.suggestedProjectId ?? null)
                }
              >
                {t('project_day_timeline.text.accept')}
              </button>
              <button
                type="button"
                className="rounded-sm hover:bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors cursor-pointer"
                onClick={() => void handleAssign(null)}
              >
                {t('project_day_timeline.text.reject')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="h-px bg-border my-1" />
      <button
        type="button"
        className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer"
        onClick={handleOpenClusterDetails}
      >
        <span>{t('project_day_timeline.text.session_details')}</span>
        {!ctxMenu.segment.isManual &&
        (ctxMenu.segment.fragmentCount ?? 1) > 1 ? (
          <span className="font-mono text-[10px] opacity-80">
            {ctxMenu.segment.fragmentCount ?? 1}
          </span>
        ) : null}
      </button>

      {onUpdateSessionRateMultiplier && (
        <>
          <div className="h-px bg-border my-1" />
          {!ctxMenu.segment.isManual &&
            (ctxMenu.segment.fragmentCount ?? 1) > 1 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t(
                  'project_day_timeline.text.applies_to_all_sessions_in_this_visual_chunk',
                  { count: ctxMenu.segment.fragmentCount ?? 1 },
                )}
              </div>
            )}
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t('project_day_timeline.text.rate_multiplier_default_x2')}{' '}
            <span className="font-mono">
              {ctxMenu.segment.mixedRateMultiplier
                ? t('project_day_timeline.text.mixed')
                : formatMultiplierLabel(ctxMenu.segment.rateMultiplier)}
            </span>
          </div>
          <div className="flex gap-1.5 px-1.5 pb-1.5">
            <button
              type="button"
              className="flex-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
              onClick={() => void handleSetRateMultiplier(2)}
            >
              Boost x2
            </button>
            <button
              type="button"
              className="flex-1 rounded border border-border bg-secondary/30 py-2 text-xs font-medium transition-colors hover:bg-secondary/60 cursor-pointer"
              onClick={() => void handleCustomRateMultiplier()}
            >
              {t('project_day_timeline.text.custom')}
            </button>
          </div>
        </>
      )}

      {onUpdateSessionComment && !ctxMenu.segment.isManual && (
        <>
          <div className="h-px bg-border my-1" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={() => void handleEditComment()}
          >
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span>
              {ctxMenu.segment.comment
                ? t('project_day_timeline.text.edit_comment')
                : t('project_day_timeline.text.add_comment')}
            </span>
          </button>
        </>
      )}

      {onAssignSession && (
        <>
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t('project_day_timeline.text.assign_to_project')}
          </div>
          <div className="px-2 pb-1.5">
            <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
              <AppTooltip
                content={t('project_day_timeline.text.active_alphabetical_a_z')}
              >
                <button
                  type="button"
                  className={`inline-flex size-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'alpha_active'
                      ? 'bg-background text-sky-200 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setAssignProjectListMode('alpha_active')}
                  aria-label={t('project_day_timeline.text.active_alphabetical')}
                >
                  <Type className="size-3.5" />
                </button>
              </AppTooltip>
              <AppTooltip
                content={t('project_day_timeline.text.newest_top_rest_a_z')}
              >
                <button
                  type="button"
                  className={`inline-flex size-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'new_top_rest'
                      ? 'bg-background text-amber-300 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setAssignProjectListMode('new_top_rest')}
                  aria-label={t('project_day_timeline.text.newest_then_top')}
                >
                  <Sparkles className="size-3.5" />
                </button>
              </AppTooltip>
              <AppTooltip
                content={t('project_day_timeline.text.top_newest_rest_a_z')}
              >
                <button
                  type="button"
                  className={`inline-flex size-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'top_new_rest'
                      ? 'bg-background text-orange-300 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setAssignProjectListMode('top_new_rest')}
                  aria-label={t('project_day_timeline.text.top_then_newest')}
                >
                  <Flame className="size-3.5" />
                </button>
              </AppTooltip>
            </div>
          </div>
          <div
            className="max-h-[min(42vh,20rem)] overflow-y-auto pr-1"
            style={{ scrollbarGutter: 'stable' }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => handleAssign(null)}
            >
              <div className="size-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
              <span className="truncate">
                {t('project_day_timeline.text.unassigned')}
              </span>
            </button>
            {assignProjectsCount > 0 ? (
              assignProjectSections.map((section) => (
                <div key={section.key}>
                  {showAssignSectionHeaders && section.projects.length > 0 && (
                    <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                      {section.label}
                    </div>
                  )}
                  {section.projects.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                      onClick={() => handleAssign(p.id)}
                    >
                      <div
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('project_day_timeline.text.no_projects_available')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
