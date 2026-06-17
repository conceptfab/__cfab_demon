import type {
  LicenseInfo,
  OnlineSyncRunResult,
  OnlineSyncSettings,
  OnlineSyncState,
} from '@/lib/online-sync';

export interface OnlineSyncCardProps {
  settings: OnlineSyncSettings;
  state: OnlineSyncState;
  manualSyncResult: OnlineSyncRunResult | null;
  manualSyncResultText: string | null;
  manualSyncResultSuccess: boolean;
  manualSyncing: boolean;
  demoModeSyncDisabled: boolean;
  showToken: boolean;
  licenseInfo: LicenseInfo | null;
  licenseKeyInput: string;
  licenseActivating: boolean;
  licenseError: string | null;
  defaultServerUrl: string;
  labelClassName: string;
  lastSyncLabel: string;
  shortHash: string;
  localHashShort: string;
  pendingAckHashShort: string;
  onEnabledChange: (enabled: boolean) => void;
  onAutoSyncOnStartupChange: (enabled: boolean) => void;
  onAutoSyncIntervalChange: (minutes: number) => void;
  onEnableLoggingChange: (enabled: boolean) => void;
  onServerUrlChange: (url: string) => void;
  onResetServerUrl: () => void;
  onUserIdChange: (userId: string) => void;
  onApiTokenChange: (token: string) => void;
  onShowTokenChange: (show: boolean) => void;
  onSyncNow: () => void;
  onLicenseKeyChange: (key: string) => void;
  onActivateLicense: () => void;
  onDeactivateLicense: () => void;
  testingRoundtrip: boolean;
  testRoundtripResult: string | null;
  testRoundtripSuccess: boolean;
  onTestRoundtrip: () => void;
  onForceSyncNow: () => void;
}
