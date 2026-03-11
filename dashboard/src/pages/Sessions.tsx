import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  MessageSquare,
  CircleDollarSign,
  Type,
  Flame,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import {
  getSessions,
  getSessionScoreBreakdown,
  analyzeSessionProjects,
  analyzeSessionsSplittable,
  splitSessionMulti as splitSessionMultiInvoke,
} from '@/lib/tauri';
import { PromptModal } from '@/components/ui/prompt-modal';
import {
  formatDuration,
  formatMultiplierLabel,
  logTauriError,
} from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { Virtuoso } from 'react-virtuoso';
import { SessionRow } from '@/components/sessions/SessionRow';
import { MultiSplitSessionModal } from '@/components/sessions/MultiSplitSessionModal';
import { SessionsToolbar } from '@/components/sessions/SessionsToolbar';
import { SessionsProjectContextMenu } from '@/components/sessions/SessionsProjectContextMenu';
import type {
  DateRange,
  MultiProjectAnalysis,
  SessionWithApp,
  SplitPart,
  ProjectWithStats,
  ScoreBreakdown,
} from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  loadSplitSettings,
  loadFreezeSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';
import { useToast } from '@/components/ui/toast-notification';
import { resolveDateFnsLocale } from '@/lib/date-locale';
import { useSessionActions } from '@/hooks/useSessionActions';
import {
  findSessionIdsMissingComment,
  parsePositiveRateMultiplierInput,
  requiresCommentForMultiplierBoost,
} from '@/hooks/useSessionActions';
import {
  EMPTY_SCORE_BREAKDOWN,
  isAlreadySplitSession,
  isSplittableFromBreakdown,
  buildAnalysisFromBreakdown,
  withTimeout,
} from '@/lib/session-analysis';
import { loadProjectsAllTime } from '@/store/projects-cache-store';

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
}

interface GroupedProject {
  projectId: number | null;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  boostedCount: number;
  sessions: SessionWithApp[];
}

type RangeMode = 'daily' | 'weekly';
type AssignProjectListMode = 'alpha_active' | 'new_top_rest' | 'top_new_rest';
const UNASSIGNED_GROUP_KEY = '__unassigned__';
const ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY =
  'timeflow-sessions-assign-project-list-mode';
const TOP_PROJECTS_LIMIT = 5;
const SCORE_BREAKDOWN_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedBreakdownEntry = {
  data: ScoreBreakdown;
  fetchedAtMs: number;
};

function loadAssignProjectListMode(): AssignProjectListMode {
  if (typeof window === 'undefined') return 'alpha_active';
  try {
    const raw = window.localStorage.getItem(
      ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY,
    );
    if (
      raw === 'new_top_rest' ||
      raw === 'top_new_rest' ||
      raw === 'alpha_active'
    ) {
      return raw;
    }
    return 'alpha_active';
  } catch {
    return 'alpha_active';
  }
}

function persistAssignProjectListMode(mode: AssignProjectListMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('Failed to persist assign project list mode', error);
  }
}

