import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  Sparkles,
  MessageSquare,
  CircleDollarSign,
  BarChart3,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAppStore } from '@/store/app-store';
import { addDays, format, parseISO, subDays } from 'date-fns';
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
    refreshKey,
    triggerRefresh,
    sessionsFocusDate,
    clearSessionsFocusDate,
    sessionsFocusRange,
    setSessionsFocusRange,
    sessionsFocusProject,
    setSessionsFocusProject,
    setProjectPageId,
    setCurrentPage,
  } = useAppStore();
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

  /**
   * Helper component for session rows to maintain consistency
   */
  const renderSessionRow = ({
    key,
    session: s,
    dismissedSuggestions,
    handleToggleScoreBreakdown,
    scoreBreakdownSessionId,
    scoreBreakdownData,
    deleteSession,
    triggerRefresh,
    handleContextMenu,
    isCompact,
    indicators: ind,
    forceShowScoreBreakdown,
    isLoadingScoreBreakdown,
  }: {
    key?: string | number;
    session: SessionWithApp;
    dismissedSuggestions: Set<number>;
    handleToggleScoreBreakdown: (
      sessionId: number,
      e: React.MouseEvent,
    ) => void;
    scoreBreakdownSessionId: number | null;
    scoreBreakdownData: ScoreBreakdown | null;
    deleteSession: (id: number) => Promise<void>;
    triggerRefresh: () => void;
    handleContextMenu: (e: React.MouseEvent, s: SessionWithApp) => void;
    isCompact?: boolean;
    indicators: SessionIndicatorSettings;
    forceShowScoreBreakdown?: boolean;
    isLoadingScoreBreakdown?: boolean;
  }) => {
    const isSuggested =
      s.project_name === null &&
      s.suggested_project_id != null &&
      !dismissedSuggestions.has(s.id);

    if (isCompact) {
      return (
        <div
          key={key}
          className="group relative rounded border border-transparent hover:border-border/30 hover:bg-secondary/10 transition-colors p-1.5 bg-secondary/5 cursor-default mb-0.5"
          onContextMenu={(e) => handleContextMenu(e, s)}
        >
          <div className="grid grid-cols-[140px_1fr] gap-x-3">
            {/* Left Column - Mini */}
            <div className="flex border-r border-border/5 pr-2 items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="font-bold text-[11px] text-foreground/80 truncate max-w-[80px]"
                  title={s.app_name}
                >
                  {s.app_name}
                </span>
                {(s.rate_multiplier ?? 1) > 1.000_001 && (
                  <CircleDollarSign className="h-3 w-3 text-emerald-400/80 fill-emerald-500/5 shrink-0" />
                )}
              </div>
              <span className="font-mono text-[10px] font-bold text-foreground/30">
                {formatDuration(s.duration_seconds)}
              </span>
            </div>

            {/* Right Column - Flat Content */}
            <div className="flex items-center justify-between min-w-0">
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 content-center overflow-hidden h-4">
                {s.files.length > 0 ? (
                  s.files.slice(0, 5).map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-0.5 text-[9px] leading-none opacity-40"
                    >
                      <span className="truncate max-w-[120px]">
                        {f.file_name}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[9px] text-muted-foreground/10 italic">
                    idle
                  </span>
                )}
              </div>

              {/* AI/Action shortcuts in compact view */}
              <div className="flex items-center gap-2 shrink-0">
                {/* AI suggestion badge (no thumbs - reassigning = negative training signal) */}
                {ind.showSuggestions && isSuggested && (
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                    <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
                    <span className="text-[9px] text-sky-300 font-medium truncate max-w-[80px]">
                      {s.suggested_project_name}
                      {s.suggested_confidence != null &&
                        ` ${(s.suggested_confidence * 100).toFixed(0)}%`}
                    </span>
                  </div>
                )}
                {/* AI assigned indicator */}
                {ind.showAiBadge && s.ai_assigned && !isSuggested && (
                  <Sparkles className="h-3 w-3 text-violet-400/60 shrink-0" />
                )}
                {/* Score bar - shows AI target project + confidence */}
                {ind.showScoreBreakdown &&
                  (() => {
                    // Determine AI target project name and confidence
                    const bdCandidate =
                      scoreBreakdownData?.candidates?.[0] ?? null;
                    const bdConf =
                      scoreBreakdownData?.final_suggestion?.confidence ?? null;

                    const targetName =
                      s.suggested_project_name ??
                      bdCandidate?.project_name ??
                      (s.ai_assigned ? s.project_name : null);
                    const conf =
                      s.suggested_confidence ??
                      bdConf ??
                      (bdCandidate
                        ? Math.min(bdCandidate.total_score / 10, 1)
                        : null);

                    const isLoadingData =
                      scoreBreakdownData === null && !aiBreakdowns.has(s.id);

                    return (
                      <div className="flex items-center gap-1 rounded-sm px-1 py-0.5 transform-gpu">
                        {isLoadingData ? (
                          <span className="text-[8px] text-muted-foreground/40 italic px-1 animate-pulse">
                            loading...
                          </span>
                        ) : targetName ? (
                          <span className="text-[8px] text-violet-300 font-medium truncate max-w-[70px]">
                            {targetName}
                          </span>
                        ) : (
                          <span className="text-[8px] text-muted-foreground/30 font-medium px-1">
                            no ai data
                          </span>
                        )}
                        <div className="w-[32px] h-[6px] rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width:
                                conf != null
                                  ? `${Math.max(8, conf * 100)}%`
                                  : '0%',
                              backgroundColor:
                                conf != null
                                  ? conf >= 0.8
                                    ? '#22c55e'
                                    : conf >= 0.5
                                      ? '#eab308'
                                      : '#ef4444'
                                  : 'transparent',
                            }}
                          />
                        </div>
                        {conf != null && (
                          <span className="text-[7px] font-mono text-muted-foreground">
                            {(conf * 100).toFixed(0)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                {/* Delete */}
                <button
                  className="h-4 w-4 shrink-0 flex items-center justify-center rounded-[2px] text-destructive/30 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await deleteSession(s.id);
                      triggerRefresh();
                    } catch {}
                  }}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          </div>
          {/* Score Breakdown Panel (compact) */}
          {(scoreBreakdownSessionId === s.id || forceShowScoreBreakdown) && (
            <div className="mt-1 border-t border-border/10 pt-1">
              <div className="text-[8px] text-muted-foreground/60 font-medium mb-0.5 flex items-center gap-1">
                <BarChart3 className="h-2 w-2" />
                AI Score Breakdown
                {scoreBreakdownData?.has_manual_override && (
                  <span className="text-amber-400/70 ml-1">
                    (manual override)
                  </span>
                )}
              </div>
              {isLoadingScoreBreakdown ? (
                <div className="text-[8px] text-muted-foreground/30 italic px-1 animate-pulse">
                  Loading AI data...
                </div>
              ) : scoreBreakdownData?.candidates.length === 0 ? (
                <p className="text-[8px] text-muted-foreground/30 italic">
                  No candidates
                </p>
              ) : (
                <div className="space-y-0.5">
                  {scoreBreakdownData?.candidates.slice(0, 3).map((c, i) => (
                    <div
                      key={c.project_id}
                      className={`flex items-center gap-2 text-[8px] ${
                        i === 0
                          ? 'text-sky-300/80 font-medium'
                          : 'text-muted-foreground/40'
                      }`}
                    >
                      <span className="truncate max-w-[100px]">
                        {c.project_name}
                      </span>
                      <span className="font-mono">
                        {c.total_score.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground/20">
                        ({c.evidence_count} ev)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={key}
        className="group relative rounded-xl border transition-[background-color,border-color] p-4 cursor-default mb-4"
        onContextMenu={(e) => handleContextMenu(e, s)}
        style={{ backgroundColor: '#1a1b26', borderColor: '#24283b' }}
      >
        {/* ROW 1: APP NAME & AI ACTIONS ONLY - STRICTLY NO DATA HERE */}
        <div className="flex items-center justify-between mb-1.5 h-6">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="font-bold text-[14px] text-foreground/90 truncate max-w-[200px]"
              title={s.app_name}
            >
              {s.app_name}
            </span>
            {(s.rate_multiplier ?? 1) > 1.000_001 && (
              <CircleDollarSign className="h-4 w-4 text-emerald-400 fill-emerald-500/10 shrink-0" />
            )}
            {/* AI assigned indicator (no thumbs - reassigning = negative training signal) */}
            {ind.showAiBadge && s.ai_assigned && !isSuggested && (
              <Sparkles className="h-3.5 w-3.5 text-violet-400/60 shrink-0" />
            )}
            {/* Score bar - shows AI target project + confidence */}
            {ind.showScoreBreakdown &&
              (() => {
                const bdCandidate = scoreBreakdownData?.candidates?.[0] ?? null;
                const bdConf =
                  scoreBreakdownData?.final_suggestion?.confidence ?? null;

                const targetName =
                  s.suggested_project_name ??
                  bdCandidate?.project_name ??
                  (s.ai_assigned ? s.project_name : null);
                const conf =
                  s.suggested_confidence ??
                  bdConf ??
                  (bdCandidate
                    ? Math.min(bdCandidate.total_score / 10, 1)
                    : null);

                const isLoadingData =
                  scoreBreakdownData === null && !aiBreakdowns.has(s.id);

                return (
                  <button
                    className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 cursor-pointer hover:bg-white/10 !transition-none transform-gpu"
                    onClick={(e) => handleToggleScoreBreakdown(s.id, e)}
                  >
                    {isLoadingData ? (
                      <span className="text-[9px] text-muted-foreground/40 italic px-1 animate-pulse">
                        loading...
                      </span>
                    ) : targetName ? (
                      <span className="text-[11px] text-violet-300 font-medium truncate max-w-[100px]">
                        {targetName}
                      </span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/30 font-medium px-1">
                        no ai data
                      </span>
                    )}
                    <div className="w-[40px] h-[7px] rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width:
                            conf != null ? `${Math.max(8, conf * 100)}%` : '0%',
                          backgroundColor:
                            conf != null
                              ? conf >= 0.8
                                ? '#22c55e'
                                : conf >= 0.5
                                  ? '#eab308'
                                  : '#ef4444'
                              : 'transparent',
                        }}
                      />
                    </div>
                    {conf != null && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                  </button>
                );
              })()}
          </div>

          <div className="flex items-center gap-3">
            {ind.showSuggestions && isSuggested && (
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
                <span className="text-[9px] text-sky-300 italic font-medium">
                  AI: {s.suggested_project_name} (
                  {((s.suggested_confidence ?? 0) * 100).toFixed(0)}%)
                </span>
              </div>
            )}

            <div className="flex items-center">
              <button
                className="h-5 w-5 shrink-0 flex items-center justify-center rounded-sm text-destructive/40 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await deleteSession(s.id);
                    triggerRefresh();
                  } catch {}
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* ROW 2: DATA SECTION (TIME & FILES) - STARTING BELOW THE METADATA ROW */}
        <div className="grid grid-cols-[140px_1fr] gap-x-4 border-t border-border/5 pt-1.5">
          {/* Time & Date Column */}
          <div className="flex flex-col text-[10px] text-muted-foreground/40 font-medium leading-tight border-r border-border/5 pr-2">
            <p className="text-muted-foreground/60">
              {formatDate(s.start_time)}
            </p>
            <p>
              {formatTime(s.start_time)} – {formatTime(s.end_time)}
            </p>
            <div className="mt-1 font-mono text-[11px] font-bold text-foreground/40 leading-none">
              {formatDuration(s.duration_seconds)}
            </div>
          </div>

          {/* Activity Column */}
          <div className="flex flex-col min-w-0">
            <div className="flex flex-wrap gap-x-3 gap-y-1 content-start overflow-hidden">
              {s.files.length > 0 ? (
                s.files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 text-[10px] leading-tight"
                  >
                    {f.project_name && f.project_name !== s.project_name && (
                      <span
                        className="font-bold opacity-80"
                        style={{ color: f.project_color || undefined }}
                      >
                        {f.project_name}:
                      </span>
                    )}
                    <span className="text-muted-foreground/70 truncate max-w-xs">
                      {f.file_name}
                    </span>
                    <span className="text-muted-foreground/20 font-mono text-[9px]">
                      {formatDuration(f.total_seconds)}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground/10 italic">
                  No traceable activity
                </span>
              )}
            </div>

            {s.comment && (
              <div className="mt-1.5 flex items-start gap-1 text-amber-500/50 italic border-t border-border/5 pt-1">
                <MessageSquare className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                <p className="text-[10px] line-clamp-1">{s.comment}</p>
              </div>
            )}
          </div>
        </div>

        {/* Score Breakdown Panel */}
        {(scoreBreakdownSessionId === s.id || forceShowScoreBreakdown) && (
          <div className="mt-2 border-t border-border/10 pt-2">
            <div className="text-[11px] text-muted-foreground/60 font-medium mb-1 flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              AI Score Breakdown
              {scoreBreakdownData?.has_manual_override && (
                <span className="text-amber-400/70 ml-1">
                  (manual override active)
                </span>
              )}
            </div>
            {isLoadingScoreBreakdown ? (
              <div className="text-[11px] text-muted-foreground/30 italic px-1 animate-pulse">
                Loading AI data...
              </div>
            ) : scoreBreakdownData?.candidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/30 italic">
                No candidates found
              </p>
            ) : (
              <div className="space-y-0.5">
                {scoreBreakdownData?.candidates.slice(0, 5).map((c, i) => (
                  <div
                    key={c.project_id}
                    className={`grid grid-cols-[1fr_repeat(4,50px)_60px_40px] gap-1 text-[11px] items-center ${
                      i === 0
                        ? 'text-sky-300/80 font-medium'
                        : 'text-muted-foreground/40'
                    }`}
                  >
                    <span className="truncate">{c.project_name}</span>
                    <span
                      className="text-right font-mono"
                      title="File activity (L0)"
                    >
                      {c.layer0_file_score > 0
                        ? c.layer0_file_score.toFixed(2)
                        : '-'}
                    </span>
                    <span
                      className="text-right font-mono"
                      title="App history (L1)"
                    >
                      {c.layer1_app_score > 0
                        ? c.layer1_app_score.toFixed(2)
                        : '-'}
                    </span>
                    <span
                      className="text-right font-mono"
                      title="Time pattern (L2)"
                    >
                      {c.layer2_time_score > 0
                        ? c.layer2_time_score.toFixed(2)
                        : '-'}
                    </span>
                    <span
                      className="text-right font-mono"
                      title="Token match (L3)"
                    >
                      {c.layer3_token_score > 0
                        ? c.layer3_token_score.toFixed(2)
                        : '-'}
                    </span>
                    <span
                      className="text-right font-mono font-bold"
                      title="Total score"
                    >
                      {c.total_score.toFixed(3)}
                    </span>
                    <span
                      className="text-right font-mono"
                      title="Evidence layers"
                    >
                      {c.evidence_count}ev
                    </span>
                  </div>
                ))}
                {scoreBreakdownData?.final_suggestion && (
                  <div className="flex gap-4 text-[11px] text-muted-foreground/30 mt-1 pt-1 border-t border-border/5">
                    <span>
                      final confidence:{' '}
                      <span className="text-violet-400/60 font-mono">
                        {(
                          scoreBreakdownData.final_suggestion.confidence * 100
                        ).toFixed(0)}
                        %
                      </span>
                    </span>
                    <span>
                      margin:{' '}
                      <span className="text-violet-400/60 font-mono">
                        {scoreBreakdownData.final_suggestion.margin.toFixed(3)}
                      </span>
                    </span>
                    <span>
                      total evidence:{' '}
                      <span className="text-violet-400/60 font-mono">
                        {scoreBreakdownData.final_suggestion.evidence_count}
                      </span>
                    </span>
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground/20 mt-1 flex gap-3">
                  <span>L0=file</span>
                  <span>L1=app</span>
                  <span>L2=time</span>
                  <span>L3=token</span>
                  {scoreBreakdownData?.final_suggestion && (
                    <span className="text-sky-400/50">
                      conf=
                      {(
                        scoreBreakdownData.final_suggestion.confidence * 100
                      ).toFixed(0)}
                      % margin=
                      {scoreBreakdownData.final_suggestion.margin.toFixed(3)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
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
      try {
        const data = await getSessionScoreBreakdown(sessionId);
        setScoreBreakdown({ sessionId, data });
      } catch (err) {
        console.error('Failed to load score breakdown:', err);
      }
    },
    [scoreBreakdown],
  );

  // Auto-load score breakdowns for all sessions
  useEffect(() => {
    if (sessions.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const promises = sessions.map(async (s) => {
        if (cancelled || aiBreakdowns.has(s.id)) return;
        try {
          const data = await getSessionScoreBreakdown(s.id);
          if (!cancelled) {
            setAiBreakdowns((prev) => {
              const next = new Map(prev);
              next.set(s.id, data);
              return next;
            });
          }
        } catch {
          if (!cancelled) {
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
        }
      });
      await Promise.allSettled(promises);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

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
    })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };

  const formatTime = (t: string) => {
    try {
      return format(parseISO(t), 'HH:mm');
    } catch {
      return t;
    }
  };
  const formatDate = (t: string) => {
    try {
      return format(parseISO(t), 'MMM d, yyyy');
    } catch {
      return t;
    }
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
  const unassignedGroup = groupedByProject.find(
    (g) => g.projectName.toLowerCase() === 'unassigned',
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
            ({aiBreakdowns.size} AI) /
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

      {viewMode === 'compact' ? (
        <div className="space-y-6">
          {groupedByProject.map((group) => {
            const projectMenuId = resolveGroupProjectId(group);
            return (
              <div key={group.projectName} className="space-y-1">
                {/* Project Header - Exactly as in screenshot 125 */}
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
                <div className="space-y-0.5 px-0.5">
                  {group.sessions.map((s) =>
                    renderSessionRow({
                      key: s.id,
                      session: s,
                      dismissedSuggestions,
                      handleToggleScoreBreakdown,
                      scoreBreakdownSessionId:
                        scoreBreakdown?.sessionId ?? null,
                      scoreBreakdownData:
                        scoreBreakdown?.sessionId === s.id
                          ? scoreBreakdown.data
                          : (aiBreakdowns.get(s.id) ?? null),
                      deleteSession,
                      triggerRefresh,
                      handleContextMenu,
                      isCompact: true,
                      indicators,
                      forceShowScoreBreakdown: false,
                      isLoadingScoreBreakdown: false,
                    }),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByProject.map((group) => {
            const projectMenuId = resolveGroupProjectId(group);
            return (
              <Card
                key={group.projectName}
                className="border-border/30 overflow-hidden bg-background/50 backdrop-blur-sm"
              >
                <CardContent className="p-3 space-y-3">
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
                  <div className="space-y-1">
                    {group.sessions.map((s) =>
                      renderSessionRow({
                        key: s.id,
                        session: s,
                        dismissedSuggestions,
                        handleToggleScoreBreakdown,
                        scoreBreakdownSessionId:
                          scoreBreakdown?.sessionId ?? null,
                        scoreBreakdownData:
                          scoreBreakdown?.sessionId === s.id
                            ? scoreBreakdown.data
                            : (aiBreakdowns.get(s.id) ?? null),
                        deleteSession,
                        triggerRefresh,
                        handleContextMenu,
                        indicators,
                        forceShowScoreBreakdown: viewMode === 'ai_detailed',
                        isLoadingScoreBreakdown:
                          viewMode === 'ai_detailed' && !aiBreakdowns.has(s.id),
                      }),
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
