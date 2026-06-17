import { LanSyncCard } from '@/components/settings/LanSyncCard';
import { OnlineSyncCard } from '@/components/settings/OnlineSyncCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsSyncTabProps = SettingsPageController;

export function SettingsSyncTab(controller: SettingsSyncTabProps) {
  const {
    defaultOnlineSyncServerUrl,
    demoModeSyncDisabled,
    handleActivateLicense,
    handleDeactivateLicense,
    handleForceSyncNow,
    handleGeneratePairingCode,
    handleLanSync,
    handleManualPing,
    handlePairWithPeer,
    handleSyncNow,
    handleTestRoundtrip,
    handleUnpairDevice,
    labelClassName,
    lanPeers,
    lanSettings,
    lanSyncing,
    lanSyncResult,
    lastSyncAt,
    lastSyncLabel,
    latestMarker,
    licenseActivating,
    licenseError,
    licenseInfo,
    licenseKeyInput,
    localHashShort,
    manualSyncResult,
    manualSyncResultSuccess,
    manualSyncResultText,
    manualSyncing,
    myIp,
    onlineSyncSettings,
    onlineSyncState,
    pairedDeviceIds,
    pairingCode,
    pairingCodeRemaining,
    pairingExpiredDeviceIds,
    pendingAckHashShort,
    setLicenseKeyInput,
    setShowOnlineSyncToken,
    shortHash,
    showOnlineSyncToken,
    t,
    testRoundtripResult,
    testRoundtripSuccess,
    testingRoundtrip,
    updateLanSettings,
    updateOnlineSyncSettings,
  } = controller;

  return (
    <div className="space-y-4">
      <OnlineSyncCard
        settings={onlineSyncSettings}
        state={onlineSyncState}
        manualSyncResult={manualSyncResult}
        manualSyncResultText={manualSyncResultText}
        manualSyncResultSuccess={manualSyncResultSuccess}
        manualSyncing={manualSyncing}
        demoModeSyncDisabled={demoModeSyncDisabled}
        showToken={showOnlineSyncToken}
        defaultServerUrl={defaultOnlineSyncServerUrl}
        labelClassName={labelClassName}
        lastSyncLabel={lastSyncLabel}
        shortHash={shortHash}
        localHashShort={localHashShort}
        pendingAckHashShort={pendingAckHashShort}
        onEnabledChange={(enabled) => {
          updateOnlineSyncSettings((prev) => ({ ...prev, enabled }));
        }}
        onAutoSyncOnStartupChange={(enabled) => {
          updateOnlineSyncSettings((prev) => ({
            ...prev,
            autoSyncOnStartup: enabled,
          }));
        }}
        onAutoSyncIntervalChange={(minutes) => {
          updateOnlineSyncSettings((prev) => ({
            ...prev,
            autoSyncIntervalMinutes: minutes,
          }));
        }}
        onEnableLoggingChange={(enabled) => {
          updateOnlineSyncSettings((prev) => ({
            ...prev,
            enableLogging: enabled,
          }));
        }}
        onServerUrlChange={(serverUrl) => {
          updateOnlineSyncSettings((prev) => ({ ...prev, serverUrl }));
        }}
        onResetServerUrl={() => {
          updateOnlineSyncSettings((prev) => ({
            ...prev,
            serverUrl: defaultOnlineSyncServerUrl,
          }));
        }}
        onUserIdChange={(userId) => {
          updateOnlineSyncSettings((prev) => ({ ...prev, userId }));
        }}
        onApiTokenChange={(apiToken) => {
          updateOnlineSyncSettings((prev) => ({ ...prev, apiToken }));
        }}
        onShowTokenChange={setShowOnlineSyncToken}
        onSyncNow={() => {
          void handleSyncNow(demoModeSyncDisabled);
        }}
        licenseInfo={licenseInfo}
        licenseKeyInput={licenseKeyInput}
        licenseActivating={licenseActivating}
        licenseError={licenseError}
        onLicenseKeyChange={setLicenseKeyInput}
        onActivateLicense={handleActivateLicense}
        onDeactivateLicense={handleDeactivateLicense}
        testingRoundtrip={testingRoundtrip}
        testRoundtripResult={testRoundtripResult}
        testRoundtripSuccess={testRoundtripSuccess}
        onTestRoundtrip={handleTestRoundtrip}
        onForceSyncNow={() => {
          void handleForceSyncNow(demoModeSyncDisabled);
        }}
      />

      <LanSyncCard
        settings={lanSettings}
        peers={lanPeers}
        syncing={lanSyncing}
        lastSyncAt={lastSyncAt}
        lastSyncResult={lanSyncResult?.text ?? null}
        lastSyncSuccess={lanSyncResult?.success ?? false}
        latestMarker={latestMarker}
        title={t('settings.lan_sync.title')}
        description={t('settings.lan_sync.description')}
        enableTitle={t('settings.lan_sync.enable_title')}
        enableDescription={t('settings.lan_sync.enable_description')}
        autoSyncTitle={t('settings.lan_sync.auto_sync_title')}
        autoSyncDescription={t('settings.lan_sync.auto_sync_description')}
        syncIntervalLabel={t('settings.lan_sync.sync_interval')}
        syncMarkerLabel={t('settings.lan_sync.sync_marker')}
        peersTitle={t('settings.lan_sync.peers_title')}
        noPeersText={t('settings.lan_sync.no_peers')}
        syncButtonLabel={t('settings.lan_sync.sync_button')}
        syncingLabel={t('settings.lan_sync.syncing')}
        lastSyncLabel={t('settings.lan_sync.last_sync')}
        dashboardRunningLabel={t('settings.lan_sync.dashboard_running')}
        dashboardOfflineLabel={t('settings.lan_sync.dashboard_offline')}
        roleLabel={t('settings.lan_sync.role_label')}
        roleAutoLabel={t('settings.lan_sync.role_auto')}
        roleMasterLabel={t('settings.lan_sync.role_master')}
        roleSlaveLabel={t('settings.lan_sync.role_slave')}
        manualSearchLabel={t('settings.lan_sync.my_ip_label')}
        manualSearchPlaceholder={t('settings.lan_sync.manual_search_placeholder')}
        manualSearchButton={t('settings.lan_sync.manual_search_button')}
        myIpLabel={t('settings.lan_sync.my_ip_label')}
        myIp={myIp}
        onManualPing={handleManualPing}
        labelClassName={labelClassName}
        onEnabledChange={(enabled) => {
          updateLanSettings((prev) => ({ ...prev, enabled }));
        }}
        onAutoSyncChange={(autoSyncOnPeerFound) => {
          updateLanSettings((prev) => ({ ...prev, autoSyncOnPeerFound }));
        }}
        onSyncIntervalChange={(syncIntervalHours) => {
          updateLanSettings((prev) => ({ ...prev, syncIntervalHours }));
        }}
        onForcedRoleChange={(forcedRole) => {
          updateLanSettings((prev) => ({ ...prev, forcedRole }));
        }}
        onSyncWithPeer={(peer) => {
          void handleLanSync(peer);
        }}
        onFullSyncWithPeer={(peer) => {
          void handleLanSync(peer, true);
        }}
        onForceSyncWithPeer={(peer) => {
          void handleLanSync(peer, true, true);
        }}
        fullSyncButtonLabel={t('settings.lan_sync.full_sync')}
        forceSyncButtonLabel={t('settings.lan_sync.force_sync')}
        slaveInfoText={t('settings.lan_sync.slave_info')}
        showLogLabel={t('settings.lan_sync.show_log')}
        hideLogLabel={t('settings.lan_sync.hide_log')}
        noLogEntriesText={t('settings.lan_sync.no_log_entries')}
        firewallHintTitle={t('settings.lan_sync.firewall_hint_title')}
        firewallHintDescription={t('settings.lan_sync.firewall_hint_description')}
        forceMergeTooltip={t('settings.lan_sync.force_merge_tooltip')}
        pairedDeviceIds={pairedDeviceIds}
        pairingExpiredDeviceIds={pairingExpiredDeviceIds}
        pairingCode={pairingCode}
        pairingCodeRemaining={pairingCodeRemaining}
        onGeneratePairingCode={() => void handleGeneratePairingCode()}
        onPairWithPeer={handlePairWithPeer}
        onUnpairDevice={(peer) => void handleUnpairDevice(peer)}
        pairingGenerateCodeLabel={t('settings.lan_sync.pairing_generate_code')}
        pairingCodeLabel={t('settings.lan_sync.pairing_code_label')}
        pairingCodeExpiresLabel={t('settings.lan_sync.pairing_code_expires')}
        pairingCodeExpiredLabel={t('settings.lan_sync.pairing_code_expired')}
        pairingEnterCodeLabel={t('settings.lan_sync.pairing_enter_code')}
        pairingEnterCodeDescriptionLabel={t(
          'settings.lan_sync.pairing_enter_code_description',
        )}
        pairingSubmitLabel={t('settings.lan_sync.pairing_submit')}
        pairingBadgePairedLabel={t('settings.lan_sync.pairing_badge_paired')}
        pairingBadgeExpiredLabel={t('settings.lan_sync.pairing_badge_expired')}
        pairingUnpairLabel={t('settings.lan_sync.pairing_unpair')}
        pairingUnpairConfirmLabel={t('settings.lan_sync.pairing_unpair_confirm')}
        pairingRepairLabel={t('settings.lan_sync.pairing_repair')}
        pairingPairButtonLabel={t('settings.lan_sync.pairing_pair_button')}
        pairingNotPairedLabel={t('settings.lan_sync.pairing_not_paired')}
      />
    </div>
  );
}
