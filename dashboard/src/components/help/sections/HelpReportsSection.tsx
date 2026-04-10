import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpReportsSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<FileText className="h-6 w-6" />}
      title={t18n('help_page.reports_2')}
      description={t18n('help_page.create_configurable_project_reports_for_print_and_pdf_ex')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.template_system_create_duplicate_and_manage_multiple_rep'),
        t18n('help_page.report_template_editor_choose_report_sections_and_their'),
        t18n('help_page.timeflow_logo_and_version_the_report_header_includes_the'),
        t18n('help_page.report_generation_button_in_the_top_toolbar_of_the_proje'),
        t18n('help_page.reportview_full_screen_report_preview_without_the_side_p'),
        t18n('help_page.report_view_toolbar_focuses_on_preview_print_and_pdf_'),
        t18n('help_page.report_work_time_uses_the_same_deduplicated_clock_time_a'),
        t18n('help_page.additional_sections_boosts_sessions_with_time_multiplier'),
        t18n('help_page.section_reordering_up_down_arrows_on_each_section_in_the'),
        t18n('help_page.preview_loading_state_when_switching_templates_or_rebuild'),
        t18n('help_page.empty_templates_state_if_no_report_templates_are_availab'),
        t18n('help_page.reports_how_to_open'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.reportview_detail_title')}
        items={[
          t18n('help_page.reportview_detail_what_it_does'),
          t18n('help_page.reportview_detail_when_to_use'),
          t18n('help_page.reportview_detail_how_to_print'),
          t18n('help_page.reportview_detail_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
