import type { MouseEvent } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionWithApp } from '@/lib/db-types';

interface SessionSuggestionBadgeProps {
  session: SessionWithApp;
  variant: 'compact' | 'detailed';
  onAcceptSuggestion?: (session: SessionWithApp, e: MouseEvent) => void;
  onRejectSuggestion?: (session: SessionWithApp, e: MouseEvent) => void;
  onOpenBreakdown?: (sessionId: number, e: MouseEvent) => void;
}

export function SessionSuggestionBadge({
  session,
  variant,
  onAcceptSuggestion,
  onRejectSuggestion,
  onOpenBreakdown,
}: SessionSuggestionBadgeProps) {
  const { t } = useTranslation();

  const projectName = session.suggested_project_name;
  if (!projectName) {
    return null;
  }

  const actions = (
    <div className="flex items-center gap-0.5 ml-1 border-l border-sky-500/20 pl-1.5">
      {onAcceptSuggestion && (
        <button
          title={t('sessions.menu.accept_suggestion')}
          className={`p-0.5 hover:bg-sky-500/20 rounded cursor-pointer text-sky-400 opacity-70 hover:opacity-100 ${
            variant === 'detailed' ? 'text-[10px]' : ''
          }`}
          onClick={(e) => onAcceptSuggestion(session, e)}
        >
          <Check className={variant === 'detailed' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
        </button>
      )}
      {onRejectSuggestion && (
        <button
          title={t('sessions.menu.reject_suggestion')}
          className={`p-0.5 hover:bg-destructive/20 rounded cursor-pointer text-destructive opacity-70 hover:opacity-100 ${
            variant === 'detailed' ? 'text-[10px]' : ''
          }`}
          onClick={(e) => onRejectSuggestion(session, e)}
        >
          <X className={variant === 'detailed' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
        </button>
      )}
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
        <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
        <span
          className="text-[9px] text-sky-300 font-medium truncate max-w-[150px]"
          title={projectName}
        >
          {projectName}
          {session.suggested_confidence != null &&
            ` ${(session.suggested_confidence * 100).toFixed(0)}%`}
        </span>
        {actions}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
      <Sparkles className="h-3 w-3 text-sky-400 shrink-0" />
      {onOpenBreakdown ? (
        <button
          className="text-[9px] text-sky-300 italic font-medium hover:underline cursor-pointer"
          onClick={(e) => onOpenBreakdown(session.id, e)}
        >
          {t('sessions.row.ai_suggestion', {
            project: projectName,
            confidence: ((session.suggested_confidence ?? 0) * 100).toFixed(0),
          })}
        </button>
      ) : (
        <span className="text-[9px] text-sky-300 italic font-medium">
          {t('sessions.row.ai_suggestion', {
            project: projectName,
            confidence: ((session.suggested_confidence ?? 0) * 100).toFixed(0),
          })}
        </span>
      )}
      {actions}
    </div>
  );
}
