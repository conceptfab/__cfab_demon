import { Import } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpDataSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Import className="h-6 w-6" />}
      title={t18n('help_page.data_2')}
      description={t18n('help_page.importing_exporting_and_organizing_the_knowledge_base')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.zip_export_quick_archiving_of_the_entire_database_or_sel'),
        t18n('help_page.json_import_loading_daily_reports_generated_by_the_daemo'),
        t18n('help_page.import_page_separate_screen_for_drag_drop_json_import_a'),
        t18n('help_page.archive_import_zip_package_validation_before_import_and'),
        t18n('help_page.system_maintenance_cleaning_old_records_and_optimizing_f'),
        t18n('help_page.operation_history_insight_into_when_and_what_data_was_mo'),
        t18n('help_page.backup_restore_database_manual_backups_restore_from_file'),
        t18n('help_page.data_history_refreshes_after_real_data_changes_and_when_'),
        t18n('help_page.data_stats_summary_tiles'),
        t18n('help_page.database_health_panel'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.import_page_detail_title')}
        items={[
          t18n('help_page.import_page_detail_what_it_does'),
          t18n('help_page.import_page_detail_when_to_use'),
          t18n('help_page.import_page_detail_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
