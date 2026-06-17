import type { DaemonControlController } from '@/hooks/useDaemonControlController';
import { mobileLayout } from '@/lib/mobile-layout';
import { DaemonAutostartCard } from '@/pages/daemon-control/DaemonAutostartCard';
import { DaemonLogsCard } from '@/pages/daemon-control/DaemonLogsCard';
import { DaemonStatusCard } from '@/pages/daemon-control/DaemonStatusCard';

interface DaemonControlViewProps {
  controller: DaemonControlController;
}

export function DaemonControlView({ controller }: DaemonControlViewProps) {
  return (
    <div className={mobileLayout.pageStack}>
      <div className="grid gap-2 sm:gap-4 md:grid-cols-2">
        <DaemonStatusCard {...controller} />
        <DaemonAutostartCard {...controller} />
      </div>
      <DaemonLogsCard {...controller} />
    </div>
  );
}
