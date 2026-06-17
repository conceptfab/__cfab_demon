import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PromptModal } from '@/components/ui/prompt-modal';
import type { ApplicationsPageController } from '@/hooks/useApplicationsPageController';
import { mobileLayout } from '@/lib/mobile-layout';
import { ApplicationsMonitoredCard } from '@/pages/applications/ApplicationsMonitoredCard';
import { ApplicationsTrackedAppsCard } from '@/pages/applications/ApplicationsTrackedAppsCard';

interface ApplicationsViewProps {
  controller: ApplicationsPageController;
}

export function ApplicationsView({ controller }: ApplicationsViewProps) {
  const { closePrompt, confirmDialogProps, promptConfig } = controller;

  return (
    <div className={mobileLayout.pageStack}>
      <ApplicationsMonitoredCard {...controller} />
      <ApplicationsTrackedAppsCard {...controller} />
      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => !open && closePrompt()}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
