import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';

import { manualSessionsApi } from '@/lib/tauri';
import type {
  ManualSessionWithProject,
  SessionWithApp,
} from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  loadFreezeSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { useSessionActions } from '@/hooks/useSessionActions';
import { useSessionsData } from '@/hooks/useSessionsData';
import { useSessionsFilters } from '@/hooks/useSessionsFilters';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { manualToSessionRow } from '@/lib/session-utils';
import { useSessionScoreBreakdown } from '@/hooks/useSessionScoreBreakdown';
import { useSessionSplitAnalysis } from '@/hooks/useSessionSplitAnalysis';
import {
  loadProjectsAllTime,
  useProjectsCacheStore,
} from '@/store/projects-cache-store';
import { shouldRefreshSessionsPage } from '@/lib/page-refresh-reasons';
import { useSettingsStore } from '@/store/settings-store';
import { useSessionBulkActions } from '@/hooks/useSessionBulkActions';
import { useSessionContextMenuActions } from '@/hooks/useSessionContextMenuActions';
import { useAssignProjectSections } from '@/hooks/useAssignProjectSections';
import { useSessionsContextMenu } from '@/hooks/useSessionsContextMenu';
import {
  groupSessionsByProject,
  isTrackedSession,
  type GroupedProject,
} from '@/lib/sessions-grouping';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';

export type SessionsFlatItem =
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

