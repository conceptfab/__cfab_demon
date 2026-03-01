import * as React from 'react';
import { useEffect, useState, useMemo, useRef } from 'react';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import {
  ChevronLeft,
  TimerReset,
  Snowflake,
  CircleOff,
  MessageSquare,
  RefreshCw,
  LayoutDashboard,
  History,
  MousePointerClick,
  CircleDollarSign,
  Trash2,
  Plus,
  PenLine,
} from 'lucide-react';
import { TimelineChart } from '@/components/dashboard/TimelineChart';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PromptModal } from '@/components/ui/prompt-modal';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  getProjects,
  getProjectExtraInfo,
  compactProjectData,
  getProjectEstimates,
  resetProjectTime,
  freezeProject,
  unfreezeProject,
  excludeProject,
  getSessions,
  getManualSessions,
  getProjectTimeline,
  updateSessionComment,
  updateSessionRateMultiplier,
  assignSessionToProject,
  deleteSession,
  deleteManualSession,
} from '@/lib/tauri';
import { formatDuration, formatMoney, formatMultiplierLabel, cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useInlineT } from '@/lib/inline-i18n';
import type {
  ProjectWithStats,
  ProjectExtraInfo,
  SessionWithApp,
  ManualSessionWithProject,
  StackedBarData,
  PromptConfig,
} from '@/lib/db-types';

type ContextMenu =
  | {
      x: number;
      y: number;
      session: SessionWithApp;
      type?: 'session';
    }
  | {
      x: number;
      y: number;
      type: 'chart';
      date: string;
      sessions: SessionWithApp[];
    };

