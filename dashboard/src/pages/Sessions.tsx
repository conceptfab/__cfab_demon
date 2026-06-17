import { mobileLayout } from '@/lib/mobile-layout';
import { SessionsToolbar } from '@/components/sessions/SessionsToolbar';
import { SessionsVirtualList } from '@/components/sessions/SessionsVirtualList';
import { SessionsPageOverlays } from '@/components/sessions/SessionsPageOverlays';
import { useSessionsPageController } from '@/hooks/useSessionsPageController';
import { useTranslation } from 'react-i18next';

export function Sessions() {
  const { t } = useTranslation();
  const controller = useSessionsPageController();
  const {
    activeProjectId,
    activeRangeLabel,
    canShiftForward,
    customScrollParent,
    deleteSessions,
    dismissedSuggestions,
    displayProjectName,
    flattenedItems,
    getScoreBreakdownData,
    handleAcceptSuggestion,
    handleContextMenu,
    handleProjectContextMenu,
    handleRejectSuggestion,
    handleToggleScoreBreakdown,
    hasMore,
    indicators,
    isSessionsLoading,
    loadMore,
    mergedSessions,
    openMultiSplitModal,
    rangeMode,
    resolveGroupProjectId,
    scoreBreakdown,
    sessionsError,
    sessionsSummaryText,
    setActiveProjectId,
    setOverrideDateRange,
    setRangeMode,
    setViewMode,
    shiftDateRange,
    unassignedGroup,
    viewMode,
    loadingBreakdownIds,
  } = controller;

  return (
    <div className={mobileLayout.pageStack}>
      <SessionsToolbar
        summary={{
          text: sessionsSummaryText,
          showUnassignedOnly: activeProjectId === 'unassigned',
          unassignedOnlyText: t('sessions.unassigned_only'),
          unassignedScopeText:
            activeProjectId === 'unassigned'
              ? t('sessions.unassigned_scope_all_dates')
              : undefined,
        }}
        range={{
          mode: rangeMode,
          label: activeRangeLabel,
          canShiftForward,
          labels: {
            today: t('sessions.range.today'),
            week: t('sessions.range.week'),
            previousTooltip: t('layout.tooltips.previous_period'),
            nextTooltip: t('layout.tooltips.next_period'),
            group: t('sessions.range.group'),
          },
          onModeChange: setRangeMode,
          onClearOverrideRange: () => setOverrideDateRange(null),
          onShiftBackward: () => shiftDateRange(-1),
          onShiftForward: () => shiftDateRange(1),
        }}
        view={{
          mode: viewMode,
          labels: {
            aiData: t('sessions.view.ai_data'),
            detailed: t('sessions.view.detailed'),
            compact: t('sessions.view.compact'),
            group: t('sessions.view.group'),
          },
          onModeChange: setViewMode,
        }}
      />

      {sessionsError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {sessionsError}
        </div>
      )}

      <SessionsVirtualList
        customScrollParent={customScrollParent}
        flattenedItems={flattenedItems}
        loadState={{
          showUnassignedBanner:
            !!unassignedGroup &&
            (activeProjectId === null || activeProjectId === 'unassigned'),
          isEmpty: mergedSessions.length === 0,
          isLoading: isSessionsLoading,
          hasMore,
        }}
        unassignedSessionCount={unassignedGroup?.sessions.length ?? 0}
        onFilterUnassigned={() => setActiveProjectId('unassigned')}
        onSelectProjectFilter={(projectId) => setActiveProjectId(projectId)}
        resolveGroupProjectId={resolveGroupProjectId}
        displayProjectName={displayProjectName}
        onProjectContextMenu={handleProjectContextMenu}
        dismissedSuggestions={dismissedSuggestions}
        onToggleScoreBreakdown={handleToggleScoreBreakdown}
        scoreBreakdownSessionId={scoreBreakdown?.sessionId ?? null}
        getScoreBreakdownData={getScoreBreakdownData}
        deleteSession={deleteSessions}
        onSessionContextMenu={handleContextMenu}
        indicators={indicators}
        viewMode={viewMode}
        loadingBreakdownIds={loadingBreakdownIds}
        onAcceptSuggestion={handleAcceptSuggestion}
        onRejectSuggestion={handleRejectSuggestion}
        onSplitClick={openMultiSplitModal}
        onLoadMore={loadMore}
      />

      <SessionsPageOverlays controller={controller} />
    </div>
  );
}
