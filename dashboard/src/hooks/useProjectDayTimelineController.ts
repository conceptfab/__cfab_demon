import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/ui/toast-notification';
import { logTauriError } from '@/lib/utils';
import { loadFreezeSettings } from '@/lib/user-settings';
import type { PromptConfig } from '@/lib/ui-types';
import { useUIStore } from '@/store/ui-store';
import {
  buildAssignProjectSections,
  buildProjectTimelineModel,
  getSegmentSessionIds,
  loadTimelineSaveView,
  loadTimelineSortMode,
  normalizeProjectName,
  resolveContextMenuPlacement,
  summarizeCluster,
  type ClusterDetailsState,
  type ContextMenuPlacement,
  type CtxMenu,
  type SegmentData,
  type TimelineSortMode,
} from '@/components/dashboard/project-day-timeline/timeline-calculations';
import {
  getCoarsePointerSnapshot,
  persistTimelineView,
  subscribeCoarsePointer,
} from '@/components/dashboard/project-day-timeline/project-day-timeline-view-persist';
import type { ProjectDayTimelineProps } from '@/components/dashboard/project-day-timeline/project-day-timeline-types';

export function useProjectDayTimelineController({
  sessions,
  manualSessions,
  workingHours,
  projects,
  onAssignSession,
  onUpdateSessionRateMultiplier,
  onUpdateSessionComment,
  onAddManualSession,
  onEditManualSession,
}: ProjectDayTimelineProps) {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [clusterDetails, setClusterDetails] =
    useState<ClusterDetailsState | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [sortMode, setSortMode] = useState<TimelineSortMode>(() =>
    loadTimelineSortMode(),
  );
  const [saveView, setSaveView] = useState<boolean>(() =>
    loadTimelineSaveView(),
  );
  const coarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    () => false,
  );
  const assignProjectListMode = useUIStore((s) => s.assignProjectListMode);
  const setAssignProjectListMode = useUIStore((s) => s.setAssignProjectListMode);
  const [ctxMenuPlacement, setCtxMenuPlacement] =
    useState<ContextMenuPlacement | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const updateSortMode = useCallback(
    (next: TimelineSortMode) => {
      setSortMode(next);
      persistTimelineView(next, saveView);
    },
    [saveView],
  );

  const toggleSaveView = useCallback(() => {
    setSaveView((prev) => {
      const next = !prev;
      persistTimelineView(sortMode, next);
      return next;
    });
  }, [sortMode]);

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

  useEffect(() => {
    if (!ctxMenu || typeof window === 'undefined') {
      // reset placementu gdy menu zamknięte; pojedynczy re-render, nie kaskada.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCtxMenuPlacement(null);
      return;
    }

    const updatePlacement = () => {
      const size = ctxRef.current
        ? {
            width: ctxRef.current.offsetWidth,
            height: ctxRef.current.offsetHeight,
          }
        : null;
      const next = resolveContextMenuPlacement(
        ctxMenu,
        window.innerWidth,
        window.innerHeight,
        size,
      );
      setCtxMenuPlacement((prev) => {
        if (
          prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.maxHeight === next.maxHeight
        ) {
          return prev;
        }
        return next;
      });
    };

    updatePlacement();
    const raf = window.requestAnimationFrame(updatePlacement);
    window.addEventListener('resize', updatePlacement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePlacement);
    };
  }, [ctxMenu]);

  const handleSegmentContextMenu = useCallback(
    (
      e: React.MouseEvent,
      segment: SegmentData,
      rowName: string,
      rowColor: string,
    ) => {
      const canAssign = Boolean(onAssignSession && projects?.length);
      const canSetMultiplier = Boolean(onUpdateSessionRateMultiplier);
      const canComment = Boolean(onUpdateSessionComment);
      const hasSuggestion = Boolean(segment.hasSuggestion);
      if (!canAssign && !canSetMultiplier && !canComment && !hasSuggestion) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({
        type: 'assign',
        x: e.clientX,
        y: e.clientY,
        segment,
        rowName,
        rowColor,
      });
    },
    [
      onAssignSession,
      onUpdateSessionRateMultiplier,
      onUpdateSessionComment,
      projects,
    ],
  );

  const handleTimelineContextMenu = useCallback(
    (e: React.MouseEvent, rangeStart: number, rangeSpan: number) => {
      if (!onAddManualSession) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const pct = relX / rect.width;
      const timeMs = rangeStart + pct * rangeSpan;
      setCtxMenu({ type: 'timeline', x: e.clientX, y: e.clientY, timeMs });
    },
    [onAddManualSession],
  );

  const handleManualSegmentContextMenu = useCallback(
    (e: React.MouseEvent, segment: SegmentData) => {
      if (!onEditManualSession || !segment.manualSession) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({
        type: 'timeline',
        x: e.clientX,
        y: e.clientY,
        timeMs: segment.startMs,
        editSession: segment.manualSession,
      });
    },
    [onEditManualSession],
  );

  const handleAssign = useCallback(
    async (projectId: number | null) => {
      if (!ctxMenu || ctxMenu.type !== 'assign' || !onAssignSession) return;
      try {
        const sessionIds = getSegmentSessionIds(ctxMenu.segment);
        if (sessionIds.length === 0) return;
        await onAssignSession(sessionIds, projectId);
      } catch (err) {
        logTauriError('assign session(s) to project', err);
        showError(t('sessions.errors.assign_failed', { error: String(err) }));
      } finally {
        setCtxMenu(null);
      }
    },
    [ctxMenu, onAssignSession, showError, t],
  );

  const ensureCommentForBoost = useCallback(
    async (sessionIds: number[]) => {
      if (sessionIds.length === 0) return true;

      const commentById = new Map(
        sessions.map((s) => [s.id, (s.comment ?? '').trim()] as const),
      );
      const missingIds = sessionIds.filter((id) => !commentById.get(id));
      if (missingIds.length === 0) return true;

      if (!onUpdateSessionComment) {
        showInfo(t('sessions.prompts.boost_requires_comment_unavailable_here'));
        return false;
      }

      const label =
        missingIds.length === 1
          ? t('sessions.prompts.boost_label_single')
          : t('sessions.prompts.boost_label_multi', {
              count: missingIds.length,
            });
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
        await Promise.all(
          missingIds.map((sessionId) =>
            onUpdateSessionComment(sessionId, normalized),
          ),
        );
        return true;
      } catch (err) {
        logTauriError('save required boost comment', err);
        showError(
          t('sessions.prompts.boost_comment_save_failed', {
            error: String(err),
          }),
        );
        return false;
      }
    },
    [onUpdateSessionComment, sessions, showError, showInfo, t],
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (
        !ctxMenu ||
        ctxMenu.type !== 'assign' ||
        !onUpdateSessionRateMultiplier
      ) {
        return;
      }
      try {
        const sessionIds = getSegmentSessionIds(ctxMenu.segment);
        if (sessionIds.length === 0) return;
        if (multiplier != null && multiplier > 1.000_001) {
          const ok = await ensureCommentForBoost(sessionIds);
          if (!ok) return;
        }
        await onUpdateSessionRateMultiplier(sessionIds, multiplier);
        setCtxMenu(null);
      } catch (err) {
        logTauriError('update session rate multiplier', err);
        showError(
          t('sessions.errors.update_multiplier', { error: String(err) }),
        );
      }
    },
    [
      ctxMenu,
      ensureCommentForBoost,
      onUpdateSessionRateMultiplier,
      showError,
      t,
    ],
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu || ctxMenu.type !== 'assign') return;
    const current = ctxMenu.segment.mixedRateMultiplier
      ? 1
      : typeof ctxMenu.segment.rateMultiplier === 'number'
        ? ctxMenu.segment.rateMultiplier
        : 1;
    const suggested = current > 1 ? current : 2;

    setPromptConfig({
      title: t('sessions.prompts.multiplier_title'),
      description: t('sessions.prompts.multiplier_desc'),
      initialValue: String(suggested),
      onConfirm: async (raw) => {
        const normalizedRaw = raw.trim().replace(',', '.');
        const parsed = Number(normalizedRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          showError(t('sessions.prompts.multiplier_positive'));
          return;
        }
        await handleSetRateMultiplier(parsed);
      },
    });
    setCtxMenu(null);
  }, [ctxMenu, handleSetRateMultiplier, showError, t]);

  const handleEditComment = useCallback(async () => {
    if (!ctxMenu || ctxMenu.type !== 'assign' || !onUpdateSessionComment) {
      return;
    }
    const sessionIds = getSegmentSessionIds(ctxMenu.segment);
    if (sessionIds.length === 0) return;
    const current = ctxMenu.segment.comment ?? '';
    const sessionId = sessionIds[0];

    setPromptConfig({
      title: t('project_day_timeline.text.session_comment'),
      description:
        sessionIds.length > 1
          ? t('project_day_timeline.text.comment_applies_to_first', {
              count: sessionIds.length,
            })
          : t('project_day_timeline.text.comment_leave_empty_to_remove'),
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await onUpdateSessionComment(sessionId, trimmed || null);
        } catch (err) {
          logTauriError('update session comment', err);
        }
      },
    });
    setCtxMenu(null);
  }, [ctxMenu, onUpdateSessionComment, t]);

  const handleOpenClusterDetails = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'assign') return;
    setClusterDetails({
      rowName: ctxMenu.rowName,
      rowColor: ctxMenu.rowColor,
      segment: ctxMenu.segment,
    });
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleAddSession = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== 'timeline' || !onAddManualSession) return;
    if (ctxMenu.editSession && onEditManualSession) {
      onEditManualSession(ctxMenu.editSession);
      setCtxMenu(null);
      return;
    }
    const d = new Date(ctxMenu.timeMs);
    d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    onAddManualSession(local.toISOString().slice(0, 16));
    setCtxMenu(null);
  }, [ctxMenu, onAddManualSession, onEditManualSession]);

  const model = useMemo(
    () =>
      buildProjectTimelineModel({
        sessions,
        manualSessions: manualSessions ?? [],
        workingHours,
        projects,
        sortMode,
        unassignedLabel: t('project_day_timeline.text.unassigned'),
      }),
    [sessions, manualSessions, workingHours, projects, sortMode, t],
  );

  const projectIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projects ?? []) {
      map.set(normalizeProjectName(project.name), project.id);
    }
    return map;
  }, [projects]);

  const assignProjectSections = useMemo(() => {
    const { thresholdDays } = loadFreezeSettings();
    return buildAssignProjectSections({
      assignProjectListMode,
      projects,
      activeProjectsLabel: t('project_day_timeline.text.active_projects_a_z'),
      newestProjectsLabel: t('project_day_timeline.text.newest_projects_a_z'),
      topProjectsLabel: t('project_day_timeline.text.top_projects_a_z'),
      remainingProjectsLabel: t('project_day_timeline.text.remaining_active_a_z'),
      newProjectMaxAgeMs: Math.max(1, thresholdDays) * 24 * 60 * 60 * 1000,
    });
  }, [assignProjectListMode, projects, t]);

  const assignProjectsCount = useMemo(
    () =>
      assignProjectSections.reduce(
        (total, section) => total + section.projects.length,
        0,
      ),
    [assignProjectSections],
  );

  const clusterDetailsSummary = useMemo(() => {
    if (!clusterDetails) return null;
    return summarizeCluster(clusterDetails.segment);
  }, [clusterDetails]);

  const mobileTickStride = useMemo(() => {
    if (!model) return 1;
    return Math.max(1, Math.ceil(model.ticks.length / 6));
  }, [model]);

  const mobileAxisTicks = useMemo(() => {
    if (!model) return [];
    return model.ticks.filter(
      (_, index) =>
        index % mobileTickStride === 0 || index === model.ticks.length - 1,
    );
  }, [model, mobileTickStride]);

  return {
    assignProjectListMode,
    assignProjectSections,
    assignProjectsCount,
    clusterDetails,
    clusterDetailsSummary,
    coarsePointer,
    ctxMenu,
    ctxMenuPlacement,
    ctxRef,
    handleAddSession,
    handleAssign,
    handleCustomRateMultiplier,
    handleEditComment,
    handleManualSegmentContextMenu,
    handleOpenClusterDetails,
    handleSegmentContextMenu,
    handleSetRateMultiplier,
    handleTimelineContextMenu,
    mobileAxisTicks,
    model,
    onAddManualSession,
    onAssignSession,
    onUpdateSessionComment,
    onUpdateSessionRateMultiplier,
    projectIdByName,
    promptConfig,
    saveView,
    setAssignProjectListMode,
    setClusterDetails,
    setPromptConfig,
    showAssignSectionHeaders: assignProjectListMode !== 'alpha_active',
    sortMode,
    t,
    toggleSaveView,
    updateSortMode,
  };
}

export type ProjectDayTimelineController = ReturnType<
  typeof useProjectDayTimelineController
>;
