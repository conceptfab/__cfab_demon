import type { RefObject } from 'react';
import { Flame, MessageSquare, Scissors, Sparkles, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import type { SessionWithApp } from '@/lib/db-types';
import { localizeProjectLabel } from '@/lib/project-labels';
import { formatMultiplierLabel } from '@/lib/utils';

type AssignProjectListMode = 'alpha_active' | 'new_top_rest' | 'top_new_rest';

type AssignProjectSection = {
  key: string;
  label: string;
  projects: Array<{
    id: number;
    name: string;
    color: string;
  }>;
};

type SessionContextMenuProps = {
  menu: {
    x: number;
    y: number;
    session: SessionWithApp;
  };
  menuRef: RefObject<HTMLDivElement | null>;
  placement: {
    left: number;
    top: number;
    maxHeight: number;
  } | null;
  splitSuggested: boolean;
  assignProjectListMode: AssignProjectListMode;
  onAssignProjectListModeChange: (mode: AssignProjectListMode) => void;
  assignProjectSections: AssignProjectSection[];
  assignProjectsCount: number;
  showAssignSectionHeaders: boolean;
  onAcceptSuggestion: () => void;
  onRejectSuggestion: () => void;
  onSetRateMultiplier: (multiplier: number | null) => void;
  onCustomRateMultiplier: () => void;
  onEditComment: () => void;
  onOpenSplit: () => void;
  onAssign: (projectId: number | null, source?: string) => void;
  isManual?: boolean;
};

export function SessionContextMenu({
  menu,
  menuRef,
  placement,
  splitSuggested,
  assignProjectListMode,
  onAssignProjectListModeChange,
  assignProjectSections,
  assignProjectsCount,
  showAssignSectionHeaders,
  onAcceptSuggestion,
  onRejectSuggestion,
  onSetRateMultiplier,
  onCustomRateMultiplier,
  onEditComment,
  onOpenSplit,
  onAssign,
  isManual,
}: SessionContextMenuProps) {
  const { t } = useTranslation();

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[240px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: placement?.left ?? menu.x,
        top: placement?.top ?? menu.y,
        maxHeight: placement?.maxHeight,
      }}
    >
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
        {t('sessions.menu.session_actions', {
          app: menu.session.app_name,
        })}
      </div>
      {menu.session.suggested_project_id !== undefined &&
        menu.session.suggested_project_name &&
        menu.session.project_name === null && (
          <div className="mx-1 mb-1 rounded-sm border border-sky-500/25 bg-sky-500/15 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 shrink-0 text-sky-400" />
              <span className="text-[11px] text-sky-200">
                {t('sessions.menu.ai_suggests')}{' '}
                <span className="font-medium">
                  {localizeProjectLabel(menu.session.suggested_project_name, {
                    projectId: menu.session.suggested_project_id ?? null,
                  })}
                </span>
                {menu.session.suggested_confidence !== undefined && (
                  <span className="ml-1 opacity-75">
                    ({(menu.session.suggested_confidence * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <button
                className="cursor-pointer rounded-sm bg-sky-500/25 px-2 py-1 text-[11px] text-sky-100 transition-colors hover:bg-sky-500/40"
                onClick={onAcceptSuggestion}
              >
                {t('sessions.menu.accept')}
              </button>
              <button
                className="cursor-pointer rounded-sm px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40"
                onClick={onRejectSuggestion}
              >
                {t('sessions.menu.reject')}
              </button>
            </div>
          </div>
        )}
      {!isManual && (
        <>
          <div className="my-1 h-px bg-border" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t('sessions.menu.rate_multiplier')}{' '}
            <span className="font-mono">
              {formatMultiplierLabel(menu.session.rate_multiplier)}
            </span>
          </div>
          <div className="flex gap-1.5 px-1.5 pb-1.5">
            <button
              className="flex-1 cursor-pointer rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
              onClick={() => onSetRateMultiplier(2)}
            >
              {t('sessions.menu.boost_x2')}
            </button>
            <button
              className="flex-1 cursor-pointer rounded border border-border bg-secondary/30 py-2 text-xs font-medium transition-colors hover:bg-secondary/60"
              onClick={onCustomRateMultiplier}
            >
              {t('sessions.menu.custom')}
            </button>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={onEditComment}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {menu.session.comment
                ? t('sessions.menu.edit_comment')
                : t('sessions.menu.add_comment')}
            </span>
          </button>
        </>
      )}
      {!isManual && splitSuggested && (
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={onOpenSplit}
        >
          <Scissors className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{t('sessions.menu.split_session', 'Split session')}</span>
        </button>
      )}
      <div className="my-1 h-px bg-border" />
      <div className="px-2 py-1 text-[11px] text-muted-foreground">
        {t('sessions.menu.assign_to_project')}
      </div>
      <div className="px-2 pb-1.5">
        <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
          <AppTooltip
            content={t(
              'sessions.menu.mode_alpha',
              'Aktywne alfabetycznie (A-Z)',
            )}
          >
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                assignProjectListMode === 'alpha_active'
                  ? 'bg-background text-sky-200 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => onAssignProjectListModeChange('alpha_active')}
            >
              <Type className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip
            content={t(
              'sessions.menu.mode_new_top',
              'Najnowsze -> Top -> Reszta (A-Z)',
            )}
          >
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                assignProjectListMode === 'new_top_rest'
                  ? 'bg-background text-amber-300 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => onAssignProjectListModeChange('new_top_rest')}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip
            content={t(
              'sessions.menu.mode_top_new',
              'Top -> Najnowsze -> Reszta (A-Z)',
            )}
          >
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                assignProjectListMode === 'top_new_rest'
                  ? 'bg-background text-orange-300 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => onAssignProjectListModeChange('top_new_rest')}
            >
              <Flame className="h-3.5 w-3.5" />
            </button>
          </AppTooltip>
        </div>
      </div>
      <div
        className="max-h-[min(42vh,20rem)] overflow-y-auto pr-1"
        style={{ scrollbarGutter: 'stable' }}
      >
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() => onAssign(null, 'manual_session_unassign')}
        >
          <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/60" />
          <span className="truncate">{t('sessions.menu.unassigned')}</span>
        </button>
        {assignProjectsCount > 0 ? (
          assignProjectSections.map((section) => (
            <div key={section.key}>
              {showAssignSectionHeaders && section.projects.length > 0 && (
                <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                  {section.label}
                </div>
              )}
              {section.projects.map((project) => (
                <button
                  key={project.id}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onAssign(project.id, 'manual_session_change')}
                >
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
            </div>
          ))
        ) : (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {t('sessions.menu.no_projects')}
          </div>
        )}
      </div>
    </div>
  );
}
