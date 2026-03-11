import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { type AppLanguageCode } from '@/lib/user-settings';
import { DEFAULT_ONLINE_SYNC_SERVER_URL } from '@/lib/online-sync';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ProjectFreezeCard } from '@/components/settings/ProjectFreezeCard';
import { DemoModeCard } from '@/components/settings/DemoModeCard';
import { DangerZoneCard } from '@/components/settings/DangerZoneCard';
import { WorkingHoursCard } from '@/components/settings/WorkingHoursCard';
import { CurrencyCard } from '@/components/settings/CurrencyCard';
import { LanguageCard } from '@/components/settings/LanguageCard';
import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { SessionManagementCard } from '@/components/settings/SessionManagementCard';
import { SessionSplitCard } from '@/components/settings/SessionSplitCard';
import { OnlineSyncCard } from '@/components/settings/OnlineSyncCard';
import { useSettingsFormState } from '@/hooks/useSettingsFormState';
import { useSettingsDemoMode } from '@/hooks/useSettingsDemoMode';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0'),
);

export function Settings() {
  const { i18n, t } = useTranslation();
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setCurrencyCode = useSettingsStore((s) => s.setCurrencyCode);
  const setChartAnimations = useSettingsStore((s) => s.setChartAnimations);
  const setPageChangeGuard = useUIStore((s) => s.setPageChangeGuard);

  const {
    clearing,
    clearArmed,
    sessionSettings,
    onlineSyncSettings,
    freezeSettings,
    currencySettings,
    languageSettings,
    appearanceSettings,
    splitSettings,
    workingHoursError,
    savedSettings,
    rebuilding,
    manualSyncing,
    manualSyncResult,
    manualSyncResultText,
    manualSyncResultSuccess,
    onlineSyncState,
    showOnlineSyncToken,
    startHour,
    startMinute,
    endHour,
    endMinute,
    sliderValue,
    normalizedColor,
    lastSyncLabel,
    shortHash,
    localHashShort,
    pendingAckHashShort,
    splitToleranceDescription,
    setClearArmed,
    setShowOnlineSyncToken,
    updateTimePart,
    updateWorkingHours,
    updateSessionSettings,
    updateOnlineSyncSettings,
    updateFreezeSettings,
    updateCurrencySettings,
    updateLanguageSettings,
    updateAppearanceSettings,
    updateSplitSetting,
    handleSaveSettings,
    handleRebuildSessions,
    handleClearData,
    handleSyncNow,
    resetManualSyncResult,
  } = useSettingsFormState({
    confirm,
    i18n,
    t,
    showInfo,
    showError,
    triggerRefresh,
    setCurrencyCode,
    setChartAnimations,
    setPageChangeGuard,
  });

  const {
    demoModeStatus,
    demoModeLoading,
    demoModeSwitching,
    demoModeError,
    handleToggleDemoMode,
  } = useSettingsDemoMode({
    t,
    showInfo,
    showError,
    onEnabledChange: () => {
      resetManualSyncResult();
    },
  });

  const labelClassName = 'text-sm font-medium text-muted-foreground';
  const compactSelectClassName =
    'h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

  const languageOptions: Array<{ code: AppLanguageCode; label: string }> = [
    { code: 'pl', label: t('settings.language.option.pl') },
    { code: 'en', label: t('settings.language.option.en') },
  ];

  const currencyOptions = useMemo(
    () => [
      { code: 'PLN', symbol: 'zł' },
      { code: 'USD', symbol: '$' },
      { code: 'EUR', symbol: '€' },
    ],
    [],
  );

  const demoModeSyncDisabled = demoModeStatus?.enabled === true;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-20">
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1">
          {t('settings_page.general_settings')}
        </h2>

        <WorkingHoursCard
          title={t('settings_page.working_hours')}
          description={t('settings_page.used_to_highlight_expected_work_window_on_timeline')}
          fromLabel={t('settings_page.from')}
          toLabel={t('settings_page.to')}
          highlightColorLabel={t('settings_page.highlight_color')}
          labelClassName={labelClassName}
          compactSelectClassName={compactSelectClassName}
          hours={HOURS}
          minutes={MINUTES}
          startHour={startHour}
          startMinute={startMinute}
          endHour={endHour}
          endMinute={endMinute}
          normalizedColor={normalizedColor}
          errorText={workingHoursError}
          onTimePartChange={updateTimePart}
          onColorChange={(color) => {
            updateWorkingHours((prev) => ({ ...prev, color }));
          }}
        />

        <CurrencyCard
          title={t('settings_page.currency')}
          description={t('settings_page.select_preferred_currency_for_project_values')}
          activeCurrencyLabel={t('settings_page.active_currency')}
          labelClassName={labelClassName}
          currencies={currencyOptions}
          selectedCode={currencySettings.code}
          onSelectCurrency={(code) => {
            updateCurrencySettings({ code });
          }}
        />

        <LanguageCard
          title={t('settings.language.title')}
          description={t('settings.language.description')}
          fieldLabel={t('settings.language.field')}
          rolloutNote={t('settings.language.rollout_note')}
          labelClassName={labelClassName}
          options={languageOptions}
          selectedCode={languageSettings.code}
          onSelectLanguage={(code) => {
            updateLanguageSettings({ code: code as AppLanguageCode });
          }}
        />

        <AppearanceCard
          title={t('settings_page.appearance_performance')}
          description={t('settings_page.adjust_visual_effects_and_performance_options')}
          animationsTitle={t('settings_page.enable_chart_animations')}
          animationsDescription={t('settings_page.turn_off_to_improve_ui_responsiveness_on_slower_devices')}
          checked={appearanceSettings.chartAnimations}
          onToggle={(enabled) => {
            updateAppearanceSettings((prev) => ({
              ...prev,
              chartAnimations: enabled,
            }));
          }}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1 mt-8 text-sky-400">
          {t('settings_page.advanced_algorithms')}
        </h2>

        <SessionManagementCard
          title={t('settings_page.session_management')}
          description={t('settings_page.rules_for_automatic_merging_of_nearby_sessions')}
          mergeGapLabel={t('settings_page.merge_gap')}
          mergeGapAriaLabel={t('settings_page.merge_gap_in_minutes')}
          minutesLabel={t('settings_page.min')}
          sliderValue={sliderValue}
          skipShortSessionsTitle={t('settings.session.skipShortTitle')}
          skipShortSessionsDescription={t('settings_page.sessions_shorter_than_or_equal_to_this_duration_will_be')}
          minDurationAriaLabel={t('settings_page.minimum_session_duration_in_seconds')}
          minDurationSeconds={sessionSettings.minSessionDurationSeconds}
          secondsLabel={t('settings_page.sec')}
          autoRebuildTitle={t('settings_page.auto_rebuild_on_startup')}
          autoRebuildDescription={t('settings_page.automatically_merge_close_sessions_when_app_starts')}
          rebuildOnStartup={sessionSettings.rebuildOnStartup}
          rebuildExistingTitle={t('settings_page.rebuild_existing_sessions')}
          rebuildExistingDescription={t('settings_page.apply_current_merge_gap_to_already_imported_sessions')}
          rebuildingLabel={t('settings_page.rebuilding')}
          rebuildLabel={t('settings_page.rebuild')}
          rebuilding={rebuilding}
          onGapFillChange={(minutes) => {
            updateSessionSettings((prev) => ({
              ...prev,
              gapFillMinutes: minutes,
            }));
          }}
          onMinDurationChange={(seconds) => {
            updateSessionSettings((prev) => ({
              ...prev,
              minSessionDurationSeconds: seconds,
            }));
          }}
          onRebuildOnStartupChange={(enabled) => {
            updateSessionSettings((prev) => ({
              ...prev,
              rebuildOnStartup: enabled,
            }));
          }}
          onRebuild={() => {
            void handleRebuildSessions();
          }}
        />

        <SessionSplitCard
          title={t('settings.splitTitle')}
          maxProjectsTitle={t('settings.splitMaxProjects')}
          maxProjectsDescription={t('settings.splitMaxProjectsDesc')}
          toleranceTitle={t('settings.splitTolerance')}
          toleranceLowLabel={t('settings.splitToleranceLow')}
          toleranceHighLabel={t('settings.splitToleranceHigh')}
          toleranceDescription={splitToleranceDescription}
          autoSplitTitle={t('settings.splitAuto')}
          autoSplitDescription={t('settings.splitAutoDesc')}
          splitSettings={splitSettings}
          onMaxProjectsChange={(maxProjects) => {
            updateSplitSetting('maxProjectsPerSession', maxProjects);
          }}
          onToleranceThresholdChange={(threshold) => {
            updateSplitSetting('toleranceThreshold', threshold);
          }}
          onAutoSplitEnabledChange={(enabled) => {
            updateSplitSetting('autoSplitEnabled', enabled);
          }}
        />

        <OnlineSyncCard
          settings={onlineSyncSettings}
          state={onlineSyncState}
          manualSyncResult={manualSyncResult}
          manualSyncResultText={manualSyncResultText}
          manualSyncResultSuccess={manualSyncResultSuccess}
          manualSyncing={manualSyncing}
          demoModeSyncDisabled={demoModeSyncDisabled}
          showToken={showOnlineSyncToken}
          title={t('settings_page.online_sync')}
          description={t('settings_page.startup_synchronization_with_remote_server_using_snapsho')}
          enableSyncTitle={t('settings.online_sync.enableTitle')}
          enableSyncDescription={t('settings_page.allows_the_dashboard_to_exchange_data_snapshots_with_the')}
          syncOnStartupTitle={t('settings_page.sync_on_startup')}
          syncOnStartupDescription={t('settings_page.runs_status_pull_push_after_local_auto_import_finishes')}
          autoSyncIntervalTitle={t('settings_page.auto_sync_interval')}
          autoSyncIntervalDescription={t('settings_page.periodic_sync_after_app_startup_default_is_every_30_minu')}
          minutesLabel={t('settings_page.min')}
          enableLoggingTitle={t('settings.online_sync.loggingTitle')}
          enableLoggingDescription={t('settings_page.save_detailed_sync_operations_to_log_file_for_debugging')}
          serverUrlLabel={t('settings_page.server_url')}
          useDefaultServerLabel={t('settings.online_sync.useRailwayDefault')}
          userIdLabel={t('settings_page.user_id')}
          userIdPlaceholder={t('settings_page.user_id_placeholder')}
          apiTokenLabel={t('settings_page.api_token_bearer')}
          apiTokenPlaceholder={t('settings_page.paste_the_raw_token_without_bearer_prefix_and_without_qu')}
          showTokenLabel={t('settings_page.show_token')}
          hideTokenLabel={t('settings_page.hide_token')}
          apiTokenHint={t('settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a')}
          deviceIdLabel={t('settings_page.device_id')}
          generatedOnSaveLabel={t('settings_page.generated_on_save')}
          deviceIdHint={t('settings_page.generated_automatically_and_used_to_identify_this_machin')}
          statusTitle={t('settings_page.last_sync_status')}
          lastSuccessfulLabel={t('settings_page.last_successful_check_sync')}
          demoModeDisabledWarning={t('settings_page.online_sync_is_disabled_while_demo_mode_is_active')}
          serverRevisionLabel={t('settings_page.server_revision')}
          serverHashLabel={t('settings_page.server_hash')}
          localRevisionHashLabel={t('settings_page.local_rev_hash')}
          pendingAckLabel={t('settings_page.pending_ack')}
          retriesLabel={t('settings_page.retries')}
          reseedWarning={t('settings_page.server_payload_was_cleaned_up_after_acks_local_reseed_ex')}
          syncingLabel={t('settings_page.syncing')}
          syncDisabledInDemoLabel={t('settings.online_sync.syncDisabledInDemo')}
          syncNowLabel={t('settings_page.sync_now')}
          notAvailableLabel={t('ui.common.not_available')}
          defaultServerUrl={DEFAULT_ONLINE_SYNC_SERVER_URL}
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
              serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
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
        />

        <ProjectFreezeCard
          thresholdDays={freezeSettings.thresholdDays}
          title={t('settings_page.project_freezing')}
          description={t('settings_page.projects_inactive_for_a_set_period_are_automatically_fro')}
          thresholdTitle={t('settings_page.inactivity_threshold')}
          thresholdDescription={t('settings_page.number_of_days_without_activity_after_which_a_project_is')}
          thresholdAriaLabel={t('settings_page.freeze_threshold_in_days')}
          daysLabel={t('settings_page.days')}
          onThresholdChange={(val) => {
            updateFreezeSettings((prev) => ({
              ...prev,
              thresholdDays: val,
            }));
          }}
        />

        <DemoModeCard
          demoModeStatus={demoModeStatus}
          demoModeLoading={demoModeLoading}
          demoModeSwitching={demoModeSwitching}
          demoModeError={demoModeError}
          title={t('settings_page.demo_mode')}
          description={t('settings_page.switch_dashboard_data_source_to_a_separate_demo_database')}
          toggleTitle={t('settings_page.use_demo_database')}
          toggleDescription={t('settings_page.applies_to_the_whole_dashboard_app_reads_writes_imports')}
          loadingStatusText={t('settings_page.loading_demo_mode_status')}
          activeDbLabel={t('settings_page.active_db')}
          primaryDbLabel={t('settings_page.primary_db')}
          demoDbLabel={t('settings_page.demo_db')}
          demoActiveText={t('settings_page.demo_mode_is_active_new_imports_changes_will_affect_the')}
          primaryActiveText={t('settings_page.primary_mode_is_active')}
          unavailableStatusText={t('settings_page.demo_mode_status_unavailable')}
          switchingLabel={t('settings_page.switching')}
          disableLabel={t('settings_page.disable_demo_mode')}
          enableLabel={t('settings_page.enable_demo_mode')}
          onToggle={(enabled) => {
            void handleToggleDemoMode(enabled);
          }}
        />

        <DangerZoneCard
          clearArmed={clearArmed}
          clearing={clearing}
          title={t('settings_page.danger_zone')}
          description={t('settings_page.hidden_by_default_to_avoid_accidental_clicks')}
          controlsLabel={t('settings_page.data_wipe_controls')}
          openLabel={t('settings_page.open')}
          closeLabel={t('settings_page.close')}
          detailsText={t('settings_page.deletes_all_imported_sessions_and_history_from_local_dat')}
          enableLabel={t('settings_page.enable_clear_action')}
          clearingLabel={t('settings_page.clearing')}
          clearLabel={t('settings_page.clear_data')}
          onClearArmedChange={setClearArmed}
          onClearData={() => {
            void handleClearData();
          }}
        />
      </div>

      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {!savedSettings && (
          <Button
            className="h-8 min-w-[7rem] rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 animate-shine text-white border-none font-black text-[10px] uppercase tracking-wider"
            onClick={handleSaveSettings}
          >
            {t('settings_page.save_changes')}
          </Button>
        )}
      </div>

      <ConfirmDialog />
    </div>
  );
}
