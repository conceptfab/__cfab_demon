import { useDaemonControlController } from '@/hooks/useDaemonControlController';
import { DaemonControlView } from '@/pages/daemon-control/DaemonControlView';

export function DaemonControl() {
  const controller = useDaemonControlController();
  return <DaemonControlView controller={controller} />;
}
