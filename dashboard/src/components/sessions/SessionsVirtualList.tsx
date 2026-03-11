import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SessionRow } from '@/components/sessions/SessionRow';
import type { ScoreBreakdown, SessionWithApp } from '@/lib/db-types';
import { formatDuration } from '@/lib/utils';
import type { SessionIndicatorSettings } from '@/lib/user-settings';

type GroupedProject = {
  projectId: number | null;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  boostedCount: number;
  sessions: SessionWithApp[];
};

type FlatItem =
  | { type: 'header'; group: GroupedProject; isCompact: boolean }
  | {
      type: 'session';
      session: SessionWithApp;
      group: GroupedProject;
      isCompact: boolean;
      isFirstInGroup: boolean;
      isLastInGroup: boolean;
      isSplittable: boolean;
    };

type SessionsVirtualListProps = {
  customScrollParent?: HTMLElement;
  flattenedItems: FlatItem[];
  showUnassignedBanner: boolean;
  unassignedSessionCount: number;
  onFilterUnassigned: () => void;
  onSelectProjectFilter: (projectId: number | 'unassigned') => void;
  resolveGroupProjectId: (group: GroupedProject) => number | null;
  displayProjectName: (name: string, projectId?: number | null) => string;
  onProjectContextMenu: (
    event: MouseEvent,
    projectId: number | null,
    projectName: string,
  ) => void;
  dismissedSuggestions: Set<number>;
  onToggleScoreBreakdown: (sessionId: number, event: MouseEvent) => void;
  scoreBreakdownSessionId: number | null;
  getScoreBreakdownData: (sessionId: number) => ScoreBreakdown | null;
  deleteSession: (id: number) => Promise<void>;
  onSessionContextMenu: (event: MouseEvent, session: SessionWithApp) => void;
  indicators: SessionIndicatorSettings;
  viewMode: 'compact' | 'detailed' | 'ai_detailed';
  loadingBreakdownIds: Set<number>;
  onAcceptSuggestion: (session: SessionWithApp, event: MouseEvent) => void;
  onRejectSuggestion: (session: SessionWithApp, event: MouseEvent) => void;
  onSplitClick: (session: SessionWithApp) => void;
  isEmpty: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
};