export function useSessionsPageController() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const assignProjectListMode = useUIStore((s) => s.assignProjectListMode);
  const setAssignProjectListMode = useUIStore((s) => s.setAssignProjectListMode);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const {
    assignSessions,
    updateSessionRateMultipliers,
    updateSessionComments,
    updateSessionComment: updateOneSessionComment,
    deleteSessions,
  } = useSessionActions({
    onAfterMutation: () => triggerRefresh('sessions_mutation'),
    onError: (action, error) => {
      console.error(`Session action failed (${action}):`, error);
    },
  });
  const projects = useProjectsCacheStore((state) => state.projectsAllTime);
  const [viewMode, setViewMode] = useState<
    'detailed' | 'compact' | 'ai_detailed'
  >('detailed');
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [multiSplitSession, setMultiSplitSession] =
    useState<SessionWithApp | null>(null);
  const [dataReloadVersion, setDataReloadVersion] = useState(0);
  const [indicators, setIndicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );
  const splitSettings = useSettingsStore((s) => s.splitSettings);
  const [customScrollParent, setCustomScrollParent] = useState<
    HTMLElement | undefined
  >(() => {
    if (typeof document === 'undefined') return undefined;
    const el = document.querySelector('main');
    return el instanceof HTMLElement ? el : undefined;
  });
  const {
    activeDateRange,
    activeProjectId,
    buildFetchParams,
    canShiftForward,
    rangeMode,
    setActiveProjectId,
    setMinDuration,
    setOverrideDateRange,
    setRangeMode,
    shiftDateRange,
  } = useSessionsFilters(viewMode);
  const reloadDisplaySettings = useCallback(() => {
    const sessionSettings = loadSessionSettings();
    setIndicators(loadIndicatorSettings());
    setMinDuration(
      sessionSettings.minSessionDurationSeconds > 0
        ? sessionSettings.minSessionDurationSeconds
        : undefined,
    );
  }, [setMinDuration]);

  const {
    dismissedSuggestions,
    error: sessionsError,
    hasMore,
    loadMore,
    sessions,
    sessionsRef,
    isLoading: isSessionsLoading,
    setDismissedSuggestions,
    setSessions,
  } = useSessionsData({
    activeDateRange,
    buildFetchParams,
    reloadVersion: dataReloadVersion,
  });

  const [manualSessions, setManualSessions] = useState<
    ManualSessionWithProject[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    manualSessionsApi
      .getManualSessions({
        dateRange: activeDateRange,
        projectId: undefined,
      })
      .then((data) => {
        if (!cancelled) setManualSessions(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeDateRange, dataReloadVersion]);

  const mergedSessions = useMemo(() => {
    if (manualSessions.length === 0) return sessions;
    const manualAsSession = manualSessions.map((m) =>
      manualToSessionRow(m, t('project_page.text.manual_session', 'Manual Session')),
    );
    return [...sessions, ...manualAsSession].toSorted((a, b) =>
      b.start_time.localeCompare(a.start_time),
    );
  }, [sessions, manualSessions, t]);

  const {
    aiBreakdowns,
    getScoreBreakdownData,
    handleToggleScoreBreakdown,
    loadingBreakdownIds,
    scoreBreakdown,
  } = useSessionScoreBreakdown({
    sessions,
    showScoreBreakdown: indicators.showScoreBreakdown,
    viewMode,
  });
  const {
    clearSplitCaches,
    isSessionSplittable,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
  } = useSessionSplitAnalysis({
    multiSplitSession,
    sessions,
    splitSettings,
  });
  usePageRefreshListener((reasons, source) => {
    if (source === 'app' && reasons.includes('settings_saved')) {
      reloadDisplaySettings();
    }
    if (!reasons.some((reason) => shouldRefreshSessionsPage(reason))) {
      return;
    }
    clearSplitCaches();
    setDataReloadVersion((prev) => prev + 1);
  });

  useEffect(() => {
    if (customScrollParent) return;

    let rafId = 0;
    const resolveScrollParent = () => {
      const el = document.querySelector('main');
      if (el instanceof HTMLElement) {
        setCustomScrollParent((current) => (current === el ? current : el));
        return;
      }
      rafId = window.requestAnimationFrame(resolveScrollParent);
    };

    resolveScrollParent();
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [customScrollParent]);

  useEffect(() => {
    void loadProjectsAllTime();
  }, []);

  const projectIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projects) {
      const key = project.name.trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, project.id);
      }
    }
    return map;
  }, [projects]);

  const unassignedLabel = t('sessions.menu.unassigned');

  const groupedByProject = useMemo(
    () =>
      groupSessionsByProject(mergedSessions, unassignedLabel, projectIdByName),
    [mergedSessions, unassignedLabel, projectIdByName],
  );

  const {
    ctxMenu,
    ctxMenuPlacement,
    ctxRef,
    handleContextMenu,
    handleProjectContextMenu,
    projectCtxMenu,
    projectCtxRef,
    setCtxMenu,
    setProjectCtxMenu,
  } = useSessionsContextMenu({ groupedByProject });

  const {
    ensureCommentForBoost,
    handleAcceptSuggestion,
    handleRejectSuggestion,
  } = useSessionBulkActions({
    assignSessions,
    updateSessionComments,
    setSessions,
    setDismissedSuggestions,
    setPromptConfig,
    mergedSessions,
  });

  const {
    handleAssign,
    handleSetRateMultiplier,
    handleCustomRateMultiplier,
    handleEditComment,
    openMultiSplitModal,
  } = useSessionContextMenuActions({
    ctxMenu,
    setCtxMenu,
    setPromptConfig,
    setMultiSplitSession,
    assignSessions,
    updateSessionRateMultipliers,
    updateOneSessionComment,
    setSessions,
    sessionsRef,
    isSessionSplittable,
    ensureCommentForBoost,
  });

  const [freezeThresholdDays] = useState(
    () => loadFreezeSettings().thresholdDays,
  );

  const {
    assignProjectSections,
    assignProjectsCount,
    showAssignSectionHeaders,
  } = useAssignProjectSections({
    assignProjectListMode,
    freezeThresholdDays,
    projects,
  });

  const flattenedItems = useMemo(() => {
    const list: SessionsFlatItem[] = [];
    groupedByProject.forEach((group) => {
      const isCompact = viewMode === 'compact';
      list.push({ type: 'header', group, isCompact });
      group.sessions.forEach((session, i) => {
        list.push({
          type: 'session',
          session,
          group,
          isCompact,
          isFirstInGroup: i === 0,
          isLastInGroup: i === group.sessions.length - 1,
          isSplittable: isSessionSplittable(session),
        });
      });
    });
    return list;
  }, [groupedByProject, viewMode, isSessionSplittable]);

  const unassignedGroup = groupedByProject.find((g) => g.projectId == null);
  const aiSessionsCount = useMemo(
    () =>
      mergedSessions.filter(
        (s) =>
          aiBreakdowns.has(s.id) ||
          (isTrackedSession(s) &&
            (s.suggested_project_id != null ||
              s.suggested_confidence != null ||
              s.ai_assigned)),
      ).length,
    [mergedSessions, aiBreakdowns],
  );
  const resolveGroupProjectId = useCallback(
    (group: GroupedProject) => {
      if (typeof group.projectId === 'number' && group.projectId > 0)
        return group.projectId;

      const explicitId = group.sessions.find(
        (s) => typeof s.project_id === 'number' && s.project_id > 0,
      )?.project_id;
      if (typeof explicitId === 'number' && explicitId > 0) return explicitId;

      const suggestedId = group.sessions.find(
        (s) =>
          typeof s.suggested_project_id === 'number' &&
          s.suggested_project_id > 0 &&
          (s.suggested_project_name ?? '').trim().toLowerCase() ===
            group.projectName.toLowerCase(),
      )?.suggested_project_id;
      if (typeof suggestedId === 'number' && suggestedId > 0)
        return suggestedId;

      const normalizedGroupName = group.projectName.trim().toLowerCase();
      const byName = projects.find(
        (p) => p.name.trim().toLowerCase() === normalizedGroupName,
      );
      return byName?.id ?? null;
    },
    [projects],
  );
  const displayProjectName = useCallback(
    (name: string, projectId: number | null = null) =>
      projectId == null ? t('sessions.menu.unassigned') : name,
    [t],
  );

  const ctxMenuSplitSuggested = ctxMenu
    ? isSessionSplittable(ctxMenu.session)
    : false;
  const sessionsSummaryText = t('sessions.summary', {
    sessions: mergedSessions.length,
    ai: aiSessionsCount,
    projects: groupedByProject.length,
  });
  const activeRangeLabel =
    activeDateRange.start === activeDateRange.end
      ? format(parseISO(activeDateRange.start), 'MMM d', { locale })
      : `${format(parseISO(activeDateRange.start), 'MMM d', { locale })} - ${format(parseISO(activeDateRange.end), 'MMM d', { locale })}`;

  return {
    activeProjectId,
    assignProjectListMode,
    assignProjectSections,
    assignProjectsCount,
    canShiftForward,
    ctxMenu,
    ctxMenuPlacement,
    ctxMenuSplitSuggested,
    ctxRef,
    customScrollParent,
    deleteSessions,
    dismissedSuggestions,
    displayProjectName,
    flattenedItems,
    getScoreBreakdownData,
    handleAcceptSuggestion,
    handleAssign,
    handleContextMenu,
    handleCustomRateMultiplier,
    handleEditComment,
    handleProjectContextMenu,
    handleRejectSuggestion,
    handleSetRateMultiplier,
    handleToggleScoreBreakdown,
    hasMore,
    indicators,
    isSessionsLoading,
    loadMore,
    mergedSessions,
    multiSplitSession,
    openMultiSplitModal,
    projectCtxMenu,
    projectCtxRef,
    projects,
    promptConfig,
    rangeMode,
    resolveGroupProjectId,
    scoreBreakdown,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
    sessionsError,
    sessionsSummaryText,
    activeRangeLabel,
    setActiveProjectId,
    setAssignProjectListMode,
    setCtxMenu,
    setCurrentPage,
    setMultiSplitSession,
    setOverrideDateRange,
    setProjectCtxMenu,
    setProjectPageId,
    setPromptConfig,
    setRangeMode,
    setViewMode,
    shiftDateRange,
    showAssignSectionHeaders,
    splitSettings,
    triggerRefresh,
    unassignedGroup,
    updateSessionComments,
    viewMode,
    loadingBreakdownIds,
  };
}

export type SessionsPageController = ReturnType<typeof useSessionsPageController>;
