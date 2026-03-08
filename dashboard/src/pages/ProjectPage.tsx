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
import { useInlineT } from '@/lib/inline-i18n';
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
  const tt = useInlineT();
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
    `${count} ${tt(
      count === 1 ? 'sesja' : 'sesji',
      count === 1 ? 'session' : 'sessions',
    )}`;
  const appCountLabel = (count: number) =>
    `${count} ${tt(
      count === 1 ? 'aplikacja' : 'aplikacje',
      count === 1 ? 'app' : 'apps',
    )}`;
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
      app_name: tt('Sesja ręczna', 'Manual Session'),
      executable_name: 'manual',
      project_id: session.project_id,
      project_name: session.project_name,
      project_color: session.project_color,
      comment: session.title,
      files: [],
      isManual: true,
    }),
    [tt],
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
          source: tt('Sesja ręczna', 'Manual Session'),
        };
      })
      .filter((item): item is RecentCommentItem => item !== null);

    return [...automatic, ...manual]
      .sort((a, b) => b.start_time.localeCompare(a.start_time))
      .slice(0, 5);
  }, [recentSessions, manualSessions, tt]);

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
        tt(
          'Skompaktować dane tego projektu? Usunie to szczegółową historię aktywności plików, ale zachowa sesje i łączny czas. Tej operacji nie można cofnąć.',
          "Compact this project's data? This will remove detailed file activity history, but will keep sessions and total time. This cannot be undone.",
        ),
      ))
    ) {
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
    if (confirmMsg && !(await confirm(confirmMsg))) return;
    try {
      await action();
      triggerRefresh();
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
        `${tt(
          'Nie udało się zapisać wymaganego komentarza dla boosta:',
          'Failed to save comment required for boost:',
        )} ${String(err)}`,
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
        title: tt(
          'Komentarz dla {{count}} sesji',
          'Comment for {{count}} sessions',
          { count: sessions.length },
        ),
        description: tt(
          'Zastosuj ten komentarz do wszystkich sesji w tej grupie.',
          'Apply this comment to all sessions in this group.',
        ),
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
        tt(
          'Sesji ręcznych nie można odpiąć od projektu (muszą należeć do projektu). Zamiast tego usuń je.',
          'Manual sessions cannot be unassigned (they must belong to a project). Delete them instead.',
        ),
      );
      return;
    }
    if (
      !(await confirm(
        tt(
          'Odpiąć {{count}} automatycznych sesji z tego projektu?',
          'Unassign {{count}} automatic sessions from this project?',
          { count: autoSessions.length },
        ),
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
        tt(
          'Trwale usunąć {{count}} sesji?',
          'Permanently delete {{count}} sessions?',
          { count: sessions.length },
        ),
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
      title: tt('Komentarz sesji', 'Session Comment'),
      description: tt(
        'Wpisz komentarz do tej sesji (puste pole usunie komentarz).',
        'Enter a comment for this session (leave empty to remove).',
      ),
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
      title: tt('Ustaw mnożnik stawki', 'Set rate multiplier'),
      description:
        ctxMenu.type === 'chart'
          ? tt('Zastosuj do {{count}} sesji', 'Apply to {{count}} sessions', {
              count: ids.length,
            })
          : tt(
              'Mnożnik musi być > 0. Użyj 1, aby zresetować.',
              'Multiplier must be > 0. Use 1 to reset.',
            ),
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
        {tt('Ładowanie szczegółów projektu...', 'Loading project details...')}
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="h-8">
          <ChevronLeft className="mr-1 h-4 w-4" />
          {tt('Powrót do projektów', 'Back to Projects')}
        </Button>
        <div className="h-4 w-[1px] bg-border" />
        <h1
          data-project-id={project.id}
          data-project-name={project.name}
          className="text-xl font-semibold flex items-center gap-2"
        >
          <div className="relative group">
            <AppTooltip content={tt('Zmień kolor', 'Change color')}>
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
                    title={tt('Wybierz kolor', 'Choose color')}
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
                        triggerRefresh();
                      }}
                      title={tt('Zapisz kolor', 'Save color')}
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
                        triggerRefresh();
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
          {tt('Generuj raport (PDF)', 'Generate report (PDF)')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {tt('Przegląd projektu', 'Project Overview')}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleAction(
                    () => resetProjectTime(project.id),
                    tt(
                      'Zresetować naliczony czas dla tego projektu? Tej operacji nie można cofnąć.',
                      'Reset tracked time for this project? This cannot be undone.',
                    ),
                  )
                }
                title={tt('Zresetuj czas', 'Reset time')}
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
                    ? tt('Odmroź projekt', 'Unfreeze project')
                    : tt('Zamroź projekt', 'Freeze project')
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
                    tt('Wykluczyć ten projekt?', 'Exclude this project?'),
                  )
                }
                title={tt('Wyklucz projekt', 'Exclude project')}
              >
                <CircleOff className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                {tt('Łączny czas / wartość', 'Total Time / Value')}
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
                  {tt('Sesje', 'Sessions')}
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.session_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  {tt('Unikalne pliki', 'Unique Files')}
                </p>
                <p className="text-2xl font-light">
                  {extraInfo?.db_stats.file_activity_count || 0}
                </p>
              </div>
              <div className="rounded-lg bg-secondary/20 p-4 border border-border/40 flex flex-col justify-between">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  {tt('Sesje ręczne', 'Manual Sessions')}
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
                  {tt('Komentarze', 'Comments')}
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
                  {tt('Podbite sesje', 'Boosted Sessions')}
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
                  {tt('Przypisany folder', 'Assigned Folder')}
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
              {tt('Najczęstsze aplikacje', 'Top Applications')}
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
                  {tt('Brak danych o aplikacjach.', 'No application data yet')}
                </p>
              )}
            </div>

            <div className="mt-6 pt-6 border-t border-dashed border-border/60">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-muted-foreground uppercase font-bold">
                  {tt('Zarządzanie danymi', 'Data Management')}
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
                {tt(
                  'Kompaktuj szczegółowe rekordy',
                  'Compact Detailed Records',
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2 px-1 leading-tight">
                {tt(
                  'Kompakcja usuwa szczegółową historię na poziomie plików, zachowując sesje i łączny czas.',
                  'Compaction removes detailed file-level history while preserving sessions and total time.',
                )}
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
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="h-4 w-4 text-sky-400" />
                  {tt('Sesje ręczne', 'Manual Sessions')}
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
                  {tt('+ Dodaj ręczną', '+ Add Manual')}
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
                        {tt('Wartość dodana', 'Value Added')}
                      </p>
                    </div>
                  </div>
                ))}
                {manualSessions.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    {tt(
                      'Brak zapisanych sesji ręcznych',
                      'No manual sessions recorded',
                    )}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-sky-500" />
                {tt('Ostatnie komentarze', 'Recent Comments')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentComments.map((s) => (
                  <div
                    key={s.key}
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
                    <p className="text-sm text-sky-100 italic">"{s.comment}"</p>
                    <p className="text-[10px] text-muted-foreground text-right">
                      - {s.source}
                    </p>
                  </div>
                ))}
                {recentComments.length === 0 && (
                  <p className="text-sm text-muted-foreground italic text-center py-4">
                    {tt('Brak komentarzy', 'No comments found')}
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
                {tt('Szczegółowa lista sesji', 'Detailed Session List')}
              </div>
              <span className="text-xs font-normal lowercase text-muted-foreground">
                {tt(
                  'kliknij prawym, aby edytować sesje',
                  'right-click to edit sessions',
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-4">
            <div className="overflow-x-auto text-muted-foreground">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider font-bold">
                  <tr>
                    <th className="px-4 py-3">{tt('Data', 'Date')}</th>
                    <th className="px-4 py-3">
                      {tt('Czas trwania', 'Duration')}
                    </th>
                    <th className="px-4 py-3">
                      {tt('Aplikacja', 'Application')}
                    </th>
                    <th className="px-4 py-3">
                      {tt('Szczegóły / Komentarz', 'Details / Comment')}
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
                                ? tt('Dzisiaj', 'Today')
                                : isYesterday(parseISO(date))
                                  ? tt('Wczoraj', 'Yesterday')
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
                                    {tt('Sesja ręczna', 'Manual Session')}
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
                                    ? tt(
                                        'Kliknij, aby edytować',
                                        'Click to edit',
                                      )
                                    : tt(
                                        'Kliknij, aby dodać komentarz',
                                        'Click to add comment',
                                      )
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
                        {tt(
                          'Nie znaleziono sesji dla tego projektu.',
                          'No sessions found for this project.',
                        )}
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
                  {tt('Akcje sesji', 'Session actions')} (
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
                    tt(
                      'Akcja grupowa na {{count}} sesjach - Dotknięte aplikacje: {{apps}}',
                      'Bulk action on {{count}} sessions - Apps affected: {{apps}}',
                      { count, apps },
                    ),
                  );
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
                  {tt(
                    'Dotyczy wszystkich {{count}} sesji w tym fragmencie wykresu',
                    'Applies to all {{count}} sessions in this visual chunk',
                    { count: ctxMenu.sessions.length },
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  {tt(
                    'Mnożnik stawki (domyślnie x2):',
                    'Rate multiplier (default x2):',
                  )}{' '}
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
                    {tt('Podbij x2', 'Boost x2')}
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/15 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    {tt('Własny...', 'Custom...')}
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
                    ? tt('Edytuj komentarz', 'Edit comment')
                    : tt('Dodaj komentarz', 'Add comment')}
                </span>
              </button>

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={() => handleBulkUnassign(ctxMenu.sessions)}
              >
                <History className="h-3.5 w-3.5 text-muted-foreground/40" />
                <span className="truncate">
                  {tt(
                    'Odepnij grupę od projektu',
                    'Unassign group from project',
                  )}
                </span>
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
                          {tt('Edytuj sesję ręczną:', 'Edit Manual Session:')}{' '}
                          {manuals[0].comment || tt('Log czasu', 'Time log')}
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-emerald-400/50 font-bold">
                          {tt(
                            'Sesje ręczne (kliknij, aby edytować)',
                            'Manual Sessions (click to edit)',
                          )}
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
                                {tt('Edytuj:', 'Edit:')}{' '}
                                {ms.comment ||
                                  tt('Sesja ręczna', 'Manual Session')}
                              </span>
                              <span className="text-[9px] text-muted-foreground mt-0.5">
                                {formatDuration(ms.duration_seconds)}{' '}
                                {tt('wpis ręczny', 'manual record')}
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
                    {tt('Dodaj sesję ręczną', 'Add manual session')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {tt(
                      'Zarejestruj czas dla tego przedziału',
                      'Log time for this slot',
                    )}
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

      {ctxMenu?.type === 'session' && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-y-auto rounded-md border border-white/10 bg-[#1a1b26]/95 p-1 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 backdrop-blur-xl"
          style={getContextMenuStyle(ctxMenu.x, ctxMenu.y, 240)}
        >
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground/60 border-b border-white/5 mb-1 flex items-center justify-between">
            <span>
              {tt('Akcje sesji (1 aplikacja)', 'Session actions (1 app)')}
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
              {tt('Szczegóły sesji', 'Session details')}
            </span>
            <span className="text-[10px] text-muted-foreground/50 mr-1">1</span>
          </button>

          {!ctxMenu.session.isManual && (
            <>
              <div className="px-3 py-2 space-y-2">
                <p className="text-[10px] text-muted-foreground/50 leading-tight">
                  {tt(
                    'Dotyczy tego rekordu sesji',
                    'Applies to this session record',
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium">
                  {tt(
                    'Mnożnik stawki (domyślnie x2):',
                    'Rate multiplier (default x2):',
                  )}{' '}
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
                    {tt('Podbij x2', 'Boost x2')}
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/10 active:scale-95 cursor-pointer"
                    onClick={handleCustomRateMultiplier}
                  >
                    {tt('Własny...', 'Custom...')}
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
                <span>{tt('Edytuj sesję ręczną', 'Edit manual session')}</span>
              </>
            ) : (
              <>
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>
                  {ctxMenu.session.comment
                    ? tt('Edytuj komentarz', 'Edit comment')
                    : tt('Dodaj komentarz', 'Add comment')}
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
              {tt('Odepnij z projektu', 'Unassign from project')}
            </span>
          </button>

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
            onClick={async () => {
              if (
                await confirm(tt('Usunąć tę sesję?', 'Delete this session?'))
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
            <span>{tt('Usuń sesję', 'Delete Session')}</span>
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
        confirmLabel={tt('Zapisz', 'Save')}
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
                    {tt('Projekt', 'Project')}
                  </p>
                  <p className="truncate text-sm font-medium mt-1">
                    {selectedSessionDetail.project_name ||
                      tt('Nieprzypisane', 'Unassigned')}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    {tt('Aplikacja / Aktywność', 'App / Activity')}
                  </p>
                  <p className="truncate text-sm font-medium mt-1">
                    {selectedSessionDetail.isManual
                      ? tt('Sesja ręczna', 'Manual Session')
                      : selectedSessionDetail.app_name}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    {tt('Zakres czasu', 'Time Range')}
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
                    {tt('Czas trwania', 'Duration')}
                  </p>
                  <p className="text-sm font-mono mt-1 text-emerald-400">
                    {formatDuration(selectedSessionDetail.duration_seconds)}
                  </p>
                </div>
                <div className="rounded-md border border-white/5 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    {tt('Mnożnik stawki', 'Rate Multiplier')}
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
                    {selectedSessionDetail.isManual
                      ? tt('(Ręczna)', '(Manual)')
                      : ''}
                  </p>
                </div>
              </div>

              {selectedSessionDetail.comment && (
                <div className="mt-4 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" />
                    {tt('Komentarz', 'Comment')}
                  </p>
                  <p className="mt-1 text-sm italic text-sky-100/90 leading-relaxed">
                    "{selectedSessionDetail.comment}"
                  </p>
                </div>
              )}

              {selectedSessionDetail.files &&
                selectedSessionDetail.files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      {tt('Użyte pliki', 'Files Accessed')}
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
                  {tt('Zamknij', 'Close')}
                </Button>
                {selectedSessionDetail.isManual ? (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      setEditManualSession(selectedSessionDetail);
                      setSessionDetailOpen(false);
                      setSessionDialogOpen(true);
                    }}
                  >
                    {tt('Edytuj sesję ręczną', 'Edit Manual Session')}
                  </Button>
                ) : (
                  <Button
                    className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      handleEditCommentForSession(selectedSessionDetail);
                      setSessionDetailOpen(false);
                    }}
                  >
                    {tt('Edytuj komentarz', 'Edit Comment')}
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
