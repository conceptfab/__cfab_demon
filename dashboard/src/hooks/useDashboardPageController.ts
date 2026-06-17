import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { useSessionActions } from '@/hooks/useSessionActions';
import type {
  DashboardStats,
  ManualSessionWithProject,
  ProjectTimeRow,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { shouldRefreshDashboardPage } from '@/lib/page-refresh-reasons';
import {
  dashboardApi,
  daemonApi,
  manualSessionsApi,
  sessionsApi,
} from '@/lib/tauri';
import { loadSessionSettings } from '@/lib/user-settings';
import { getErrorMessage, logTauriError } from '@/lib/utils';
import {
  EMPTY_DASHBOARD_VIEW_STATE,
  EMPTY_PROJECT_ROWS,
  EMPTY_STACKED_BAR_DATA,
  PROJECT_TIMELINE_SERIES_LIMIT,
  UNASSIGNED_PROJECT_KEY,
  type DashboardViewState,
} from '@/pages/dashboard/dashboard-page-constants';
import { useDataStore } from '@/store/data-store';
import {
  loadProjectsAllTime,
  useProjectsCacheStore,
} from '@/store/projects-cache-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';

export function useDashboardPageController() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setSessionsFocusDate = useUIStore((s) => s.setSessionsFocusDate);
  const dateRange = useDataStore((s) => s.dateRange);
  const timePreset = useDataStore((s) => s.timePreset);
  const setTimePreset = useDataStore((s) => s.setTimePreset);
  const shiftDateRange = useDataStore((s) => s.shiftDateRange);
  const canShiftForward = useDataStore((s) => s.canShiftForward);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const [dashboardView, setDashboardView] = useState<DashboardViewState>(
    EMPTY_DASHBOARD_VIEW_STATE,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogStartTime, setSessionDialogStartTime] = useState<
    string | undefined
  >();
  const [editingManualSession, setEditingManualSession] =
    useState<ManualSessionWithProject | null>(null);
  const workingHours = useSettingsStore((s) => s.workingHours);
  const reloadDashboardRef = useRef<(() => void) | null>(null);
  const projectsList = useProjectsCacheStore((s) => s.projectsAllTime);
  const projectCount = projectsList.length;
  const {
    dashboardData,
    projectTimelineLoading,
    projectTimelineError,
    loadError,
    todaySessions,
    manualSessions,
  } = dashboardView;
  const stats: DashboardStats | null = dashboardData?.stats ?? null;
  const topProjects: ProjectTimeRow[] =
    dashboardData?.top_projects ?? EMPTY_PROJECT_ROWS;
  const allProjects: ProjectTimeRow[] =
    dashboardData?.all_projects ?? EMPTY_PROJECT_ROWS;
  const projectTimeline: StackedBarData[] =
    dashboardData?.project_timeline ?? EMPTY_STACKED_BAR_DATA;

  const projectColorMap = useMemo(
    () =>
      Object.fromEntries(allProjects.map((p) => [p.name, p.color] as const)),
    [allProjects],
  );

  const unassignedToday = useMemo(() => {
    const unassigned = todaySessions.filter((s) => s.project_name === null);
    const apps = new Set(unassigned.map((s) => s.app_id));
    const seconds = unassigned.reduce((sum, s) => sum + s.duration_seconds, 0);
    return { sessionCount: unassigned.length, appCount: apps.size, seconds };
  }, [todaySessions]);

  const boostedByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of todaySessions) {
      if ((s.rate_multiplier ?? 1) > 1.000_001) {
        const key =
          s.project_id == null ? UNASSIGNED_PROJECT_KEY : String(s.project_id);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [todaySessions]);

  const manualCountsByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const ms of manualSessions) {
      const key =
        ms.project_id == null ? UNASSIGNED_PROJECT_KEY : String(ms.project_id);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [manualSessions]);

  const timelineGranularity: 'hour' | 'day' =
    timePreset === 'today' ? 'hour' : 'day';
  const projectTimelineSeriesLimit = PROJECT_TIMELINE_SERIES_LIMIT;

  const { assignSessions, updateSessionRateMultipliers, updateSessionComment } =
    useSessionActions({
      onAfterMutation: () => triggerRefresh('dashboard_session_mutation'),
      onError: (action, error) => {
        console.error(`Dashboard session action failed (${action}):`, error);
      },
    });

  const handleAssignSession = useCallback(
    async (sessionIds: number[], projectId: number | null) => {
      try {
        await assignSessions(sessionIds, projectId, 'manual_dashboard_change');
      } catch (err) {
        logTauriError('assign session to project', err);
        throw err;
      }
    },
    [assignSessions],
  );

  const handleUpdateSessionRateMultiplier = useCallback(
    async (sessionIds: number[], multiplier: number | null) => {
      try {
        await updateSessionRateMultipliers(sessionIds, multiplier);
      } catch (err) {
        logTauriError('update session rate multiplier', err);
        throw err;
      }
    },
    [updateSessionRateMultipliers],
  );

  const handleUpdateSessionCommentAction = useCallback(
    async (sessionId: number, comment: string | null) => {
      try {
        await updateSessionComment(sessionId, comment);
        setDashboardView((prev) => ({
          ...prev,
          todaySessions: prev.todaySessions.map((s) =>
            s.id === sessionId ? { ...s, comment } : s,
          ),
        }));
      } catch (err) {
        logTauriError('update session comment', err);
      }
    },
    [updateSessionComment],
  );

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await daemonApi.refreshToday();
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      triggerRefresh('dashboard_manual_refresh');
      setRefreshing(false);
    }
  };

  const handleOpenSessionsForUnassigned = () => {
    setSessionsFocusDate(dateRange.end);
    setCurrentPage('sessions');
  };

  const handleAddManualSession = (startTime: string) => {
    setSessionDialogStartTime(startTime);
    setSessionDialogOpen(true);
  };

  const handleEditManualSession = (session: ManualSessionWithProject) => {
    setEditingManualSession(session);
    setSessionDialogOpen(true);
  };

  const handleSessionDialogOpenChange = (open: boolean) => {
    setSessionDialogOpen(open);
    if (!open) {
      setSessionDialogStartTime(undefined);
      setEditingManualSession(null);
    }
  };

  const handleManualSessionSaved = () => {
    triggerRefresh('dashboard_manual_session_saved');
  };

  const projectTimelineErrorMessage = projectTimelineError
    ? getErrorMessage(
        projectTimelineError,
        t('components.timeline_chart.load_failed'),
      )
    : null;

  useEffect(() => {
    void loadProjectsAllTime();
  }, []);

  usePageRefreshListener((reasons) => {
    if (!reasons.some((reason) => shouldRefreshDashboardPage(reason))) {
      return;
    }
    reloadDashboardRef.current?.();
  });

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      const minDuration =
        loadSessionSettings().minSessionDurationSeconds || undefined;
      const shouldLoadTodayData = timePreset === 'today';
      setDashboardView((prev) => ({
        ...prev,
        projectTimelineLoading: true,
        projectTimelineError: null,
        loadError: null,
      }));

      Promise.allSettled([
        dashboardApi.getDashboardData(
          dateRange,
          5,
          projectTimelineSeriesLimit,
          timelineGranularity,
        ),
        shouldLoadTodayData
          ? sessionsApi.getSessions({
              dateRange,
              offset: 0,
              minDuration,
              includeFiles: false,
              includeAiSuggestions: false,
            })
          : Promise.resolve([] as SessionWithApp[]),
        shouldLoadTodayData
          ? manualSessionsApi.getManualSessions({ dateRange })
          : Promise.resolve([] as ManualSessionWithProject[]),
      ]).then(
        ([dashboardDataRes, todaySessionsRes, manualSessionsRes]) => {
          if (cancelled) return;
          let nextDashboardData = null;
          let nextLoadError: string | null = null;
          let nextProjectTimelineError: unknown | null = null;

          if (dashboardDataRes.status === 'fulfilled') {
            nextDashboardData = dashboardDataRes.value;
          } else {
            nextLoadError = getErrorMessage(
              dashboardDataRes.reason,
              t('ui.common.unknown_error'),
            );
            nextProjectTimelineError = dashboardDataRes.reason;
            logTauriError('load dashboard data', dashboardDataRes.reason);
          }

          let nextTodaySessions: SessionWithApp[] = [];
          let nextManualSessions: ManualSessionWithProject[] = [];
          if (shouldLoadTodayData) {
            if (todaySessionsRes.status === 'fulfilled') {
              nextTodaySessions = todaySessionsRes.value;
            } else {
              logTauriError(
                'load today sessions for timeline',
                todaySessionsRes.reason,
              );
            }

            if (manualSessionsRes.status === 'fulfilled') {
              nextManualSessions = manualSessionsRes.value;
            } else {
              logTauriError('load manual sessions', manualSessionsRes.reason);
            }
          }

          startTransition(() => {
            setDashboardView({
              dashboardData: nextDashboardData,
              projectTimelineLoading: false,
              projectTimelineError: nextProjectTimelineError,
              loadError: nextLoadError,
              todaySessions: nextTodaySessions,
              manualSessions: nextManualSessions,
            });
          });
        },
      );
    };

    reloadDashboardRef.current = reload;
    reload();

    return () => {
      cancelled = true;
      reloadDashboardRef.current = null;
    };
  }, [
    dateRange,
    timePreset,
    projectTimelineSeriesLimit,
    timelineGranularity,
    t,
  ]);

  return {
    allProjects,
    dashboardData,
    boostedByProject,
    canShiftForward,
    dateRange,
    editingManualSession,
    handleAddManualSession,
    handleAssignSession,
    handleEditManualSession,
    handleManualSessionSaved,
    handleOpenSessionsForUnassigned,
    handleRefresh,
    handleSessionDialogOpenChange,
    handleUpdateSessionCommentAction,
    handleUpdateSessionRateMultiplier,
    loadError,
    locale,
    manualCountsByProject,
    manualSessions,
    projectColorMap,
    projectCount,
    projectTimeline,
    projectTimelineErrorMessage,
    projectTimelineLoading,
    projectsList,
    refreshing,
    sessionDialogOpen,
    sessionDialogStartTime,
    setCurrentPage,
    setSessionsFocusDate,
    setTimePreset,
    shiftDateRange,
    stats,
    t,
    timePreset,
    timelineGranularity,
    todaySessions,
    topProjects,
    unassignedToday,
    workingHours,
  };
}

export type DashboardPageController = ReturnType<typeof useDashboardPageController>;
