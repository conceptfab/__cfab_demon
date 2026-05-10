import { memo, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  CircleDollarSign,
  Trash2,
  MessageSquare,
  BarChart3,
  Scissors,
  GitBranch,
  CalendarPlus,
} from 'lucide-react';
import {
  formatDuration,
  logTauriError,
  formatSessionDate,
  formatSessionTime,
} from '@/lib/utils';
import type { SessionWithApp, ScoreBreakdown } from '@/lib/db-types';
import type { SessionIndicatorSettings } from '@/lib/user-settings';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import { SessionScoreBadge } from '@/components/sessions/SessionScoreBadge';
import { SessionSuggestionBadge } from '@/components/sessions/SessionSuggestionBadge';

export interface SessionRowProps {
  session: SessionWithApp;
  dismissedSuggestions: Set<number>;
  handleToggleScoreBreakdown: (sessionId: number, e: React.MouseEvent) => void;
  scoreBreakdownSessionId: number | null;
  scoreBreakdownData: ScoreBreakdown | null;
  deleteSession: (id: number) => Promise<void>;
  handleContextMenu: (e: React.MouseEvent, s: SessionWithApp) => void;
  isCompact?: boolean;
  indicators: SessionIndicatorSettings;
  forceShowScoreBreakdown?: boolean;
  isLoadingScoreBreakdown?: boolean;
  onAcceptSuggestion?: (s: SessionWithApp, e: React.MouseEvent) => void;
  onRejectSuggestion?: (s: SessionWithApp, e: React.MouseEvent) => void;
  isSplittable?: boolean;
  onSplitClick?: (s: SessionWithApp) => void;
  className?: string;
}

function renderScoreBreakdownCandidates(
  scoreBreakdownData: ScoreBreakdown,
  variant: 'compact' | 'detailed',
  t: TFunction,
): ReactNode {
  const topScore = scoreBreakdownData.candidates[0]?.total_score;

  if (variant === 'compact') {
    return scoreBreakdownData.candidates.slice(0, 3).map((candidate) => (
      <div
        key={candidate.project_id}
        className={`flex items-center gap-2 text-[8px] ${
          candidate.total_score === topScore
            ? 'text-sky-300/80 font-medium'
            : 'text-muted-foreground/40'
        }`}
      >
        <span className="truncate max-w-[100px]">{candidate.project_name}</span>
        <span className="font-mono">{candidate.total_score.toFixed(2)}</span>
        <span className="text-muted-foreground/20">
          ({t('sessions.row.evidence_short', { count: candidate.evidence_count })})
        </span>
      </div>
    ));
  }

  return scoreBreakdownData.candidates
    .slice(0, 5)
    .map((candidate, index) => {
      const isTopTwo = index === 0 || index === 1;
      return (
        <div
          key={candidate.project_id}
          className={`grid grid-cols-[1fr_repeat(5,46px)_60px_40px] gap-1 text-[11px] items-center ${
            candidate.total_score === topScore
              ? 'text-sky-300/80 font-medium'
              : 'text-muted-foreground/40'
          }`}
        >
          <span className="truncate">{candidate.project_name}</span>
          <span className="text-right font-mono">
            {candidate.layer0_file_score > 0
              ? candidate.layer0_file_score.toFixed(2)
              : '-'}
          </span>
          <span className="text-right font-mono">
            {candidate.layer1_app_score > 0
              ? candidate.layer1_app_score.toFixed(2)
              : '-'}
          </span>
          <span className="text-right font-mono">
            {candidate.layer2_time_score > 0
              ? candidate.layer2_time_score.toFixed(2)
              : '-'}
          </span>
          <span className="text-right font-mono">
            {candidate.layer3_token_score > 0
              ? candidate.layer3_token_score.toFixed(2)
              : '-'}
          </span>
          <span className="text-right font-mono">
            {candidate.layer3b_folder_score > 0
              ? candidate.layer3b_folder_score.toFixed(2)
              : '-'}
          </span>
          <span
            className={`text-right font-mono font-bold ${
              isTopTwo ? 'text-sky-400 bg-sky-900/20 px-1 rounded' : ''
            }`}
          >
            {candidate.total_score.toFixed(3)}
          </span>
          <span className="text-right font-mono">
            {t('sessions.row.evidence_short', {
              count: candidate.evidence_count,
            })}
          </span>
        </div>
      );
    });
}

