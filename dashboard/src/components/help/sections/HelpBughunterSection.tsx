import { Bug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp } from '@/components/help/help-shared';

export function HelpBughunterSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Bug className="h-6 w-6" />}
      title={t18n('help_page.bughunter_2')}
      description={t18n('help_page.bughunter_the_bug_icon_in_the_sidebar_allows_quick_bug_r')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.bughunter_detail_what_it_does'),
        t18n('help_page.bughunter_detail_when_to_use'),
        t18n('help_page.bughunter_detail_limitations'),
        t18n('help_page.bughunter_attachment_limit'),
        t18n('help_page.bughunter_report_address'),
      ]}
    />
  );
}
