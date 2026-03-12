import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScoreBreakdown, SessionWithApp } from '@/lib/db-types';
import { localizeProjectLabel } from '@/lib/project-labels';

interface SessionScoreBadgeProps {
  session: SessionWithApp;
  scoreBreakdownData: ScoreBreakdown | null | undefined;
  isLoading?: boolean;
  variant: 'compact' | 'detailed';
  onToggle?: (sessionId: number, e: MouseEvent) => void;
}

function computeConfidence(
  session: SessionWithApp,
  scoreBreakdownData: ScoreBreakdown | null | undefined,
) {
  const firstCandidate = scoreBreakdownData?.candidates?.[0] ?? null;
  const secondCandidate = scoreBreakdownData?.candidates?.[1] ?? null;
  const isTied =
    firstCandidate != null &&
    secondCandidate != null &&
    firstCandidate.total_score === secondCandidate.total_score;
  const rawTargetName = isTied
    ? `${localizeProjectLabel(firstCandidate!.project_name, { projectId: firstCandidate!.project_id })} / ${localizeProjectLabel(secondCandidate!.project_name, { projectId: secondCandidate!.project_id })}`
    : (session.suggested_project_name ??
      firstCandidate?.project_name ??
      (session.ai_assigned ? session.project_name : null));
  const targetProjectId =
    session.suggested_project_id ??
    firstCandidate?.project_id ??
    (session.ai_assigned ? session.project_id : null);
  const targetName = rawTargetName
    ? localizeProjectLabel(
        rawTargetName,
        {
          projectId: targetProjectId,
        },
      )
    : null;
  const confidence =
    session.suggested_confidence ??
    scoreBreakdownData?.final_suggestion?.confidence ??
    (firstCandidate ? Math.min(firstCandidate.total_score / 10, 1) : null);

  return { targetName, confidence, isTied };
}

function getBarColor(confidence: number | null, isTied: boolean) {
  if (isTied) return '#eab308';
  if (confidence == null) return 'transparent';
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.5) return '#eab308';
  return '#ef4444';
}

export function SessionScoreBadge({
  session,
  scoreBreakdownData,
  isLoading = false,
  variant,
  onToggle,
}: SessionScoreBadgeProps) {
  const { t } = useTranslation();
  const { targetName, confidence, isTied } = computeConfidence(
    session,
    scoreBreakdownData,
  );

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1 rounded-sm px-1 py-0.5 transform-gpu">
        {isLoading ? (
          <span className="text-[8px] text-muted-foreground/40 italic px-1 animate-pulse">
            {t('sessions.row.loading_short')}
          </span>
        ) : targetName ? (
          <span
            className={`text-[8px] font-medium truncate max-w-[180px] ${
              isTied ? 'text-amber-300' : 'text-violet-300'
            }`}
            title={targetName}
          >
            {targetName}
          </span>
        ) : (
          <span className="text-[8px] text-muted-foreground/30 font-medium px-1">
            {t('sessions.row.no_ai_data_short')}
          </span>
        )}
        <div className="w-[32px] h-[6px] rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: confidence != null ? `${Math.max(8, confidence * 100)}%` : '0%',
              backgroundColor: getBarColor(confidence, isTied),
            }}
          />
        </div>
        {confidence != null && (
          <span className="text-[7px] font-mono text-muted-foreground">
            {(confidence * 100).toFixed(0)}
          </span>
        )}
      </div>
    );
  }

  const content = (
    <>
      {isLoading ? (
        <span className="text-[9px] text-muted-foreground/40 italic px-1 animate-pulse">
          {t('sessions.row.loading_short')}
        </span>
      ) : targetName ? (
        <span
          className={`text-[11px] font-medium truncate max-w-[240px] ${
            isTied ? 'text-amber-300' : 'text-violet-300'
          }`}
          title={targetName}
        >
          {targetName}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/30 font-medium px-1">
          {t('sessions.row.no_ai_data_short')}
        </span>
      )}
      <div className="w-[40px] h-[7px] rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: confidence != null ? `${Math.max(8, confidence * 100)}%` : '0%',
            backgroundColor: getBarColor(confidence, isTied),
          }}
        />
      </div>
      {confidence != null && (
        <span className="text-[10px] font-mono text-muted-foreground">
          {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </>
  );

  if (!onToggle) {
    return <div className="flex items-center gap-1.5 rounded-sm px-1 py-0.5">{content}</div>;
  }

  return (
    <button
      className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 cursor-pointer hover:bg-white/10 !transition-none transform-gpu"
      onClick={(e) => onToggle(session.id, e)}
    >
      {content}
    </button>
  );
}
