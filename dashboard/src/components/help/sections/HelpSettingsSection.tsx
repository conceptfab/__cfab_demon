import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpSettingsSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Settings className="h-6 w-6" />}
      title={t18n('help_page.settings_2')}
      description={t18n('help_page.full_control_over_application_configuration_and_security')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.working_hours_define_work_hours_affects_timeline_color_s'),
        t18n('help_page.session_management_set_session_merging_threshold_gap_fil'),
        t18n('help_page.auto_rebuild_on_startup_automatically_rebuild_merge_sess'),
        t18n('help_page.freeze_threshold_configure_the_number_of_days_after_whic'),
        t18n('help_page.currency_choose_valuation_currency_pln_usd_eur_used_acro'),
        t18n('help_page.ui_language_pl_en_language_switch_for_the_whole_dashboar'),
        t18n('help_page.online_sync_set_up_synchronization_with_an_external_serv'),
        t18n('help_page.lan_sync_description'),
        t18n('help_page.device_id_a_device_identifier_is_generated_when_sync_set'),
        t18n('help_page.the_sync_token_is_stored_in_rust_side_secure_storage_the'),
        t18n('help_page.sync_on_startup_runs_only_when_online_sync_is_en'),
        t18n('help_page.auto_sync_interval_configure_automatic_synchronization_i'),
        t18n('help_page.ack_statuses_in_online_sync_the_status_area_shows_whethe'),
        t18n('help_page.online_sync_status_panel_shows_revision_hash_and_retr'),
        t18n('help_page.server_snapshot_pruned_scenario_if_the_server_payload_wa'),
        t18n('help_page.sync_logging_you_can_enable_file_logging_for_synchroniza'),
        t18n('help_page.license_activation'),
        t18n('help_page.demo_mode_switch_to_a_demo_database_test_without_affecti'),
        t18n('help_page.demo_mode_and_sync_when_switched_to_the_demo_database_on'),
        t18n('help_page.demo_mode_uses_a_separate_sqlite_file_and_reads_live_dai'),
        t18n('help_page.auto_optimize_db_schedule_automatic_sqlite_optimization'),
        t18n('help_page.emergency_clear_option_to_completely_clear_the_database'),
        t18n('help_page.appearance_performance_disable_chart_animations_to_impro'),
        t18n('help_page.highlight_color_choose_the_highlight_color_for_working_h'),
        t18n('help_page.bughunter_the_bug_icon_in_the_sidebar_allows_quick_bug_r'),
        t18n('help_page.session_split_settings_in_a_dedicated_card_tolerance_coe'),
        t18n('help_page.danger_zone_two_step_confirmation_first_arm_the_button_t'),
        t18n('help_page.manual_session_rebuild_button_in_the_session_management'),
        t18n('help_page.unsaved_changes_warning_before_leaving_settings'),
        t18n('help_page.dev_log_management_centralized_log_viewer'),
        t18n('help_page.pm_settings_work_folder_and_templates'),
        t18n('help_page.backup_interval_automatic_database_backup'),
        t18n('help_page.restore_database_from_backup_file'),
        t18n('help_page.settings_dev_log_channels'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.bughunter_detail_title')}
        items={[
          t18n('help_page.bughunter_detail_what_it_does'),
          t18n('help_page.bughunter_detail_when_to_use'),
          t18n('help_page.bughunter_detail_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
