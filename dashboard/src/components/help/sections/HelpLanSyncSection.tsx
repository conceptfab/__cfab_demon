import { Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpLanSyncSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Wifi className="h-6 w-6" />}
      title={t18n('help_page.lan_sync_section_title')}
      description={t18n('help_page.lan_sync_description')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.lan_sync_master_slave'),
        t18n('help_page.lan_sync_manual_search'),
        t18n('help_page.lan_sync_udp_discovery'),
        t18n('help_page.lan_sync_http_server'),
        t18n('help_page.lan_sync_delta_merge'),
        t18n('help_page.lan_sync_project_name_persist'),
        t18n('help_page.lan_sync_sync_markers'),
        t18n('help_page.lan_sync_scheduled'),
        t18n('help_page.lan_sync_freeze'),
        t18n('help_page.lan_sync_backup'),
        t18n('help_page.lan_sync_progress'),
        t18n('help_page.lan_sync_force_sync'),
        t18n('help_page.lan_sync_auto_sync'),
        t18n('help_page.lan_sync_firewall'),
        t18n('help_page.lan_sync_subnet_broadcast'),
        t18n('help_page.lan_sync_background_interval'),
        t18n('help_page.lan_sync_peer_notification'),
        t18n('help_page.lan_sync_sidebar_indicator'),
        t18n('help_page.lan_sync_port_config'),
        t18n('help_page.lan_sync_device_pairing'),
        t18n('help_page.lan_sync_peer_notification_detail'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.lan_sync_setup_title')}
        items={[
          t18n('help_page.lan_sync_setup_what_it_does'),
          t18n('help_page.lan_sync_setup_how_to_start'),
          t18n('help_page.lan_sync_setup_when_to_use'),
          t18n('help_page.lan_sync_setup_limitations'),
        ]}
      />
      <HelpDetailsBlock
        title={t18n('help_page.lan_sync_pairing_title')}
        items={[
          t18n('help_page.lan_sync_pairing_what'),
          t18n('help_page.lan_sync_pairing_master'),
          t18n('help_page.lan_sync_pairing_slave'),
          t18n('help_page.lan_sync_pairing_expired'),
          t18n('help_page.lan_sync_pairing_unpair'),
        ]}
      />
    </SectionHelp>
  );
}
