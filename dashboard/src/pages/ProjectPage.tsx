import { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  History,
  Trash2,
  Plus,
  PenLine,
} from 'lucide-react';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { PromptModal } from '@/components/ui/prompt-modal';
import { useToast } from '@/components/ui/toast-notification';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { ProjectSessionDetailDialog } from '@/components/project/ProjectSessionDetailDialog';
import {
  dashboardApi,
  manualSessionsApi,
  projectsApi,
} from '@/lib/tauri';
import {
  formatDuration,
  formatMultiplierLabel,
  getErrorMessage,
  logTauriError,
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
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import {
  findSessionIdsMissingComment,
  manualToSessionRow,
  requiresCommentForMultiplierBoost,
} from '@/lib/session-utils';
import { parsePositiveRateMultiplierInput } from '@/lib/rate-utils';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { loadProjectsAllTime } from '@/store/projects-cache-store';
import { fetchAllSessions } from '@/lib/session-pagination';
import { shouldRefreshProjectPage } from '@/lib/page-refresh-reasons';
import { ProjectOverview } from '@/components/project-page/ProjectOverview';
import { ProjectEstimatesSection } from '@/components/project-page/ProjectEstimatesSection';
import { ProjectTimelineSection } from '@/components/project-page/ProjectTimelineSection';
import {
  ProjectSessionsList,
  type AutoSessionRow,
  type ManualSessionRow,
  type ProjectSessionRow,
  type RecentCommentItem,
} from '@/components/project-page/ProjectSessionsList';

function RateMultiplierPanel({
  description,
  currentMultiplierLabel,
  currentMultiplier,
  boostLabel,
  customLabel,
  onBoost,
  onCustom,
}: {
  description: string;
  currentMultiplierLabel: string;
  currentMultiplier: number | null | undefined;
  boostLabel: string;
  customLabel: string;
  onBoost: () => void;
  onCustom: () => void;
}) {
  return (
    <div className="px-3 py-2 space-y-2">
      <p className="text-[10px] text-muted-foreground/50 leading-tight">
        {description}
      </p>
      <p className="text-[10px] text-muted-foreground/80 font-medium">
        {currentMultiplierLabel}{' '}
        <span className="text-emerald-400 font-mono">
          {formatMultiplierLabel(currentMultiplier ?? undefined)}
        </span>
      </p>
      <div className="flex gap-2">
        <button
          className="flex-1 flex items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/25 active:scale-95 cursor-pointer shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]"
          onClick={onBoost}
        >
          {boostLabel}
        </button>
        <button
          className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/15 active:scale-95 cursor-pointer"
          onClick={onCustom}
        >
          {customLabel}
        </button>
      </div>
    </div>
  );
}

// AutoSessionRow, ManualSessionRow, ProjectSessionRow imported from ProjectSessionsList

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

// RecentCommentItem imported from ProjectSessionsList

function upsertProjectInList(
  projects: ProjectWithStats[],
  nextProject: ProjectWithStats,
): ProjectWithStats[] {
  const existingIndex = projects.findIndex((project) => project.id === nextProject.id);
  if (existingIndex === -1) {
    return [nextProject, ...projects];
  }

  const nextProjects = [...projects];
  nextProjects[existingIndex] = nextProject;
  return nextProjects;
}

export function ProjectPage() {
  const { t, i18n } = useTranslation();
  const projectPageId = useUIStore((s) => s.projectPageId);
  const projectPageMinimal = useUIStore((s) => s.projectPageMinimal);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const { showError, showInfo } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();
  const {
    assignSessions,
    updateSessionRateMultipliers,
    updateSessionComments,
    updateSessionComment,
    deleteSessions,
    deleteManualSessions,
  } = useSessionActions({
    onAfterMutation: () => triggerRefresh('project_page_session_mutation'),
    onError: (action, error) => {
      console.error(`Project page session action failed (${action}):`, error);
    },
  });

  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [project, setProject] = useState<ProjectWithStats | null>(null);
  const [projectsList, setProjectsList] = useState<ProjectWithStats[]>([]);
  const hasLoadedProjectsListRef = useRef(false);
  const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
  const [timelineData, setTimelineData] = useState<StackedBarData[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
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
    `${count} ${
      count === 1
        ? t('project_page.text.session')
        : t('project_page.text.sessions')
    }`;
  const appCountLabel = (count: number) =>
    `${count} ${
      count === 1 ? t('project_page.text.app') : t('project_page.text.apps')
    }`;

  const groupedSessions = useMemo(() => {
    const groups: {
      [date: string]: ProjectSessionRow[];
    } = {};

    recentSessions.forEach((s) => {
      const date = s.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push({ ...s, isManual: false as const });
    });

    manualSessions.forEach((m) => {
      const date = m.start_time.substring(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push(
        manualToSessionRow(m, t('project_page.text.manual_session')),
      );
    });

    return Object.entries(groups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, sessions]) => ({
        date,
        sessions: sessions.sort((a, b) =>
          b.start_time.localeCompare(a.start_time),
        ),
      }));
  }, [recentSessions, manualSessions, t]);

  const recentComments = useMemo<RecentCommentItem[]>(() => {
    const automatic = recentSessions.reduce<RecentCommentItem[]>((acc, s) => {
      const text = s.comment?.trim();
      if (text) {
        acc.push({
          key: `auto-${s.id}`,
          start_time: s.start_time,
          duration_seconds: s.duration_seconds,
          comment: text,
          source: s.app_name,
        });
      }
      return acc;
    }, []);

    const manual = manualSessions.reduce<RecentCommentItem[]>((acc, m) => {
      const text = m.title?.trim();
      if (text) {
        acc.push({
          key: `manual-${m.id}`,
          start_time: m.start_time,
          duration_seconds: m.duration_seconds,
          comment: text,
          source: t('project_page.text.manual_session'),
        });
      }
      return acc;
    }, []);

    return [...automatic, ...manual]
      .sort((a, b) => b.start_time.localeCompare(a.start_time))
      .slice(0, 5);
  }, [recentSessions, manualSessions, t]);

  const [estimate, setEstimate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // force-refresh via useState — deliberately triggers re-render on increment
  const [dataReloadVersion, setDataReloadVersion] = useState(0);
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
  const ctxRef = useRef<HTMLDivElement>(null);

  usePageRefreshListener((reasons) => {
    if (!reasons.some((reason) => shouldRefreshProjectPage(reason))) {
      return;
    }
    setDataReloadVersion((prev) => prev + 1);
  });

  useEffect(() => {
    if (projectPageId === null) {
      setProject(null);
      setProjectsList([]);
      hasLoadedProjectsListRef.current = false;
      setCurrentPage('projects');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setTimelineError(null);
    setHasLoadedProjectsList(false);
    Promise.all([
      projectsApi.getProject(projectPageId)
        .then((project) => ({
          project,
          missing: false as const,
        }))
        .catch((error) => {
          if (String(error).includes('Project not found')) {
            return {
              project: null,
              missing: true as const,
            };
          }
          throw error;
        }),
      projectsApi.getProjectExtraInfo(projectPageId, ALL_TIME_DATE_RANGE),
      dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE),
      dashboardApi.getProjectTimeline(ALL_TIME_DATE_RANGE, 100, 'day', projectPageId)
        .then((data) => ({ data, error: null as string | null }))
        .catch((error) => ({
          data: [] as StackedBarData[],
          error: getErrorMessage(
            error,
            t('components.timeline_chart.load_failed'),
          ),
        })),
      fetchAllSessions({
        projectId: projectPageId,
        dateRange: ALL_TIME_DATE_RANGE,
        includeAiSuggestions: false,
      }),
      manualSessionsApi.getManualSessions({ projectId: projectPageId }),
    ])
      .then(
        ([projectResult, info, estimates, timelineResult, sessions, manuals]) => {
          if (cancelled) return;
          if (projectResult.missing || projectResult.project === null) {
            setCurrentPage('projects');
            return;
          }

          const nextProject = projectResult.project;
          setProject(nextProject);
          setProjectsList((prev) => upsertProjectInList(prev, nextProject));
          setExtraInfo(info);
          setTimelineData(timelineResult.data);
          setTimelineError(timelineResult.error);
          setRecentSessions(sessions);
          setManualSessions(manuals);
          const est = estimates.find((e) => e.project_id === projectPageId);
          setEstimate(est?.estimated_value || 0);
        },
      )
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
  }, [projectPageId, dataReloadVersion, setCurrentPage, t]);

  useEffect(() => {
    if (!sessionDialogOpen || projectPageId === null || hasLoadedProjectsListRef.current) {
      return;
    }

    let cancelled = false;
    loadProjectsAllTime()
      .then((projects) => {
        if (cancelled) return;
        setProjectsList(projects);
        hasLoadedProjectsListRef.current = true;
      })
      .catch((error) => {
        if (cancelled) return;
        logTauriError('load projects list for manual sessions', error);
      });

    return () => {
      cancelled = true;
    };
  }, [projectPageId, sessionDialogOpen]);

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

  const projectName = project?.name;
  const filteredTimeline = useMemo(() => {
    if (!projectName) return timelineData;

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
        [projectName]: row[projectName] || 0,
        comments: comments ? Array.from(comments) : undefined,
        has_manual: row.has_manual || manualByDate.has(row.date),
      };
    });
  }, [timelineData, projectName, recentSessions, manualSessions]);

  const handleBack = () => {
    setProjectPageId(null);
    setCurrentPage('projects');
  };

  const handleCompact = async () => {
    if (!project) return;
    if (
      !(await confirm(
        t(
          'project_page.text.compact_this_project_s_data_this_will_remove_detailed_fi',
        ),
      ))
    ) {
      return;
    }
    setBusy('compact');
    try {
      await projectsApi.compactProjectData(project.id);
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

    const missingIds = findSessionIdsMissingComment(
      autoSessionIds,
      (id) => autoSessionsById.get(id)?.comment,
    );
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
      logTauriError('save required boost comment', err);
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
      if (requiresCommentForMultiplierBoost(multiplier)) {
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
        title: t('project_page.text.comment_for_sessions', {
          count: sessions.length,
        }),
        description: t(
          'project_page.text.apply_this_comment_to_all_sessions_in_this_group',
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
        t(
          'project_page.text.manual_sessions_cannot_be_unassigned_they_must_belong_to',
        ),
      );
      return;
    }
    if (
      !(await confirm(
        t('project_page.text.unassign_automatic_sessions_from_this_project', {
          count: autoSessions.length,
        }),
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
        t('project_page.text.permanently_delete_sessions', {
          count: sessions.length,
        }),
      ))
    )
      return;
    try {
      const manualIds = sessions.reduce<number[]>((acc, s) => {
        if (s.isManual) acc.push(s.id);
        return acc;
      }, []);
      const autoIds = sessions.reduce<number[]>((acc, s) => {
        if (!s.isManual) acc.push(s.id);
        return acc;
      }, []);
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
      description: t(
        'project_page.text.enter_a_comment_for_this_session_leave_empty_to_remove',
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
        ? ctxMenu.sessions.reduce<number[]>((acc, s) => { if (!s.isManual) acc.push(s.id); return acc; }, [])
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
        const parsed = parsePositiveRateMultiplierInput(raw);
        if (parsed == null) return;
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
      <ProjectOverview
        project={project}
        onBack={handleBack}
        onGenerateReport={() => setShowTemplateSelector(true)}
        onSaveColor={async (color) => {
          await projectsApi.updateProject(project.id, color);
          setProject(prev => ({ ...prev!, color }));
        }}
      />

      <ProjectEstimatesSection
        project={project}
        extraInfo={extraInfo}
        estimate={estimate}
        currencyCode={currencyCode}
        busy={busy}
        onResetTime={() =>
          void handleAction(
            () => projectsApi.resetProjectTime(project.id),
            t(
              'project_page.text.reset_tracked_time_for_this_project_this_cannot_be_undon',
            ),
          )
        }
        onToggleFreeze={() =>
          void handleAction(() =>
            project.frozen_at
              ? projectsApi.unfreezeProject(project.id)
              : projectsApi.freezeProject(project.id),
          )
        }
        onExclude={() =>
          void handleAction(
            () => projectsApi.excludeProject(project.id),
            t('project_page.text.exclude_this_project'),
          )
        }
        onCompact={handleCompact}
        minimal={projectPageMinimal}
      />

      <ProjectTimelineSection
        project={project}
        data={filteredTimeline}
        isLoading={loading && timelineData.length === 0}
        errorMessage={timelineError}
        onBarClick={(date) => {
          setSessionDialogDate(date);
          setSessionDialogOpen(true);
        }}
        onBarContextMenu={(date, x, y) => {
          const dayLogSessions: ProjectSessionRow[] = recentSessions.reduce<ProjectSessionRow[]>((acc, s) => {
            if (s.start_time.startsWith(date)) acc.push({ ...s, isManual: false as const });
            return acc;
          }, []);
          const dayManualSessions: ProjectSessionRow[] = manualSessions.reduce<ProjectSessionRow[]>((acc, m) => {
            if (m.start_time.startsWith(date)) acc.push(manualToSessionRow(m, t('project_page.text.manual_session')));
            return acc;
          }, []);
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

      <ProjectSessionsList
        manualSessions={manualSessions}
        recentComments={recentComments}
        groupedSessions={groupedSessions}
        sessionCountLabel={sessionCountLabel}
        onSessionContextMenu={handleContextMenu}
        onAddManual={() => {
          setEditManualSession(null);
          setSessionDialogDate(undefined);
          setSessionDialogOpen(true);
        }}
        onEditManual={(session) => {
          setEditManualSession(session);
          setSessionDialogOpen(true);
        }}
        onEditComment={handleEditCommentForSession}
      />

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
                    t(
                      'project_page.text.bulk_action_on_sessions_apps_affected',
                      { count, apps },
                    ),
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

              <RateMultiplierPanel
                description={t(
                  'project_page.text.applies_to_all_sessions_in_this_visual_chunk',
                  { count: ctxMenu.sessions.length },
                )}
                currentMultiplierLabel={t(
                  'project_page.text.rate_multiplier_default_x2',
                )}
                currentMultiplier={ctxMenu.sessions[0]?.rate_multiplier}
                boostLabel={t('project_page.text.boost_x2')}
                customLabel={t('project_page.text.custom')}
                onBoost={() =>
                  handleSetRateMultiplier(
                    2,
                    ctxMenu.sessions.map((s) => s.id),
                  )
                }
                onCustom={handleCustomRateMultiplier}
              />

              <div className="h-px bg-white/5 my-1" />

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
                onClick={handleEditComment}
              >
                <MessageSquare className="size-3.5 text-sky-400" />
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
                <History className="size-3.5 text-muted-foreground/40" />
                <span className="truncate">
                  {t('project_page.text.unassign_group_from_project')}
                </span>
              </button>

              <button
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
                onClick={() => handleBulkDelete(ctxMenu.sessions)}
              >
                <Trash2 className="size-3.5 opacity-50 group-hover:opacity-100" />
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
                <Plus className="size-3.5 text-emerald-400" />
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
                        <PenLine className="size-3.5" />
                        <span className="font-bold uppercase tracking-tight">
                          {t('project_page.text.edit_manual_session')}{' '}
                          {manuals[0].comment ||
                            t('project_page.text.time_log')}
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
                            <PenLine className="size-3.5 text-emerald-400" />
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
              <div className="p-2 text-[11px] font-semibold text-muted-foreground/50 border-b border-white/5 mb-1 flex items-center justify-between">
                <span>{t('project_page.text.zone_actions')}</span>
                <span className="bg-white/5 px-1.5 py-0.5 rounded text-[10px]">
                  {/* eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app) */}
                  {new Date(ctxMenu.date).toLocaleDateString(
                    i18n.resolvedLanguage || undefined,
                    {
                    month: 'short',
                    day: 'numeric',
                    },
                  )}
                </span>
              </div>
              <button
                className="flex w-full items-center gap-3 rounded-sm p-2 text-sm hover:bg-white/5 hover:text-white cursor-pointer transition-all active:scale-95"
                onClick={() => {
                  setSessionDialogDate(ctxMenu.date);
                  setEditManualSession(null);
                  setSessionDialogOpen(true);
                  setCtxMenu(null);
                }}
              >
                <div className="flex size-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-400">
                  <Plus className="size-4" />
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
            <span>{t('project_page.text.session_actions_1_app')}</span>
            <span className="text-[10px] opacity-40">
              {sessionCountLabel(1)}
            </span>
          </div>

          <button
            className="flex w-full items-center justify-between rounded-sm p-2 text-sm hover:bg-white/5 hover:text-white cursor-pointer transition-colors"
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
              <RateMultiplierPanel
                description={t(
                  'project_page.text.applies_to_this_session_record',
                )}
                currentMultiplierLabel={t(
                  'project_page.text.rate_multiplier_default_x2',
                )}
                currentMultiplier={ctxMenu.session.rate_multiplier}
                boostLabel={t('project_page.text.boost_x2')}
                customLabel={t('project_page.text.custom')}
                onBoost={() => handleSetRateMultiplier(2, [ctxMenu.session.id])}
                onCustom={handleCustomRateMultiplier}
              />
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
                <PenLine className="size-3.5 text-emerald-400" />
                <span>{t('project_page.text.edit_manual_session_2')}</span>
              </>
            ) : (
              <>
                <MessageSquare className="size-3.5 text-sky-400" />
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
            <History className="size-3.5 text-muted-foreground/40" />
            <span className="truncate">
              {t('project_page.text.unassign_from_project')}
            </span>
          </button>

          <button
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-[12px] hover:bg-red-500/10 text-red-400/70 hover:text-red-400 cursor-pointer transition-colors group"
            onClick={async () => {
              if (await confirm(t('project_page.text.delete_this_session'))) {
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
            <Trash2 className="size-3.5 opacity-50 group-hover:opacity-100" />
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
        onSaved={() => triggerRefresh('project_page_manual_session_saved')}
      />
      <ConfirmDialog {...confirmDialogProps} />
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
