import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpOnlineSyncSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Activity className="h-6 w-6" />}
      title={t18n('help_page.online_sync_setup_title')}
      description={t18n('help_page.online_sync_set_up_synchronization_with_an_external_serv')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.device_id_a_device_identifier_is_generated_when_sync_set'),
        t18n('help_page.the_sync_token_is_stored_in_rust_side_secure_storage_the'),
        t18n('help_page.sync_on_startup_runs_only_when_online_sync_is_en'),
        t18n('help_page.auto_sync_interval_configure_automatic_synchronization_i'),
        t18n('help_page.ack_statuses_in_online_sync_the_status_area_shows_whethe'),
        t18n('help_page.online_sync_status_panel_shows_revision_hash_and_retr'),
        t18n('help_page.server_snapshot_pruned_scenario_if_the_server_payload_wa'),
        t18n('help_page.sync_logging_you_can_enable_file_logging_for_synchroniza'),
        t18n('help_page.online_sync_daemon_mode'),
        t18n('help_page.delta_sync_description'),
        t18n('help_page.online_sync_sse_realtime'),
        t18n('help_page.license_activation'),
        t18n('help_page.demo_mode_and_sync_when_switched_to_the_demo_database_on'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.online_sync_setup_title')}
        items={[
          t18n('help_page.online_sync_setup_what_it_does'),
          t18n('help_page.online_sync_setup_how_to_start'),
          t18n('help_page.online_sync_setup_when_to_use'),
          t18n('help_page.online_sync_setup_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
