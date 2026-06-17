import { useLanSyncCardController } from '@/hooks/useLanSyncCardController';

import { LanSyncCardView } from './lan-sync/LanSyncCardView';
import type { LanSyncCardProps } from './lan-sync/lan-sync-card-types';

export type { LanSyncCardProps } from './lan-sync/lan-sync-card-types';

export function LanSyncCard(props: LanSyncCardProps) {
  const controller = useLanSyncCardController(props);
  return <LanSyncCardView {...props} {...controller} />;
}
