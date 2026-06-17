import { PlayCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AiPageController } from '@/hooks/useAiPageController';
import { AI_REMINDER_SNOOZE_HOURS } from '@/pages/ai/ai-page-constants';

type AiTrainingReminderCardProps = Pick<
  AiPageController,
  | 'handleSnoozeReminder'
  | 'handleTrainNow'
  | 'snoozingReminder'
  | 'status'
  | 'training'
  | 'trainingReminder'
  | 'tr'
>;

export function AiTrainingReminderCard({
  handleSnoozeReminder,
  handleTrainNow,
  snoozingReminder,
  status,
  training,
  trainingReminder,
  tr,
}: AiTrainingReminderCardProps) {
  if (!trainingReminder.shouldShow || !trainingReminder.reason) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-amber-100">
          {tr('ai_page.text.time_for_model_training')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-amber-100/90">{trainingReminder.reason}</p>
        <p className="text-xs text-amber-100/80">
          {tr('ai_page.text.estimated_cost_light_training_usually_under_10_s')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-8"
            onClick={() => {
              void handleTrainNow();
            }}
            disabled={training || status?.is_training}
          >
            <PlayCircle className="mr-2 size-4" />
            {training || status?.is_training
              ? tr('ai_page.text.training')
              : tr('ai_page.text.train_now')}
          </Button>
          <Button
            variant="outline"
            className="h-8 border-amber-500/60 text-amber-100 hover:bg-amber-500/15"
            onClick={handleSnoozeReminder}
            disabled={snoozingReminder}
          >
            {snoozingReminder
              ? tr('ai_page.text.saving')
              : tr('ai_page.text.remind_me_later_h', {
                  hours: AI_REMINDER_SNOOZE_HOURS,
                })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
