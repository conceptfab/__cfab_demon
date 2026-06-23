import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dashboardApi,
  manualSessionsApi,
  projectsApi,
} from '@/lib/tauri';
import { getErrorMessage, logTauriError } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import type {
  EstimateProjectRow,
  ManualSessionWithProject,
  ProjectExtraInfo,
  ProjectWithStats,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import { useSessionActions } from '@/hooks/useSessionActions';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import {
  buildAutoSessionsById,
  buildFilteredProjectTimeline,
  buildGroupedProjectSessions,
  buildRecentProjectComments,
} from '@/lib/project-page-derived';
import {
  findSessionIdsMissingComment,
  requiresCommentForMultiplierBoost,
} from '@/lib/session-utils';
import { parsePositiveRateMultiplierInput } from '@/lib/rate-utils';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { loadProjectsAllTime } from '@/store/projects-cache-store';
import { fetchAllSessions } from '@/lib/session-pagination';
import { shouldRefreshProjectPage } from '@/lib/page-refresh-reasons';
import {
  applyProjectPageLoad,
  createInitialProjectPageState,
} from '@/pages/project-page-state';
import type { ProjectPageContextMenu } from '@/components/project-page/project-page-context-menu-utils';
import type {
  AutoSessionRow,
  ProjectSessionRow,
} from '@/components/project-page/ProjectSessionsList';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';

export function useProjectPageController() {
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
  const [pageState, setPageState] = useState(createInitialProjectPageState);
  const hasLoadedProjectsListRef = useRef(false);
  const {
    loading,
    data: {
      project,
      extraInfo,
      timelineData,
      timelineError,
      recentSessions,
      manualSessions,
      mergedChildren,
      estimate,
    },
    projectsList,
  } = pageState;
  const autoSessionsById = useMemo(
    () => buildAutoSessionsById(recentSessions),
    [recentSessions],
  );
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

  const groupedSessions = useMemo(
    () =>
      buildGroupedProjectSessions(
        recentSessions,
        manualSessions,
        t('project_page.text.manual_session'),
      ),
    [recentSessions, manualSessions, t],
  );

  const recentComments = useMemo(
    () =>
      buildRecentProjectComments(
        recentSessions,
        manualSessions,
        t('project_page.text.manual_session'),
      ),
    [recentSessions, manualSessions, t],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const reloadProjectPageRef = useRef<(() => void) | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [selectedSessionDetail, setSelectedSessionDetail] =
    useState<ProjectSessionRow | null>(null);
  const [sessionDialogDate, setSessionDialogDate] = useState<
    string | undefined
  >();
  const [editManualSession, setEditManualSession] =
    useState<ManualSessionWithProject | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ProjectPageContextMenu | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  usePageRefreshListener((reasons) => {
    if (!reasons.some((reason) => shouldRefreshProjectPage(reason))) {
      return;
    }
    reloadProjectPageRef.current?.();
  });

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      if (projectPageId === null) {
        hasLoadedProjectsListRef.current = false;
        setCurrentPage('projects');
        return;
      }

      hasLoadedProjectsListRef.current = false;
      Promise.all([
        projectsApi
          .getProject(projectPageId)
          .then((project) => ({
            project,
            missing: false as const,
          }))
          .catch((error) => {
            logTauriError('load project', error);
            return {
              project: null,
              missing: true as const,
            };
          }),
        projectsApi
          .getProjectExtraInfo(projectPageId, ALL_TIME_DATE_RANGE)
          .catch((error) => {
            logTauriError('load project extra info', error);
            return {
              current_value: 0,
              period_value: 0,
              db_stats: {
                session_count: 0,
                file_activity_count: 0,
                manual_session_count: 0,
                comment_count: 0,
                boosted_session_count: 0,
                estimated_size_bytes: 0,
              },
              top_apps: [],
            } as ProjectExtraInfo;
          }),
        dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE).catch((error) => {
          logTauriError('load project estimates', error);
          return [] as EstimateProjectRow[];
        }),
        dashboardApi
          .getProjectTimeline(ALL_TIME_DATE_RANGE, 100, 'day', projectPageId)
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
        }).catch((error) => {
          logTauriError('load project sessions', error);
          return [] as SessionWithApp[];
        }),
        manualSessionsApi
          .getManualSessions({ projectId: projectPageId })
          .catch((error) => {
            logTauriError('load manual sessions', error);
            return [] as ManualSessionWithProject[];
          }),
        projectsApi.getMergedProjects().catch((error) => {
          logTauriError('load merged projects', error);
          return [] as ProjectWithStats[];
        }),
      ])
        .then(
          ([
            projectResult,
            info,
            estimates,
            timelineResult,
            sessions,
            manuals,
            merged,
          ]) => {
            if (cancelled) return;
            if (projectResult.missing || projectResult.project === null) {
              setCurrentPage('projects');
              return;
            }

            const nextProject = projectResult.project;
            const est = estimates.find((e) => e.project_id === projectPageId);
            setPageState((prev) =>
              applyProjectPageLoad(prev, {
                project: nextProject,
                extraInfo: info,
                timelineData: timelineResult.data,
                timelineError: timelineResult.error,
                recentSessions: sessions,
                manualSessions: manuals,
                mergedChildren: merged.filter(
                  (p) => p.merged_into === nextProject.name,
                ),
                estimate: est?.estimated_value || 0,
              }),
            );
          },
        )
        .catch((err) => {
          if (cancelled) return;
          console.error('Critical error fetching project data:', err);
          setPageState((prev) => ({ ...prev, loading: false }));
        });
    };

    reloadProjectPageRef.current = reload;
    reload();

    return () => {
      cancelled = true;
      reloadProjectPageRef.current = null;
    };
  }, [projectPageId, setCurrentPage, t]);

  useEffect(() => {
    if (
      !sessionDialogOpen ||
      projectPageId === null ||
      hasLoadedProjectsListRef.current
    ) {
      return;
    }

    let cancelled = false;
    loadProjectsAllTime()
      .then((projects) => {
        if (cancelled) return;
        setPageState((prev) => ({
          ...prev,
          projectsList: projects,
        }));
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

  const filteredTimeline = useMemo(
    () =>
      buildFilteredProjectTimeline(
        timelineData,
        project?.name,
        recentSessions,
        manualSessions,
      ),
    [timelineData, project?.name, recentSessions, manualSessions],
  );

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
      setPageState((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          recentSessions: prev.data.recentSessions.map((s) =>
            missingSet.has(s.id) ? { ...s, comment: normalized } : s,
          ),
        },
      }));
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
        // safe: sessions.length > 0 is checked at the condition above
        initialValue: sessions[0]!.comment || '',
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
        ? ctxMenu.sessions.reduce<number[]>((acc, s) => {
            if (!s.isManual) acc.push(s.id);
            return acc;
          }, [])
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

  return {
    appCountLabel,
    busy,
    confirm,
    confirmDialogProps,
    ctxMenu,
    ctxRef,
    currencyCode,
    deleteManualSessions,
    deleteSessions,
    editManualSession,
    estimate,
    extraInfo,
    filteredTimeline,
    groupedSessions,
    handleAction,
    handleAssign,
    handleBack,
    handleBulkDelete,
    handleBulkUnassign,
    handleCompact,
    handleContextMenu,
    handleCustomRateMultiplier,
    handleEditComment,
    handleEditCommentForSession,
    handleSetRateMultiplier,
    i18n,
    loading,
    manualSessions,
    mergedChildren,
    project,
    projectPageMinimal,
    projectsList,
    promptConfig,
    recentComments,
    recentSessions,
    sessionCountLabel,
    sessionDetailOpen,
    sessionDialogDate,
    sessionDialogOpen,
    selectedSessionDetail,
    setCtxMenu,
    setCurrentPage,
    setEditManualSession,
    setPageState,
    setProjectPageId,
    setPromptConfig,
    setSelectedSessionDetail,
    setSessionDetailOpen,
    setSessionDialogDate,
    setSessionDialogOpen,
    setShowTemplateSelector,
    showInfo,
    showTemplateSelector,
    t,
    timelineData,
    timelineError,
    triggerRefresh,
  };
}

export type ProjectPageController = ReturnType<typeof useProjectPageController>;
