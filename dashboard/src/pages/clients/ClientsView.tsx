import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ClientsPageController } from '@/hooks/useClientsPageController';
import { mobileLayout } from '@/lib/mobile-layout';
import { ClientsAssignSection } from '@/pages/clients/ClientsAssignSection';
import { ClientsManageSection } from '@/pages/clients/ClientsManageSection';
import { ClientsSummarySection } from '@/pages/clients/ClientsSummarySection';

interface ClientsViewProps {
  controller: ClientsPageController;
}

export function ClientsView({ controller }: ClientsViewProps) {
  const { dialogProps } = controller;

  return (
    <div className={`${mobileLayout.pageContainer} max-w-5xl`}>
      <ClientsSummarySection {...controller} />
      <ClientsManageSection {...controller} />
      <ClientsAssignSection {...controller} />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
