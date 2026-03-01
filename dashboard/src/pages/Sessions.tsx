import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  MessageSquare,
  CircleDollarSign,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getSessions,
  getProjects,
  assignSessionToProject,
  deleteSession,
  updateSessionRateMultiplier,
  updateSessionComment,
  getSessionScoreBreakdown,
} from '@/lib/tauri';
import { PromptModal } from '@/components/ui/prompt-modal';
import { formatDuration } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { Virtuoso } from 'react-virtuoso';
import { SessionRow } from '@/components/sessions/SessionRow';
import type {
  DateRange,
  SessionWithApp,
  ProjectWithStats,
  ScoreBreakdown,
} from '@/lib/db-types';
import {
  loadSessionSettings,
  loadIndicatorSettings,
  type SessionIndicatorSettings,
} from '@/lib/user-settings';

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

interface PromptConfig {
  title: string;
  initialValue: string;
  onConfirm: (val: string) => void;
  description?: string;
}
type RangeMode = 'daily' | 'weekly';

function formatMultiplierLabel(multiplier?: number): string {
  const value =
    typeof multiplier === 'number' &&
    Number.isFinite(multiplier) &&
    multiplier > 0
      ? multiplier
      : 1;
  return Number.isInteger(value)
    ? `x${value.toFixed(0)}`
    : `x${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function Sessions() {
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
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [projectCtxMenu, setProjectCtxMenu] =
    useState<ProjectHeaderMenu | null>(null);
  const [viewMode, setViewMode] = useState<
    'detailed' | 'compact' | 'ai_detailed'
  >('detailed');
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [indicators] = useState<SessionIndicatorSettings>(() =>
    loadIndicatorSettings(),
  );
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    sessionId: number;
    data: ScoreBreakdown;
  } | null>(null);
  const [aiBreakdowns, setAiBreakdowns] = useState<Map<number, ScoreBreakdown>>(
    new Map(),
  );
  const [loadingBreakdownIds, setLoadingBreakdownIds] = useState<Set<number>>(
    new Set(),
  );
  const ctxRef = useRef<HTMLDivElement>(null);
  const projectCtxRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 100;
  const minDuration = useMemo(() => {
    const s = loadSessionSettings();
    return s.minSessionDurationSeconds > 0
      ? s.minSessionDurationSeconds
      : undefined;
  }, [refreshKey]);
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
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

  useEffect(() => {
    getSessions({
      dateRange: effectiveDateRange,
      limit: PAGE_SIZE,
      offset: 0,
      projectId:
        activeProjectId === 'unassigned'
          ? undefined
          : (activeProjectId ?? undefined),
      unassigned: activeProjectId === 'unassigned' ? true : undefined,
      minDuration,
      includeAiSuggestions: true,
    })
      .then((data) => {
        setSessions(data);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  }, [effectiveDateRange, refreshKey, activeProjectId, minDuration]);

  useEffect(() => {
    setDismissedSuggestions(new Set());
  }, [activeDateRange.start, activeDateRange.end]);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, [refreshKey]);

  useEffect(() => {
    if (!indicators.showScoreBreakdown || sessions.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const promises = sessions.map(async (s) => {
        if (cancelled || aiBreakdowns.has(s.id)) return;
        setLoadingBreakdownIds((prev) => {
          const next = new Set(prev);
          next.add(s.id);
          return next;
        });
        try {
          const data = await getSessionScoreBreakdown(s.id);
          if (!cancelled) {
            setAiBreakdowns((prev) => {
              const next = new Map(prev);
              next.set(s.id, data);
              return next;
            });
          }
        } catch (err) {
          if (!cancelled) {
            console.error(
              `Failed to prefetch AI score breakdown for session ${s.id}:`,
              err,
            );
            setAiBreakdowns((prev) => {
              const next = new Map(prev);
              next.set(s.id, {
                candidates: [],
                has_manual_override: false,
                manual_override_project_id: null,
                final_suggestion: null,
              });
              return next;
            });
          }
        } finally {
          if (!cancelled) {
            setLoadingBreakdownIds((prev) => {
              const next = new Set(prev);
              next.delete(s.id);
              return next;
            });
          }
        }
      });
      await Promise.allSettled(promises);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, indicators.showScoreBreakdown]);

  // Auto-refresh sessions every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      getSessions({
        dateRange: effectiveDateRange,
        limit: PAGE_SIZE,
        offset: 0,
        projectId:
          activeProjectId === 'unassigned'
            ? undefined
            : (activeProjectId ?? undefined),
        unassigned: activeProjectId === 'unassigned' ? true : undefined,
        minDuration,
        includeAiSuggestions: true,
      })
        .then((data) => {
          setSessions(data);
          setHasMore(data.length >= PAGE_SIZE);
        })
        .catch(console.error);
    }, 15_000);
    return () => clearInterval(interval);
  }, [effectiveDateRange, activeProjectId, minDuration]);

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
    [],
  );

  const handleProjectContextMenu = useCallback(
    (e: React.MouseEvent, projectId: number | null, projectName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu(null);
      setProjectCtxMenu({ x: e.clientX, y: e.clientY, projectId, projectName });
    },
    [],
  );

  const handleAssign = useCallback(
    async (projectId: number | null, source?: string) => {
      if (!ctxMenu) return;
      try {
        await assignSessionToProject(ctxMenu.session.id, projectId, source);
        triggerRefresh();
      } catch (err) {
        console.error('Failed to assign session to project:', err);
      }
      setCtxMenu(null);
    },
    [ctxMenu, triggerRefresh],
  );

  const ensureCommentForBoost = useCallback(
    async (sessionIds: number[]) => {
      if (sessionIds.length === 0) return true;

      const missingIds = sessionIds.filter((id) => {
        const comment = sessions.find((s) => s.id === id)?.comment;
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
        window.alert('Comment is required to add boost.');
        return false;
      }

      try {
        await Promise.all(
          missingIds.map((id) => updateSessionComment(id, normalized)),
        );
        const missingSet = new Set(missingIds);
        setSessions((prev) =>
          prev.map((s) =>
            missingSet.has(s.id) ? { ...s, comment: normalized } : s,
          ),
        );
        return true;
      } catch (err) {
        console.error('Failed to save required boost comment:', err);
        window.alert(
          `Failed to save comment required for boost: ${String(err)}`,
        );
        return false;
      }
    },
    [sessions],
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (!ctxMenu) return;
      const sessionId = ctxMenu.session.id;
      try {
        if (multiplier != null && multiplier > 1.000_001) {
          const ok = await ensureCommentForBoost([sessionId]);
          if (!ok) return;
        }
        await updateSessionRateMultiplier(sessionId, multiplier);
        triggerRefresh();
        setCtxMenu(null);
      } catch (err) {
        console.error('Failed to update session rate multiplier:', err);
        window.alert(
          `Failed to update session rate multiplier: ${String(err)}`,
        );
      }
    },
    [ctxMenu, ensureCommentForBoost, triggerRefresh],
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu) return;
    const current =
      typeof ctxMenu.session.rate_multiplier === 'number'
        ? ctxMenu.session.rate_multiplier
        : 1;
    const suggested = current > 1 ? current : 2;

    setPromptConfig({
      title: 'Set session rate multiplier',
      description: 'Set multiplier (> 0). Use 1 to reset.',
      initialValue: String(suggested),
      onConfirm: async (raw) => {
        const normalizedRaw = raw.trim().replace(',', '.');
        const parsed = Number(normalizedRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          window.alert('Multiplier must be a positive number.');
          return;
        }
        await handleSetRateMultiplier(parsed);
      },
    });
    setCtxMenu(null);
  }, [ctxMenu, handleSetRateMultiplier]);

  const handleEditComment = useCallback(async () => {
    if (!ctxMenu) return;
    const current = ctxMenu.session.comment ?? '';
    const sessionId = ctxMenu.session.id;

    setPromptConfig({
      title: 'Session comment',
      description: '(leave empty to remove)',
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await updateSessionComment(sessionId, trimmed || null);
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, comment: trimmed || null } : s,
            ),
          );
          triggerRefresh();
        } catch (err) {
          console.error('Failed to update session comment:', err);
        }
      },
    });
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleAcceptSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessionToProject(
          session.id,
          session.suggested_project_id ?? null,
          'ai_suggestion_accept',
        );
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
        triggerRefresh();
      } catch (err) {
        console.error('Failed to accept AI suggestion:', err);
      }
    },
    [triggerRefresh],
  );

  const handleRejectSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessionToProject(session.id, null, 'ai_suggestion_reject');
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.add(session.id);
          return next;
        });
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  suggested_project_id: undefined,
                  suggested_project_name: undefined,
                  suggested_confidence: undefined,
                }
              : item,
          ),
        );
        triggerRefresh();
      } catch (err) {
        console.error('Failed to reject AI suggestion:', err);
      }
    },
    [triggerRefresh],
  );

  const handleToggleScoreBreakdown = useCallback(
    async (sessionId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (scoreBreakdown?.sessionId === sessionId) {
        setScoreBreakdown(null);
        return;
      }
      const cached = aiBreakdowns.get(sessionId);
      if (cached) {
        setScoreBreakdown({ sessionId, data: cached });
        return;
      }
      setLoadingBreakdownIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
      try {
        const data = await getSessionScoreBreakdown(sessionId);
        setAiBreakdowns((prev) => {
          const next = new Map(prev);
          next.set(sessionId, data);
          return next;
        });
        setScoreBreakdown({ sessionId, data });
      } catch (err) {
        console.error('Failed to load score breakdown:', err);
        setAiBreakdowns((prev) => {
          const next = new Map(prev);
          const empty: ScoreBreakdown = {
            candidates: [],
            has_manual_override: false,
            manual_override_project_id: null,
            final_suggestion: null,
          };
          next.set(sessionId, empty);
          return next;
        });
      } finally {
        setLoadingBreakdownIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [aiBreakdowns, scoreBreakdown],
  );

  const loadMore = () => {
    getSessions({
      dateRange: effectiveDateRange,
      limit: PAGE_SIZE,
      offset: sessions.length,
      projectId:
        activeProjectId === 'unassigned'
          ? undefined
          : (activeProjectId ?? undefined),
      unassigned: activeProjectId === 'unassigned' ? true : undefined,
      minDuration,
      includeAiSuggestions: true,
    })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };

  const groupedByProject = useMemo(() => {
    const groups = new Map<string, GroupedProject>();
    for (const session of sessions) {
      const projectName = session.project_name ?? 'Unassigned';
      const projectId = session.project_id;
      const projectColor = session.project_color ?? '#64748b';
      const key = projectName.toLowerCase();
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
        typeof session.project_id === 'number' &&
        session.project_id > 0
      ) {
        group.projectId = session.project_id;
      }
      group.totalSeconds += session.duration_seconds;
      if ((session.rate_multiplier ?? 1) > 1.000_001) group.boostedCount++;
      group.sessions.push(session);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aUnassigned = a.projectName.toLowerCase() === 'unassigned';
      const bUnassigned = b.projectName.toLowerCase() === 'unassigned';
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      return b.totalSeconds - a.totalSeconds;
    });
  }, [sessions]);
  type FlatItem =
    | { type: 'header'; group: GroupedProject; isCompact: boolean }
    | {
        type: 'session';
        session: SessionWithApp;
        group: GroupedProject;
        isCompact: boolean;
        isFirstInGroup: boolean;
        isLastInGroup: boolean;
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
        });
      });
    });
    return list;
  }, [groupedByProject, viewMode]);

  const unassignedGroup = groupedByProject.find(
    (g) => g.projectName.toLowerCase() === 'unassigned',
  );
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
      if (group.projectName.toLowerCase() === 'unassigned') return null;
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

  return (
    <div className="space-y-4">
      {/* Filters & Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground font-medium flex items-baseline gap-1">
          {sessions.length} sessions{' '}
          <span className="opacity-40 text-[10px]">
            ({aiSessionsCount} AI) /
          </span>{' '}
          {groupedByProject.length} projects
          {activeProjectId === 'unassigned' && (
            <span className="text-amber-400/80 ml-2 font-bold select-none">
              UNASSIGNED ONLY
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-secondary/20 p-0.5 rounded border border-border/20">
            <Button
              variant={rangeMode === 'daily' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-[10px] px-3 font-bold"
              onClick={() => {
                setRangeMode('daily');
                setOverrideDateRange(null);
              }}
            >
              Today
            </Button>
            <Button
              variant={rangeMode === 'weekly' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-[10px] px-3 font-bold"
              onClick={() => {
                setRangeMode('weekly');
                setOverrideDateRange(null);
              }}
            >
              Week
            </Button>
          </div>
          <div className="mx-1 h-4 w-px bg-border/40" />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => shiftDateRange(-1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] font-mono font-bold text-muted-foreground/80 min-w-[5rem] text-center">
              {activeDateRange.start === activeDateRange.end
                ? format(parseISO(activeDateRange.start), 'MMM d')
                : `${format(parseISO(activeDateRange.start), 'MMM d')} – ${format(parseISO(activeDateRange.end), 'MMM d')}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => shiftDateRange(1)}
              disabled={!canShiftForward}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="mx-1 h-4 w-px bg-border/40" />
          <div className="flex bg-secondary/30 p-0.5 rounded border border-border/20">
            <button
              onClick={() => setViewMode('ai_detailed')}
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${viewMode === 'ai_detailed' ? 'bg-violet-500/20 text-violet-300 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              AI Data
            </button>
            <button
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${viewMode === 'detailed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Detailed
            </button>
            <button
              onClick={() => setViewMode('compact')}
              className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${viewMode === 'compact' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Compact
            </button>
          </div>
        </div>
      </div>

      {unassignedGroup &&
        (activeProjectId === null || activeProjectId === 'unassigned') && (
          <div className="mx-1 p-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <span className="text-[10px] font-bold text-amber-500">!</span>
            </div>
            <p className="text-[11px] text-amber-200/80 font-medium">
              Found{' '}
              <span className="text-amber-400 font-bold">
                {unassignedGroup.sessions.length} unassigned sessions
              </span>
              . Click <Sparkles className="inline h-3 w-3 mx-0.5" /> to assign
              or use context menu.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 text-[10px] text-amber-400 hover:bg-amber-500/10"
              onClick={() => setActiveProjectId('unassigned')}
            >
              Filter
            </Button>
          </div>
        )}

      {flattenedItems.length > 0 ? (
        <Virtuoso
          useWindowScroll
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
                          group.projectName === 'Unassigned'
                            ? 'unassigned'
                            : projectMenuId,
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
                          {group.projectName}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-4 px-1.5 bg-secondary/40 text-muted-foreground/80 border-none font-medium"
                        >
                          {group.sessions.length} sessions
                        </Badge>
                        {group.boostedCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400/80 border border-emerald-500/20 font-medium">
                            <CircleDollarSign className="h-3 w-3" />
                            {group.boostedCount} boosted
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
                        {group.projectName}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 border-border/40 text-muted-foreground/60"
                      >
                        {group.sessions.length} sessions
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
                    deleteSession={deleteSession}
                    triggerRefresh={triggerRefresh}
                    handleContextMenu={handleContextMenu}
                    isCompact={true}
                    indicators={indicators}
                    forceShowScoreBreakdown={false}
                    isLoadingScoreBreakdown={loadingBreakdownIds.has(s.id)}
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
                } ${isLastInGroup ? 'rounded-b-xl border-b pb-3 mb-4' : 'mb-4'}`}
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
                    deleteSession={deleteSession}
                    triggerRefresh={triggerRefresh}
                    handleContextMenu={handleContextMenu}
                    indicators={indicators}
                    forceShowScoreBreakdown={rowViewMode === 'ai_detailed'}
                    isLoadingScoreBreakdown={
                      rowViewMode === 'ai_detailed' &&
                      loadingBreakdownIds.has(s.id)
                    }
                    className="!mb-0"
                  />
                </div>
              </div>
            );
          }}
        />
      ) : null}

      {sessions.length === 0 && (
        <div className="py-24 text-center">
          <p className="text-sm text-muted-foreground/30 font-medium italic">
            No activity recorded for this period.
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
            Load older sessions...
          </Button>
        </div>
      )}

      {/* Context menu for assigning session to a project */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Session actions ({ctxMenu.session.app_name})
          </div>
          {ctxMenu.session.suggested_project_id !== undefined &&
            ctxMenu.session.suggested_project_name &&
            ctxMenu.session.project_name === null && (
              <div className="mx-1 mb-1 rounded-sm bg-sky-500/15 border border-sky-500/25 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-sky-400" />
                  <span className="text-[11px] text-sky-200">
                    AI suggests:{' '}
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
                    Accept
                  </button>
                  <button
                    className="rounded-sm hover:bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors cursor-pointer"
                    onClick={() =>
                      void handleRejectSuggestion(ctxMenu.session, {
                        stopPropagation: () => {},
                      } as React.MouseEvent)
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            Rate multiplier (default x2):{' '}
            <span className="font-mono">
              {formatMultiplierLabel(ctxMenu.session.rate_multiplier)}
            </span>
          </div>
          <div className="flex gap-1.5 px-1.5 pb-1.5">
            <button
              className="flex-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
              onClick={() => void handleSetRateMultiplier(2)}
            >
              Boost x2
            </button>
            <button
              className="flex-1 rounded border border-border bg-secondary/30 py-2 text-xs font-medium transition-colors hover:bg-secondary/60 cursor-pointer"
              onClick={() => void handleCustomRateMultiplier()}
            >
              Custom...
            </button>
          </div>
          <div className="h-px bg-border my-1" />
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={() => void handleEditComment()}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {ctxMenu.session.comment ? 'Edit comment' : 'Add comment'}
            </span>
          </button>
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            Assign to project
          </div>
          <div className="max-h-[58vh] overflow-y-auto pr-1">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => handleAssign(null, 'manual_session_unassign')}
            >
              <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
              <span className="truncate">Unassigned</span>
            </button>
            {projects.filter((p) => !p.frozen_at).length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No projects available
              </div>
            ) : (
              projects
                .filter((p) => !p.frozen_at)
                .map((p) => (
                  <button
                    key={p.id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    onClick={() => handleAssign(p.id, 'manual_session_change')}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))
            )}
          </div>
        </div>
      )}

      {projectCtxMenu && (
        <div
          ref={projectCtxRef}
          className="fixed z-[130] min-w-[240px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ left: projectCtxMenu.x, top: projectCtxMenu.y }}
        >
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            Project:{' '}
            <span className="font-medium text-foreground">
              {projectCtxMenu.projectName}
            </span>
          </div>
          <button
            type="button"
            disabled={projectCtxMenu.projectId == null}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (projectCtxMenu.projectId == null) return;
              setProjectPageId(projectCtxMenu.projectId);
              setCurrentPage('project-card');
              setProjectCtxMenu(null);
            }}
          >
            {projectCtxMenu.projectId == null
              ? 'No linked project card'
              : 'Go to project card'}
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
      />
    </div>
  );
}
