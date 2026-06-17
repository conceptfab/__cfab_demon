import {
  AppWindow,
  AlertTriangle,
  Clock,
  FolderOpen,
  RefreshCw,
  Rocket,
  TrendingUp,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

import { AllProjectsChart } from '@/components/dashboard/AllProjectsChart';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { ProjectDayTimeline } from '@/components/dashboard/ProjectDayTimeline';
import { TimelineChart } from '@/components/dashboard/TimelineChart';
import { TopAppsChart } from '@/components/dashboard/TopAppsChart';
import { TopProjectsList } from '@/components/dashboard/TopProjectsList';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { MobileAlertBanner } from '@/components/ui/MobileAlertBanner';
import { RoundedDuration } from '@/components/ui/RoundedDuration';
import type { DashboardPageController } from '@/hooks/useDashboardPageController';
import { mobileLayout } from '@/lib/mobile-layout';
import { formatDuration } from '@/lib/utils';
import { DashboardAutoImportBanner } from '@/pages/dashboard/DashboardAutoImportBanner';
import { DashboardDiscoveredProjectsBanner } from '@/pages/dashboard/DashboardDiscoveredProjectsBanner';

interface DashboardViewProps {
  controller: DashboardPageController;
}

export function DashboardView({ controller }: DashboardViewProps) {
  const {
    allProjects,
    boostedByProject,
    canShiftForward,
    dashboardData,
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
    setDateRange,
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
  } = controller;

  return (
    <div className={mobileLayout.pageStack}>
      <DateRangeToolbar
        dateRange={dateRange}
        timePreset={timePreset}
        setTimePreset={setTimePreset}
        shiftDateRange={shiftDateRange}
        canShiftForward={canShiftForward}
      >
        <DateRangePicker
          start={dateRange.start}
          end={dateRange.end}
          onApply={setDateRange}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing}
          className="size-9 shrink-0 md:h-8 md:w-auto md:px-2.5"
          aria-label={
            refreshing
              ? t('dashboard.actions.refreshing')
              : t('dashboard.actions.refresh')
          }
        >
          <RefreshCw className="size-3.5 md:mr-1.5" />
          <span className="hidden md:inline">
            {refreshing
              ? t('dashboard.actions.refreshing')
              : t('dashboard.actions.refresh')}
          </span>
        </Button>
      </DateRangeToolbar>

      <DashboardAutoImportBanner />
      <DashboardDiscoveredProjectsBanner />

      {loadError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2.5 p-3">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span className="text-xs text-destructive">
              {t('dashboard.errors.loading_data')}: {loadError}
            </span>
          </CardContent>
        </Card>
      )}

      {timePreset === 'today' && unassignedToday.sessionCount > 0 && (
        <MobileAlertBanner
          icon={
            <AlertTriangle className="icon-colored mt-0.5 size-4 shrink-0 text-amber-300" />
          }
          action={
            <Button
              size="sm"
              variant="outline"
              className={`${mobileLayout.alertAction} border-amber-300/40 text-amber-100 hover:bg-amber-500/20`}
              onClick={handleOpenSessionsForUnassigned}
            >
              {t('dashboard.actions.open_sessions')}
            </Button>
          }
        >
          {t('dashboard.unassigned_banner.message', {
            sessionCount: unassignedToday.sessionCount,
            duration: formatDuration(unassignedToday.seconds),
            appCount: unassignedToday.appCount,
            date: format(parseISO(dateRange.end), 'MMM d', { locale }),
          })}
        </MobileAlertBanner>
      )}

      {!dashboardData && !loadError ? (
        <div className={mobileLayout.metricGrid}>
          {['s1', 's2', 's3', 's4'].map((slot) => (
            <Card key={`skeleton-card-${slot}`} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 w-24 rounded bg-muted mb-2" />
                <div className="h-8 w-16 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats && stats.total_seconds === 0 && !loadError ? (
        <div className="flex flex-col items-center gap-4 py-12">
          <Rocket className="size-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">
            {t('dashboard_page.empty_state_title')}
          </p>
          <p className="text-sm text-muted-foreground/70">
            {t('dashboard_page.empty_state_description')}
          </p>
          <Button onClick={() => setCurrentPage('daemon')}>
            {t('dashboard_page.go_to_daemon')}
          </Button>
        </div>
      ) : (
          <>
            <div className={mobileLayout.metricGrid}>
              <MetricCard
                title={t('dashboard.metrics.total_tracked')}
                value={
                  stats ? (
                    <RoundedDuration
                      seconds={stats.total_seconds}
                      dailySeconds={stats.daily_seconds}
                    />
                  ) : (
                    t('ui.common.not_available')
                  )
                }
                icon={Clock}
              />
              <MetricCard
                title={t('dashboard.metrics.applications')}
                value={
                  stats ? String(stats.app_count) : t('ui.common.not_available')
                }
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
                  stats ? (
                    <RoundedDuration seconds={stats.avg_daily_seconds} />
                  ) : (
                    t('ui.common.not_available')
                  )
                }
                icon={TrendingUp}
              />
            </div>

            {timePreset === 'today' ? (
              <ProjectDayTimeline
                sessions={todaySessions}
                manualSessions={manualSessions}
                workingHours={workingHours}
                projects={projectsList}
                onAssignSession={handleAssignSession}
                onUpdateSessionRateMultiplier={
                  handleUpdateSessionRateMultiplier
                }
                onUpdateSessionComment={handleUpdateSessionCommentAction}
                onAddManualSession={handleAddManualSession}
                onEditManualSession={handleEditManualSession}
              />
            ) : (
              <TimelineChart
                data={projectTimeline}
                presentation={{
                  projectColors: projectColorMap,
                  granularity: timelineGranularity,
                  dateRange,
                  trimLeadingToFirstData: timePreset === 'all',
                  heightClassName: 'h-[24rem]',
                  disableAnimation: true,
                }}
                state={{
                  isLoading: projectTimelineLoading,
                  errorMessage: projectTimelineErrorMessage,
                }}
              />
            )}

            <div className={mobileLayout.chartGrid}>
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

              <TopAppsChart apps={stats?.top_apps ?? []} />
            </div>

            <AllProjectsChart projects={allProjects} />
          </>
      )}

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={handleSessionDialogOpenChange}
        projects={projectsList}
        defaultStartTime={sessionDialogStartTime}
        editSession={editingManualSession}
        onSaved={handleManualSessionSaved}
      />
    </div>
  );
}
