import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { sessionsApi, manualSessionsApi } from '@/lib/tauri';
import { PromptModal } from '@/components/ui/prompt-modal';
import { logTauriError } from '@/lib/utils';
import { UNASSIGNED_PROJECT_SENTINEL } from '@/lib/project-labels';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { format, parseISO } from 'date-fns';
import { MultiSplitSessionModal } from '@/components/sessions/MultiSplitSessionModal';
import { SessionsToolbar } from '@/components/sessions/SessionsToolbar';
import { SessionsProjectContextMenu } from '@/components/sessions/SessionsProjectContextMenu';
import { SessionContextMenu } from '@/components/sessions/SessionContextMenu';
import { SessionsVirtualList } from '@/components/sessions/SessionsVirtualList';
import type {
  ManualSessionWithProject,
  SessionWithApp,
  SplitPart,
} from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  loadFreezeSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import {
  compareProjectsByName,
  isRecentProject,
} from '@/lib/project-utils';
import { useSessionActions } from '@/hooks/useSessionActions';
import { useSessionsData } from '@/hooks/useSessionsData';
import { useSessionsFilters } from '@/hooks/useSessionsFilters';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { manualToSessionRow } from '@/lib/session-utils';
import { useSessionScoreBreakdown } from '@/hooks/useSessionScoreBreakdown';
import { useSessionSplitAnalysis } from '@/hooks/useSessionSplitAnalysis';
import {
  useClickOutsideDismiss,
  useEscapeKey,
} from '@/hooks/useDismissable';
import {
  loadProjectsAllTime,
  useProjectsCacheStore,
} from '@/store/projects-cache-store';
import { shouldRefreshSessionsPage } from '@/lib/page-refresh-reasons';
import { useSettingsStore } from '@/store/settings-store';
import { useSessionBulkActions } from '@/hooks/useSessionBulkActions';
import { useSessionContextMenuActions } from '@/hooks/useSessionContextMenuActions';

interface ContextMenu {
  x: number;
  y: number;
  session: SessionWithApp;
}

interface ProjectHeaderMenu {
  x: number;
  y: number;
  projectId: number | null;
  projectName: string;
  sessionIds: number[];
}

interface GroupedProject {
  projectId: number | null;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  boostedCount: number;
  sessions: SessionWithApp[];
}

const TOP_PROJECTS_LIMIT = 5;

