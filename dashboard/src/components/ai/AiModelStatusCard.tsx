import { useTranslation } from 'react-i18next';
import { Brain, PlayCircle, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AssignmentModelStatus } from '@/lib/db-types';
import { cn, formatDateTime } from '@/lib/utils';

interface AiModelStatusCardProps {
  status: AssignmentModelStatus | null;
  training: boolean;
  refreshingStatus: boolean;
  resettingKnowledge: boolean;
  highlightTrainAction: boolean;
  snoozedUntil: Date | null;
  reminderSuppressed: boolean;
  onTrainNow: () => void;
  onFullRebuild: () => void;
  onRefreshStatus: () => void;
  onResetWeights: () => void;
  onResetFull: () => void;
}

export function AiModelStatusCard({
  status,
  training,
  refreshingStatus,
  resettingKnowledge,
  highlightTrainAction,
  snoozedUntil,
  reminderSuppressed,
  onTrainNow,
  onFullRebuild,
  onRefreshStatus,
  onResetWeights,
  onResetFull,
}: AiModelStatusCardProps) {
  const { t: tr } = useTranslation();
  const trainActionHighlighted =
    highlightTrainAction && !training && !status?.is_training;
  const modeLabel =
    status?.mode === 'off'
      ? tr('ai_page.text.off_manual')
      : status?.mode === 'suggest'
        ? tr('ai_page.text.ai_suggestions')
        : status?.mode === 'auto_safe'
          ? tr('ai_page.text.auto_safe')
          : tr('ui.common.not_available');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Brain className="size-4" />
          {tr('ai_page.text.model_status')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.mode')}
            </p>
            <p className="mt-1 font-medium">{modeLabel}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.training_state')}
            </p>
            <p className="mt-1 font-medium">
              {status?.is_training
                ? tr('ai_page.text.in_progress')
                : tr('ai_page.text.idle')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.last_training')}
            </p>
            <p className="mt-1 font-medium">
              {formatDateTime(status?.last_train_at) || tr('ai_page.text.never')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.corrections_since_last_training')}
            </p>
            <p className="mt-1 font-medium">{status?.feedback_since_train ?? 0}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.last_training_metrics')}
            </p>
            <p className="mt-1 font-medium">
              {(status?.last_train_samples ?? 0) > 0
                ? tr('ai_page.text.training_metrics_summary', {
                    sampleCount: status?.last_train_samples ?? 0,
                    durationMs: status?.last_train_duration_ms ?? 0,
                  })
                : tr('ai_page.text.no_data')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.last_auto_safe_run')}
            </p>
            <p className="mt-1 font-medium">
              {status?.last_auto_run_at
                ? tr('ai_page.text.last_auto_safe_run_summary', {
                    date: formatDateTime(status.last_auto_run_at),
                    assigned: status.last_auto_assigned_count,
                  })
                : tr('ai_page.text.never')}
            </p>
          </div>
        </div>

        {status?.train_error_last && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {tr('ai_page.text.last_training_error')} {status.train_error_last}
          </div>
        )}

        {snoozedUntil && reminderSuppressed && (
          <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
            {tr('ai_page.text.training_reminder_snoozed_until')}{' '}
            {formatDateTime(snoozedUntil)}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {trainActionHighlighted && (
            <Badge
              variant="outline"
              className="h-5 border-amber-400/45 bg-amber-500/12 text-amber-100 shadow-[0_0_12px_rgba(245,158,11,0.18)]"
            >
              {tr('layout.status.new_data')}
            </Badge>
          )}
          <Button
            variant="outline"
            className={cn(
              'h-8',
              trainActionHighlighted &&
                'border-amber-400/60 bg-amber-500/14 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.32),0_0_20px_rgba(245,158,11,0.16)] hover:border-amber-300/80 hover:bg-amber-500/20 hover:text-amber-50',
            )}
            onClick={onTrainNow}
            disabled={training || status?.is_training}
          >
            <PlayCircle className="mr-2 size-4" />
            {training || status?.is_training
              ? tr('ai_page.text.training')
              : tr('ai_page.text.train_now')}
          </Button>
          <Button
            variant="outline"
            className="h-8"
            onClick={onFullRebuild}
            disabled={training || status?.is_training}
          >
            <RotateCcw className="mr-2 size-4" />
            {tr('ai_page.text.full_rebuild')}
          </Button>
          <Button
            variant="outline"
            className="h-8"
            onClick={onRefreshStatus}
            disabled={refreshingStatus}
          >
            <RefreshCw
              className={`mr-2 size-4 ${refreshingStatus ? 'animate-spin' : ''}`}
            />
            {refreshingStatus
              ? tr('ai_page.text.refreshing')
              : tr('ai_page.text.refresh_status')}
          </Button>
          <Button
            variant="outline"
            className="h-8"
            onClick={onResetWeights}
            disabled={resettingKnowledge}
          >
            <Trash2 className="mr-2 size-4" />
            {resettingKnowledge
              ? tr('ai_page.text.resetting')
              : tr('ai_page.text.reset_ai_weights')}
          </Button>
          <Button
            variant="destructive"
            className="h-8"
            onClick={onResetFull}
            disabled={resettingKnowledge}
          >
            <Trash2 className="mr-2 size-4" />
            {resettingKnowledge
              ? tr('ai_page.text.resetting')
              : tr('ai_page.text.reset_ai_full')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
