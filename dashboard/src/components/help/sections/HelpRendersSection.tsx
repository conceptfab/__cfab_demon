import { Clapperboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpDetailsBlock } from '@/components/help/HelpDetailsBlock';
import { SectionHelp } from '@/components/help/SectionHelp';

export function HelpRendersSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Clapperboard className="size-6" />}
      title={t18n('help_page.renders')}
      description={t18n('help_page.renders_description')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.renders_feature_beacon'),
        t18n('help_page.renders_feature_index'),
        t18n('help_page.renders_feature_unassigned'),
        t18n('help_page.renders_feature_offline'),
        t18n('help_page.renders_feature_cost'),
        t18n('help_page.renders_feature_thumbnails'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.renders_detail_beacon_title')}
        items={[
          t18n('help_page.renders_detail_beacon_1'),
          t18n('help_page.renders_detail_beacon_2'),
        ]}
      />
      <HelpDetailsBlock
        title={t18n('help_page.renders_detail_assignment_title')}
        items={[
          t18n('help_page.renders_detail_assignment_1'),
          t18n('help_page.renders_detail_assignment_2'),
          t18n('help_page.renders_detail_assignment_3'),
        ]}
      />
      <HelpDetailsBlock
        title={t18n('help_page.renders_detail_offline_title')}
        items={[
          t18n('help_page.renders_detail_offline_1'),
          t18n('help_page.renders_detail_offline_2'),
          t18n('help_page.renders_detail_offline_3'),
        ]}
      />
    </SectionHelp>
  );
}
