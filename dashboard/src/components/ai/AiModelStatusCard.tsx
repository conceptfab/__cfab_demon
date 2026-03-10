import { useTranslation } from 'react-i18next';
import { Brain, PlayCircle, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { AssignmentModelStatus } from '@/lib/db-types';
import { formatDateTime } from '@/lib/utils';

interface AiModelStatusCardProps {
  status: AssignmentModelStatus | null;
  training: boolean;
  refreshingStatus: boolean;
  resettingKnowledge: boolean;
  snoozedUntil: Date | null;
  reminderSuppressed: boolean;
  onTrainNow: () => void;
  onRefreshStatus: () => void;
  onResetKnowledge: () => void;
}

export function AiModelStatusCard({
  status,
  training,
  refreshingStatus,
  resettingKnowledge,
  snoozedUntil,
  reminderSuppressed,
  onTrainNow,
  onRefreshStatus,
  onResetKnowledge,
}: AiModelStatusCardProps) {
  const { t: tr } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Brain className="h-4 w-4" />
          {tr('ai_page.text.model_status')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.mode')}
            </p>
            <p className="mt-1 font-medium">{status?.mode ?? '-'}</p>
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
                ? `${status?.last_train_samples} samples / ${status?.last_train_duration_ms ?? 0} ms`
                : tr('ai_page.text.no_data')}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <p className="text-xs text-muted-foreground">
              {tr('ai_page.text.last_auto_safe_run')}
            </p>
            <p className="mt-1 font-medium">
              {status?.last_auto_run_at
                ? `${formatDateTime(status.last_auto_run_at)} (${status.last_auto_assigned_count} assigned)`
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
          <Button
            variant="outline"
            className="h-8"
            onClick={onTrainNow}
            disabled={training || status?.is_training}
          >
            <PlayCircle className="mr-2 h-4 w-4" />
            {training || status?.is_training
              ? tr('ai_page.text.training')
              : tr('ai_page.text.train_now')}
          </Button>
          <Button
            variant="outline"
            className="h-8"
            onClick={onRefreshStatus}
            disabled={refreshingStatus}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshingStatus ? 'animate-spin' : ''}`}
            />
            {refreshingStatus
              ? tr('ai_page.text.refreshing')
              : tr('ai_page.text.refresh_status')}
          </Button>
          <Button
            variant="destructive"
            className="h-8"
            onClick={onResetKnowledge}
            disabled={resettingKnowledge}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {resettingKnowledge
              ? tr('ai_page.text.resetting')
              : tr('ai_page.text.reset_ai_knowledge')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
