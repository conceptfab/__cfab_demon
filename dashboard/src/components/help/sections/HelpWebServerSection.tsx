import { Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpDetailsBlock } from '@/components/help/HelpDetailsBlock';
import { SectionHelp } from '@/components/help/SectionHelp';

export function HelpWebServerSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Globe2 className="size-6" />}
      title={t18n('help_page.webserver_section_title')}
      description={t18n('help_page.webserver_description')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.webserver_browser_access'),
        t18n('help_page.webserver_clients_read_write'),
        t18n('help_page.webserver_settings_tab'),
        t18n('help_page.webserver_lan_toggle'),
        t18n('help_page.webserver_pairing_code'),
        t18n('help_page.webserver_active_sessions'),
        t18n('help_page.webserver_restart_required'),
        t18n('help_page.webserver_http_lan_warning'),
        t18n('help_page.webserver_dashboard_required'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.webserver_setup_title')}
        items={[
          t18n('help_page.webserver_setup_what_it_does'),
          t18n('help_page.webserver_setup_when_to_use'),
          t18n('help_page.webserver_setup_how_to_start'),
          t18n('help_page.webserver_setup_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
