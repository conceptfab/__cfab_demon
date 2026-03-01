import { memo } from 'react';
import {
  Sparkles,
  CircleDollarSign,
  Trash2,
  MessageSquare,
  BarChart3,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatDuration } from '@/lib/utils';
import type { SessionWithApp, ScoreBreakdown } from '@/lib/db-types';
import type { SessionIndicatorSettings } from '@/lib/user-settings';

function formatTime(t: string) {
  try {
    return format(parseISO(t), 'HH:mm');
  } catch {
    return t;
  }
}

function formatDate(t: string) {
  try {
    return format(parseISO(t), 'MMM d, yyyy');
  } catch {
    return t;
  }
}

export interface SessionRowProps {
  session: SessionWithApp;
  dismissedSuggestions: Set<number>;
  handleToggleScoreBreakdown: (sessionId: number, e: React.MouseEvent) => void;
  scoreBreakdownSessionId: number | null;
  scoreBreakdownData: ScoreBreakdown | null;
  deleteSession: (id: number) => Promise<void>;
  triggerRefresh: () => void;
  handleContextMenu: (e: React.MouseEvent, s: SessionWithApp) => void;
  isCompact?: boolean;
  indicators: SessionIndicatorSettings;
  forceShowScoreBreakdown?: boolean;
  isLoadingScoreBreakdown?: boolean;
  className?: string;
}

export const SessionRow = memo(function SessionRow({
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
  className = '',
}: SessionRowProps) {
  const isSuggested =
    s.project_name === null &&
    s.suggested_project_id != null &&
    !dismissedSuggestions.has(s.id);

  if (isCompact) {
    return (
      <div
        className={`group relative rounded border border-transparent hover:border-border/30 hover:bg-secondary/10 transition-colors p-1.5 bg-secondary/5 cursor-default mb-0.5 ${className}`}
        onContextMenu={(e) => handleContextMenu(e, s)}
      >
        <div className="grid grid-cols-[140px_1fr] gap-x-3">
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

            <div className="flex items-center gap-2 shrink-0">
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
              {ind.showAiBadge && s.ai_assigned && !isSuggested && (
                <Sparkles className="h-3 w-3 text-violet-400/60 shrink-0" />
              )}
              {ind.showScoreBreakdown &&
                (() => {
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

                  return (
                    <div className="flex items-center gap-1 rounded-sm px-1 py-0.5 transform-gpu">
                      {isLoadingScoreBreakdown ? (
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
              <button
                className="h-4 w-4 shrink-0 flex items-center justify-center rounded-[2px] text-destructive/30 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu cursor-pointer"
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
            ) : !scoreBreakdownData ? (
              <p className="text-[8px] text-muted-foreground/30 italic">
                No AI data
              </p>
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
      className={`group relative rounded-xl border transition-[background-color,border-color] p-4 cursor-default ${className}`}
      onContextMenu={(e) => handleContextMenu(e, s)}
      style={{ backgroundColor: '#1a1b26', borderColor: '#24283b' }}
    >
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
          {ind.showAiBadge && s.ai_assigned && !isSuggested && (
            <Sparkles className="h-3.5 w-3.5 text-violet-400/60 shrink-0" />
          )}
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

              return (
                <button
                  className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 cursor-pointer hover:bg-white/10 !transition-none transform-gpu"
                  onClick={(e) => handleToggleScoreBreakdown(s.id, e)}
                >
                  {isLoadingScoreBreakdown ? (
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
              className="h-5 w-5 shrink-0 flex items-center justify-center rounded-sm text-destructive/40 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu cursor-pointer"
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

      <div className="grid grid-cols-[140px_1fr] gap-x-4 border-t border-border/5 pt-1.5">
        <div className="flex flex-col text-[10px] text-muted-foreground/40 font-medium leading-tight border-r border-border/5 pr-2">
          <p className="text-muted-foreground/60">{formatDate(s.start_time)}</p>
          <p>
            {formatTime(s.start_time)} – {formatTime(s.end_time)}
          </p>
          <div className="mt-1 font-mono text-[11px] font-bold text-foreground/40 leading-none">
            {formatDuration(s.duration_seconds)}
          </div>
        </div>

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
          ) : !scoreBreakdownData ? (
            <p className="text-[11px] text-muted-foreground/30 italic">
              No AI data
            </p>
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
                  <span className="text-right font-mono">
                    {c.layer0_file_score > 0
                      ? c.layer0_file_score.toFixed(2)
                      : '-'}
                  </span>
                  <span className="text-right font-mono">
                    {c.layer1_app_score > 0
                      ? c.layer1_app_score.toFixed(2)
                      : '-'}
                  </span>
                  <span className="text-right font-mono">
                    {c.layer2_time_score > 0
                      ? c.layer2_time_score.toFixed(2)
                      : '-'}
                  </span>
                  <span className="text-right font-mono">
                    {c.layer3_token_score > 0
                      ? c.layer3_token_score.toFixed(2)
                      : '-'}
                  </span>
                  <span className="text-right font-mono font-bold">
                    {c.total_score.toFixed(3)}
                  </span>
                  <span className="text-right font-mono">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
});
