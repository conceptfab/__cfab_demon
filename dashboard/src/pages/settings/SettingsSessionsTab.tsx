import { ProjectFreezeCard } from '@/components/settings/ProjectFreezeCard';
import { SessionManagementCard } from '@/components/settings/SessionManagementCard';
import { SessionSplitCard } from '@/components/settings/SessionSplitCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsSessionsTabProps = SettingsPageController;

export function SettingsSessionsTab({
  freezeSettings,
  handleRebuildSessions,
  rebuilding,
  sessionSettings,
  sliderValue,
  splitSettings,
  splitToleranceDescription,
  t,
  updateFreezeSettings,
  updateSessionSettings,
  updateSplitSetting,
}: SettingsSessionsTabProps) {
  return (
    <div className="space-y-4">
      <SessionManagementCard
        title={t('settings_page.session_management')}
        description={t(
          'settings_page.rules_for_automatic_merging_of_nearby_sessions',
        )}
        mergeGapLabel={t('settings_page.merge_gap')}
        mergeGapAriaLabel={t('settings_page.merge_gap_in_minutes')}
        minutesLabel={t('settings_page.min')}
        sliderValue={sliderValue}
        skipShortSessionsTitle={t('settings.session.skipShortTitle')}
        skipShortSessionsDescription={t(
          'settings_page.sessions_shorter_than_or_equal_to_this_duration_will_be',
        )}
        minDurationAriaLabel={t(
          'settings_page.minimum_session_duration_in_seconds',
        )}
        minDurationSeconds={sessionSettings.minSessionDurationSeconds}
        secondsLabel={t('settings_page.sec')}
        autoRebuildTitle={t('settings_page.auto_rebuild_on_startup')}
        autoRebuildDescription={t(
          'settings_page.automatically_merge_close_sessions_when_app_starts',
        )}
        rebuildOnStartup={sessionSettings.rebuildOnStartup}
        rebuildExistingTitle={t('settings_page.rebuild_existing_sessions')}
        rebuildExistingDescription={t(
          'settings_page.apply_current_merge_gap_to_already_imported_sessions',
        )}
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

      <ProjectFreezeCard
        thresholdDays={freezeSettings.thresholdDays}
        title={t('settings_page.project_freezing')}
        description={t(
          'settings_page.projects_inactive_for_a_set_period_are_automatically_fro',
        )}
        thresholdTitle={t('settings_page.inactivity_threshold')}
        thresholdDescription={t(
          'settings_page.number_of_days_without_activity_after_which_a_project_is',
        )}
        thresholdAriaLabel={t('settings_page.freeze_threshold_in_days')}
        daysLabel={t('settings_page.days')}
        onThresholdChange={(val) => {
          updateFreezeSettings((prev) => ({
            ...prev,
            thresholdDays: val,
          }));
        }}
      />
    </div>
  );
}
