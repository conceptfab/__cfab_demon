import * as React from 'react';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  Save,
  FileText,
} from 'lucide-react';
import { TimelineChart } from '@/components/dashboard/TimelineChart';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { PromptModal } from '@/components/ui/prompt-modal';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ProjectSessionDetailDialog } from '@/components/project/ProjectSessionDetailDialog';
import { ProjectManualSessionsCard } from '@/components/project/ProjectManualSessionsCard';
import { ProjectRecentCommentsCard } from '@/components/project/ProjectRecentCommentsCard';
import {
  getProjects,
  getProjectExtraInfo,
  compactProjectData,
  getProjectEstimates,
  resetProjectTime,
  freezeProject,
  unfreezeProject,
  excludeProject,
  getManualSessions,
  getProjectTimeline,
  updateProject,
} from '@/lib/tauri';
import {
  formatDuration,
  formatMoney,
  formatMultiplierLabel,
  cn,
} from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import type {
  ProjectWithStats,
  ProjectExtraInfo,
  SessionWithApp,
  ManualSessionWithProject,
  StackedBarData,
} from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import { useSessionActions } from '@/hooks/useSessionActions';
import { PROJECT_COLORS } from '@/lib/project-colors';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-ranges';
import { fetchAllSessions } from '@/lib/session-pagination';

type AutoSessionRow = SessionWithApp & { isManual: false };

type ManualSessionRow = SessionWithApp &
  ManualSessionWithProject & {
    isManual: true;
  };

type ProjectSessionRow = AutoSessionRow | ManualSessionRow;

type ContextMenu =
  | {
      x: number;
      y: number;
      session: ProjectSessionRow;
      type: 'session';
    }
  | {
      x: number;
      y: number;
      type: 'chart';
      date: string;
      sessions: ProjectSessionRow[];
    };

type RecentCommentItem = {
  key: string;
  start_time: string;
  duration_seconds: number;
  comment: string;
  source: string;
};