export function SessionsVirtualList({
  customScrollParent,
  flattenedItems,
  showUnassignedBanner,
  unassignedSessionCount,
  onFilterUnassigned,
  onSelectProjectFilter,
  resolveGroupProjectId,
  displayProjectName,
  onProjectContextMenu,
  dismissedSuggestions,
  onToggleScoreBreakdown,
  scoreBreakdownSessionId,
  getScoreBreakdownData,
  deleteSession,
  onSessionContextMenu,
  indicators,
  viewMode,
  loadingBreakdownIds,
  onAcceptSuggestion,
  onRejectSuggestion,
  onSplitClick,
  isEmpty,
  hasMore,
  onLoadMore,
}: SessionsVirtualListProps) {
  const { t } = useTranslation();

  return (
    <>
      {showUnassignedBanner && unassignedSessionCount > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/20">
            <span className="text-[10px] font-bold text-amber-500">!</span>
          </div>
          <p className="text-[11px] font-medium text-amber-200/80">
            <span className="font-bold text-amber-400">
              {t('sessions.banner.unassigned_sessions', {
                count: unassignedSessionCount,
              })}
            </span>
            . {t('sessions.banner.hint')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 text-[10px] text-amber-400 hover:bg-amber-500/10"
            onClick={onFilterUnassigned}
          >
            {t('sessions.banner.filter')}
          </Button>
        </div>
      )}

      {flattenedItems.length > 0 ? (
        <Virtuoso
          customScrollParent={customScrollParent}
          data={flattenedItems}
          itemContent={(_index: number, item: FlatItem) => {
            if (item.type === 'header') {
              const { group, isCompact } = item;
              const projectMenuId = resolveGroupProjectId(group);

              if (isCompact) {
                return (
                  <div className="mt-4 space-y-1 first:mt-0">
                    <div
                      data-project-id={projectMenuId ?? undefined}
                      data-project-name={
                        projectMenuId != null ? group.projectName : undefined
                      }
                      className="group/hdr flex cursor-pointer items-center justify-between gap-4 px-2 py-1 leading-none"
                      onClick={() =>
                        onSelectProjectFilter(
                          projectMenuId == null ? 'unassigned' : projectMenuId,
                        )
                      }
                      onContextMenu={(event) =>
                        onProjectContextMenu(
                          event,
                          projectMenuId,
                          group.projectName,
                        )
                      }
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)]"
                          style={{ backgroundColor: group.projectColor }}
                        />
                        <span className="text-[13px] font-bold tracking-tight text-foreground/90">
                          {displayProjectName(group.projectName, projectMenuId)}
                        </span>
                        <Badge
                          variant="secondary"
                          className="h-4 border-none bg-secondary/40 px-1.5 text-[10px] font-medium text-muted-foreground/80"
                        >
                          {t('sessions.group.sessions_count', {
                            count: group.sessions.length,
                          })}
                        </Badge>
                        {group.boostedCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400/80">
                            <CircleDollarSign className="h-3 w-3" />
                            {t('sessions.group.boosted_count', {
                              count: group.boostedCount,
                            })}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[13px] font-bold text-foreground/40 transition-colors group-hover/hdr:text-foreground/70">
                        {formatDuration(group.totalSeconds)}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div className="relative z-10 mt-4 rounded-t-xl border-x border-t border-border/30 bg-background/50 px-3 pt-3 backdrop-blur-sm first:mt-0">
                  <div
                    data-project-id={projectMenuId ?? undefined}
                    data-project-name={
                      projectMenuId != null ? group.projectName : undefined
                    }
                    className="flex items-center justify-between gap-2 border-b border-border/5 pb-2"
                    onContextMenu={(event) =>
                      onProjectContextMenu(
                        event,
                        projectMenuId,
                        group.projectName,
                      )
                    }
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.4)]"
                        style={{ backgroundColor: group.projectColor }}
                      />
                      <span className="select-none text-lg font-bold tracking-tight">
                        {displayProjectName(group.projectName, projectMenuId)}
                      </span>
                      <Badge
                        variant="outline"
                        className="h-4 border-border/40 px-1.5 text-[10px] text-muted-foreground/60"
                      >
                        {t('sessions.group.sessions_count', {
                          count: group.sessions.length,
                        })}
                      </Badge>
                    </div>
                    <span className="font-mono text-base font-bold text-foreground/70">
                      {formatDuration(group.totalSeconds)}
                    </span>
                  </div>
                </div>
              );
            }

            const {
              session,
              isCompact,
              isLastInGroup,
              isFirstInGroup,
              isSplittable,
            } = item;
            const rowViewMode = isCompact
              ? 'compact'
              : viewMode === 'ai_detailed'
                ? 'ai_detailed'
                : 'detailed';
            const scoreBreakdownData = getScoreBreakdownData(session.id);

            if (isCompact) {
              return (
                <div className="px-0.5">
                  <SessionRow
                    session={session}
                    dismissedSuggestions={dismissedSuggestions}
                    handleToggleScoreBreakdown={onToggleScoreBreakdown}
                    scoreBreakdownSessionId={scoreBreakdownSessionId}
                    scoreBreakdownData={scoreBreakdownData}
                    deleteSession={deleteSession}
                    handleContextMenu={onSessionContextMenu}
                    isCompact={true}
                    indicators={indicators}
                    forceShowScoreBreakdown={false}
                    isLoadingScoreBreakdown={loadingBreakdownIds.has(session.id)}
                    onAcceptSuggestion={onAcceptSuggestion}
                    onRejectSuggestion={onRejectSuggestion}
                    isSplittable={isSplittable}
                    onSplitClick={onSplitClick}
                    className="!mb-0"
                  />
                  {isLastInGroup && <div className="h-4" />}
                </div>
              );
            }

            return (
              <div
                className={`border-x border-border/30 bg-background/50 px-3 backdrop-blur-sm ${
                  isFirstInGroup ? 'pt-3' : 'pt-0'
                } ${isLastInGroup ? 'mb-4 rounded-b-xl border-b pb-3' : ''}`}
              >
                <div className="h-full">
                  <SessionRow
                    session={session}
                    dismissedSuggestions={dismissedSuggestions}
                    handleToggleScoreBreakdown={onToggleScoreBreakdown}
                    scoreBreakdownSessionId={scoreBreakdownSessionId}
                    scoreBreakdownData={scoreBreakdownData}
                    deleteSession={deleteSession}
                    handleContextMenu={onSessionContextMenu}
                    indicators={indicators}
                    forceShowScoreBreakdown={rowViewMode === 'ai_detailed'}
                    isLoadingScoreBreakdown={
                      rowViewMode === 'ai_detailed' &&
                      loadingBreakdownIds.has(session.id)
                    }
                    onAcceptSuggestion={onAcceptSuggestion}
                    onRejectSuggestion={onRejectSuggestion}
                    isSplittable={isSplittable}
                    onSplitClick={onSplitClick}
                    className="!mb-0"
                  />
                </div>
              </div>
            );
          }}
          components={{
            Footer: () => <div className="h-[300px]" />,
          }}
        />
      ) : null}

      {isEmpty && (
        <div className="py-24 text-center">
          <p className="text-sm font-medium italic text-muted-foreground/30">
            {t('sessions.empty.no_activity')}
          </p>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[11px] font-bold text-muted-foreground/50 hover:text-foreground"
            onClick={onLoadMore}
          >
            {t('sessions.actions.load_older')}
          </Button>
        </div>
      )}
    </>
  );
}