export const SessionRow = memo(function SessionRow({
  session: s,
  dismissedSuggestions,
  handleToggleScoreBreakdown,
  scoreBreakdownSessionId,
  scoreBreakdownData,
  deleteSession,
  handleContextMenu,
  isCompact,
  indicators: ind,
  forceShowScoreBreakdown,
  isLoadingScoreBreakdown,
  onAcceptSuggestion,
  onRejectSuggestion,
  isSplittable,
  onSplitClick,
  className = '',
}: SessionRowProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const splitBadgeTitle = t(
    'sessions.split_badge',
    'Split session — cannot be split again',
  );
  const isManual = 'isManual' in s && (s as SessionWithApp & { isManual?: boolean }).isManual === true;
  const isSuggested =
    !isManual &&
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
              {isManual ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-400/80">
                  <CalendarPlus className="size-3 shrink-0" />
                  <span className="truncate max-w-[70px]">{s.comment || s.app_name}</span>
                </span>
              ) : (
                <span
                  className="font-bold text-[11px] text-foreground/80 truncate max-w-[80px]"
                  title={s.app_name}
                >
                  {s.app_name}
                </span>
              )}
              {!isManual && (s.rate_multiplier ?? 1) > 1.000_001 && (
                <CircleDollarSign className="size-3 text-emerald-400/80 fill-emerald-500/5 shrink-0" />
              )}
              {typeof s.split_source_session_id === 'number' && (
                <span className="inline-flex shrink-0 ml-0.5" title={splitBadgeTitle}>
                  <GitBranch
                    aria-hidden="true"
                    className="size-3 text-sky-400/60 shrink-0"
                  />
                </span>
              )}
              {isSplittable && onSplitClick && (
                <button
                  type="button"
                  className="inline-flex size-4 items-center justify-center rounded text-amber-400 hover:text-amber-300 cursor-pointer ml-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSplitClick(s);
                  }}
                  title={t(
                    'sessions.menu.split_suggestion',
                  )}
                >
                  <Scissors className="size-3.5 shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                </button>
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
                  {t('sessions.row.idle')}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {ind.showSuggestions && isSuggested && (
                <SessionSuggestionBadge
                  session={s}
                  variant="compact"
                  onAcceptSuggestion={onAcceptSuggestion}
                  onRejectSuggestion={onRejectSuggestion}
                />
              )}
              {ind.showAiBadge && s.ai_assigned && !isSuggested && (
                <Sparkles className="size-3 text-violet-400/60 shrink-0" />
              )}
              {ind.showScoreBreakdown && (
                <SessionScoreBadge
                  session={s}
                  scoreBreakdownData={scoreBreakdownData}
                  isLoading={isLoadingScoreBreakdown}
                  variant="compact"
                />
              )}
              <button
                type="button"
                className="size-4 shrink-0 flex items-center justify-center rounded-[2px] text-destructive/30 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu cursor-pointer"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await deleteSession(s.id);
                  } catch (error) {
                    logTauriError('delete session', error);
                  }
                }}
              >
                <Trash2 className="size-2.5" />
              </button>
            </div>
          </div>
        </div>
        {(scoreBreakdownSessionId === s.id || forceShowScoreBreakdown) && (
          <div className="mt-1 border-t border-border/10 pt-1">
            <div className="text-[8px] text-muted-foreground/60 font-medium mb-0.5 flex items-center gap-1">
              <BarChart3 className="size-2" />
              {t('sessions.row.ai_score_breakdown')}
              {scoreBreakdownData?.has_manual_override && (
                <span className="text-amber-400/70 ml-1">
                  {t('sessions.row.manual_override')}
                </span>
              )}
            </div>
            {isLoadingScoreBreakdown ? (
              <div className="text-[8px] text-muted-foreground/30 italic px-1 animate-pulse">
                {t('sessions.row.loading_ai_data')}
              </div>
            ) : !scoreBreakdownData ? (
              <p className="text-[8px] text-muted-foreground/30 italic">
                {t('sessions.row.no_ai_data')}
              </p>
            ) : scoreBreakdownData?.candidates.length === 0 ? (
              <p className="text-[8px] text-muted-foreground/30 italic">
                {t('sessions.row.no_candidates')}
              </p>
            ) : (
              <div className="space-y-0.5">
                {renderScoreBreakdownCandidates(scoreBreakdownData, 'compact', t)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group relative rounded-xl border border-border/40 bg-card transition-[background-color,border-color] p-4 cursor-default ${className}`}
      onContextMenu={(e) => handleContextMenu(e, s)}
    >
      <div className="flex items-center justify-between mb-1.5 h-6">
        <div className="flex items-center gap-2 min-w-0">
          {isManual ? (
            <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-400/90">
              <CalendarPlus className="size-4 shrink-0" />
              <span className="truncate max-w-[180px]">{s.comment || s.app_name}</span>
            </span>
          ) : (
            <span
              className="font-bold text-[14px] text-foreground/90 truncate max-w-[200px]"
              title={s.app_name}
            >
              {s.app_name}
            </span>
          )}
          {!isManual && (s.rate_multiplier ?? 1) > 1.000_001 && (
            <CircleDollarSign className="size-4 text-emerald-400 fill-emerald-500/10 shrink-0" />
          )}
          {!isManual && ind.showAiBadge && s.ai_assigned && !isSuggested && (
            <Sparkles className="size-3.5 text-violet-400/60 shrink-0" />
          )}
          {typeof s.split_source_session_id === 'number' && (
            <span className="inline-flex shrink-0" title={splitBadgeTitle}>
              <GitBranch
                aria-hidden="true"
                className="size-3.5 text-sky-400/60 shrink-0"
              />
            </span>
          )}
          {isSplittable && onSplitClick && (
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded text-amber-400 hover:text-amber-300 cursor-pointer ml-1"
              onClick={(e) => {
                e.stopPropagation();
                onSplitClick(s);
              }}
              title={t(
                'sessions.menu.split_suggestion',
              )}
            >
              <Scissors className="size-4 shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
            </button>
          )}
          {ind.showScoreBreakdown && (
            <SessionScoreBadge
              session={s}
              scoreBreakdownData={scoreBreakdownData}
              isLoading={isLoadingScoreBreakdown}
              variant="detailed"
              onToggle={handleToggleScoreBreakdown}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          {ind.showSuggestions && isSuggested && (
            <SessionSuggestionBadge
              session={s}
              variant="detailed"
              onAcceptSuggestion={onAcceptSuggestion}
              onRejectSuggestion={onRejectSuggestion}
              onOpenBreakdown={handleToggleScoreBreakdown}
            />
          )}
          <div className="flex items-center">
            <button
              type="button"
              className="size-5 shrink-0 flex items-center justify-center rounded-sm text-destructive/40 hover:text-destructive hover:bg-destructive/10 !transition-none transform-gpu cursor-pointer"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await deleteSession(s.id);
                } catch (error) {
                  logTauriError('delete session', error);
                }
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-x-4 border-t border-border/5 pt-1.5">
        <div className="flex flex-col text-[10px] text-muted-foreground/40 font-medium leading-tight border-r border-border/5 pr-2">
          <p className="text-muted-foreground/60">
            {formatSessionDate(s.start_time, locale)}
          </p>
          <p>
            {formatSessionTime(s.start_time)} - {formatSessionTime(s.end_time)}
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
                {t('sessions.row.no_traceable_activity')}
              </span>
            )}
          </div>

          {s.comment && (
            <div className="mt-1.5 flex items-start gap-1 text-amber-500/50 italic border-t border-border/5 pt-1">
              <MessageSquare className="size-2.5 mt-0.5 shrink-0" />
              <p className="text-[10px] line-clamp-1">{s.comment}</p>
            </div>
          )}
        </div>
      </div>

      {(scoreBreakdownSessionId === s.id || forceShowScoreBreakdown) && (
        <div className="mt-2 border-t border-border/10 pt-2">
          <div className="text-[11px] text-muted-foreground/60 font-medium mb-1 flex items-center gap-1">
            <BarChart3 className="size-3" />
            {t('sessions.row.ai_score_breakdown')}
            {scoreBreakdownData?.has_manual_override && (
              <span className="text-amber-400/70 ml-1">
                {t('sessions.row.manual_override_active')}
              </span>
            )}
          </div>
          {isLoadingScoreBreakdown ? (
            <div className="text-[11px] text-muted-foreground/30 italic px-1 animate-pulse">
              {t('sessions.row.loading_ai_data')}
            </div>
          ) : !scoreBreakdownData ? (
            <p className="text-[11px] text-muted-foreground/30 italic">
              {t('sessions.row.no_ai_data')}
            </p>
          ) : scoreBreakdownData?.candidates.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/30 italic">
              {t('sessions.row.no_candidates_found')}
            </p>
          ) : (
            <div className="space-y-0.5">
              {renderScoreBreakdownCandidates(scoreBreakdownData, 'detailed', t)}
              {scoreBreakdownData?.final_suggestion && (
                <div className="flex gap-4 text-[11px] text-muted-foreground/30 mt-1 pt-1 border-t border-border/5">
                  <span>
                    {t('sessions.row.final_confidence')}{' '}
                    <span className="text-violet-400/60 font-mono">
                      {(
                        scoreBreakdownData.final_suggestion.confidence * 100
                      ).toFixed(0)}
                      %
                    </span>
                  </span>
                  <span>
                    {t('sessions.row.margin')}{' '}
                    <span className="text-violet-400/60 font-mono">
                      {scoreBreakdownData.final_suggestion.margin.toFixed(3)}
                    </span>
                  </span>
                  <span>
                    {t('sessions.row.total_evidence')}{' '}
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

