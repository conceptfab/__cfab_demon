import { FolderKanban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp, HelpDetailsBlock } from '@/components/help/help-shared';

export function HelpProjectsSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<FolderKanban className="h-6 w-6" />}
      title={t18n('help_page.projects_2')}
      description={t18n('help_page.managing_task_structure_and_intelligent_automation_of_pr')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.freezing_hide_inactive_projects_to_keep_them_from_clutte'),
        t18n('help_page.auto_freezing_the_system_automatically_freezes_projects'),
        t18n('help_page.freezing_blocks_override_reapply'),
        t18n('help_page.unfreezing_use_the_flame_icon_to_restore_a_project_to_th'),
        t18n('help_page.folder_sync_timeflow_scans_paths_on_every_dashboard_star'),
        t18n('help_page.candidate_detection_the_system_suggests_project_creation'),
        t18n('help_page.duplicate_name_marker_projects_with_similar_names_are_marked'),
        t18n('help_page.root_folders_manage_disk_locations_that_timeflow_should'),
        t18n('help_page.exclude_remove_projects_from_view_without_permanently_de'),
        t18n('help_page.search_filter_projects_by_name_or_folder_path_in_real_ti'),
        t18n('help_page.color_change_click_the_color_dot_on_the_project_card_to'),
        t18n('help_page.project_card_projectpage_full_project_view_data_compacti'),
        t18n('help_page.project_time_is_consistent_across_project_views_estima'),
        t18n('help_page.project_page_daily_timeline_comments_manual_sessions'),
        t18n('help_page.saved_view_persist_your_preferred_sorting_and_presentati'),
        t18n('help_page.project_data_compaction_action_in_the_project_view_that'),
        t18n('help_page.recent_comments_card_in_the_project_view_showing_latest'),
        t18n('help_page.project_manual_sessions_dedicated_card_in_the_project_vi'),
        t18n('help_page.chart_context_menu_right_click_on_a_day_in_the_project_t'),
        t18n('help_page.project_timeline_states_loading_empty_and_error_messages'),
      ]}
    >
      <HelpDetailsBlock
        title={t18n('help_page.project_page_detail_title')}
        items={[
          t18n('help_page.project_page_detail_what_it_does'),
          t18n('help_page.project_page_detail_when_to_use'),
          t18n('help_page.project_page_detail_limitations'),
        ]}
      />
      <HelpDetailsBlock
        title={t18n('help_page.manual_session_dialog_detail_title')}
        items={[
          t18n('help_page.manual_session_dialog_detail_what_it_does'),
          t18n('help_page.manual_session_dialog_detail_when_to_use'),
          t18n('help_page.manual_session_dialog_detail_limitations'),
        ]}
      />
    </SectionHelp>
  );
}