export function ProjectPage() {
  const tt = useInlineT();
  const { projectPageId, setProjectPageId, setCurrentPage } = useUIStore();
  const { refreshKey, triggerRefresh } = useDataStore();
  const { currencyCode } = useSettingsStore();
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [projectsList, setProjectsList] = useState<ProjectWithStats[]>([]);
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [timelineData, setTimelineData] = useState<StackedBarData[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionWithApp[]>([]);
  const [manualSessions, setManualSessions] = useState<
    ManualSessionWithProject[]
  >([]);
  const autoSessionsById = useMemo(() => {
    const byId = new Map<number, SessionWithApp>();
    for (const s of recentSessions) {
      byId.set(s.id, s);
    }
    return byId;
  }, [recentSessions]);

  const groupedSessions = useMemo(() => {
    const groups: {
      [date: string]: (SessionWithApp & { isManual?: boolean })[];
    } = {};

    recentSessions.forEach((s) => {
      const date = s.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push({ ...s, isManual: false });
    });

    manualSessions.forEach((m) => {
      const date = m.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push({
        ...m,
        app_name: 'Manual Session',
        executable_name: 'manual',
        project_id: m.project_id,
        project_name: m.project_name,
        project_color: m.project_color,
        comment: m.title,
        files: [],
        isManual: true,
      } as any);
    });

    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0])) // Most recent days first
      .map(([date, sessions]) => ({
        date,
        sessions: sessions.sort((a, b) =>
          b.start_time.localeCompare(a.start_time),
        ), // Most recent sessions first within day
      }));
  }, [recentSessions, manualSessions]);

  const [estimate, setEstimate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [selectedSessionDetail, setSelectedSessionDetail] =
    useState<SessionWithApp | null>(null);
  const [sessionDialogDate, setSessionDialogDate] = useState<
    string | undefined
  >();
  const [editManualSession, setEditManualSession] =
    useState<ManualSessionWithProject | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectPageId === null) {
      setCurrentPage('projects');
      return;
    }

    setLoading(true);
    Promise.all([
      getProjects(),
      getProjectExtraInfo(projectPageId, {
        start: '1970-01-01',
        end: '2100-01-01',
      }),
      getProjectEstimates({ start: '1970-01-01', end: '2100-01-01' }),
      getProjectTimeline(
        { start: '1970-01-01', end: '2100-01-01' },
        100,
        'day',
        projectPageId,
      ).catch(() => [] as StackedBarData[]),
      getSessions({
        projectId: projectPageId,
        limit: 10000,
        dateRange: { start: '1970-01-01', end: '2100-01-01' },
        includeAiSuggestions: false,
      }),
      getManualSessions({ projectId: projectPageId }),
    ])
      .then(([projects, info, estimates, timeline, sessions, manuals]) => {
        const p = projects.find((x) => x.id === projectPageId);
        if (p) {
          setProject(p);
          setProjectsList(projects);
          setExtraInfo(info);
          setTimelineData(timeline);
          setRecentSessions(sessions);
          setManualSessions(manuals);
          const est = estimates.find((e) => e.project_id === projectPageId);
          setEstimate(est?.estimated_value || 0);
        } else {
          setCurrentPage('projects');
        }
      })
      .catch((err) => {
        console.error('Critical error fetching project data:', err);
      })
      .finally(() => setLoading(false));
  }, [projectPageId, refreshKey, setCurrentPage]);

  // Handle click outside for context menu
  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu]);

  const getContextMenuStyle = (x: number, y: number, minWidth: number) => {
    const padding = 8;
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 1080;
    const left = Math.min(
      Math.max(x, padding),
      viewportWidth - minWidth - padding,
    );
    const openUpward = y > viewportHeight * 0.62;
    const top = Math.min(Math.max(y, padding), viewportHeight - padding);
    return {
      left,
      top,
      transform: openUpward ? 'translateY(-100%)' : 'none',
    } as const;
  };

  const filteredTimeline = useMemo(() => {
    if (!project) return timelineData;

    // Group comments by date from both recentSessions and manualSessions
    const commentsByDate = new Map<string, Set<string>>();
    recentSessions.forEach((s) => {
      if (s.comment?.trim()) {
        const date = s.start_time.substring(0, 10);
        if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
        commentsByDate.get(date)!.add(s.comment.trim());
      }
    });
    manualSessions.forEach((s) => {
      if (s.title?.trim()) {
        const date = s.start_time.substring(0, 10);
        if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
        commentsByDate.get(date)!.add(s.title.trim());
      }
    });

    const manualByDate = new Set(
      manualSessions.map((ms) => ms.start_time.substring(0, 10)),
    );

    return timelineData.map((row) => {
      const comments = commentsByDate.get(row.date);
      return {
        ...row,
        [project.name]: row[project.name] || 0,
        comments: comments ? Array.from(comments) : undefined,
        has_manual: row.has_manual || manualByDate.has(row.date),
      };
    });
  }, [timelineData, project, recentSessions, manualSessions]);

  const handleBack = () => {
    setProjectPageId(null);
    setCurrentPage('projects');
  };

  const handleCompact = async () => {
    if (!project) return;
    if (!await confirm("Compact this project's data? This will remove detailed file activity history, but will keep sessions and total time. This cannot be undone.")) {
      return;
    }
    setBusy('compact');
    try {
      await compactProjectData(project.id);
      triggerRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleAction = async (
    action: () => Promise<void>,
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !await confirm(confirmMsg)) return;
    try {
      await action();
      triggerRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    s: SessionWithApp & { isManual?: boolean },
  ) => {
    e.preventDefault();
    setCtxMenu({
      type: 'session',
      x: e.clientX,
      y: e.clientY,
      session: s,
    });
  };

  const ensureCommentForBoost = async (ids: number[]) => {
    const autoSessionIds = Array.from(
      new Set(ids.filter((id) => autoSessionsById.has(id))),
    );
    if (autoSessionIds.length === 0) return true;

    const missingIds = autoSessionIds.filter((id) => {
      const comment = autoSessionsById.get(id)?.comment;
      return !comment || !comment.trim();
    });
    if (missingIds.length === 0) return true;

    const label =
      missingIds.length === 1
        ? 'this session'
        : `${missingIds.length} sessions`;
    const entered = window.prompt(
      `Boost requires a comment. Enter a comment for ${label}:`,
      '',
    );
    const normalized = entered?.trim() ?? '';
    if (!normalized) {
      showError('Comment is required to add boost.');
      return false;
    }

    try {
      await Promise.all(
        missingIds.map((id) => updateSessionComment(id, normalized)),
      );
      const missingSet = new Set(missingIds);
      setRecentSessions((prev) =>
        prev.map((s) =>
          missingSet.has(s.id) ? { ...s, comment: normalized } : s,
        ),
      );
      return true;
    } catch (err) {
      console.error('Failed to save required boost comment:', err);
      showError(`Failed to save comment required for boost: ${String(err)}`);
      return false;
    }
  };

  const handleSetRateMultiplier = async (
    multiplier: number | null,
    ids: number[],
  ) => {
    const autoSessionIds = Array.from(
      new Set(ids.filter((id) => autoSessionsById.has(id))),
    );
    if (autoSessionIds.length === 0) return;
    try {
      if (multiplier != null && multiplier > 1.000_001) {
        const ok = await ensureCommentForBoost(autoSessionIds);
        if (!ok) return;
      }
      await Promise.all(
        autoSessionIds.map((id) => updateSessionRateMultiplier(id, multiplier)),
      );
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditComment = () => {
    if (!ctxMenu) return;
    if (ctxMenu.type === 'session') {
      handleEditCommentForSession(ctxMenu.session);
    } else if (ctxMenu.type === 'chart' && ctxMenu.sessions.length > 0) {
      const sessions = ctxMenu.sessions;
      setPromptConfig({
        title: `Comment for ${sessions.length} sessions`,
        description: 'Apply this comment to all sessions in this group.',
        initialValue: sessions[0].comment || '',
        onConfirm: async (raw) => {
          const trimmed = raw.trim();
          try {
            await Promise.all(
              sessions.map((s) => updateSessionComment(s.id, trimmed || null)),
            );
            triggerRefresh();
          } catch (err) {
            console.error(err);
          }
        },
      });
    }
    setCtxMenu(null);
  };

  const handleBulkUnassign = async (
    sessions: (SessionWithApp & { isManual?: boolean })[],
  ) => {
    const autoSessions = sessions.filter((s) => !s.isManual);
    if (autoSessions.length === 0) {
      showInfo('Manual sessions cannot be unassigned (they must belong to a project). Delete them instead.');
      return;
    }
    if (!await confirm(`Unassign ${autoSessions.length} automatic sessions from this project?`))
      return;
    try {
      await Promise.all(
        autoSessions.map((s) =>
          assignSessionToProject(s.id, null, 'bulk_unassign'),
        ),
      );
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
    setCtxMenu(null);
  };

  const handleBulkDelete = async (
    sessions: (SessionWithApp & { isManual?: boolean })[],
  ) => {
    if (!await confirm(`Permanently delete ${sessions.length} sessions?`))
      return;
    try {
      await Promise.all(
        sessions.map((s) =>
          s.isManual ? deleteManualSession(s.id) : deleteSession(s.id),
        ),
      );
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
    setCtxMenu({} as any); // Close menu
    setCtxMenu(null);
  };

  const handleEditCommentForSession = (session: SessionWithApp) => {
    const current = session.comment ?? '';
    const sessionId = session.id;

    setPromptConfig({
      title: 'Session Comment',
      description: 'Enter a comment for this session (leave empty to remove).',
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await updateSessionComment(sessionId, trimmed || null);
          triggerRefresh();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const handleCustomRateMultiplier = () => {
    if (!ctxMenu) return;
    const ids =
      ctxMenu.type === 'chart'
        ? ctxMenu.sessions
            .filter((s) => !(s as any).isManual)
            .map((s: SessionWithApp) => s.id)
        : [ctxMenu.session.id];
    const currentMultiplier =
      ctxMenu.type === 'session'
        ? ctxMenu.session.rate_multiplier || 1
        : ctxMenu.type === 'chart'
          ? ctxMenu.sessions[0]?.rate_multiplier || 1
          : 1;

    setPromptConfig({
      title: 'Set rate multiplier',
      description:
        ctxMenu.type === 'chart'
          ? `Apply to ${ids.length} sessions`
          : 'Multiplier must be > 0. Use 1 to reset.',
      initialValue: String(currentMultiplier > 1 ? currentMultiplier : 2),
      onConfirm: async (raw) => {
        const parsed = Number(raw.trim().replace(',', '.'));
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        await handleSetRateMultiplier(parsed, ids);
      },
    });
    setCtxMenu(null);
  };

  const handleAssign = async (projectId: number | null) => {
    if (!ctxMenu || ctxMenu.type === 'chart') return;
    try {
      await assignSessionToProject(
        ctxMenu.session.id,
        projectId,
        'manual_project_card_change',
      );
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
    setCtxMenu(null);
  };

  if (loading && !project) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading project details...
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="h-8">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="h-4 w-[1px] bg-border" />
        <h1
          data-project-id={project.id}
          data-project-name={project.name}
          className="text-xl font-semibold flex items-center gap-2"
        >
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          {project.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Project Overview
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleAction(
                    () => resetProjectTime(project.id),
                    'Reset tracked time for this project? This cannot be undone.',
                  )
                }
                title="Reset time"
              >
                <TimerReset className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  project.frozen_at && 'text-blue-400 bg-blue-500/10',
                )}
                onClick={() =>
                  handleAction(() =>
                    project.frozen_at
                      ? unfreezeProject(project.id)
                      : freezeProject(project.id),
                  )
                }
                title={
                  project.frozen_at ? 'Unfreeze project' : 'Freeze project'
                }
              >
                <Snowflake className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() =>
                  handleAction(
                    () => excludeProject(project.id),
                    'Exclude this project?',
                  )
                }
                title="Exclude project"
              >
                <CircleOff className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                Total Time / Value
              </p>
              <div className="flex items-baseline gap-4">
                <p className="text-4xl font-[200] text-emerald-400">
                  {formatDuration(project.total_seconds)}
                </p>
                <span className="text-2xl font-[100] opacity-30">/</span>
                <p className="text-3xl font-[200] text-emerald-400/80">
                  {formatMoney(estimate, currencyCode)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Sessions
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.session_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  File Edits
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.file_activity_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40 flex flex-col justify-between">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Manual Sessions
                </p>
                <p className="text-2xl font-light flex items-center justify-between">
                  <span>{extraInfo?.db_stats.manual_session_count || 0}</span>
                  {(extraInfo?.db_stats.manual_session_count || 0) > 0 && (
                    <div className="h-6 w-6 rounded bg-orange-500/10 flex items-center justify-center text-orange-400">
                      <MousePointerClick className="h-3.5 w-3.5" />
                    </div>
                  )}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40 flex flex-col justify-between">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Comments
                </p>
                <p className="text-2xl font-light flex items-center justify-between">
                  <span>{extraInfo?.db_stats.comment_count || 0}</span>
                  {(extraInfo?.db_stats.comment_count || 0) > 0 && (
                    <div className="h-6 w-6 rounded bg-sky-500/10 flex items-center justify-center text-sky-400">
                      <MessageSquare className="h-3.5 w-3.5" />
                    </div>
                  )}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40 flex flex-col justify-between">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Boosted Sessions
                </p>
                <p className="text-2xl font-light flex items-center justify-between">
                  <span>{extraInfo?.db_stats.boosted_session_count || 0}</span>
                  {(extraInfo?.db_stats.boosted_session_count || 0) > 0 && (
                    <div className="h-6 w-6 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <CircleDollarSign className="h-3.5 w-3.5" />
                    </div>
                  )}
                </p>
              </div>
            </div>

            {project.assigned_folder_path && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">
                  Assigned Folder
                </p>
                <p
                  className="text-sm font-mono bg-secondary/30 p-2 rounded truncate transition-colors hover:bg-secondary/50 cursor-default"
                  title={project.assigned_folder_path}
                >
                  {project.assigned_folder_path}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Top Applications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {extraInfo?.top_apps.map((app, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/20 transition-colors"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: app.color || '#64748b' }}
                  />
                  <span className="text-sm truncate flex-1 font-medium">
                    {app.name}
                  </span>
                  <span className="font-mono text-xs text-emerald-400 shrink-0">
                    {formatDuration(app.seconds)}
                  </span>
                </div>
              ))}
              {(!extraInfo?.top_apps || extraInfo.top_apps.length === 0) && (
                <p className="text-sm text-muted-foreground italic text-center py-4">
                  No application data yet
                </p>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-dashed border-border/60">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-muted-foreground uppercase font-bold">
                  Data Management
                </span>
                <Badge variant="outline" className="text-[10px] opacity-70">
                  ~
                  {(
                    (extraInfo?.db_stats.estimated_size_bytes || 0) / 1024
                  ).toFixed(1)}{' '}
                  KB
                </Badge>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/20"
                onClick={handleCompact}
                disabled={
                  !extraInfo ||
                  extraInfo.db_stats.file_activity_count === 0 ||
                  !!busy
                }
              >
                {busy === 'compact' ? (
                  <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
                )}
                Compact Detailed Records
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2 px-1 leading-tight">
                Compaction removes detailed file-level history while preserving
                sessions and total time.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <TimelineChart
          title="Activity Over Time"
          data={filteredTimeline}
          projectColors={project ? { [project.name]: project.color } : {}}
          granularity="day"
          heightClassName="h-64"
          onBarClick={(date) => {
            setSessionDialogDate(date);
            setSessionDialogOpen(true);
          }}
          onBarContextMenu={(date, x, y) => {
            const dayLogSessions = recentSessions
              .filter((s) => s.start_time.startsWith(date))
              .map((s) => ({ ...s, isManual: false }));
            const dayManualSessions = manualSessions
              .filter((s) => s.start_time.startsWith(date))
              .map(
                (m) =>
                  ({
                    ...m,
                    app_name: 'Manual Session',
                    executable_name: 'manual',
                    project_id: m.project_id,
                    project_name: m.project_name,
                    project_color: m.project_color,
                    comment: m.title,
                    files: [],
                    isManual: true,
                  }) as any,
              );
            const daySessions = [...dayLogSessions, ...dayManualSessions];
            setCtxMenu({
              type: 'chart',
              x,
              y,
              date,
              sessions: daySessions,
            });
          }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="h-4 w-4 text-sky-400" />
                  Manual Sessions
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditManualSession(null);
                    setSessionDialogDate(undefined);
                    setSessionDialogOpen(true);
                  }}
                  className="h-6 text-[10px] font-bold text-sky-400 hover:bg-sky-400/10"
                >
                  + Add Manual
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {manualSessions.map((ms) => (
                  <div
                    key={ms.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/20 border border-border/40 cursor-pointer hover:bg-secondary/30 transition-colors"
                    onClick={() => {
                      setEditManualSession(ms);
                      setSessionDialogOpen(true);
                    }}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{ms.title}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {new Date(ms.start_time).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono text-emerald-400">
                        {formatDuration(ms.duration_seconds)}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase">
                        Value Added
                      </p>
                    </div>
                  </div>
                ))}
                {manualSessions.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    No manual sessions recorded
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sky-500" />
                Recent Comments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentSessions
                  .filter((s) => s.comment)
                  .slice(0, 5)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="p-3 rounded-lg bg-secondary/20 border border-border/40 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground">
                          {new Date(s.start_time).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400/70">
                          {formatDuration(s.duration_seconds)}
                        </span>
                      </div>
                      <p className="text-sm text-sky-100 italic">
                        "{s.comment}"
                      </p>
                      <p className="text-[10px] text-muted-foreground text-right">
                        â€” {s.app_name}
                      </p>
                    </div>
                  ))}
                {recentSessions.filter((s) => s.comment).length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    No comments found
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Detailed Session List
              </div>
              <span className="text-xs font-normal lowercase text-muted-foreground">
                right-click to edit sessions
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <div className="overflow-x-auto text-muted-foreground">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider font-bold">
                  <tr>
                    <th className="px-4 py-3">{tt('Data', 'Date')}</th>
                    <th className="px-4 py-3">{tt('Czas trwania', 'Duration')}</th>
                    <th className="px-4 py-3">{tt('Aplikacja', 'Application')}</th>
                    <th className="px-4 py-3">{tt('SzczegĂłĹ‚y / Komentarz', 'Details / Comment')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {groupedSessions.map(({ date, sessions }) => (
                    <React.Fragment key={date}>
                      <tr className="bg-secondary/5 border-y border-border/5">
                        <td colSpan={4} className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30 select-none">
                              {isToday(parseISO(date))
                                ? 'Today'
                                : isYesterday(parseISO(date))
                                  ? 'Yesterday'
                                  : format(
                                      parseISO(date),
                                      'EEEE, do MMMM yyyy',
                                    )}
                            </span>
                            <div className="h-[1px] flex-1 bg-border/5" />
                            <span className="text-[9px] font-medium text-muted-foreground/20 font-mono italic">
                              {sessions.length} sessions
                            </span>
                          </div>
                        </td>
                      </tr>
                      {sessions.map((s) => {
                        const isManual = (s as any).isManual;
                        return (
                          <tr
                            key={`${isManual ? 'm' : 's'}-${s.id}`}
                            className="hover:bg-accent/10 transition-colors cursor-context-menu"
                            onContextMenu={(e) => handleContextMenu(e, s)}
                          >
                            <td className="px-4 py-3 whitespace-nowrap min-w-[120px]">
                              <div className="flex items-center gap-2">
                                {isManual && (
                                  <PenLine className="h-3 w-3 text-emerald-400" />
                                )}
                                {format(parseISO(s.start_time), 'HH:mm')}
                                <span className="text-[10px] opacity-20 ml-2 font-mono">
                                  â€” {format(parseISO(s.end_time), 'HH:mm')}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono text-emerald-400">
                              <div className="flex items-center gap-2">
                                {formatDuration(s.duration_seconds)}
                                {(s.rate_multiplier ?? 1) > 1.000_001 && (
                                  <CircleDollarSign className="h-3 w-3 text-emerald-400" />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor:
                                      s.project_color || '#64748b',
                                  }}
                                />
                                {isManual ? (
                                  <span className="text-emerald-400 font-medium">
                                    Manual Session
                                  </span>
                                ) : (
                                  s.app_name
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 group/comment">
                              <div
                                className="flex items-center gap-2 text-sky-200 italic truncate max-w-xs cursor-pointer hover:text-sky-100 transition-colors"
                                onClick={() => {
                                  if (isManual) {
                                    setEditManualSession(s as any);
                                    setSessionDialogOpen(true);
                                  } else {
                                    handleEditCommentForSession(s);
                                  }
                                }}
                                title={
                                  s.comment
                                    ? 'Click to edit'
                                    : 'Click to add comment'
                                }
                              >
                                {s.comment ? (
                                  <>
                                    <MessageSquare className="h-3 w-3 shrink-0" />
                                    {s.comment}
                                    {isManual && (
                                      <PenLine className="h-2 w-2 text-muted-foreground ml-1" />
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <MessageSquare className="h-3 w-3 shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity" />
                                    <span className="text-muted-foreground/20 group-hover/comment:text-muted-foreground/50 transition-colors">
                                      â€”
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {groupedSessions.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground italic"
                      >
                        No sessions found for this project.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {ctxMenu && ctxMenu.type === 'chart' && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[300px] max-h-[70vh] overflow-y-auto rounded-md border border-white/10 bg-[#1a1b26]/95 p-1 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 backdrop-blur-xl"
          style={getContextMenuStyle(ctxMenu.x, ctxMenu.y, 300)}
        >
          {ctxMenu.sessions.length > 0 ? (
            <>
              <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground/60 border-b border-white/5 mb-1 flex items-center justify-between">
                <span>
                  Session actions (
                  {
                    Array.from(new Set(ctxMenu.sessions.map((s) => s.app_name)))
                      .length
                  }{' '}
                  apps)
                </span>
                <span className="text-[10px] opacity-40">
                  {ctxMenu.sessions.length} sessions
                </span>
              </div>

              <button
                className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-xs font-medium text-white/90 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => {
                  const count = ctxMenu.sessions.length;
                  const apps = Array.from(
                    new Set(ctxMenu.sessions.map((s) => s.app_name)),
                  ).join(', ');
                  showInfo(`Bulk action on ${count} sessions â€” Apps affected: ${apps}`);
                  setCtxMenu(null);
                }}
              >
                <span>{tt('Szczegóły sesji', 'Session details')}</span>
                <span className="text-muted-foreground/50">
                  {ctxMenu.sessions.length}
                </span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <div className="px-3 py-2 space-y-2">
                <p className="text-[10px] text-muted-foreground/50 leading-tight italic">
                  Applies to all {ctxMenu.sessions.length} sessions in this
                  visual chunk
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  Rate multiplier (default x2):{' '}
                  <span className="text-emerald-400 font-mono">
                    {formatMultiplierLabel(
                      ctxMenu.sessions[0]?.rate_multiplier,
                    )}
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/25 active:scale-95 cursor-pointer shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]"
                    onClick={() =>
                      handleSetRateMultiplier(
                        2,
                        ctxMenu.sessions.map((s) => s.id),
                      )
                    }
                  >
                    Boost x2
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/15 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    Custom...
                  </button>
                </div>
              </div>

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={handleEditComment}
              >
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>
                  {ctxMenu.sessions[0]?.comment
                    ? 'Edit comment'
                    : 'Add comment'}
                </span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={() => handleBulkUnassign(ctxMenu.sessions)}
              >
                <History className="h-3.5 w-3.5 text-muted-foreground/40" />
                <span className="truncate">{tt('Odepnij grupę od projektu', 'Unassign group from project')}</span>
              </button>

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
                onClick={() => handleBulkDelete(ctxMenu.sessions)}
              >
                <Trash2 className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
                <span>{tt('Usuń grupę', 'Delete Group')}</span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={() => {
                  setSessionDialogDate(ctxMenu.date);
                  setEditManualSession(null);
                  setSessionDialogOpen(true);
                  setCtxMenu(null);
                }}
              >
                <Plus className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tt('Dodaj sesję ręczną', 'Add manual session')}</span>
              </button>

              {(() => {
                const manuals = ctxMenu.sessions.filter(
                  (s) => (s as any).isManual,
                );
                if (manuals.length === 0) return null;
                return (
                  <>
                    <div className="h-px bg-white/5 my-1" />
                    {manuals.length === 1 ? (
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 cursor-pointer transition-colors border border-emerald-500/20"
                        onClick={() => {
                          setEditManualSession(manuals[0] as any);
                          setSessionDialogOpen(true);
                          setCtxMenu(null);
                        }}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                        <span className="font-bold uppercase tracking-tight">
                          Edit Manual Session:{' '}
                          {manuals[0].comment || 'Time log'}
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-emerald-400/50 font-bold">
                          Manual Sessions (click to edit)
                        </div>
                        {manuals.map((ms) => (
                          <button
                            key={ms.id}
                            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors group/ms"
                            onClick={() => {
                              setEditManualSession(ms as any);
                              setSessionDialogOpen(true);
                              setCtxMenu(null);
                            }}
                          >
                            <PenLine className="h-3.5 w-3.5 text-emerald-400" />
                            <div className="flex flex-col items-start leading-none truncate">
                              <span className="font-medium">
                                Edit: {ms.comment || 'Manual Session'}
                              </span>
                              <span className="text-[9px] text-muted-foreground mt-0.5">
                                {formatDuration(ms.duration_seconds)} manual
                                record
                              </span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <div className="px-2 py-2 text-[11px] font-semibold text-muted-foreground/50 border-b border-white/5 mb-1 flex items-center justify-between">
                <span>{tt('Akcje strefy', 'Zone actions')}</span>
                <span className="bg-white/5 px-1.5 py-0.5 rounded text-[10px]">
                  {new Date(ctxMenu.date).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <button
                className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-sm hover:bg-white/5 hover:text-white cursor-pointer transition-all active:scale-95"
                onClick={() => {
                  setSessionDialogDate(ctxMenu.date);
                  setEditManualSession(null);
                  setSessionDialogOpen(true);
                  setCtxMenu(null);
                }}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-400">
                  <Plus className="h-4 w-4" />
                </div>
                <div className="flex flex-col items-start leading-none text-left">
                  <span className="font-medium text-xs">
                    Add manual session
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Log time for this slot
                  </span>
                </div>
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button
                className="flex w-full items-center justify-center gap-2 rounded-sm py-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/5 cursor-pointer transition-colors"
                onClick={() => setCtxMenu(null)}
              >
                <span>{tt('Anuluj', 'Cancel')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {ctxMenu && (ctxMenu.type === 'session' || !ctxMenu.type) && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-y-auto rounded-md border border-white/10 bg-[#1a1b26]/95 p-1 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 backdrop-blur-xl"
          style={getContextMenuStyle(ctxMenu.x, ctxMenu.y, 240)}
        >
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground/60 border-b border-white/5 mb-1 flex items-center justify-between">
            <span>{tt('Akcje sesji (1 aplikacja)', 'Session actions (1 app)')}</span>
            <span className="text-[10px] opacity-40">1 session</span>
          </div>

          <button
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-sm hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
            onClick={() => {
              setSelectedSessionDetail((ctxMenu as any).session);
              setSessionDetailOpen(true);
              setCtxMenu(null);
            }}
          >
            <span className="font-medium text-xs ml-1">{tt('Szczegóły sesji', 'Session details')}</span>
            <span className="text-[10px] text-muted-foreground/50 mr-1">1</span>
          </button>

          {!(ctxMenu as any).session.isManual && (
            <>
              <div className="px-3 py-2 space-y-2">
                <p className="text-[10px] text-muted-foreground/50 leading-tight">
                  Applies to this session record
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  Rate multiplier (default x2):{' '}
                  <span className="text-emerald-400">
                    x
                    {((ctxMenu as any).session.rate_multiplier || 1).toFixed(1)}
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95 cursor-pointer"
                    onClick={() =>
                      handleSetRateMultiplier(2, [(ctxMenu as any).session.id])
                    }
                  >
                    Boost x2
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    Custom...
                  </button>
                </div>
              </div>
              <div className="h-px bg-white/5 my-1" />
            </>
          )}

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
            onClick={() => {
              const s = (ctxMenu as any).session;
              if (s.isManual) {
                setEditManualSession(s);
                setSessionDialogOpen(true);
              } else {
                handleEditComment();
              }
              setCtxMenu(null);
            }}
          >
            {(ctxMenu as any).session.isManual ? (
              <>
                <PenLine className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tt('Edytuj sesję ręczną', 'Edit manual session')}</span>
              </>
            ) : (
              <>
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>
                  {(ctxMenu as any).session.comment
                    ? 'Edit comment'
                    : 'Add comment'}
                </span>
              </>
            )}
          </button>

          <div className="h-px bg-white/5 my-1" />

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
            onClick={() => handleAssign(null)}
          >
            <History className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="truncate">{tt('Odepnij z projektu', 'Unassign from project')}</span>
          </button>

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
            onClick={async () => {
              if (await confirm('Delete this session?')) {
                try {
                  await deleteSession((ctxMenu as any).session.id);
                  triggerRefresh();
                  setCtxMenu(null);
                } catch (err) {
                  console.error(err);
                }
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
            <span>{tt('Usuń sesję', 'Delete Session')}</span>
          </button>
        </div>
      )}

      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => !open && setPromptConfig(null)}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
        confirmLabel="Save"
      />

      <Dialog open={sessionDetailOpen} onOpenChange={setSessionDetailOpen}>
        <DialogContent className="max-w-2xl bg-[#1a1b26] border-white/10 text-white">
          {selectedSessionDetail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{
                      backgroundColor:
                        selectedSessionDetail.project_color || '#64748b',
                    }}
                  />
                  <span>{tt('Szczegóły sesji', 'Session Details')}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Project
                  </p>
                  <p className="truncate text-sm font-medium mt-1">
                    {selectedSessionDetail.project_name || 'Unassigned'}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    App / Activity
                  </p>
                  <p className="truncate text-sm font-medium mt-1">
                    {(selectedSessionDetail as any).isManual
                      ? 'Manual Session'
                      : selectedSessionDetail.app_name}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Time Range
                  </p>
                  <p className="text-sm font-mono mt-1">
                    {format(
                      parseISO(selectedSessionDetail.start_time),
                      'HH:mm',
                    )}{' '}
                    -{' '}
                    {format(parseISO(selectedSessionDetail.end_time), 'HH:mm')}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {format(
                      parseISO(selectedSessionDetail.start_time),
                      'MMM do, yyyy',
                    )}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Duration
                  </p>
                  <p className="text-sm font-mono mt-1 text-emerald-400">
                    {formatDuration(selectedSessionDetail.duration_seconds)}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Rate Multiplier
                  </p>
                  <p className="text-sm font-medium mt-1">
                    x{(selectedSessionDetail.rate_multiplier || 1).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    ID
                  </p>
                  <p className="text-sm font-mono mt-1 text-muted-foreground">
                    #{selectedSessionDetail.id}{' '}
                    {(selectedSessionDetail as any).isManual ? '(Manual)' : ''}
                  </p>
                </div>
              </div>

              {selectedSessionDetail.comment && (
                <div className="mt-4 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" />
                    Comment
                  </p>
                  <p className="mt-1 text-sm italic text-sky-100/90 leading-relaxed">
                    â€ś{selectedSessionDetail.comment}â€ť
                  </p>
                </div>
              )}

              {selectedSessionDetail.files &&
                selectedSessionDetail.files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      Files Accessed
                    </p>
                    <div className="max-h-[200px] overflow-y-auto rounded-md border border-white/5 bg-white/5 p-2 space-y-1">
                      {selectedSessionDetail.files.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-4 px-2 py-1.5 rounded hover:bg-white/5 text-[12px] border-b border-white/5 last:border-0"
                        >
                          <span
                            className="truncate text-muted-foreground/90 font-mono"
                            title={f.file_name}
                          >
                            {f.file_name}
                          </span>
                          <span className="shrink-0 text-emerald-400 font-mono opacity-80">
                            {formatDuration(f.total_seconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="outline"
                  className="border-white/10"
                  onClick={() => setSessionDetailOpen(false)}
                >
                  Close
                </Button>
                {(selectedSessionDetail as any).isManual ? (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      setEditManualSession(selectedSessionDetail as any);
                      setSessionDetailOpen(false);
                      setSessionDialogOpen(true);
                    }}
                  >
                    Edit Manual Session
                  </Button>
                ) : (
                  <Button
                    className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      handleEditCommentForSession(selectedSessionDetail);
                      setSessionDetailOpen(false);
                    }}
                  >
                    Edit Comment
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={(open) => {
          setSessionDialogOpen(open);
          if (!open) setEditManualSession(null);
        }}
        projects={projectsList}
        defaultProjectId={project?.id}
        defaultStartTime={
          sessionDialogDate ? `${sessionDialogDate}T09:00` : undefined
        }
        editSession={editManualSession || undefined}
        onSaved={triggerRefresh}
      />
      <ConfirmDialog />
    </div>
  );
}