export function Sessions() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const assignProjectListMode = useUIStore((s) => s.assignProjectListMode);
  const setAssignProjectListMode = useUIStore((s) => s.setAssignProjectListMode);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const {
    assignSessions,
    updateSessionRateMultipliers,
    updateSessionComments,
    updateSessionComment: updateOneSessionComment,
    deleteSessions,
  } = useSessionActions({
    onAfterMutation: () => triggerRefresh('sessions_mutation'),
    onError: (action, error) => {
      console.error(`Session action failed (${action}):`, error);
    },
  });
  const projects = useProjectsCacheStore((state) => state.projectsAllTime);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [projectCtxMenu, setProjectCtxMenu] =
    useState<ProjectHeaderMenu | null>(null);
  const [viewMode, setViewMode] = useState<
    'detailed' | 'compact' | 'ai_detailed'
  >('detailed');
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [multiSplitSession, setMultiSplitSession] =
    useState<SessionWithApp | null>(null);
  const [dataReloadVersion, setDataReloadVersion] = useState(0);
  const [indicators, setIndicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );
  const splitSettings = useSettingsStore((s) => s.splitSettings);
  const ctxRef = useRef<HTMLDivElement>(null);
  const projectCtxRef = useRef<HTMLDivElement>(null);
  const [customScrollParent, setCustomScrollParent] = useState<
    HTMLElement | undefined
  >(undefined);
  const {
    activeDateRange,
    activeProjectId,
    buildFetchParams,
    canShiftForward,
    rangeMode,
    setActiveProjectId,
    setMinDuration,
    setOverrideDateRange,
    setRangeMode,
    shiftDateRange,
  } = useSessionsFilters(viewMode);
  const reloadDisplaySettings = useCallback(() => {
    const sessionSettings = loadSessionSettings();
    setIndicators(loadIndicatorSettings());
    setMinDuration(
      sessionSettings.minSessionDurationSeconds > 0
        ? sessionSettings.minSessionDurationSeconds
        : undefined,
    );
  }, [setMinDuration]);

  const {
    dismissedSuggestions,
    error: sessionsError,
    hasMore,
    loadMore,
    sessions,
    sessionsRef,
    isLoading: isSessionsLoading,
    setDismissedSuggestions,
    setSessions,
  } = useSessionsData({
    activeDateRange,
    buildFetchParams,
    reloadVersion: dataReloadVersion,
  });

  const [manualSessions, setManualSessions] = useState<
    ManualSessionWithProject[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    manualSessionsApi
      .getManualSessions({
        dateRange: activeDateRange,
        projectId: undefined,
      })
      .then((data) => {
        if (!cancelled) setManualSessions(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeDateRange, dataReloadVersion]);

  const mergedSessions = useMemo(() => {
    if (manualSessions.length === 0) return sessions;
    const manualAsSession = manualSessions.map((m) =>
      manualToSessionRow(m, t('project_page.text.manual_session', 'Manual Session')),
    );
    return [...sessions, ...manualAsSession].sort((a, b) =>
      b.start_time.localeCompare(a.start_time),
    );
  }, [sessions, manualSessions, t]);

  const {
    aiBreakdowns,
    getScoreBreakdownData,
    handleToggleScoreBreakdown,
    loadingBreakdownIds,
    scoreBreakdown,
  } = useSessionScoreBreakdown({
    sessions,
    showScoreBreakdown: indicators.showScoreBreakdown,
    viewMode,
  });
  const {
    clearSplitCaches,
    isSessionSplittable,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
  } = useSessionSplitAnalysis({
    multiSplitSession,
    sessions,
    splitSettings,
  });
  usePageRefreshListener((reasons, source) => {
    if (source === 'app' && reasons.includes('settings_saved')) {
      reloadDisplaySettings();
    }
    if (!reasons.some((reason) => shouldRefreshSessionsPage(reason))) {
      return;
    }
    clearSplitCaches();
    setDataReloadVersion((prev) => prev + 1);
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let rafId = 0;
    const resolveScrollParent = () => {
      const el = document.querySelector('main');
      if (el instanceof HTMLElement) {
        setCustomScrollParent((current) => (current === el ? current : el));
        return;
      }
      rafId = window.requestAnimationFrame(resolveScrollParent);
    };

    resolveScrollParent();
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    void loadProjectsAllTime();
  }, []);

  const [ctxMenuPlacement, setCtxMenuPlacement] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  // TODO: Extract shared context menu placement logic with ProjectDayTimeline (timeline-calculations.ts)
  const resolveContextMenuPlacement = useCallback(
    (
      x: number,
      y: number,
      viewportWidth: number,
      viewportHeight: number,
      menuSize: { width: number; height: number } | null,
    ) => {
      const width = Math.max(240, menuSize?.width ?? 0);
      const maxHeight = Math.max(200, viewportHeight - 16);
      const height = Math.min(Math.max(400, menuSize?.height ?? 0), maxHeight);

      const maxLeft = Math.max(8, viewportWidth - width - 8);
      const left = Math.min(Math.max(x, 8), maxLeft);

      const overflowsDown = y + height > viewportHeight - 8;
      const canFlipUp = y - height >= 8;
      const maxTop = Math.max(8, viewportHeight - height - 8);
      const top =
        overflowsDown && canFlipUp
          ? y - height
          : Math.min(Math.max(y, 8), maxTop);

      return { left, top, maxHeight };
    },
    [],
  );

  // Update placement when menu opens or window resizes
  useEffect(() => {
    if (!ctxMenu || typeof window === 'undefined') return;

    const updatePlacement = () => {
      const next = resolveContextMenuPlacement(
        ctxMenu.x,
        ctxMenu.y,
        window.innerWidth,
        window.innerHeight,
        ctxRef.current
          ? {
              width: ctxRef.current.offsetWidth,
              height: ctxRef.current.offsetHeight,
            }
          : null,
      );
      setCtxMenuPlacement(next);
    };

    updatePlacement();
    const raf = window.requestAnimationFrame(updatePlacement);
    window.addEventListener('resize', updatePlacement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePlacement);
    };
  }, [ctxMenu, resolveContextMenuPlacement]);

  const closeSessionContextMenu = useCallback(() => setCtxMenu(null), [
    setCtxMenu,
  ]);
  const closeProjectContextMenu = useCallback(() => setProjectCtxMenu(null), [
    setProjectCtxMenu,
  ]);
  const closeContextMenus = useCallback(() => {
    setCtxMenu(null);
    setProjectCtxMenu(null);
  }, [setCtxMenu, setProjectCtxMenu]);

  useClickOutsideDismiss(ctxRef, closeSessionContextMenu, Boolean(ctxMenu));
  useClickOutsideDismiss(
    projectCtxRef,
    closeProjectContextMenu,
    Boolean(projectCtxMenu),
  );
  useEscapeKey(closeContextMenus, Boolean(ctxMenu || projectCtxMenu));

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, session: SessionWithApp) => {
      e.preventDefault();
      e.stopPropagation();
      setProjectCtxMenu(null);
      setCtxMenu({ x: e.clientX, y: e.clientY, session });
    },
    [setProjectCtxMenu, setCtxMenu],
  );

  const projectIdByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const project of projects) {
      const key = project.name.trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, project.id);
      }
    }
    return map;
  }, [projects]);

  const unassignedLabel = t('sessions.menu.unassigned');

  const groupedByProject = useMemo(() => {
    const groups = new Map<string, GroupedProject>();
    for (const session of mergedSessions) {
      const projectName = session.project_name ?? unassignedLabel;
      const normalizedProjectName = projectName.trim().toLowerCase();
      const inferredProjectId =
        session.project_id ??
        (normalizedProjectName
          ? (projectIdByName.get(normalizedProjectName) ?? null)
          : null);
      const isUnassigned = inferredProjectId == null;
      const projectId = inferredProjectId;
      const projectColor = session.project_color ?? '#64748b';
      const key = isUnassigned
        ? UNASSIGNED_PROJECT_SENTINEL
        : typeof projectId === 'number' && projectId > 0
          ? `id:${projectId}`
          : `name:${projectName.trim().toLowerCase()}`;
      if (!groups.has(key)) {
        groups.set(key, {
          projectId,
          projectName,
          projectColor,
          totalSeconds: 0,
          boostedCount: 0,
          sessions: [],
        });
      }
      const group = groups.get(key)!;
      if (
        group.projectId == null &&
        typeof projectId === 'number' &&
        projectId > 0
      ) {
        group.projectId = projectId;
      }
      group.totalSeconds += session.duration_seconds;
      if ((session.rate_multiplier ?? 1) > 1.000_001) group.boostedCount++;
      group.sessions.push(session);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aUnassigned = a.projectId == null;
      const bUnassigned = b.projectId == null;
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      return b.totalSeconds - a.totalSeconds;
    });
  }, [mergedSessions, unassignedLabel, projectIdByName]);

  const handleProjectContextMenu = useCallback(
    (e: React.MouseEvent, projectId: number | null, projectName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu(null);
      const group = groupedByProject.find(
        (g) => g.projectName === projectName,
      );
      const sessionIds = group?.sessions.map((s) => s.id) ?? [];
      setProjectCtxMenu({ x: e.clientX, y: e.clientY, projectId, projectName, sessionIds });
    },
    [setCtxMenu, setProjectCtxMenu, groupedByProject],
  );

  const {
    ensureCommentForBoost,
    handleAcceptSuggestion,
    handleRejectSuggestion,
  } = useSessionBulkActions({
    assignSessions,
    updateSessionComments,
    setSessions,
    sessionsRef,
    setDismissedSuggestions,
    setPromptConfig,
    mergedSessions,
  });

  const {
    handleAssign,
    handleSetRateMultiplier,
    handleCustomRateMultiplier,
    handleEditComment,
    openMultiSplitModal,
  } = useSessionContextMenuActions({
    ctxMenu,
    setCtxMenu,
    setPromptConfig,
    setMultiSplitSession,
    assignSessions,
    updateSessionRateMultipliers,
    updateOneSessionComment,
    setSessions,
    sessionsRef,
    isSessionSplittable,
    ensureCommentForBoost,
  });

  const [freezeThresholdDays] = useState(
    () => loadFreezeSettings().thresholdDays,
  );

  const assignProjectSections = useMemo(() => {
    const activeProjects = projects.filter((p) => !p.frozen_at);
    const activeAlpha = [...activeProjects].sort(compareProjectsByName);
    const newProjectMaxAgeMs = Math.max(1, freezeThresholdDays) * 24 * 60 * 60 * 1000;

    if (assignProjectListMode === 'alpha_active') {
      return [
        {
          key: 'all',
          label: t(
            'sessions.menu.active_projects_az',
            'Active projects (A-Z)',
          ),
          projects: activeAlpha,
        },
      ];
    }

    const topProjectIds = new Set(
      [...activeProjects]
        .sort((a, b) => {
          const byTime = b.total_seconds - a.total_seconds;
          if (byTime !== 0) return byTime;
          return compareProjectsByName(a, b);
        })
        .slice(0, TOP_PROJECTS_LIMIT)
        .map((p) => p.id),
    );
    const newestAlpha = activeAlpha.filter((p) =>
      isRecentProject(p, newProjectMaxAgeMs),
    );
    const topAlpha = activeAlpha.filter((p) => topProjectIds.has(p.id));

    if (assignProjectListMode === 'new_top_rest') {
      const used = new Set<number>();
      const newest = newestAlpha;
      newest.forEach((p) => used.add(p.id));
      const top = topAlpha.filter((p) => !used.has(p.id));
      top.forEach((p) => used.add(p.id));
      const rest = activeAlpha.filter((p) => !used.has(p.id));

      return [
        {
          key: 'new',
          label: t(
            'sessions.menu.newest_projects_az',
            'Newest projects (A-Z)',
          ),
          projects: newest,
        },
        {
          key: 'top',
          label: t('sessions.menu.top_projects_az', 'Top projects (A-Z)'),
          projects: top,
        },
        {
          key: 'rest',
          label: t(
            'sessions.menu.remaining_active_az',
            'Remaining active (A-Z)',
          ),
          projects: rest,
        },
      ];
    }

    const used = new Set<number>();
    const top = topAlpha;
    top.forEach((p) => used.add(p.id));
    const newest = newestAlpha.filter((p) => !used.has(p.id));
    newest.forEach((p) => used.add(p.id));
    const rest = activeAlpha.filter((p) => !used.has(p.id));

    return [
      {
        key: 'top',
        label: t('sessions.menu.top_projects_az', 'Top projects (A-Z)'),
        projects: top,
      },
      {
        key: 'new',
        label: t(
          'sessions.menu.newest_projects_az',
          'Newest projects (A-Z)',
        ),
        projects: newest,
      },
      {
        key: 'rest',
        label: t(
          'sessions.menu.remaining_active_az',
          'Remaining active (A-Z)',
        ),
        projects: rest,
      },
    ];
  }, [assignProjectListMode, freezeThresholdDays, projects, t]);

  const assignProjectsCount = useMemo(
    () =>
      assignProjectSections.reduce(
        (total, section) => total + section.projects.length,
        0,
      ),
    [assignProjectSections],
  );
  const showAssignSectionHeaders = assignProjectListMode !== 'alpha_active';

  type FlatItem =
    | { type: 'header'; group: GroupedProject; isCompact: boolean }
    | {
        type: 'session';
        session: SessionWithApp;
        group: GroupedProject;
        isCompact: boolean;
        isFirstInGroup: boolean;
        isLastInGroup: boolean;
        isSplittable: boolean;
      };

  const flattenedItems = useMemo(() => {
    const list: FlatItem[] = [];
    groupedByProject.forEach((group) => {
      const isCompact = viewMode === 'compact';
      list.push({ type: 'header', group, isCompact });
      group.sessions.forEach((session, i) => {
        list.push({
          type: 'session',
          session,
          group,
          isCompact,
          isFirstInGroup: i === 0,
          isLastInGroup: i === group.sessions.length - 1,
          isSplittable: isSessionSplittable(session),
        });
      });
    });
    return list;
  }, [groupedByProject, viewMode, isSessionSplittable]);

  const unassignedGroup = groupedByProject.find((g) => g.projectId == null);
  const aiSessionsCount = useMemo(
    () =>
      mergedSessions.filter(
        (s) =>
          aiBreakdowns.has(s.id) ||
          s.suggested_project_id != null ||
          s.suggested_confidence != null ||
          s.ai_assigned,
      ).length,
    [mergedSessions, aiBreakdowns],
  );
  const resolveGroupProjectId = useCallback(
    (group: GroupedProject) => {
      if (typeof group.projectId === 'number' && group.projectId > 0)
        return group.projectId;

      const explicitId = group.sessions.find(
        (s) => typeof s.project_id === 'number' && s.project_id > 0,
      )?.project_id;
      if (typeof explicitId === 'number' && explicitId > 0) return explicitId;

      const suggestedId = group.sessions.find(
        (s) =>
          typeof s.suggested_project_id === 'number' &&
          s.suggested_project_id > 0 &&
          (s.suggested_project_name ?? '').trim().toLowerCase() ===
            group.projectName.toLowerCase(),
      )?.suggested_project_id;
      if (typeof suggestedId === 'number' && suggestedId > 0)
        return suggestedId;

      const normalizedGroupName = group.projectName.trim().toLowerCase();
      const byName = projects.find(
        (p) => p.name.trim().toLowerCase() === normalizedGroupName,
      );
      return byName?.id ?? null;
    },
    [projects],
  );
  const displayProjectName = useCallback(
    (name: string, projectId: number | null = null) =>
      projectId == null ? t('sessions.menu.unassigned') : name,
    [t],
  );

  const ctxMenuSplitSuggested = ctxMenu
    ? isSessionSplittable(ctxMenu.session)
    : false;
  const sessionsSummaryText = t('sessions.summary', {
    sessions: mergedSessions.length,
    ai: aiSessionsCount,
    projects: groupedByProject.length,
  });
  const activeRangeLabel =
    activeDateRange.start === activeDateRange.end
      ? format(parseISO(activeDateRange.start), 'MMM d', { locale })
      : `${format(parseISO(activeDateRange.start), 'MMM d', { locale })} - ${format(parseISO(activeDateRange.end), 'MMM d', { locale })}`;

  return (
    <div className="space-y-4">
      <SessionsToolbar
        summary={{
          text: sessionsSummaryText,
          showUnassignedOnly: activeProjectId === 'unassigned',
          unassignedOnlyText: t('sessions.unassigned_only'),
          unassignedScopeText:
            activeProjectId === 'unassigned'
              ? t('sessions.unassigned_scope_all_dates')
              : undefined,
        }}
        range={{
          mode: rangeMode,
          label: activeRangeLabel,
          canShiftForward,
          labels: {
            today: t('sessions.range.today'),
            week: t('sessions.range.week'),
            previousTooltip: t('layout.tooltips.previous_period'),
            nextTooltip: t('layout.tooltips.next_period'),
          },
          onModeChange: setRangeMode,
          onClearOverrideRange: () => setOverrideDateRange(null),
          onShiftBackward: () => shiftDateRange(-1),
          onShiftForward: () => shiftDateRange(1),
        }}
        view={{
          mode: viewMode,
          labels: {
            aiData: t('sessions.view.ai_data'),
            detailed: t('sessions.view.detailed'),
            compact: t('sessions.view.compact'),
          },
          onModeChange: setViewMode,
        }}
      />

      {sessionsError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {sessionsError}
        </div>
      )}

      <SessionsVirtualList
        customScrollParent={customScrollParent}
        flattenedItems={flattenedItems}
        showUnassignedBanner={
          !!unassignedGroup &&
          (activeProjectId === null || activeProjectId === 'unassigned')
        }
        unassignedSessionCount={unassignedGroup?.sessions.length ?? 0}
        onFilterUnassigned={() => setActiveProjectId('unassigned')}
        onSelectProjectFilter={(projectId) => setActiveProjectId(projectId)}
        resolveGroupProjectId={resolveGroupProjectId}
        displayProjectName={displayProjectName}
        onProjectContextMenu={handleProjectContextMenu}
        dismissedSuggestions={dismissedSuggestions}
        onToggleScoreBreakdown={handleToggleScoreBreakdown}
        scoreBreakdownSessionId={scoreBreakdown?.sessionId ?? null}
        getScoreBreakdownData={getScoreBreakdownData}
        deleteSession={deleteSessions}
        onSessionContextMenu={handleContextMenu}
        indicators={indicators}
        viewMode={viewMode}
        loadingBreakdownIds={loadingBreakdownIds}
        onAcceptSuggestion={handleAcceptSuggestion}
        onRejectSuggestion={handleRejectSuggestion}
        onSplitClick={openMultiSplitModal}
        isEmpty={mergedSessions.length === 0}
        isLoading={isSessionsLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />

      {ctxMenu && (
        <SessionContextMenu
          menu={ctxMenu}
          menuRef={ctxRef}
          placement={ctxMenuPlacement}
          splitSuggested={ctxMenuSplitSuggested}
          assignProjectListMode={assignProjectListMode}
          onAssignProjectListModeChange={setAssignProjectListMode}
          assignProjectSections={assignProjectSections}
          assignProjectsCount={assignProjectsCount}
          showAssignSectionHeaders={showAssignSectionHeaders}
          onAcceptSuggestion={() =>
            void handleAcceptSuggestion(ctxMenu.session, {
              stopPropagation: () => {},
            } as React.MouseEvent)
          }
          onRejectSuggestion={() =>
            void handleRejectSuggestion(ctxMenu.session, {
              stopPropagation: () => {},
            } as React.MouseEvent)
          }
          onSetRateMultiplier={(multiplier) =>
            void handleSetRateMultiplier(multiplier)
          }
          onCustomRateMultiplier={() => {
            void handleCustomRateMultiplier();
          }}
          onEditComment={() => {
            void handleEditComment();
          }}
          onOpenSplit={() => {
            openMultiSplitModal(ctxMenu.session);
          }}
          onAssign={(projectId, source) => {
            void handleAssign(projectId, source);
          }}
          isManual={'isManual' in ctxMenu.session && !!(ctxMenu.session as SessionWithApp & { isManual?: boolean }).isManual}
        />
      )}

      <SessionsProjectContextMenu
        menu={projectCtxMenu}
        menuRef={projectCtxRef}
        projectLabel={t('sessions.menu.project_label')}
        projectNameDisplay={
          projectCtxMenu
            ? displayProjectName(
                projectCtxMenu.projectName,
                projectCtxMenu.projectId,
              )
            : ''
        }
        goToProjectCardLabel={t('sessions.menu.go_to_project_card')}
        noLinkedProjectCardLabel={t('sessions.menu.no_linked_project_card')}
        bulkCommentLabel={t('sessions.menu.bulk_comment')}
        onNavigateToProject={(projectId) => {
          setProjectPageId(projectId);
          setCurrentPage('project-card');
        }}
        onBulkComment={(sessionIds) => {
          setPromptConfig({
            title: t('sessions.prompts.bulk_comment_title'),
            description: t('sessions.prompts.bulk_comment_description', { count: sessionIds.length }),
            initialValue: '',
            onConfirm: async (raw) => {
              const trimmed = raw.trim();
              try {
                await updateSessionComments(sessionIds, trimmed || null);
              } catch (err) {
                logTauriError('bulk update session comments', err);
              }
            },
          });
        }}
        onClose={() => setProjectCtxMenu(null)}
      />

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
      />

      {multiSplitSession && (
        <MultiSplitSessionModal
          session={multiSplitSession}
          projects={projects}
          analysis={selectedSplitAnalysis}
          isAnalysisLoading={selectedSplitAnalysisLoading}
          maxProjects={splitSettings.maxProjectsPerSession}
          onConfirm={async (splits: SplitPart[]) => {
            await sessionsApi.splitSessionMulti(multiSplitSession.id, splits);
            setMultiSplitSession(null);
            void triggerRefresh('sessions_multi_split');
          }}
          onCancel={() => setMultiSplitSession(null)}
        />
      )}
    </div>
  );
}
