import type { LanPeer, LanSyncSettings, SyncMarker } from '@/lib/lan-sync-types';

export const LAN_SYNC_INTERVAL_OPTIONS = [
  { value: 0, label: 'Manual' },
  { value: 4, label: '4h' },
  { value: 8, label: '8h' },
  { value: 12, label: '12h' },
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
] as const;

export interface LanSyncCardProps {
  settings: LanSyncSettings;
  peers: LanPeer[];
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  lastSyncSuccess: boolean;
  latestMarker: SyncMarker | null;
  title: string;
  description: string;
  enableTitle: string;
  enableDescription: string;
  autoSyncTitle: string;
  autoSyncDescription: string;
  syncIntervalLabel: string;
  syncMarkerLabel: string;
  peersTitle: string;
  noPeersText: string;
  syncButtonLabel: string;
  syncingLabel: string;
  lastSyncLabel: string;
  dashboardRunningLabel: string;
  dashboardOfflineLabel: string;
  fullSyncButtonLabel?: string;
  forceSyncButtonLabel?: string;
  roleLabel: string;
  roleAutoLabel: string;
  roleMasterLabel: string;
  roleSlaveLabel: string;
  manualSearchLabel: string;
  manualSearchPlaceholder: string;
  manualSearchButton: string;
  myIpLabel: string;
  myIp: string;
  labelClassName: string;
  slaveInfoText?: string;
  showLogLabel?: string;
  hideLogLabel?: string;
  noLogEntriesText?: string;
  firewallHintTitle?: string;
  firewallHintDescription?: string;
  forceMergeTooltip?: string;
  pairedDeviceIds?: Set<string>;
  pairingExpiredDeviceIds?: Set<string>;
  pairingCode?: string | null;
  pairingCodeRemaining?: number;
  onGeneratePairingCode?: () => void;
  onPairWithPeer?: (peer: LanPeer, code: string) => Promise<void>;
  onUnpairDevice?: (peer: LanPeer) => void;
  pairingGenerateCodeLabel?: string;
  pairingCodeLabel?: string;
  pairingCodeExpiresLabel?: string;
  pairingCodeExpiredLabel?: string;
  pairingEnterCodeLabel?: string;
  pairingEnterCodeDescriptionLabel?: string;
  pairingSubmitLabel?: string;
  pairingBadgePairedLabel?: string;
  pairingBadgeExpiredLabel?: string;
  pairingUnpairLabel?: string;
  pairingUnpairConfirmLabel?: string;
  pairingRepairLabel?: string;
  pairingPairButtonLabel?: string;
  pairingNotPairedLabel?: string;
  onEnabledChange: (enabled: boolean) => void;
  onAutoSyncChange: (enabled: boolean) => void;
  onSyncIntervalChange: (hours: number) => void;
  onForcedRoleChange: (role: string) => void;
  onManualPing: (ip: string, port: number) => Promise<LanPeer | null>;
  onSyncWithPeer: (peer: LanPeer) => void;
  onFullSyncWithPeer?: (peer: LanPeer) => void;
  onForceSyncWithPeer?: (peer: LanPeer) => void;
}