function compareProjectsByName(
  a: ProjectWithStats,
  b: ProjectWithStats,
): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function isNewProjectForAssignList(
  project: ProjectWithStats,
  maxAgeMs: number,
): boolean {
  const createdAtMs = new Date(project.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  const ageMs = Date.now() - createdAtMs;
  return ageMs >= 0 && ageMs < maxAgeMs;
}

function readMinSessionDuration(): number | undefined {
  const settings = loadSessionSettings();
  return settings.minSessionDurationSeconds > 0
    ? settings.minSessionDurationSeconds
    : undefined;
}

function areFileActivitiesEqual(
  left: SessionWithApp['files'][number],
  right: SessionWithApp['files'][number],
): boolean {
  return (
    left.id === right.id &&
    left.app_id === right.app_id &&
    left.file_name === right.file_name &&
    (left.file_path ?? null) === (right.file_path ?? null) &&
    left.total_seconds === right.total_seconds &&
    left.first_seen === right.first_seen &&
    left.last_seen === right.last_seen &&
    (left.project_id ?? null) === (right.project_id ?? null) &&
    (left.project_name ?? null) === (right.project_name ?? null) &&
    (left.project_color ?? null) === (right.project_color ?? null)
  );
}

function areSessionsEqual(left: SessionWithApp, right: SessionWithApp): boolean {
  if (
    left.id !== right.id ||
    left.app_id !== right.app_id ||
    left.app_name !== right.app_name ||
    left.executable_name !== right.executable_name ||
    (left.project_id ?? null) !== (right.project_id ?? null) ||
    left.start_time !== right.start_time ||
    left.end_time !== right.end_time ||
    left.duration_seconds !== right.duration_seconds ||
    (left.rate_multiplier ?? null) !== (right.rate_multiplier ?? null) ||
    (left.comment ?? null) !== (right.comment ?? null) ||
    (left.is_hidden ?? null) !== (right.is_hidden ?? null) ||
    (left.split_source_session_id ?? null) !==
      (right.split_source_session_id ?? null) ||
    (left.project_name ?? null) !== (right.project_name ?? null) ||
    (left.project_color ?? null) !== (right.project_color ?? null) ||
    (left.suggested_project_id ?? null) !==
      (right.suggested_project_id ?? null) ||
    (left.suggested_project_name ?? null) !==
      (right.suggested_project_name ?? null) ||
    (left.suggested_confidence ?? null) !==
      (right.suggested_confidence ?? null) ||
    (left.ai_assigned ?? null) !== (right.ai_assigned ?? null) ||
    left.files.length !== right.files.length
  ) {
    return false;
  }

  for (let index = 0; index < left.files.length; index += 1) {
    if (!areFileActivitiesEqual(left.files[index], right.files[index])) {
      return false;
    }
  }

  return true;
}

function areSessionListsEqual(
  left: SessionWithApp[],
  right: SessionWithApp[],
): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (!areSessionsEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

export function Sessions() {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const { showError } = useToast();
  const {
    sessionsFocusDate,
    clearSessionsFocusDate,
    sessionsFocusRange,
    setSessionsFocusRange,
    sessionsFocusProject,
    setSessionsFocusProject,
    setProjectPageId,
    setCurrentPage,
  } = useUIStore();
  const { refreshKey, triggerRefresh } = useDataStore();
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
  const [rangeMode, setRangeMode] = useState<RangeMode>('daily');
  const [anchorDate, setAnchorDate] = useState<string>(
    () => sessionsFocusDate ?? format(new Date(), 'yyyy-MM-dd'),
  );
  const [overrideDateRange, setOverrideDateRange] = useState<DateRange | null>(
    null,
  );
  const [activeProjectId, setActiveProjectId] = useState<
    number | 'unassigned' | null
  >(sessionsFocusProject);
  const [sessions, setSessions] = useState<SessionWithApp[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(
    new Set(),
  );
  const [hasMore, setHasMore] = useState(false);
  const sessionsRef = useRef<SessionWithApp[]>([]);
  const hasMoreRef = useRef(false);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [projectCtxMenu, setProjectCtxMenu] =
    useState<ProjectHeaderMenu | null>(null);
  const [viewMode, setViewMode] = useState<
    'detailed' | 'compact' | 'ai_detailed'
  >('detailed');
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [assignProjectListMode, setAssignProjectListMode] =
    useState<AssignProjectListMode>(() => loadAssignProjectListMode());
  const [multiSplitSession, setMultiSplitSession] =
    useState<SessionWithApp | null>(null);
  const [splitEligibilityBySession, setSplitEligibilityBySession] = useState<
    Map<number, boolean>
  >(new Map());

  const [splitAnalysisBySession, setSplitAnalysisBySession] = useState<
    Map<number, MultiProjectAnalysis>
  >(new Map());
  const [splitAnalysisLoadingIds, setSplitAnalysisLoadingIds] = useState<
    Set<number>
  >(new Set());
  const [indicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );
  const splitSettings = useMemo(() => {
    void refreshKey;
    return loadSplitSettings();
  }, [refreshKey]);
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    sessionId: number;
    data: ScoreBreakdown;
  } | null>(null);
  const [aiBreakdowns, setAiBreakdowns] = useState<Map<number, ScoreBreakdown>>(
    new Map(),
  );
  const aiBreakdownsRef = useRef<Map<number, ScoreBreakdown>>(new Map());
  const [loadingBreakdownIds, setLoadingBreakdownIds] = useState<Set<number>>(
    new Set(),
  );
  const scoreBreakdownRequestsRef = useRef<
    Map<number, Promise<ScoreBreakdown>>
  >(new Map());
  const scoreBreakdownCacheRef = useRef<Map<number, CachedBreakdownEntry>>(
    new Map(),
  );
  const getCachedBreakdown = useCallback(
    (sessionId: number): ScoreBreakdown | null => {
      const cached = scoreBreakdownCacheRef.current.get(sessionId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAtMs > SCORE_BREAKDOWN_CACHE_TTL_MS) {
        scoreBreakdownCacheRef.current.delete(sessionId);
        return null;
      }
      return cached.data;
    },
    [],
  );
  const ctxRef = useRef<HTMLDivElement>(null);
  const projectCtxRef = useRef<HTMLDivElement>(null);
  const [customScrollParent] = useState<HTMLElement | undefined>(() => {
    if (typeof document === 'undefined') return undefined;
    const el = document.querySelector('main');
    return el instanceof HTMLElement ? el : undefined;
  });
  const PAGE_SIZE = 100;
  const minDuration = readMinSessionDuration();
  const today = format(new Date(), 'yyyy-MM-dd');
  const canShiftForward = anchorDate < today;
  const shiftStepDays = rangeMode === 'weekly' ? 7 : 1;

  const activeDateRange = useMemo<DateRange>(() => {
    if (overrideDateRange) return overrideDateRange;
    const selectedDay = anchorDate || today;
    const selectedDateObj = parseISO(selectedDay);

    switch (rangeMode) {
      case 'daily':
        return { start: selectedDay, end: selectedDay };
      case 'weekly':
        return {
          start: format(subDays(selectedDateObj, 6), 'yyyy-MM-dd'),
          end: selectedDay,
        };
    }
  }, [rangeMode, anchorDate, today, overrideDateRange]);

  const shiftDateRange = (direction: -1 | 1) => {
    setOverrideDateRange(null);
    const current = parseISO(anchorDate);
    const next = format(
      addDays(current, direction * shiftStepDays),
      'yyyy-MM-dd',
    );
    if (next > today) return;
    setAnchorDate(next);
  };

  useEffect(() => {
    if (
      !sessionsFocusDate &&
      !sessionsFocusRange &&
      sessionsFocusProject === null
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (sessionsFocusDate) {
        setOverrideDateRange(null);
        setRangeMode('daily');
        setAnchorDate(sessionsFocusDate);
        clearSessionsFocusDate();
      } else if (sessionsFocusRange) {
        setOverrideDateRange(sessionsFocusRange);
        // We set anchorDate to end of range just so navigation buttons are somewhat sane
        setAnchorDate(sessionsFocusRange.end);
        setSessionsFocusRange(null);
      }

      if (sessionsFocusProject !== null) {
        setActiveProjectId(sessionsFocusProject);
        setSessionsFocusProject(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    sessionsFocusDate,
    clearSessionsFocusDate,
    sessionsFocusRange,
    setSessionsFocusRange,
    sessionsFocusProject,
    setSessionsFocusProject,
  ]);

  // When filtering to "unassigned", skip dateRange so ALL unassigned sessions
  // are visible (the daemon badge counts across all dates, not just today/week).
  const effectiveDateRange =
    activeProjectId === 'unassigned' ? undefined : activeDateRange;

  const buildFetchParams = useCallback(
    (offset: number) => ({
      dateRange: effectiveDateRange,
      limit: PAGE_SIZE,
      offset,
      projectId:
        activeProjectId === 'unassigned'
          ? undefined
          : (activeProjectId ?? undefined),
      unassigned: activeProjectId === 'unassigned' ? true : undefined,
      minDuration,
      includeFiles: viewMode === 'detailed',
      includeAiSuggestions: true,
    }),
    [effectiveDateRange, activeProjectId, minDuration, viewMode],
  );

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    aiBreakdownsRef.current = aiBreakdowns;
  }, [aiBreakdowns]);

  const replaceSessionsPage = useCallback((data: SessionWithApp[]) => {
    const nextHasMore = data.length >= PAGE_SIZE;
    if (!areSessionListsEqual(sessionsRef.current, data)) {
      sessionsRef.current = data;
      setSessions(data);
    }
    if (hasMoreRef.current !== nextHasMore) {
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
    }
  }, []);

  const loadFirstSessionsPage = useCallback(async () => {
    const data = await getSessions(buildFetchParams(0));
    replaceSessionsPage(data);
  }, [buildFetchParams, replaceSessionsPage]);

  useEffect(() => {
    let cancelled = false;
    getSessions(buildFetchParams(0))
      .then((data) => {
        if (cancelled) return;
        replaceSessionsPage(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [buildFetchParams, refreshKey, replaceSessionsPage]);

  useEffect(() => {
    queueMicrotask(() => {
      setDismissedSuggestions(new Set());
    });
  }, [activeDateRange.start, activeDateRange.end]);

  useEffect(() => {
    loadProjectsAllTime().then(setProjects).catch(console.error);
  }, [refreshKey]);

  useEffect(() => {
    if (!multiSplitSession) return;
    const sessionId = multiSplitSession.id;
    if (splitAnalysisBySession.has(sessionId)) return;
    if (splitAnalysisLoadingIds.has(sessionId)) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSplitAnalysisLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    });

    void withTimeout(
      analyzeSessionProjects(
        sessionId,
        splitSettings.toleranceThreshold,
        splitSettings.maxProjectsPerSession,
      ),
      12_000,
    )
      .then((analysis) => {
        if (cancelled) return;
        setSplitAnalysisBySession((prev) => {
          const next = new Map(prev);
          next.set(sessionId, analysis);
          return next;
        });
      })
      .catch((error) => {
        console.warn(
          `Failed to analyze split candidates for session ${sessionId}:`,
          error,
        );
        if (cancelled) return;
        setSplitAnalysisBySession((prev) => {
          if (prev.has(sessionId)) return prev;
          const fallback = buildAnalysisFromBreakdown(
            sessionId,
            aiBreakdowns.get(sessionId) ??
              (scoreBreakdown?.sessionId === sessionId
                ? scoreBreakdown.data
                : null),
            splitSettings.toleranceThreshold,
            splitSettings.maxProjectsPerSession,
          ) ?? {
            session_id: sessionId,
            candidates: [],
            is_splittable: false,
            leader_project_id: null,
            leader_score: 0,
          };
          const next = new Map(prev);
          next.set(sessionId, fallback);
          return next;
        });
      })
      .finally(() => {
        setSplitAnalysisLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    multiSplitSession,
    splitAnalysisBySession,
    splitSettings,
    splitAnalysisLoadingIds,
    aiBreakdowns,
    scoreBreakdown,
  ]);

  useEffect(() => {
    const visibleSessionIds = sessions.map((s) => s.id);
    if (visibleSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    analyzeSessionsSplittable(
      visibleSessionIds,
      splitSettings.toleranceThreshold,
      splitSettings.maxProjectsPerSession,
    )
      .then((flags) => {
        if (cancelled) return;
        setSplitEligibilityBySession((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const flag of flags) {
            if (next.get(flag.session_id) !== flag.is_splittable) {
              next.set(flag.session_id, flag.is_splittable);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [
    sessions,
    splitSettings.toleranceThreshold,
    splitSettings.maxProjectsPerSession,
  ]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!indicators.showScoreBreakdown) {
        setLoadingBreakdownIds(new Set());
        return;
      }
      const visibleSessionIds = new Set(sessions.map((s) => s.id));
      setAiBreakdowns((prev) => {
        const next = new Map<number, ScoreBreakdown>();
        prev.forEach((value, sessionId) => {
          if (visibleSessionIds.has(sessionId)) {
            next.set(sessionId, value);
          }
        });
        aiBreakdownsRef.current = next;
        return next;
      });
      setLoadingBreakdownIds((prev) => {
        const next = new Set<number>();
        prev.forEach((sessionId) => {
          if (visibleSessionIds.has(sessionId)) {
            next.add(sessionId);
          }
        });
        return next;
      });
      if (scoreBreakdown && !visibleSessionIds.has(scoreBreakdown.sessionId)) {
        setScoreBreakdown(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, indicators.showScoreBreakdown, scoreBreakdown]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void loadFirstSessionsPage().catch(console.error);
    };
    const handleWindowFocus = () => {
      void loadFirstSessionsPage().catch(console.error);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [loadFirstSessionsPage]);

  const [ctxMenuPlacement, setCtxMenuPlacement] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  // resolveContextMenuPlacement helper similar to ProjectDayTimeline
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

  // Close context menus on click outside or Escape
  useEffect(() => {
    if (!ctxMenu && !projectCtxMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ctxRef.current && !ctxRef.current.contains(target)) setCtxMenu(null);
      if (projectCtxRef.current && !projectCtxRef.current.contains(target))
        setProjectCtxMenu(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null);
        setProjectCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ctxMenu, projectCtxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, session: SessionWithApp) => {
      e.preventDefault();
      e.stopPropagation();
      setProjectCtxMenu(null);
      setCtxMenu({ x: e.clientX, y: e.clientY, session });
    },
    [setProjectCtxMenu, setCtxMenu],
  );

  const openMultiSplitModal = (session: SessionWithApp) => {
    const derivedAnalysis = buildAnalysisFromBreakdown(
      session.id,
      aiBreakdowns.get(session.id) ??
        (scoreBreakdown?.sessionId === session.id ? scoreBreakdown.data : null),
      splitSettings.toleranceThreshold,
      splitSettings.maxProjectsPerSession,
    );
    const splitSuggested =
      (splitEligibilityBySession.get(session.id) ?? false) ||
      (derivedAnalysis?.is_splittable ?? false);
    if (!splitSuggested) return;

    if (derivedAnalysis) {
      setSplitAnalysisBySession((prev) => {
        if (prev.has(session.id)) return prev;
        const next = new Map(prev);
        next.set(session.id, derivedAnalysis);
        return next;
      });
    }

    setCtxMenu(null);
    setMultiSplitSession(session);
  };

  const handleProjectContextMenu = useCallback(
    (e: React.MouseEvent, projectId: number | null, projectName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu(null);
      setProjectCtxMenu({ x: e.clientX, y: e.clientY, projectId, projectName });
    },
    [setCtxMenu, setProjectCtxMenu],
  );

  const handleAssign = useCallback(
    async (projectId: number | null, source?: string) => {
      if (!ctxMenu) return;
      try {
        await assignSessions(ctxMenu.session.id, projectId, source);
      } catch (err) {
        logTauriError('assign session to project', err);
      }
      setCtxMenu(null);
    },
    [assignSessions, ctxMenu, setCtxMenu],
  );

  const ensureCommentForBoost = useCallback(
    async (sessionIds: number[]) => {
      if (sessionIds.length === 0) return true;

      const commentById = new Map(sessions.map((s) => [s.id, s.comment]));
      const missingIds = findSessionIdsMissingComment(
        sessionIds,
        (id) => commentById.get(id) ?? null,
      );

      if (missingIds.length === 0) return true;

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
        await updateSessionComments(missingIds, normalized);
        const missingSet = new Set(missingIds);
        setSessions((prev) => {
          const next = prev.map((s) =>
            missingSet.has(s.id) ? { ...s, comment: normalized } : s,
          );
          sessionsRef.current = next;
          return next;
        });
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
    [sessions, showError, t, updateSessionComments, setPromptConfig],
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (!ctxMenu) return;
      const sessionId = ctxMenu.session.id;
      try {
        if (requiresCommentForMultiplierBoost(multiplier)) {
          const ok = await ensureCommentForBoost([sessionId]);
          if (!ok) return;
        }
        await updateSessionRateMultipliers(sessionId, multiplier);
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
      showError,
      t,
      updateSessionRateMultipliers,
      setCtxMenu,
    ],
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu) return;
    const current =
      typeof ctxMenu.session.rate_multiplier === 'number'
        ? ctxMenu.session.rate_multiplier
        : 1;
    const suggested = current > 1 ? current : 2;

    setPromptConfig({
      title: t('sessions.prompts.multiplier_title'),
      description: t('sessions.prompts.multiplier_desc'),
      initialValue: String(suggested),
      onConfirm: async (raw) => {
        const parsed = parsePositiveRateMultiplierInput(raw);
        if (parsed == null) {
          showError(t('sessions.prompts.multiplier_positive'));
          return;
        }
        await handleSetRateMultiplier(parsed);
      },
    });
    setCtxMenu(null);
  }, [
    ctxMenu,
    handleSetRateMultiplier,
    showError,
    t,
    setPromptConfig,
    setCtxMenu,
  ]);

  const handleEditComment = useCallback(async () => {
    if (!ctxMenu) return;
    const current = ctxMenu.session.comment ?? '';
    const sessionId = ctxMenu.session.id;

    setPromptConfig({
      title: t('sessions.prompts.session_comment_title'),
      description: t('sessions.prompts.session_comment_desc'),
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await updateOneSessionComment(sessionId, trimmed || null);
          setSessions((prev) => {
            const next = prev.map((s) =>
              s.id === sessionId ? { ...s, comment: trimmed || null } : s,
            );
            sessionsRef.current = next;
            return next;
          });
        } catch (err) {
          logTauriError('update session comment', err);
        }
      },
    });
    setCtxMenu(null);
  }, [ctxMenu, t, updateOneSessionComment, setPromptConfig, setCtxMenu]);

  const handleAcceptSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessions(
          session.id,
          session.suggested_project_id ?? null,
          'ai_suggestion_accept',
        );
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
      } catch (err) {
        logTauriError('accept AI suggestion', err);
      }
    },
    [assignSessions],
  );

  const handleRejectSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessions(session.id, null, 'ai_suggestion_reject');
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.add(session.id);
          return next;
        });
        setSessions((prev) => {
          const next = prev.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  suggested_project_id: undefined,
                  suggested_project_name: undefined,
                  suggested_confidence: undefined,
                }
              : item,
          );
          sessionsRef.current = next;
          return next;
        });
      } catch (err) {
        logTauriError('reject AI suggestion', err);
      }
    },
    [assignSessions],
  );

  const loadScoreBreakdown = useCallback(
    async (sessionId: number): Promise<ScoreBreakdown> => {
      const currentBreakdowns = aiBreakdownsRef.current;
      const cached =
        currentBreakdowns.get(sessionId) ?? getCachedBreakdown(sessionId);
      if (cached) {
        if (!currentBreakdowns.has(sessionId)) {
          setAiBreakdowns((prev) => {
            if (prev.has(sessionId)) return prev;
            const next = new Map(prev);
            next.set(sessionId, cached);
            aiBreakdownsRef.current = next;
            return next;
          });
        }
        return cached;
      }

      const inFlight = scoreBreakdownRequestsRef.current.get(sessionId);
      if (inFlight) return inFlight;

      setLoadingBreakdownIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });

      const request = withTimeout(getSessionScoreBreakdown(sessionId), 10_000)
        .then((data) => {
          scoreBreakdownCacheRef.current.set(sessionId, {
            data,
            fetchedAtMs: Date.now(),
          });
          setAiBreakdowns((prev) => {
            if (prev.has(sessionId)) return prev;
            const next = new Map(prev);
            next.set(sessionId, data);
            aiBreakdownsRef.current = next;
            return next;
          });
          return data;
        })
        .catch((err) => {
          logTauriError('load score breakdown', err);
          return EMPTY_SCORE_BREAKDOWN;
        })
        .finally(() => {
          scoreBreakdownRequestsRef.current.delete(sessionId);
          setLoadingBreakdownIds((prev) => {
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
          });
        });

      scoreBreakdownRequestsRef.current.set(sessionId, request);
      return request;
    },
    [getCachedBreakdown],
  );

  const breakdownPrefetchIdsKey = useMemo(
    () =>
      sessions
        .filter((session) => !isAlreadySplitSession(session))
        .map((session) => session.id)
        .join(','),
    [sessions],
  );

  // Prefetch breakdowns only when the visible session ID set changes,
  // which avoids rerunning the effect after each individual breakdown arrives.
  useEffect(() => {
    const sessionIds = breakdownPrefetchIdsKey
      ? breakdownPrefetchIdsKey
          .split(',')
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
    if (sessionIds.length === 0) return;

    const missingIds = sessionIds.filter(
      (id) =>
        !aiBreakdownsRef.current.has(id) &&
        !getCachedBreakdown(id) &&
        !scoreBreakdownRequestsRef.current.has(id),
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    const batchSize = viewMode === 'ai_detailed' ? 8 : missingIds.length;

    const prefetch = async () => {
      for (let index = 0; index < missingIds.length; index += batchSize) {
        if (cancelled) return;
        const batch = missingIds.slice(index, index + batchSize);
        await Promise.allSettled(
          batch.map((sessionId) => loadScoreBreakdown(sessionId)),
        );
      }
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [breakdownPrefetchIdsKey, getCachedBreakdown, loadScoreBreakdown, viewMode]);

  const handleToggleScoreBreakdown = useCallback(
    async (sessionId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (scoreBreakdown?.sessionId === sessionId) {
        setScoreBreakdown(null);
        return;
      }
      const data = await loadScoreBreakdown(sessionId);
      setScoreBreakdown({ sessionId, data });
    },
    [loadScoreBreakdown, scoreBreakdown],
  );

  const loadMore = () => {
    getSessions(buildFetchParams(sessions.length))
      .then((data) => {
        setSessions((prev) => {
          const next = [...prev, ...data];
          sessionsRef.current = next;
          return next;
        });
        const nextHasMore = data.length >= PAGE_SIZE;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      })
      .catch(console.error);
  };

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

  const assignProjectSections = useMemo(() => {
    const activeProjects = projects.filter((p) => !p.frozen_at);
    const activeAlpha = [...activeProjects].sort(compareProjectsByName);
    const { thresholdDays } = loadFreezeSettings();
    const newProjectMaxAgeMs = Math.max(1, thresholdDays) * 24 * 60 * 60 * 1000;

    if (assignProjectListMode === 'alpha_active') {
      return [
        {
          key: 'all',
          label: t(
            'sessions.menu.active_projects_az',
            'Aktywne projekty (A-Z)',
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
      isNewProjectForAssignList(p, newProjectMaxAgeMs),
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
            'Najnowsze projekty (A-Z)',
          ),
          projects: newest,
        },
        {
          key: 'top',
          label: t('sessions.menu.top_projects_az', 'Top projekty (A-Z)'),
          projects: top,
        },
        {
          key: 'rest',
          label: t(
            'sessions.menu.remaining_active_az',
            'Pozostałe aktywne (A-Z)',
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
        label: t('sessions.menu.top_projects_az', 'Top projekty (A-Z)'),
        projects: top,
      },
      {
        key: 'new',
        label: t(
          'sessions.menu.newest_projects_az',
          'Najnowsze projekty (A-Z)',
        ),
        projects: newest,
      },
      {
        key: 'rest',
        label: t(
          'sessions.menu.remaining_active_az',
          'Pozostałe aktywne (A-Z)',
        ),
        projects: rest,
      },
    ];
  }, [assignProjectListMode, projects, t]);

  const assignProjectsCount = useMemo(
    () =>
      assignProjectSections.reduce(
        (total, section) => total + section.projects.length,
        0,
      ),
    [assignProjectSections],
  );
  const showAssignSectionHeaders = assignProjectListMode !== 'alpha_active';

  const groupedByProject = useMemo(() => {
    const groups = new Map<string, GroupedProject>();
    for (const session of sessions) {
      const projectName = session.project_name ?? t('sessions.menu.unassigned');
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
        ? UNASSIGNED_GROUP_KEY
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
  }, [sessions, t, projectIdByName]);
  const isSessionSplittable = useCallback(
    (session: SessionWithApp): boolean => {
      // Already split sessions must not be split again
      if (isAlreadySplitSession(session)) return false;

      const breakdown =
        aiBreakdowns.get(session.id) ??
        (scoreBreakdown?.sessionId === session.id ? scoreBreakdown.data : null);
      const breakdownSuggestsSplit = isSplittableFromBreakdown(
        breakdown,
        splitSettings.toleranceThreshold,
      );

      const explicit = splitEligibilityBySession.get(session.id);
      if (typeof explicit === 'boolean') return explicit || breakdownSuggestsSplit;

      return breakdownSuggestsSplit;
    },
    [
      splitEligibilityBySession,
      aiBreakdowns,
      scoreBreakdown,
      splitSettings.toleranceThreshold,
    ],
  );

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
      sessions.filter(
        (s) =>
          aiBreakdowns.has(s.id) ||
          s.suggested_project_id != null ||
          s.suggested_confidence != null ||
          s.ai_assigned,
      ).length,
    [sessions, aiBreakdowns],
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
  const selectedSplitAnalysis = multiSplitSession
    ? (splitAnalysisBySession.get(multiSplitSession.id) ?? null)
    : null;
  const selectedSplitAnalysisLoading = multiSplitSession
    ? splitAnalysisLoadingIds.has(multiSplitSession.id)
    : false;
  const sessionsSummaryText = t('sessions.summary', {
    sessions: sessions.length,
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

      {unassignedGroup &&
        (activeProjectId === null || activeProjectId === 'unassigned') && (
          <div className="mx-1 p-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <span className="text-[10px] font-bold text-amber-500">!</span>
            </div>
            <p className="text-[11px] text-amber-200/80 font-medium">
              <span className="text-amber-400 font-bold">
                {t('sessions.banner.unassigned_sessions', {
                  count: unassignedGroup.sessions.length,
                })}
              </span>
              . {t('sessions.banner.hint')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 text-[10px] text-amber-400 hover:bg-amber-500/10"
              onClick={() => setActiveProjectId('unassigned')}
            >
              {t('sessions.banner.filter')}
            </Button>
          </div>
        )}

      {flattenedItems.length > 0 ? (
        <Virtuoso
          customScrollParent={customScrollParent}
          data={flattenedItems}
          itemContent={(_index: number, item: FlatItem) => {
            if (item.type === 'header') {
              const { group, isCompact } = item;
              const projectMenuId = resolveGroupProjectId(group);

              if (isCompact) {
                return (
                  <div className="space-y-1 mt-4 first:mt-0">
                    <div
                      data-project-id={projectMenuId ?? undefined}
                      data-project-name={
                        projectMenuId != null ? group.projectName : undefined
                      }
                      className="flex items-center justify-between gap-4 px-2 py-1 leading-none group/hdr cursor-pointer"
                      onClick={() =>
                        setActiveProjectId(
                          projectMenuId == null ? 'unassigned' : projectMenuId,
                        )
                      }
                      onContextMenu={(e) =>
                        handleProjectContextMenu(
                          e,
                          projectMenuId,
                          group.projectName,
                        )
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.3)]"
                          style={{ backgroundColor: group.projectColor }}
                        />
                        <span className="font-bold text-[13px] text-foreground/90 tracking-tight">
                          {displayProjectName(group.projectName, projectMenuId)}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-4 px-1.5 bg-secondary/40 text-muted-foreground/80 border-none font-medium"
                        >
                          {t('sessions.group.sessions_count', {
                            count: group.sessions.length,
                          })}
                        </Badge>
                        {group.boostedCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400/80 border border-emerald-500/20 font-medium">
                            <CircleDollarSign className="h-3 w-3" />
                            {t('sessions.group.boosted_count', {
                              count: group.boostedCount,
                            })}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[13px] font-bold text-foreground/40 group-hover/hdr:text-foreground/70 transition-colors">
                        {formatDuration(group.totalSeconds)}
                      </span>
                    </div>
                  </div>
                );
              }

              return (
                <div className="mt-4 first:mt-0 relative z-10 px-3 pt-3 border-x border-t border-border/30 rounded-t-xl bg-background/50 backdrop-blur-sm">
                  <div
                    data-project-id={projectMenuId ?? undefined}
                    data-project-name={
                      projectMenuId != null ? group.projectName : undefined
                    }
                    className="flex items-center justify-between gap-2 border-b border-border/5 pb-2"
                    onContextMenu={(e) =>
                      handleProjectContextMenu(
                        e,
                        projectMenuId,
                        group.projectName,
                      )
                    }
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.4)]"
                        style={{ backgroundColor: group.projectColor }}
                      />
                      <span className="font-bold text-lg tracking-tight select-none">
                        {displayProjectName(group.projectName, projectMenuId)}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 border-border/40 text-muted-foreground/60"
                      >
                        {t('sessions.group.sessions_count', {
                          count: group.sessions.length,
                        })}
                      </Badge>
                    </div>
                    <span className="font-mono text-base font-bold text-foreground/70">
                      {formatDuration(group.totalSeconds)}
                    </span>
                  </div>
                </div>
              );
            }

            const {
              session: s,
              isCompact,
              isLastInGroup,
              isFirstInGroup,
              isSplittable,
            } = item;
            const rowViewMode = isCompact
              ? 'compact'
              : viewMode === 'ai_detailed'
                ? 'ai_detailed'
                : 'detailed';

            if (isCompact) {
              return (
                <div className="px-0.5">
                  <SessionRow
                    session={s}
                    dismissedSuggestions={dismissedSuggestions}
                    handleToggleScoreBreakdown={handleToggleScoreBreakdown}
                    scoreBreakdownSessionId={scoreBreakdown?.sessionId ?? null}
                    scoreBreakdownData={
                      scoreBreakdown?.sessionId === s.id && scoreBreakdown
                        ? scoreBreakdown.data
                        : (aiBreakdowns.get(s.id) ?? null)
                    }
                    deleteSession={deleteSessions}
                    handleContextMenu={handleContextMenu}
                    isCompact={true}
                    indicators={indicators}
                    forceShowScoreBreakdown={false}
                    isLoadingScoreBreakdown={loadingBreakdownIds.has(s.id)}
                    onAcceptSuggestion={handleAcceptSuggestion}
                    onRejectSuggestion={handleRejectSuggestion}
                    isSplittable={isSplittable}
                    onSplitClick={openMultiSplitModal}
                    className="!mb-0"
                  />
                  {isLastInGroup && <div className="h-4" />}
                </div>
              );
            }

            return (
              <div
                className={`px-3 bg-background/50 backdrop-blur-sm border-x border-border/30 ${
                  isFirstInGroup ? 'pt-3' : 'pt-0'
                } ${isLastInGroup ? 'rounded-b-xl border-b pb-3 mb-4' : ''}`}
              >
                <div className="h-full">
                  <SessionRow
                    session={s}
                    dismissedSuggestions={dismissedSuggestions}
                    handleToggleScoreBreakdown={handleToggleScoreBreakdown}
                    scoreBreakdownSessionId={scoreBreakdown?.sessionId ?? null}
                    scoreBreakdownData={
                      scoreBreakdown?.sessionId === s.id && scoreBreakdown
                        ? scoreBreakdown.data
                        : (aiBreakdowns.get(s.id) ?? null)
                    }
                    deleteSession={deleteSessions}
                    handleContextMenu={handleContextMenu}
                    indicators={indicators}
                    forceShowScoreBreakdown={rowViewMode === 'ai_detailed'}
                    isLoadingScoreBreakdown={
                      rowViewMode === 'ai_detailed' &&
                      loadingBreakdownIds.has(s.id)
                    }
                    onAcceptSuggestion={handleAcceptSuggestion}
                    onRejectSuggestion={handleRejectSuggestion}
                    isSplittable={isSplittable}
                    onSplitClick={openMultiSplitModal}
                    className="!mb-0"
                  />
                </div>
              </div>
            );
          }}
          components={{
            Footer: () => <div className="h-[300px]" />,
          }}
        />
      ) : null}

      {sessions.length === 0 && (
        <div className="py-24 text-center">
          <p className="text-sm text-muted-foreground/30 font-medium italic">
            {t('sessions.empty.no_activity')}
          </p>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[11px] font-bold text-muted-foreground/50 hover:text-foreground"
            onClick={loadMore}
          >
            {t('sessions.actions.load_older')}
          </Button>
        </div>
      )}

      {/* Context menu for assigning session to a project */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{
            left: ctxMenuPlacement?.left ?? ctxMenu.x,
            top: ctxMenuPlacement?.top ?? ctxMenu.y,
            maxHeight: ctxMenuPlacement?.maxHeight,
          }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            {t('sessions.menu.session_actions', {
              app: ctxMenu.session.app_name,
            })}
          </div>
          {ctxMenu.session.suggested_project_id !== undefined &&
            ctxMenu.session.suggested_project_name &&
            ctxMenu.session.project_name === null && (
              <div className="mx-1 mb-1 rounded-sm bg-sky-500/15 border border-sky-500/25 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-sky-400" />
                  <span className="text-[11px] text-sky-200">
                    {t('sessions.menu.ai_suggests')}{' '}
                    <span className="font-medium">
                      {ctxMenu.session.suggested_project_name}
                    </span>
                    {ctxMenu.session.suggested_confidence !== undefined && (
                      <span className="ml-1 opacity-75">
                        (
                        {(ctxMenu.session.suggested_confidence * 100).toFixed(
                          0,
                        )}
                        %)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  <button
                    className="rounded-sm bg-sky-500/25 hover:bg-sky-500/40 px-2 py-1 text-[11px] text-sky-100 transition-colors cursor-pointer"
                    onClick={() =>
                      void handleAcceptSuggestion(ctxMenu.session, {
                        stopPropagation: () => {},
                      } as React.MouseEvent)
                    }
                  >
                    {t('sessions.menu.accept')}
                  </button>
                  <button
                    className="rounded-sm hover:bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors cursor-pointer"
                    onClick={() =>
                      void handleRejectSuggestion(ctxMenu.session, {
                        stopPropagation: () => {},
                      } as React.MouseEvent)
                    }
                  >
                    {t('sessions.menu.reject')}
                  </button>
                </div>
              </div>
            )}
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t('sessions.menu.rate_multiplier')}{' '}
            <span className="font-mono">
              {formatMultiplierLabel(ctxMenu.session.rate_multiplier)}
            </span>
          </div>
          <div className="flex gap-1.5 px-1.5 pb-1.5">
            <button
              className="flex-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
              onClick={() => void handleSetRateMultiplier(2)}
            >
              {t('sessions.menu.boost_x2')}
            </button>
            <button
              className="flex-1 rounded border border-border bg-secondary/30 py-2 text-xs font-medium transition-colors hover:bg-secondary/60 cursor-pointer"
              onClick={() => void handleCustomRateMultiplier()}
            >
              {t('sessions.menu.custom')}
            </button>
          </div>
          <div className="h-px bg-border my-1" />
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={() => void handleEditComment()}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {ctxMenu.session.comment
                ? t('sessions.menu.edit_comment')
                : t('sessions.menu.add_comment')}
            </span>
          </button>
          {ctxMenuSplitSuggested && (
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => {
                openMultiSplitModal(ctxMenu.session);
              }}
            >
              <span>
                ✂️ {t('sessions.menu.split_session', 'Podziel sesję')}
              </span>
            </button>
          )}
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {t('sessions.menu.assign_to_project')}
          </div>
          <div className="px-2 pb-1.5">
            <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
              <AppTooltip
                content={t(
                  'sessions.menu.mode_alpha',
                  'Aktywne alfabetycznie (A-Z)',
                )}
              >
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'alpha_active'
                      ? 'bg-background text-sky-200 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setAssignProjectListMode('alpha_active');
                    persistAssignProjectListMode('alpha_active');
                  }}
                >
                  <Type className="h-3.5 w-3.5" />
                </button>
              </AppTooltip>
              <AppTooltip
                content={t(
                  'sessions.menu.mode_new_top',
                  'Najnowsze -> Top -> Reszta (A-Z)',
                )}
              >
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'new_top_rest'
                      ? 'bg-background text-amber-300 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setAssignProjectListMode('new_top_rest');
                    persistAssignProjectListMode('new_top_rest');
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </button>
              </AppTooltip>
              <AppTooltip
                content={t(
                  'sessions.menu.mode_top_new',
                  'Top -> Najnowsze -> Reszta (A-Z)',
                )}
              >
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors cursor-pointer ${
                    assignProjectListMode === 'top_new_rest'
                      ? 'bg-background text-orange-300 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    setAssignProjectListMode('top_new_rest');
                    persistAssignProjectListMode('top_new_rest');
                  }}
                >
                  <Flame className="h-3.5 w-3.5" />
                </button>
              </AppTooltip>
            </div>
          </div>
          <div
            className="max-h-[min(42vh,20rem)] overflow-y-auto pr-1"
            style={{ scrollbarGutter: 'stable' }}
          >
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => handleAssign(null, 'manual_session_unassign')}
            >
              <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
              <span className="truncate">{t('sessions.menu.unassigned')}</span>
            </button>
            {assignProjectsCount > 0 ? (
              assignProjectSections.map((section) => (
                <div key={section.key}>
                  {showAssignSectionHeaders && section.projects.length > 0 && (
                    <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                      {section.label}
                    </div>
                  )}
                  {section.projects.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                      onClick={() =>
                        handleAssign(p.id, 'manual_session_change')
                      }
                    >
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('sessions.menu.no_projects')}
              </div>
            )}
          </div>
        </div>
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
        onNavigateToProject={(projectId) => {
          setProjectPageId(projectId);
          setCurrentPage('project-card');
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
            await splitSessionMultiInvoke(multiSplitSession.id, splits);
            setMultiSplitSession(null);
            void triggerRefresh('sessions_multi_split');
          }}
          onCancel={() => setMultiSplitSession(null)}
        />
      )}
    </div>
  );
}
