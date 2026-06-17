import { Wifi } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LanSyncCardController } from '@/hooks/useLanSyncCardController';

import { LanSyncLogPanel } from './LanSyncLogPanel';
import { LanSyncPeerContextMenu } from './LanSyncPeerContextMenu';
import { LanSyncPeersSection } from './LanSyncPeersSection';
import { LanSyncSettingsSection } from './LanSyncSettingsSection';
import type { LanSyncCardProps } from './lan-sync-card-types';

export type LanSyncCardViewProps = LanSyncCardProps & LanSyncCardController;

export function LanSyncCardView(props: LanSyncCardViewProps) {
  const {
    title,
    description,
    ...rest
  } = props;

  return (
    <Card className="relative">
      {/* Sync progress overlay is handled globally by DaemonSyncOverlay */}

      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Wifi className="size-4 text-sky-400" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <LanSyncSettingsSection {...rest} />
        <LanSyncPeersSection {...rest} />
        <LanSyncLogPanel {...rest} />
      </CardContent>

      <LanSyncPeerContextMenu {...rest} />
    </Card>
  );
}
