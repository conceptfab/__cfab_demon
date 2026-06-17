import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

type OnlineSyncStatusPanelProps = Pick<
  OnlineSyncCardProps,
  | 'demoModeSyncDisabled'
  | 'lastSyncLabel'
  | 'localHashShort'
  | 'manualSyncResult'
  | 'manualSyncResultSuccess'
  | 'manualSyncResultText'
  | 'manualSyncing'
  | 'onForceSyncNow'
  | 'onSyncNow'
  | 'onTestRoundtrip'
  | 'pendingAckHashShort'
  | 'shortHash'
  | 'state'
  | 'testRoundtripResult'
  | 'testRoundtripSuccess'
  | 'testingRoundtrip'
>;

export function OnlineSyncStatusPanel({
  demoModeSyncDisabled,
  lastSyncLabel,
  localHashShort,
  manualSyncResult,
  manualSyncResultSuccess,
  manualSyncResultText,
  manualSyncing,
  onForceSyncNow,
  onSyncNow,
  onTestRoundtrip,
  pendingAckHashShort,
  shortHash,
  state,
  testRoundtripResult,
  testRoundtripSuccess,
  testingRoundtrip,
}: OnlineSyncStatusPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t('settings_page.last_sync_status')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8"
            onClick={onSyncNow}
            disabled={manualSyncing || demoModeSyncDisabled}
          >
            {manualSyncing
              ? t('settings_page.syncing')
              : demoModeSyncDisabled
                ? t('settings.online_sync.syncDisabledInDemo')
                : t('settings_page.sync_now')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8"
            onClick={onTestRoundtrip}
            disabled={testingRoundtrip}
          >
            {testingRoundtrip
              ? t('settings_page.testing_roundtrip')
              : t('settings_page.test_roundtrip')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
            onClick={onForceSyncNow}
            disabled={manualSyncing || demoModeSyncDisabled}
          >
            {t('settings_page.force_full_sync')}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('settings_page.last_successful_check_sync')} {lastSyncLabel}
      </p>

      {demoModeSyncDisabled && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
          {t('settings_page.online_sync_is_disabled_while_demo_mode_is_active')}
        </div>
      )}

      {(testRoundtripResult || (manualSyncResult && manualSyncResultText)) && (
        <div className="grid gap-1 rounded-md border border-border/50 bg-background/30 p-2">
          {testRoundtripResult && (
            <div
              className={`text-xs font-mono break-all ${testRoundtripSuccess ? 'text-emerald-400' : 'text-destructive'}`}
            >
              {testRoundtripResult}
            </div>
          )}
          {manualSyncResult && manualSyncResultText && (
            <div
              className={
                manualSyncResultSuccess
                  ? 'text-xs text-emerald-400'
                  : 'text-xs text-destructive'
              }
            >
              {manualSyncResultText}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1 text-xs text-muted-foreground">
        <div>
          {t('settings_page.server_revision')}{' '}
          <span className="font-mono text-foreground">
            {state.serverRevision}
          </span>
        </div>
        <div>
          {t('settings_page.server_hash')}{' '}
          <span className="font-mono text-foreground break-all">{shortHash}</span>
        </div>
        <div>
          {t('settings_page.local_rev_hash')}{' '}
          <span className="font-mono text-foreground">
            {state.localRevision ?? t('ui.common.not_available')} / {localHashShort}
          </span>
        </div>
        {state.pendingAck && (
          <div className="text-amber-500">
            {t('settings_page.pending_ack')}{' '}
            <span className="font-mono text-foreground">
              r{state.pendingAck.revision} / {pendingAckHashShort}
            </span>
            {state.pendingAck.retries > 0 && (
              <>
                {' '}
                ({t('settings_page.retries')}: {state.pendingAck.retries})
              </>
            )}
          </div>
        )}
        {state.needsReseed && (
          <div className="text-amber-500">
            {t(
              'settings_page.server_payload_was_cleaned_up_after_acks_local_reseed_ex',
            )}
          </div>
        )}
      </div>
    </div>
  );
}
