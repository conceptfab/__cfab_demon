import { MonitorPlay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpDetailsBlock } from '@/components/help/HelpDetailsBlock';
import { SectionHelp } from '@/components/help/SectionHelp';

export function HelpWebUiSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<MonitorPlay className="size-6" />}
      title={t18n('help_page.webui_section_title')}
      description={t18n('help_page.webui_description')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.webui_what_it_does'),
        t18n('help_page.webui_when_to_use'),
        t18n('help_page.webui_localhost_auto_login'),
        t18n('help_page.webui_lan_pairing'),
        t18n('help_page.webui_how_to_start'),
        t18n('help_page.webui_how_to_stop'),
        t18n('help_page.webui_start_failure'),
        t18n('help_page.webui_default_port'),
        t18n('help_page.webui_mobile_layout'),
        t18n('help_page.webui_shared_settings'),
        t18n('help_page.webui_http_warning'),
        t18n('help_page.webui_localhost_no_password'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.webui_setup_title')}
        items={[
          t18n('help_page.webui_setup_what_it_does'),
          t18n('help_page.webui_setup_when_to_use'),
          t18n('help_page.webui_setup_pairing'),
          t18n('help_page.webui_setup_how_to_stop'),
          t18n('help_page.webui_setup_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
