import { useClientsPageController } from '@/hooks/useClientsPageController';
import { ClientsView } from '@/pages/clients/ClientsView';

export function Clients() {
  const controller = useClientsPageController();
  return <ClientsView controller={controller} />;
}