export function ProjectPage() {
  const { t } = useTranslation();
  const { projectPageId, setProjectPageId, setCurrentPage } = useUIStore();
  const { refreshKey, triggerRefresh } = useDataStore();
  const { currencyCode } = useSettingsStore();
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const {
    assignSessions,
    updateSessionRateMultipliers,
    updateSessionComments,
    updateSessionComment,
    deleteSessions,
    deleteManualSessions,
  } = useSessionActions({
    onAfterMutation: triggerRefresh,
    onError: (action, error) => {
      console.error(`Project page session action failed (${action}):`, error);
    },
  });

  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
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
  const sessionCountLabel = (count: number) =>
    `${count} ${count === 1
      ? t('project_page.text.session')
      : t('project_page.text.sessions')}`;
  const appCountLabel = (count: number) =>
    `${count} ${count === 1
      ? t('project_page.text.app')
      : t('project_page.text.apps')}`;
  const toAutoSessionRow = useCallback(
    (session: SessionWithApp): AutoSessionRow => ({
      ...session,
      isManual: false,
    }),
    [],
  );
  const toManualSessionRow = useCallback(
    (session: ManualSessionWithProject): ManualSessionRow => ({
      ...session,
      app_id: session.app_id ?? 0,
      app_name: t('project_page.text.manual_session'),
      executable_name: 'manual',
      project_id: session.project_id,
      project_name: session.project_name,
      project_color: session.project_color,
      comment: session.title,
      files: [],
      isManual: true,
    }),
    [t],
  );

  const groupedSessions = useMemo(() => {
    const groups: {
      [date: string]: ProjectSessionRow[];
    } = {};

    recentSessions.forEach((s) => {
      const date = s.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push(toAutoSessionRow(s));
    });

    manualSessions.forEach((m) => {
      const date = m.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push(toManualSessionRow(m));
    });

    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0])) // Most recent days first
      .map(([date, sessions]) => ({
        date,
        sessions: sessions.sort((a, b) =>
          b.start_time.localeCompare(a.start_time),
        ), // Most recent sessions first within day
      }));
  }, [recentSessions, manualSessions, toAutoSessionRow, toManualSessionRow]);

  const recentComments = useMemo<RecentCommentItem[]>(() => {
    const automatic = recentSessions
      .map((s) => {
        const text = s.comment?.trim();
        if (!text) return null;
        return {
          key: `auto-${s.id}`,
          start_time: s.start_time,
          duration_seconds: s.duration_seconds,
          comment: text,
          source: s.app_name,
        };
      })
      .filter((item): item is RecentCommentItem => item !== null);

    const manual = manualSessions
      .map((m) => {
        const text = m.title?.trim();
        if (!text) return null;
        return {
          key: `manual-${m.id}`,
          start_time: m.start_time,
          duration_seconds: m.duration_seconds,
          comment: text,
          source: t('project_page.text.manual_session'),
        };
      })
      .filter((item): item is RecentCommentItem => item !== null);

    return [...automatic, ...manual]
      .sort((a, b) => b.start_time.localeCompare(a.start_time))
      .slice(0, 5);
  }, [recentSessions, manualSessions, t]);

  const [estimate, setEstimate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [selectedSessionDetail, setSelectedSessionDetail] =
    useState<ProjectSessionRow | null>(null);
  const [sessionDialogDate, setSessionDialogDate] = useState<
    string | undefined
  >();
  const [editManualSession, setEditManualSession] =
    useState<ManualSessionWithProject | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [editingColor, setEditingColor] = useState(false);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectPageId === null) {
      setCurrentPage('projects');
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all([
      getProjects(),
      getProjectExtraInfo(projectPageId, ALL_TIME_DATE_RANGE),
      getProjectEstimates(ALL_TIME_DATE_RANGE),
      getProjectTimeline(
        ALL_TIME_DATE_RANGE,
        100,
        'day',
        projectPageId,
      ).catch(() => [] as StackedBarData[]),
      fetchAllSessions({
        projectId: projectPageId,
        dateRange: ALL_TIME_DATE_RANGE,
        includeAiSuggestions: false,
      }),
      getManualSessions({ projectId: projectPageId }),
    ])
      .then(([projects, info, estimates, timeline, sessions, manuals]) => {
        if (cancelled) return;
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
        if (cancelled) return;
        console.error('Critical error fetching project data:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
    if (
      !(await confirm(
        t('project_page.text.compact_this_project_s_data_this_will_remove_detailed_fi'),
      ))
    ) {
      return;
    }
    setBusy('compact');
    try {
      await compactProjectData(project.id);
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
    if (confirmMsg && !(await confirm(confirmMsg))) return;
    try {
      await action();
    } catch (e) {
      console.error(e);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, s: ProjectSessionRow) => {
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
        ? t('sessions.prompts.boost_label_single')
        : t('sessions.prompts.boost_label_multi', { count: missingIds.length });
    const entered = await new Promise<string | null>((resolve) => {
      setPromptConfig({
        title: t('sessions.prompts.boost_requires_comment_prompt', { label }),
        initialValue: '',
        onConfirm: (val) => resolve(val),
        onCancel: () => resolve(null),
      });
    });
    const normalized = entered?.trim() ?? '';
    if (!normalized) {
      showError(t('sessions.prompts.boost_comment_required'));
      return false;
    }

    try {
      await updateSessionComments(missingIds, normalized);
      const missingSet = new Set(missingIds);
      setRecentSessions((prev) =>
        prev.map((s) =>
          missingSet.has(s.id) ? { ...s, comment: normalized } : s,
        ),
      );
      return true;
    } catch (err) {
      console.error('Failed to save required boost comment:', err);
      showError(
        `${t('project_page.text.failed_to_save_comment_required_for_boost')} ${String(err)}`,
      );
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
      await updateSessionRateMultipliers(autoSessionIds, multiplier);
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
        title: t('project_page.text.comment_for_sessions', { count: sessions.length }),
        description: t('project_page.text.apply_this_comment_to_all_sessions_in_this_group'),
        initialValue: sessions[0].comment || '',
        onConfirm: async (raw) => {
          const trimmed = raw.trim();
          try {
            await updateSessionComments(
              sessions.map((s) => s.id),
              trimmed || null,
            );
          } catch (err) {
            console.error(err);
          }
        },
      });
    }
    setCtxMenu(null);
  };

  const handleBulkUnassign = async (sessions: ProjectSessionRow[]) => {
    const autoSessions = sessions.filter(
      (s): s is AutoSessionRow => !s.isManual,
    );
    if (autoSessions.length === 0) {
      showInfo(
        t('project_page.text.manual_sessions_cannot_be_unassigned_they_must_belong_to'),
      );
      return;
    }
    if (
      !(await confirm(
        t('project_page.text.unassign_automatic_sessions_from_this_project', { count: autoSessions.length }),
      ))
    )
      return;
    try {
      await assignSessions(
        autoSessions.map((s) => s.id),
        null,
        'bulk_unassign',
      );
    } catch (err) {
      console.error(err);
    }
    setCtxMenu(null);
  };

  const handleBulkDelete = async (sessions: ProjectSessionRow[]) => {
    if (
      !(await confirm(
        t('project_page.text.permanently_delete_sessions', { count: sessions.length }),
      ))
    )
      return;
    try {
      const manualIds = sessions
        .filter((s): s is ManualSessionRow => s.isManual)
        .map((s) => s.id);
      const autoIds = sessions
        .filter((s): s is AutoSessionRow => !s.isManual)
        .map((s) => s.id);
      await Promise.all([
        deleteManualSessions(manualIds),
        deleteSessions(autoIds),
      ]);
    } catch (err) {
      console.error(err);
    }
    setCtxMenu(null);
  };

  const handleEditCommentForSession = (session: SessionWithApp) => {
    const current = session.comment ?? '';
    const sessionId = session.id;

    setPromptConfig({
      title: t('project_page.text.session_comment'),
      description: t('project_page.text.enter_a_comment_for_this_session_leave_empty_to_remove'),
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await updateSessionComment(sessionId, trimmed || null);
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
        ? ctxMenu.sessions.filter((s) => !s.isManual).map((s) => s.id)
        : [ctxMenu.session.id];
    const currentMultiplier =
      ctxMenu.type === 'session'
        ? ctxMenu.session.rate_multiplier || 1
        : ctxMenu.type === 'chart'
          ? ctxMenu.sessions[0]?.rate_multiplier || 1
          : 1;

    setPromptConfig({
      title: t('project_page.text.set_rate_multiplier'),
      description:
        ctxMenu.type === 'chart'
          ? t('project_page.text.apply_to_sessions', {
              count: ids.length,
            })
          : t('project_page.text.multiplier_must_be_0_use_1_to_reset'),
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
      await assignSessions(
        ctxMenu.session.id,
        projectId,
        'manual_project_card_change',
      );
    } catch (err) {
      console.error(err);
    }
    setCtxMenu(null);
  };

  if (loading && !project) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        {t('project_page.text.loading_project_details')}
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="h-8">
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('project_page.text.back_to_projects')}
        </Button>
        <div className="h-4 w-[1px] bg-border" />
        <h1
          data-project-id={project.id}
          data-project-name={project.name}
          className="text-xl font-semibold flex items-center gap-2"
        >
          <div className="relative group">
            <AppTooltip content={t('project_page.text.change_color')}>
              <div
                className="h-3 w-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                style={{
                  backgroundColor:
                    pendingColor && editingColor ? pendingColor : project.color,
                }}
                onClick={() => {
                  setEditingColor(!editingColor);
                  setPendingColor(null);
                }}
              />
            </AppTooltip>
            {editingColor && (
              <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded border bg-popover shadow-md">
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    defaultValue={project.color}
                    className="w-16 h-8 border border-border rounded cursor-pointer"
                    onChange={(e) => setPendingColor(e.target.value)}
                    title={t('project_page.text.choose_color')}
                  />
                  {pendingColor && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-500 hover:text-green-400"
                      onClick={async () => {
                        await updateProject(project.id, pendingColor);
                        setProject({ ...project, color: pendingColor });
                        setEditingColor(false);
                        setPendingColor(null);
                      }}
                      title={t('project_page.text.save_color')}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex gap-1">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                      onClick={async () => {
                        await updateProject(project.id, c);
                        setProject({ ...project, color: c });
                        setEditingColor(false);
                        setPendingColor(null);
                      }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          {project.name}
        </h1>
        <Button
          size="sm"
          className="ml-auto bg-sky-600 hover:bg-sky-700 text-white"
          onClick={() => setShowTemplateSelector(true)}
        >
          <FileText className="mr-2 h-4 w-4" />
          {t('project_page.text.generate_report_pdf')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t('project_page.text.project_overview')}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleAction(
                    () => resetProjectTime(project.id),
                    t('project_page.text.reset_tracked_time_for_this_project_this_cannot_be_undon'),
                  )
                }
                title={t('project_page.text.reset_time')}
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
                  project.frozen_at
                    ? t('project_page.text.unfreeze_project')
                    : t('project_page.text.freeze_project')
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
                    t('project_page.text.exclude_this_project'),
                  )
                }
                title={t('project_page.text.exclude_project')}
              >
                <CircleOff className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                {t('project_page.text.total_time_value')}
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
                  {t('project_page.text.sessions')}
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.session_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  {t('project_page.text.unique_files')}
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.file_activity_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40 flex flex-col justify-between">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  {t('project_page.text.manual_sessions')}
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
                  {t('project_page.text.comments')}
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
                  {t('project_page.text.boosted_sessions')}
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
                  {t('project_page.text.assigned_folder')}
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
              {t('project_page.text.top_applications')}
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
                  {t('project_page.text.no_application_data_yet')}
                </p>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-dashed border-border/60">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-muted-foreground uppercase font-bold">
                  {t('project_page.text.data_management')}
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
                {t('project_page.text.compact_detailed_records')}
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2 px-1 leading-tight">
                {t('project_page.text.compaction_removes_detailed_file_level_history_while_pre')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <TimelineChart
          title={t('project_page.timeline.activity_over_time')}
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
              .map(toAutoSessionRow);
            const dayManualSessions = manualSessions
              .filter((s) => s.start_time.startsWith(date))
              .map(toManualSessionRow);
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
          <ProjectManualSessionsCard
            sessions={manualSessions}
            labels={{
              title: t('project_page.text.manual_sessions'),
              addManual: t('project_page.text.add_manual'),
              valueAdded: t('project_page.text.value_added'),
              emptyText: t('project_page.text.no_manual_sessions_recorded'),
            }}
            formatDuration={formatDuration}
            onAddManual={() => {
              setEditManualSession(null);
              setSessionDialogDate(undefined);
              setSessionDialogOpen(true);
            }}
            onEditManual={(session) => {
              setEditManualSession(session);
              setSessionDialogOpen(true);
            }}
          />

          <ProjectRecentCommentsCard
            comments={recentComments}
            labels={{
              title: t('project_page.text.recent_comments'),
              emptyText: t('project_page.text.no_comments_found'),
            }}
            formatDuration={formatDuration}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t('project_page.text.detailed_session_list')}
              </div>
              <span className="text-xs font-normal lowercase text-muted-foreground">
                {t('project_page.text.right_click_to_edit_sessions')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <div className="overflow-x-auto text-muted-foreground">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider font-bold">
                  <tr>
                    <th className="px-4 py-3">{t('project_page.text.date')}</th>
                    <th className="px-4 py-3">
                      {t('project_page.text.duration')}
                    </th>
                    <th className="px-4 py-3">
                      {t('project_page.text.application')}
                    </th>
                    <th className="px-4 py-3">
                      {t('project_page.text.details_comment')}
                    </th>
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
                                ? t('project_page.text.today')
                                : isYesterday(parseISO(date))
                                  ? t('project_page.text.yesterday')
                                  : format(
                                      parseISO(date),
                                      'EEEE, do MMMM yyyy',
                                    )}
                            </span>
                            <div className="h-[1px] flex-1 bg-border/5" />
                            <span className="text-[9px] font-medium text-muted-foreground/20 font-mono italic">
                              {sessionCountLabel(sessions.length)}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {sessions.map((s) => {
                        const isManual = s.isManual;
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
                                <span className="mx-1.5 opacity-30 select-none text-muted-foreground">
                                  -
                                </span>
                                {format(parseISO(s.end_time), 'HH:mm')}
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
                                    {t('project_page.text.manual_session')}
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
                                    setEditManualSession(s);
                                    setSessionDialogOpen(true);
                                  } else {
                                    handleEditCommentForSession(s);
                                  }
                                }}
                                title={
                                  s.comment
                                    ? t('project_page.text.click_to_edit')
                                    : t('project_page.text.click_to_add_comment')
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
                                      -
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
                        {t('project_page.text.no_sessions_found_for_this_project')}
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
                  {t('project_page.text.session_actions')} (
                  {appCountLabel(
                    Array.from(new Set(ctxMenu.sessions.map((s) => s.app_name)))
                      .length,
                  )}
                  )
                </span>
                <span className="text-[10px] opacity-40">
                  {sessionCountLabel(ctxMenu.sessions.length)}
                </span>
              </div>

              <button
                className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-xs font-medium text-white/90 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => {
                  const count = ctxMenu.sessions.length;
                  const apps = Array.from(
                    new Set(ctxMenu.sessions.map((s) => s.app_name)),
                  ).join(', ');
                  showInfo(
                    t('project_page.text.bulk_action_on_sessions_apps_affected', { count, apps }),
                  );
                  setCtxMenu(null);
                }}
              >
                <span>{t('project_page.text.session_details')}</span>
                <span className="text-muted-foreground/50">
                  {ctxMenu.sessions.length}
                </span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <div className="px-3 py-2 space-y-2">
                <p className="text-[10px] text-muted-foreground/50 leading-tight italic">
                  {t('project_page.text.applies_to_all_sessions_in_this_visual_chunk', { count: ctxMenu.sessions.length })}
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  {t('project_page.text.rate_multiplier_default_x2')}{' '}
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
                    {t('project_page.text.boost_x2')}
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/15 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    {t('project_page.text.custom')}
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
                    ? t('project_page.text.edit_comment')
                    : t('project_page.text.add_comment')}
                </span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={() => handleBulkUnassign(ctxMenu.sessions)}
              >
                <History className="h-3.5 w-3.5 text-muted-foreground/40" />
                <span className="truncate">
                  {t('project_page.text.unassign_group_from_project')}
                </span>
              </button>

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
                onClick={() => handleBulkDelete(ctxMenu.sessions)}
              >
                <Trash2 className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
                <span>{t('project_page.text.delete_group')}</span>
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
                <span>{t('project_page.text.add_manual_session')}</span>
              </button>

              {(() => {
                const manuals = ctxMenu.sessions.filter(
                  (s): s is ManualSessionRow => s.isManual,
                );
                if (manuals.length === 0) return null;
                return (
                  <>
                    <div className="h-px bg-white/5 my-1" />
                    {manuals.length === 1 ? (
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 cursor-pointer transition-colors border border-emerald-500/20"
                        onClick={() => {
                          setEditManualSession(manuals[0]);
                          setSessionDialogOpen(true);
                          setCtxMenu(null);
                        }}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                        <span className="font-bold uppercase tracking-tight">
                          {t('project_page.text.edit_manual_session')}{' '}
                          {manuals[0].comment || t('project_page.text.time_log')}
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-emerald-400/50 font-bold">
                          {t('project_page.text.manual_sessions_click_to_edit')}
                        </div>
                        {manuals.map((ms) => (
                          <button
                            key={ms.id}
                            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors group/ms"
                            onClick={() => {
                              setEditManualSession(ms);
                              setSessionDialogOpen(true);
                              setCtxMenu(null);
                            }}
                          >
                            <PenLine className="h-3.5 w-3.5 text-emerald-400" />
                            <div className="flex flex-col items-start leading-none truncate">
                              <span className="font-medium">
                                {t('project_page.text.edit')}{' '}
                                {ms.comment ||
                                  t('project_page.text.manual_session')}
                              </span>
                              <span className="text-[9px] text-muted-foreground mt-0.5">
                                {formatDuration(ms.duration_seconds)}{' '}
                                {t('project_page.text.manual_record')}
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
                <span>{t('project_page.text.zone_actions')}</span>
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
                    {t('project_page.text.add_manual_session')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('project_page.text.log_time_for_this_slot')}
                  </span>
                </div>
              </button>
              <div className="h-px bg-white/5 my-1" />
              <button
                className="flex w-full items-center justify-center gap-2 rounded-sm py-1.5 text-xs text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/5 cursor-pointer transition-colors"
                onClick={() => setCtxMenu(null)}
              >
                <span>{t('project_page.text.cancel')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {ctxMenu?.type === 'session' && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-y-auto rounded-md border border-white/10 bg-[#1a1b26]/95 p-1 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 backdrop-blur-xl"
          style={getContextMenuStyle(ctxMenu.x, ctxMenu.y, 240)}
        >
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground/60 border-b border-white/5 mb-1 flex items-center justify-between">
            <span>
              {t('project_page.text.session_actions_1_app')}
            </span>
            <span className="text-[10px] opacity-40">
              {sessionCountLabel(1)}
            </span>
          </div>

          <button
            className="flex w-full items-center justify-between rounded-sm px-2 py-2 text-sm hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
            onClick={() => {
              setSelectedSessionDetail(ctxMenu.session);
              setSessionDetailOpen(true);
              setCtxMenu(null);
            }}
          >
            <span className="font-medium text-xs ml-1">
              {t('project_page.text.session_details')}
            </span>
            <span className="text-[10px] text-muted-foreground/50 mr-1">1</span>
          </button>

          {!ctxMenu.session.isManual && (
            <>
              <div className="px-3 py-2 space-y-2">
                <p className="text-[10px] text-muted-foreground/50 leading-tight">
                  {t('project_page.text.applies_to_this_session_record')}
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  {t('project_page.text.rate_multiplier_default_x2')}{' '}
                  <span className="text-emerald-400">
                    x{(ctxMenu.session.rate_multiplier || 1).toFixed(1)}
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95 cursor-pointer"
                    onClick={() =>
                      handleSetRateMultiplier(2, [ctxMenu.session.id])
                    }
                  >
                    {t('project_page.text.boost_x2')}
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    {t('project_page.text.custom')}
                  </button>
                </div>
              </div>
              <div className="h-px bg-white/5 my-1" />
            </>
          )}

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
            onClick={() => {
              const s = ctxMenu.session;
              if (s.isManual) {
                setEditManualSession(s);
                setSessionDialogOpen(true);
              } else {
                handleEditComment();
              }
              setCtxMenu(null);
            }}
          >
            {ctxMenu.session.isManual ? (
              <>
                <PenLine className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t('project_page.text.edit_manual_session_2')}</span>
              </>
            ) : (
              <>
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>
                  {ctxMenu.session.comment
                    ? t('project_page.text.edit_comment')
                    : t('project_page.text.add_comment')}
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
            <span className="truncate">
              {t('project_page.text.unassign_from_project')}
            </span>
          </button>

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
            onClick={async () => {
              if (
                await confirm(t('project_page.text.delete_this_session'))
              ) {
                try {
                  if (ctxMenu.session.isManual) {
                    await deleteManualSessions(ctxMenu.session.id);
                  } else {
                    await deleteSessions(ctxMenu.session.id);
                  }
                  setCtxMenu(null);
                } catch (err) {
                  console.error(err);
                }
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
            <span>{t('project_page.text.delete_session')}</span>
          </button>
        </div>
      )}

      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => {
          if (!open) {
            promptConfig?.onCancel?.();
            setPromptConfig(null);
          }
        }}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
        confirmLabel={t('project_page.text.save')}
      />

      <ProjectSessionDetailDialog
        open={sessionDetailOpen}
        session={selectedSessionDetail}
        labels={{
          title: t('project_page.text.session_details_2'),
          project: t('project_page.text.project'),
          unassigned: t('project_page.text.unassigned'),
          appActivity: t('project_page.text.app_activity'),
          manualSession: t('project_page.text.manual_session'),
          timeRange: t('project_page.text.time_range'),
          duration: t('project_page.text.duration'),
          rateMultiplier: t('project_page.text.rate_multiplier'),
          id: 'ID',
          manualTag: t('project_page.text.manual'),
          comment: t('project_page.text.comment'),
          filesAccessed: t('project_page.text.files_accessed'),
          close: t('project_page.text.close'),
          editManualSession: t('project_page.text.edit_manual_session_3'),
          editComment: t('project_page.text.edit_comment_2'),
        }}
        formatDuration={formatDuration}
        onOpenChange={setSessionDetailOpen}
        onEditManualSession={(session) => {
          setEditManualSession(session);
          setSessionDetailOpen(false);
          setSessionDialogOpen(true);
        }}
        onEditComment={(session) => {
          handleEditCommentForSession(session);
          setSessionDetailOpen(false);
        }}
      />

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
      {showTemplateSelector && (
        <ReportTemplateSelector
          onSelect={(templateId) => {
            setShowTemplateSelector(false);
            useUIStore.getState().setReportTemplateId(templateId);
            setProjectPageId(project!.id);
            setCurrentPage('report-view');
          }}
          onCancel={() => setShowTemplateSelector(false)}
          onEditTemplates={() => {
            setShowTemplateSelector(false);
            setCurrentPage('reports');
          }}
        />
      )}
    </div>
  );
}
