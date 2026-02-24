import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, AppWindow, TrendingUp, FolderOpen, Archive, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { TimelineChart } from "@/components/dashboard/TimelineChart";
import { ProjectDayTimeline } from "@/components/dashboard/ProjectDayTimeline";
import { AllProjectsChart } from "@/components/dashboard/AllProjectsChart";
import { TopAppsChart } from "@/components/dashboard/TopAppsChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import {
  getDashboardStats,
  getDashboardProjects,
  getProjects,
  getProjectTimeline,
  getSessions,
  getTopProjects,
  refreshToday,
  assignSessionToProject,
  getManualSessions,
  updateSessionRateMultiplier,
  updateSessionComment,
} from "@/lib/tauri";
import { formatDuration } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ManualSessionDialog } from "@/components/ManualSessionDialog";
import { loadWorkingHoursSettings, loadSessionSettings, type WorkingHoursSettings } from "@/lib/user-settings";
import type {
  DashboardStats,
  ManualSessionWithProject,
  ProjectTimeRow,
  ProjectWithStats,
  SessionWithApp,
  StackedBarData,
  DateRange,
} from "@/lib/db-types";

function AutoImportBanner() {
  const result = useAppStore((s) => s.autoImportResult);
  const done = useAppStore((s) => s.autoImportDone);

  if (!done) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-2.5 p-3">
          <Archive className="h-4 w-4 text-muted-foreground animate-pulse" />
          <span className="text-xs">Importing data from daemon...</span>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  if (result.errors.length > 0 && result.files_imported === 0) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-center gap-2.5 p-3">
          <Archive className="icon-colored h-4 w-4 text-destructive" />
          <span className="text-xs text-destructive">
            Auto-import failed: {result.errors[0]}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (result.files_imported === 0) return null;

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="flex items-center gap-2.5 p-3">
        <Archive className="h-4 w-4 text-emerald-400" />
        <span className="text-xs text-emerald-300">
          Auto-imported <strong>{result.files_imported}</strong> file(s) ({result.files_archived} archived).
          {result.files_skipped > 0 && ` ${result.files_skipped} already in database.`}
        </span>
        {result.errors.length > 0 && (
          <span className="ml-auto text-[10px] text-destructive">
            {result.errors.length} error(s)
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function TopProjectsList({ projects, allProjectsList, dateRange, setSessionsFocusDate }: { projects: ProjectTimeRow[], allProjectsList: ProjectWithStats[], dateRange: DateRange, setSessionsFocusDate: (date: string | null) => void }) {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setSessionsFocusProject = useAppStore((s) => s.setSessionsFocusProject);

  if (projects.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground">
        No projects found.
      </p>
    );
  }

  const maxSeconds = Math.max(1, ...projects.map((p) => p.seconds));

  return (
    <div className="space-y-0.5">
      {projects.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className="space-y-1 rounded-md p-1.5 -mx-1.5 cursor-pointer transition-colors hover:bg-muted/40"
          onClick={() => {
            setSessionsFocusDate(dateRange.end);
            if (p.name === "Unassigned") {
              setSessionsFocusProject("unassigned");
            } else {
              const prj = allProjectsList.find(x => x.name === p.name);
              if (prj) setSessionsFocusProject(prj.id);
              else setSessionsFocusProject(null);
            }
            setCurrentPage("sessions");
          }}
          title={`Click to view sessions for ${p.name}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">{p.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-5.5">
                <span className="text-[10px] text-muted-foreground">
                  {p.session_count} sessions
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {p.app_count} apps
                </span>
              </div>
            </div>
            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {formatDuration(p.seconds)}
            </span>
          </div>
          <div className="ml-5.5 h-1 rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(p.seconds / maxSeconds) * 100}%`, backgroundColor: p.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const {
    dateRange,
    refreshKey,
    timePreset,
    setTimePreset,
    shiftDateRange,
    canShiftForward,
    triggerRefresh,
    setCurrentPage,
    setSessionsFocusDate,
  } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [projectTimeline, setProjectTimeline] = useState<StackedBarData[]>([]);
  const [todaySessions, setTodaySessions] = useState<SessionWithApp[]>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [topProjects, setTopProjects] = useState<ProjectTimeRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectTimeRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [projectsList, setProjectsList] = useState<ProjectWithStats[]>([]);
  const [manualSessions, setManualSessions] = useState<ManualSessionWithProject[]>([]);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDialogStartTime, setSessionDialogStartTime] = useState<string | undefined>();
  const [editingManualSession, setEditingManualSession] = useState<ManualSessionWithProject | null>(null);
  const [workingHours, setWorkingHours] = useState<WorkingHoursSettings>(() =>
    loadWorkingHoursSettings()
  );

  const projectColorMap = useMemo(
    () =>
      Object.fromEntries(allProjects.map((p) => [p.name, p.color] as const)),
    [allProjects]
  );
  const unassignedToday = useMemo(() => {
    const unassigned = todaySessions.filter((s) => s.project_name === null);
    const apps = new Set(unassigned.map((s) => s.app_id));
    const seconds = unassigned.reduce((sum, s) => sum + s.duration_seconds, 0);
    return { sessionCount: unassigned.length, appCount: apps.size, seconds };
  }, [todaySessions]);
  const timelineGranularity: "hour" | "day" = timePreset === "today" ? "hour" : "day";
  const projectTimelineSeriesLimit = useMemo(() => {
    switch (timePreset) {
      case "all":
        return 12;
      case "month":
        return 10;
      case "week":
        return 8;
      default:
        return 5;
    }
  }, [timePreset]);

  const handleAssignSession = useCallback(
    async (sessionIds: number[], projectId: number | null) => {
      try {
        await Promise.all(sessionIds.map((sessionId) => assignSessionToProject(sessionId, projectId)));
        triggerRefresh();
      } catch (err) {
        console.error("Failed to assign session to project:", err);
        throw err;
      }
    },
    [triggerRefresh]
  );

  const handleUpdateSessionRateMultiplier = useCallback(
    async (sessionIds: number[], multiplier: number | null) => {
      try {
        await Promise.all(sessionIds.map((sessionId) => updateSessionRateMultiplier(sessionId, multiplier)));
        triggerRefresh();
      } catch (err) {
        console.error("Failed to update session rate multiplier:", err);
        throw err;
      }
    },
    [triggerRefresh]
  );

  const handleUpdateSessionComment = useCallback(
    async (sessionId: number, comment: string | null) => {
      try {
        await updateSessionComment(sessionId, comment);
        setTodaySessions((prev) =>
          prev.map((s) => s.id === sessionId ? { ...s, comment } : s)
        );
      } catch (err) {
        console.error("Failed to update session comment:", err);
      }
    },
    []
  );

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshToday();
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      triggerRefresh();
      setRefreshing(false);
    }
  };

  useEffect(() => {
    Promise.allSettled([
      getDashboardStats(dateRange),
      getProjects(),
      getTopProjects(dateRange, 5),
      getDashboardProjects(dateRange),
      getProjectTimeline(dateRange, projectTimelineSeriesLimit, timelineGranularity),
      timePreset === "today"
        ? getSessions({ dateRange, limit: 500, offset: 0, minDuration: loadSessionSettings().minSessionDurationSeconds || undefined })
        : Promise.resolve([] as SessionWithApp[]),
      timePreset === "today"
        ? getManualSessions({ dateRange })
        : Promise.resolve([] as ManualSessionWithProject[]),
    ])
      .then(([statsRes, projectsCountRes, topProjectsRes, allProjectsRes, timelineRes, todaySessionsRes, manualSessionsRes]) => {
        if (statsRes.status === "fulfilled") setStats(statsRes.value);
        else console.error("Failed to load dashboard stats:", statsRes.reason);

        if (projectsCountRes.status === "fulfilled") {
          setProjectCount(projectsCountRes.value.length);
          setProjectsList(projectsCountRes.value);
        } else console.error("Failed to load projects count:", projectsCountRes.reason);

        if (topProjectsRes.status === "fulfilled") setTopProjects(topProjectsRes.value);
        else console.error("Failed to load top projects:", topProjectsRes.reason);

        if (allProjectsRes.status === "fulfilled") setAllProjects(allProjectsRes.value);
        else console.error("Failed to load all projects for chart:", allProjectsRes.reason);

        if (timelineRes.status === "fulfilled") setProjectTimeline(timelineRes.value);
        else console.error("Failed to load project timeline:", timelineRes.reason);

        if (todaySessionsRes.status === "fulfilled") setTodaySessions(todaySessionsRes.value);
        else {
          setTodaySessions([]);
          console.error("Failed to load today sessions for timeline:", todaySessionsRes.reason);
        }

        if (manualSessionsRes.status === "fulfilled") setManualSessions(manualSessionsRes.value);
        else {
          setManualSessions([]);
          console.error("Failed to load manual sessions:", manualSessionsRes.reason);
        }

      });
  }, [dateRange, refreshKey, timelineGranularity, timePreset, projectTimelineSeriesLimit]);

  useEffect(() => {
    setWorkingHours(loadWorkingHoursSettings());
  }, [refreshKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>

        {(["today", "week", "month", "all"] as const).map((preset) => (
          <Button
            key={preset}
            variant={timePreset === preset ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimePreset(preset)}
            className="capitalize"
          >
            {preset === "all" ? "All time" : preset}
          </Button>
        ))}

        {timePreset !== "all" && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDateRange(-1)}
              title="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[5rem] text-center text-[11px] text-muted-foreground">
              {dateRange.start === dateRange.end
                ? format(parseISO(dateRange.start), "MMM d")
                : `${format(parseISO(dateRange.start), "MMM d")} – ${format(parseISO(dateRange.end), "MMM d")}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDateRange(1)}
              disabled={!canShiftForward()}
              title="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Auto-import status banner */}
      <AutoImportBanner />

      {timePreset === "today" && unassignedToday.sessionCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center gap-2.5 p-3">
            <AlertTriangle className="icon-colored h-4 w-4 text-amber-300" />
            <span className="text-xs text-amber-100">
              <strong>{unassignedToday.sessionCount}</strong> sessions (
              <strong>{formatDuration(unassignedToday.seconds)}</strong>) are unassigned across{" "}
              <strong>{unassignedToday.appCount}</strong> apps on{" "}
              <strong>{format(parseISO(dateRange.end), "MMM d")}</strong>. Please assign them manually.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto border-amber-300/40 text-amber-100 hover:bg-amber-500/20"
              onClick={() => {
                setSessionsFocusDate(dateRange.end);
                setCurrentPage("sessions");
              }}
            >
              Open Sessions
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Metric cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Tracked"
          value={stats ? formatDuration(stats.total_seconds) : "—"}
          icon={Clock}
        />
        <MetricCard
          title="Applications"
          value={stats ? String(stats.app_count) : "—"}
          icon={AppWindow}
        />
        <MetricCard
          title="Projects"
          value={String(projectCount)}
          subtitle="active projects"
          icon={FolderOpen}
        />
        <MetricCard
          title="Avg Daily"
          value={stats ? formatDuration(stats.avg_daily_seconds) : "—"}
          icon={TrendingUp}
        />
      </div>

      {/* Timeline */}
      {timePreset === "today" ? (
        <ProjectDayTimeline
          sessions={todaySessions}
          manualSessions={manualSessions}
          workingHours={workingHours}
          projects={projectsList}
          onAssignSession={handleAssignSession}
          onUpdateSessionRateMultiplier={handleUpdateSessionRateMultiplier}
          onUpdateSessionComment={handleUpdateSessionComment}
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
          trimLeadingToFirstData={timePreset === "all"}
          heightClassName="h-[24rem]"
        />
      )}

      {/* Projects + Applications split (project-first) */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Projects column */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top 5 Projects</CardTitle>
          </CardHeader>
          <CardContent>
                  <TopProjectsList
                    projects={topProjects}
                    allProjectsList={projectsList}
                    dateRange={dateRange}
                    setSessionsFocusDate={setSessionsFocusDate}
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
        onSaved={triggerRefresh}
      />
    </div>
  );
}
