import {
  LayoutDashboard,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  Cpu,
  Briefcase,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp } from '@/components/help/help-shared';

export function HelpDashboardSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<LayoutDashboard className="h-6 w-6" />}
      title={t18n('help_page.dashboard')}
      description={t18n('help_page.quick_overview_of_your_current_activity_and_key_performa')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.integrated_metrics_cards_total_tracked_time_number_of_ap'),
        t18n('help_page.interactive_timeline_with_hourly_view_today_or_daily_vie'),
        t18n('help_page.top_5_projects_charts_and_analysis_of_most_used_applicat'),
        t18n('help_page.quick_time_range_switching_today_week_month_all_time'),
        t18n('help_page.timeline_visualization_mode_shows_your_engagement_in_rea'),
        t18n('help_page.notifications_on_auto_import_status_and_potential_data_r'),
        t18n('help_page.sidebar_status_indicators_act_as_a_control_center_they_s'),
        t18n('help_page.refresh_button_synchronizing_data_directly_from_the_runn'),
        t18n('help_page.unassigned_sessions_banner_shows_the_count_of_today_s_un'),
        t18n('help_page.discovered_projects_notification_after_folder_scanning_o'),
        t18n('help_page.add_manual_session_from_timeline_click_on_the_dashboard'),
        t18n('help_page.all_projects_overview_chart_showing_work_time_distributi'),
        t18n('help_page.timeline_states_loading_empty_and_error_messages_help_yo'),
        t18n('help_page.dashboard_sidebar_backup_indicator'),
      ]}
    />
  );
}

export function HelpEstimatesSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<CircleDollarSign className="h-6 w-6" />}
      title={t18n('help_page.estimates_2')}
      description={t18n('help_page.business_module_for_precise_conversion_of_time_into_fina')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.global_hourly_rate_configuration_and_specific_rates_for'),
        t18n('help_page.includes_session_multipliers_in_the_final_project_valuat'),
        t18n('help_page.manual_session_valuation_meetings_and_calls_are_added_to'),
        t18n('help_page.project_profitability_analysis_over_time_monthly_and_yea'),
        t18n('help_page.visual_breakdown_into_daily_and_weekly_earnings'),
        t18n('help_page.ability_to_compare_time_value_spent_on_different_task_gr'),
        t18n('help_page.project_rate_reset_button_to_reset_a_project_specific_ra'),
        t18n('help_page.multiplier_badge_each_project_shows_the_count_of_session'),
        t18n('help_page.estimates_loading_and_empty_states_the_table_shows_a_loa'),
        t18n('help_page.per_row_save_indicator_when_you_save_a_project_specific_'),
      ]}
    />
  );
}

export function HelpAppsSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<AppWindow className="h-6 w-6" />}
      title={t18n('help_page.applications_2')}
      description={t18n('help_page.managing_the_list_of_detected_software_and_processes')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.full_list_of_applications_with_activity_history_and_time'),
        t18n('help_page.app_aliases_change_process_names_e_g_cmd_exe_to_readable'),
        t18n('help_page.tracking_block_remove_data_for_applications_you_don_t_wa'),
        t18n('help_page.app_data_archiving_reset_tracking_time_without_deleting'),
        t18n('help_page.directly_assign_an_entire_application_to_a_specific_proj'),
        t18n('help_page.monitored_applications_section_for_managing_processes_ac'),
        t18n('help_page.sync_from_apps_button_copies_detected_apps_into_the_monitored_list'),
        t18n('help_page.app_colors_inline_picker_with_preset_palette_and_custom'),
        t18n('help_page.imported_badge_label_on_applications_that_came_from_impo'),
        t18n('help_page.list_pagination_for_large_app_lists_a_load_more_control'),
      ]}
    />
  );
}

export function HelpAnalysisSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<BarChart3 className="h-6 w-6" />}
      title={t18n('help_page.time_analysis_2')}
      description={t18n('help_page.deep_visualization_of_your_habits_and_work_intensity')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.activity_heatmaps_hourly_and_daily_visualization_of_your'),
        t18n('help_page.monthly_view_with_week_numbers_facilitates_planning_and'),
        t18n('help_page.intensity_analysis_charts_showing_what_hours_you_work_mo'),
        t18n('help_page.stacked_bar_charts_percentage_share_of_projects_in_your'),
        t18n('help_page.timeline_project_view_detailed_timeline_broken_down_by_s'),
        t18n('help_page.range_toolbar_daily_weekly_monthly_buttons_switch_the_da'),
        t18n('help_page.period_navigation_previous_next_arrows_let_you_move_betw'),
        t18n('help_page.interactive_legend_project_list_with_colors_and_times_cl'),
      ]}
    />
  );
}

export function HelpDaemonSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Cpu className="h-6 w-6" />}
      title={t18n('help_page.daemon')}
      description={t18n('help_page.control_center_for_the_background_process_responsible_fo')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.status_control_diagnostics_monitor_if_the_time_tracking'),
        t18n('help_page.service_management_start_stop_and_restart_the_daemon_dir'),
        t18n('help_page.windows_autostart_automatic_startup_of_timeflow_upon_sys'),
        t18n('help_page.real_time_logs_preview_of_the_event_log_to_identify_issu'),
        t18n('help_page.version_insight_information_on_the_compatibility_of_daem'),
        t18n('help_page.localization_the_daemon_tray_menu_automatically_switches'),
        t18n('help_page.monitor_all_fallback_if_the_monitored_process_list_is_em'),
        t18n('help_page.monitored_apps_with_empty_window_titles_are_still_counted'),
        t18n('help_page.unassigned_sessions_indicator_badge_with_the_count_of_se'),
        t18n('help_page.log_auto_refresh_button_to_enable_automatic_real_time_lo'),
        t18n('help_page.log_auto_refresh_runs_only_while_the_daemon_screen_is_v'),
        t18n('help_page.log_coloring_error_and_warn_lines_are_highlighted_with_c'),
        t18n('help_page.daemon_windows_autostart_details'),
      ]}
    />
  );
}

export function HelpPmSection() {
  const { t: t18n } = useTranslation();

  return (
    <SectionHelp
      icon={<Briefcase className="h-6 w-6" />}
      title={t18n('help_page.pm_2')}
      description={t18n('help_page.pm_description')}
      footer={t18n('help_page.key_functionalities')}
      features={[
        t18n('help_page.pm_feature_create'),
        t18n('help_page.pm_feature_numbering'),
        t18n('help_page.pm_feature_folders'),
        t18n('help_page.pm_feature_templates'),
        t18n('help_page.pm_feature_status'),
        t18n('help_page.pm_feature_budget'),
        t18n('help_page.pm_feature_clients'),
        t18n('help_page.pm_feature_tf_match'),
        t18n('help_page.pm_feature_filters'),
        t18n('help_page.pm_feature_folder_size'),
        t18n('help_page.pm_feature_compat'),
        t18n('help_page.pm_template_manager'),
        t18n('help_page.pm_project_detail_dialog'),
        t18n('help_page.pm_clients_management'),
      ]}
    />
  );
}
