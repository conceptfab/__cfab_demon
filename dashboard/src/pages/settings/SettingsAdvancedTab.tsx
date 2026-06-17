import { DangerZoneCard } from '@/components/settings/DangerZoneCard';
import { DemoModeCard } from '@/components/settings/DemoModeCard';
import { DevSettingsCard } from '@/components/settings/DevSettingsCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsAdvancedTabProps = SettingsPageController;

export function SettingsAdvancedTab({
  clearArmed,
  clearing,
  demoModeError,
  demoModeLoading,
  demoModeStatus,
  demoModeSwitching,
  handleClearData,
  handleToggleDemoMode,
  setClearArmed,
  t,
}: SettingsAdvancedTabProps) {
  return (
    <div className="space-y-4">
      <DemoModeCard
        demoModeStatus={demoModeStatus}
        demoModeLoading={demoModeLoading}
        demoModeSwitching={demoModeSwitching}
        demoModeError={demoModeError}
        title={t('settings_page.demo_mode')}
        description={t(
          'settings_page.switch_dashboard_data_source_to_a_separate_demo_database',
        )}
        toggleTitle={t('settings_page.use_demo_database')}
        toggleDescription={t(
          'settings_page.applies_to_the_whole_dashboard_app_reads_writes_imports',
        )}
        loadingStatusText={t('settings_page.loading_demo_mode_status')}
        activeDbLabel={t('settings_page.active_db')}
        primaryDbLabel={t('settings_page.primary_db')}
        demoDbLabel={t('settings_page.demo_db')}
        demoActiveText={t(
          'settings_page.demo_mode_is_active_new_imports_changes_will_affect_the',
        )}
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
        description={t(
          'settings_page.hidden_by_default_to_avoid_accidental_clicks',
        )}
        controlsLabel={t('settings_page.data_wipe_controls')}
        openLabel={t('settings_page.open')}
        closeLabel={t('settings_page.close')}
        detailsText={t(
          'settings_page.deletes_all_imported_sessions_and_history_from_local_dat',
        )}
        enableLabel={t('settings_page.enable_clear_action')}
        clearingLabel={t('settings_page.clearing')}
        clearLabel={t('settings_page.clear_data')}
        onClearArmedChange={setClearArmed}
        onClearData={() => {
          void handleClearData();
        }}
      />

      <DevSettingsCard />
    </div>
  );
}
