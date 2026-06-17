import type { MouseEvent } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionWithApp } from '@/lib/db-types';
import { localizeProjectLabel } from '@/lib/project-labels';

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

  const rawProjectName = session.suggested_project_name?.trim() ?? '';
  if (!rawProjectName) {
    return null;
  }
  const projectName = localizeProjectLabel(rawProjectName, {
    projectId: session.suggested_project_id ?? null,
  });

  const actions = (
    <div className="ml-1 flex items-center gap-1 border-l border-sky-500/20 pl-1.5 md:gap-0.5">
      {onAcceptSuggestion && (
        <button type="button"
          title={t('sessions.menu.accept_suggestion')}
          className={`inline-flex size-7 items-center justify-center rounded text-sky-400 opacity-70 hover:bg-sky-500/20 hover:opacity-100 cursor-pointer md:size-auto md:p-0.5 ${
            variant === 'detailed' ? 'text-[10px]' : ''
          }`}
          onClick={(e) => onAcceptSuggestion(session, e)}
        >
          <Check className={variant === 'detailed' ? 'size-4 md:size-3.5' : 'size-4 md:size-3'} />
        </button>
      )}
      {onRejectSuggestion && (
        <button type="button"
          title={t('sessions.menu.reject_suggestion')}
          className={`inline-flex size-7 items-center justify-center rounded text-destructive opacity-70 hover:bg-destructive/20 hover:opacity-100 cursor-pointer md:size-auto md:p-0.5 ${
            variant === 'detailed' ? 'text-[10px]' : ''
          }`}
          onClick={(e) => onRejectSuggestion(session, e)}
        >
          <X className={variant === 'detailed' ? 'size-4 md:size-3.5' : 'size-4 md:size-3'} />
        </button>
      )}
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className="flex min-h-8 items-center gap-1.5 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 md:min-h-0">
        <Sparkles className="size-3 text-sky-400 shrink-0" />
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
    <div className="flex min-h-8 items-center gap-1.5 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 md:min-h-0">
      <Sparkles className="size-3 text-sky-400 shrink-0" />
      {onOpenBreakdown ? (
        <button type="button"
          className="min-h-7 text-left text-[9px] font-medium italic text-sky-300 hover:underline cursor-pointer md:min-h-0"
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
