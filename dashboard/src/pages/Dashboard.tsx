import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  AppWindow,
  TrendingUp,
  FolderOpen,
  Archive,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { TimelineChart } from '@/components/dashboard/TimelineChart';
import { ProjectDayTimeline } from '@/components/dashboard/ProjectDayTimeline';
import { AllProjectsChart } from '@/components/dashboard/AllProjectsChart';
import { TopAppsChart } from '@/components/dashboard/TopAppsChart';
import { TopProjectsList } from '@/components/dashboard/TopProjectsList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import {
  getDashboardStats,
  getDashboardProjects,
  getProjects,
  getProjectTimeline,
  getSessions,
  getTopProjects,
  refreshToday,
  getManualSessions,
} from '@/lib/tauri';
import { formatDuration } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { resolveDateFnsLocale } from '@/lib/date-locale';
import {
  loadWorkingHoursSettings,
  loadSessionSettings,
  type WorkingHoursSettings,
} from '@/lib/user-settings';
import type {
  DashboardStats,
  ManualSessionWithProject,
  ProjectTimeRow,
  ProjectWithStats,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';
import { useSessionActions } from '@/hooks/useSessionActions';

function AutoImportBanner() {
  const { t } = useTranslation();
  const result = useDataStore((s) => s.autoImportResult);
  const done = useDataStore((s) => s.autoImportDone);

  if (!done) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-2.5 p-3">
          <Archive className="h-4 w-4 text-muted-foreground animate-pulse" />
          <span className="text-xs">
            {t('dashboard.auto_import.importing')}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;
  const importFailed = result.errors.length > 0 && result.files_imported === 0;
  if (result.files_imported === 0 && !importFailed) return null;

  const cardClassName = importFailed
    ? 'border-destructive/30 bg-destructive/5'
    : 'border-emerald-500/30 bg-emerald-500/5';
  const iconClassName = importFailed
    ? 'icon-colored h-4 w-4 text-destructive'
    : 'h-4 w-4 text-emerald-400';
  const messageClassName = importFailed
    ? 'text-xs text-destructive'
    : 'text-xs text-emerald-300';
  const message = importFailed
    ? t('dashboard.auto_import.failed', { error: result.errors[0] })
    : t('dashboard.auto_import.imported_summary', {
        imported: result.files_imported,
        archived: result.files_archived,
      });
  const skippedMessage =
    !importFailed && result.files_skipped > 0
      ? ` ${t('dashboard.auto_import.already_in_database', { skipped: result.files_skipped })}`
      : '';
  const errorCount =
    result.errors.length > 0 ? (
      <span className="ml-auto text-[10px] text-destructive">
        {t('dashboard.auto_import.errors_count', {
          count: result.errors.length,
        })}
      </span>
    ) : null;

  return (
    <Card className={cardClassName}>
      <CardContent className="flex items-center gap-2.5 p-3">
        <Archive className={iconClassName} />
        <span className={messageClassName}>
          {message}
          {skippedMessage}
        </span>
        {errorCount}
      </CardContent>
    </Card>
  );
}

function DiscoveredProjectsBanner() {
  const { t } = useTranslation();
  const { projects, dismissed } = useDataStore((s) => s.discoveredProjects);
  const dismiss = useDataStore((s) => s.dismissDiscoveredProjects);
  const { setCurrentPage } = useUIStore();

  if (dismissed || projects.length === 0) return null;
  const previewProjects = projects.slice(0, 5).join(', ');
  const extraProjectsCount = projects.length - 5;

  return (
    <Card className="border-sky-500/30 bg-sky-500/5">
      <CardContent className="flex items-center gap-2.5 p-3">
        <FolderOpen className="h-4 w-4 text-sky-400 shrink-0" />
        <span className="text-xs text-sky-300">
          {t('dashboard.discovered_projects.summary', {
            count: projects.length,
          })}
          {': '}
          <span className="font-medium">{previewProjects}</span>
          {extraProjectsCount > 0 && ` (+${extraProjectsCount})`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="text-[10px] text-sky-400 hover:text-sky-300 underline"
            onClick={() => setCurrentPage('projects')}
          >
            {t('dashboard.discovered_projects.view')}
          </button>
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const { setCurrentPage, setSessionsFocusDate } = useUIStore();
  const {
    dateRange,
    refreshKey,
    timePreset,
    setTimePreset,
    shiftDateRange,
    canShiftForward,
    triggerRefresh,
  } = useDataStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [projectTimeline, setProjectTimeline] = useState<StackedBarData[]>([]);
  const [todaySessions, setTodaySessions] = useState<SessionWithApp[]>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [topProjects, setTopProjects] = useState<ProjectTimeRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectTimeRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [projectsList, setProjectsList] = useState<ProjectWithStats[]>([]);
  const [manualSessions, setManualSessions] = useState<
    ManualSessionWithProject[]
  >([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogStartTime, setSessionDialogStartTime] = useState<
    string | undefined
  >();
  const [editingManualSession, setEditingManualSession] =
    useState<ManualSessionWithProject | null>(null);
  const [workingHours, setWorkingHours] = useState<WorkingHoursSettings>(() =>
    loadWorkingHoursSettings(),
  );

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
        const key = (s.project_name ?? 'unassigned').toLowerCase();
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [todaySessions]);

  const manualCountsByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const ms of manualSessions) {
      const key = (ms.project_name ?? 'unassigned').toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [manualSessions]);
  const timelineGranularity: 'hour' | 'day' =
    timePreset === 'today' ? 'hour' : 'day';
  const projectTimelineSeriesLimit = useMemo(() => {
    switch (timePreset) {
      case 'all':
        return 12;
      case 'month':
        return 10;
      case 'week':
        return 8;
      default:
        return 5;
    }
  }, [timePreset]);
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
        console.error('Failed to assign session to project:', err);
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
        console.error('Failed to update session rate multiplier:', err);
        throw err;
      }
    },
    [updateSessionRateMultipliers],
  );

  const handleUpdateSessionCommentAction = useCallback(
    async (sessionId: number, comment: string | null) => {
      try {
        await updateSessionComment(sessionId, comment);
        setTodaySessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, comment } : s)),
        );
      } catch (err) {
        console.error('Failed to update session comment:', err);
      }
    },
    [updateSessionComment],
  );

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshToday();
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      triggerRefresh('dashboard_manual_refresh');
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const minDuration =
      loadSessionSettings().minSessionDurationSeconds || undefined;
    const shouldLoadTodayData = timePreset === 'today';

    Promise.allSettled([
      getDashboardStats(dateRange),
      getTopProjects(dateRange, 5),
      getDashboardProjects(dateRange),
      getProjects(),
      getProjectTimeline(
        dateRange,
        projectTimelineSeriesLimit,
        timelineGranularity,
        undefined,
      ),
      shouldLoadTodayData
        ? getSessions({
            dateRange,
            limit: 500,
            offset: 0,
            minDuration,
            includeFiles: false,
            includeAiSuggestions: false,
          })
        : Promise.resolve([] as SessionWithApp[]),
      shouldLoadTodayData
        ? getManualSessions({ dateRange })
        : Promise.resolve([] as ManualSessionWithProject[]),
    ]).then(
      ([
        statsRes,
        topProjectsRes,
        allProjectsRes,
        projectsRes,
        timelineRes,
        todaySessionsRes,
        manualSessionsRes,
      ]) => {
        if (cancelled) return;
        if (statsRes.status === 'fulfilled') setStats(statsRes.value);
        else console.error('Failed to load dashboard stats:', statsRes.reason);

        if (topProjectsRes.status === 'fulfilled')
          setTopProjects(topProjectsRes.value);
        else console.error('Failed to load top projects:', topProjectsRes.reason);

        if (allProjectsRes.status === 'fulfilled')
          setAllProjects(allProjectsRes.value);
        else
          console.error(
            'Failed to load all projects for chart:',
            allProjectsRes.reason,
          );

        if (projectsRes.status === 'fulfilled') {
          setProjectCount(projectsRes.value.length);
          setProjectsList(projectsRes.value);
        } else {
          console.error('Failed to load projects count:', projectsRes.reason);
        }

        if (timelineRes.status === 'fulfilled') {
          setProjectTimeline(timelineRes.value);
        } else {
          console.error('Failed to load project timeline:', timelineRes.reason);
        }

        if (!shouldLoadTodayData) {
          setTodaySessions([]);
          setManualSessions([]);
        } else {
          if (todaySessionsRes.status === 'fulfilled') {
            setTodaySessions(todaySessionsRes.value);
          } else {
            setTodaySessions([]);
            console.error(
              'Failed to load today sessions for timeline:',
              todaySessionsRes.reason,
            );
          }

          if (manualSessionsRes.status === 'fulfilled') {
            setManualSessions(manualSessionsRes.value);
          } else {
            setManualSessions([]);
            console.error('Failed to load manual sessions:', manualSessionsRes.reason);
          }
        }

        setWorkingHours(loadWorkingHoursSettings());
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    dateRange,
    refreshKey,
    timePreset,
    projectTimelineSeriesLimit,
    timelineGranularity,
  ]);

  return (
    <div className="space-y-4">
      <DateRangeToolbar
        dateRange={dateRange}
        timePreset={timePreset}
        setTimePreset={setTimePreset}
        shiftDateRange={shiftDateRange}
        canShiftForward={canShiftForward}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {refreshing
            ? t('dashboard.actions.refreshing')
            : t('dashboard.actions.refresh')}
        </Button>
      </DateRangeToolbar>

      {/* Auto-import status banner */}
      <AutoImportBanner />
      <DiscoveredProjectsBanner />

      {timePreset === 'today' && unassignedToday.sessionCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center gap-2.5 p-3">
            <AlertTriangle className="icon-colored h-4 w-4 text-amber-300" />
            <span className="text-xs text-amber-100">
              {t('dashboard.unassigned_banner.message', {
                sessionCount: unassignedToday.sessionCount,
                duration: formatDuration(unassignedToday.seconds),
                appCount: unassignedToday.appCount,
                date: format(parseISO(dateRange.end), 'MMM d', { locale }),
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto border-amber-300/40 text-amber-100 hover:bg-amber-500/20"
              onClick={() => {
                setSessionsFocusDate(dateRange.end);
                setCurrentPage('sessions');
              }}
            >
              {t('dashboard.actions.open_sessions')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Metric cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('dashboard.metrics.total_tracked')}
          value={
            stats
              ? formatDuration(stats.total_seconds)
              : t('ui.common.not_available')
          }
          icon={Clock}
        />
        <MetricCard
          title={t('dashboard.metrics.applications')}
          value={stats ? String(stats.app_count) : t('ui.common.not_available')}
          icon={AppWindow}
        />
        <MetricCard
          title={t('dashboard.metrics.projects')}
          value={String(projectCount)}
          subtitle={t('dashboard.metrics.active_projects')}
          icon={FolderOpen}
        />
        <MetricCard
          title={t('dashboard.metrics.avg_daily')}
          value={
            stats
              ? formatDuration(stats.avg_daily_seconds)
              : t('ui.common.not_available')
          }
          icon={TrendingUp}
        />
      </div>

      {/* Timeline */}
      {timePreset === 'today' ? (
        <ProjectDayTimeline
          sessions={todaySessions}
          manualSessions={manualSessions}
          workingHours={workingHours}
          projects={projectsList}
          onAssignSession={handleAssignSession}
          onUpdateSessionRateMultiplier={handleUpdateSessionRateMultiplier}
          onUpdateSessionComment={handleUpdateSessionCommentAction}
          onAddManualSession={(startTime) => {
            setSessionDialogStartTime(startTime);
            setSessionDialogOpen(true);
          }}
          onEditManualSession={(session) => {
            setEditingManualSession(session);
            setSessionDialogOpen(true);
          }}
        />
      ) : (
        <TimelineChart
          data={projectTimeline}
          projectColors={projectColorMap}
          granularity={timelineGranularity}
          dateRange={dateRange}
          trimLeadingToFirstData={timePreset === 'all'}
          heightClassName="h-[24rem]"
          disableAnimation
        />
      )}

      {/* Projects + Applications split (project-first) */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Projects column */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t('dashboard.sections.top_5_projects')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopProjectsList
              projects={topProjects}
              allProjectsList={projectsList}
              dateRange={dateRange}
              setSessionsFocusDate={setSessionsFocusDate}
              boostedByProject={boostedByProject}
              manualCountsByProject={manualCountsByProject}
            />
          </CardContent>
        </Card>

        {/* Applications are secondary context */}
        <TopAppsChart apps={stats?.top_apps ?? []} />
      </div>

      {/* All projects chart */}
      <AllProjectsChart projects={allProjects} />

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={(op) => {
          setSessionDialogOpen(op);
          if (!op) {
            setSessionDialogStartTime(undefined);
            setEditingManualSession(null);
          }
        }}
        projects={projectsList}
        defaultStartTime={sessionDialogStartTime}
        editSession={editingManualSession}
        onSaved={() => triggerRefresh('dashboard_manual_session_saved')}
      />
    </div>
  );
}
