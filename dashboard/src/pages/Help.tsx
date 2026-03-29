import logo from '@/assets/logo.png';
import cfab from '@/assets/cfab.png';
import {
  LayoutDashboard,
  List,
  FolderKanban,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  Brain,
  Import,
  Cpu,
  Activity,
  Wifi,
  Settings,
  Info,
  Bug,
  ChevronRight,
  Rocket,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import {
  normalizeHelpTab,
  pageForHelpTab,
  type HelpTabId,
} from '@/lib/help-navigation';
import { useTranslation } from 'react-i18next';
import { getDaemonRuntimeStatus } from '@/lib/tauri';

export function Help() {
  const { t: t18n } = useTranslation();
  const {
    helpTab: activeTab,
    setHelpTab: setActiveTab,
    setCurrentPage,
  } = useUIStore();

  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    getDaemonRuntimeStatus()
      .then((s) => setVersion(s.dashboard_version ?? ''))
      .catch(() => {});
  }, []);

  const activeTabValue = normalizeHelpTab(activeTab, 'dashboard');
  const openActiveSection = () => {
    setCurrentPage(pageForHelpTab(activeTabValue));
  };

  return (
    <div className="flex h-full flex-col p-8 space-y-8 overflow-y-auto max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/10 pb-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-[0.1em] flex items-center gap-3">
            {t18n('help_page.welcome_to')}{' '}
            <div className="flex items-center gap-4 ml-1">
              <img
                src={logo}
                alt="TIMEFLOW"
                className="h-11 w-11 object-contain"
              />
              <span className="font-semibold tracking-[0.2em]">TIMEFLOW</span>
            </div>
            {version && (
              <span className="ml-2 font-medium text-sm text-muted-foreground/70 tracking-normal antialiased self-end mb-1">
                β v{version}
              </span>
            )}
          </h1>
          <div className="text-[11px] text-muted-foreground/70 tracking-wide ml-1 mt-1 flex items-center gap-2">
            <span className="uppercase font-extralight tracking-[0.15em]">
              {t18n('help_page.concept_creation_execution')}
            </span>
            <img
              src={cfab}
              alt="CONCEPTFAB"
              className="h-9 w-auto object-contain"
            />
            <span className="font-light">
              {t18n('help_page.all_rights_reserved')}
            </span>
          </div>
        </div>

        <span className="text-[11px] text-muted-foreground">
          {t18n('help.language_hint')}
        </span>
      </div>

      <Card className="border-none bg-transparent shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {t18n('help_page.about_the_software')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground font-semibold">TIMEFLOW</strong>{' '}
            {t18n('help_page.is_an_advanced_time_tracking_ecosystem_that_works_discre')}{' '}
            {t18n('help_page.unlike_traditional_tools_timeflow_intelligently_analyzes')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Activity className="h-4 w-4 text-emerald-500" />
                {t18n('help_page.automatic_tracking')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.the_timeflow_daemon_monitors_used_applications_and_activ')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Brain className="h-4 w-4 text-purple-400" />
                {t18n('help_page.intelligent_categorization')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.a_local_machine_learning_ml_engine_learns_your_habits_wi')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <CircleDollarSign className="h-4 w-4 text-amber-500" />
                {t18n('help_page.financial_analysis')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.get_instant_insight_into_the_actual_value_of_your_work_t')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Settings className="h-4 w-4 text-blue-400" />
                {t18n('help_page.privacy_and_locality')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.your_data_is_your_property_everything_is_stored_locally')}
              </p>
            </div>
          </div>
        </CardContent>
        <div className="border-t border-border/10 p-4 pl-0">
          <Button
            variant="ghost"
            className="w-full justify-between group hover:bg-primary/5 text-primary"
            onClick={() => setCurrentPage('quickstart')}
          >
            <span className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              {t18n('help_page.launch_quick_start_tutorial')}
            </span>
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </Card>

      <div className="space-y-4 pt-4">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-light">
            {t18n('help_page.section_guide')}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={openActiveSection}
            className="w-fit border-primary/20 hover:bg-primary/5"
          >
            {activeTabValue === 'quickstart'
              ? t18n('help_page.open_full_tutorial')
              : t18n('help_page.open_this_module')}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </div>

        <Tabs
          value={activeTabValue}
          onValueChange={(value) =>
            setActiveTab(normalizeHelpTab(value, activeTabValue))
          }
          orientation="vertical"
          className="flex flex-col md:flex-row gap-0 items-start"
        >
          <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 w-full md:w-56 shrink-0 border-r border-border/10 pr-6">
            <HelpTabTrigger
              value="quickstart"
              icon={<Rocket className="h-3.5 w-3.5" />}
              label={t18n('help_page.quick_start')}
            />
            <HelpTabTrigger
              value="dashboard"
              icon={<LayoutDashboard className="h-3.5 w-3.5" />}
              label={t18n('help_page.dashboard')}
            />
            <HelpTabTrigger
              value="sessions"
              icon={<List className="h-3.5 w-3.5" />}
              label={t18n('help_page.sessions')}
            />
            <HelpTabTrigger
              value="projects"
              icon={<FolderKanban className="h-3.5 w-3.5" />}
              label={t18n('help_page.projects')}
            />
            <HelpTabTrigger
              value="estimates"
              icon={<CircleDollarSign className="h-3.5 w-3.5" />}
              label={t18n('help_page.estimates')}
            />
            <HelpTabTrigger
              value="apps"
              icon={<AppWindow className="h-3.5 w-3.5" />}
              label={t18n('help_page.applications')}
            />
            <HelpTabTrigger
              value="analysis"
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label={t18n('help_page.time_analysis')}
            />
            <HelpTabTrigger
              value="ai"
              icon={<Brain className="h-3.5 w-3.5" />}
              label={t18n('help_page.ai_model')}
            />
            <HelpTabTrigger
              value="data"
              icon={<Import className="h-3.5 w-3.5" />}
              label={t18n('help_page.data')}
            />
            <HelpTabTrigger
              value="reports"
              icon={<FileText className="h-3.5 w-3.5" />}
              label={t18n('help_page.reports')}
            />
            <HelpTabTrigger
              value="daemon"
              icon={<Cpu className="h-3.5 w-3.5" />}
              label={t18n('help_page.daemon')}
            />
            <HelpTabTrigger
              value="online-sync"
              icon={<Activity className="h-3.5 w-3.5" />}
              label={t18n('help_page.online_sync')}
            />
            <HelpTabTrigger
              value="lan-sync"
              icon={<Wifi className="h-3.5 w-3.5" />}
              label={t18n('help_page.lan_sync_title')}
            />
            <HelpTabTrigger
              value="bughunter"
              icon={<Bug className="h-3.5 w-3.5" />}
              label={t18n('help_page.bughunter')}
            />
            <HelpTabTrigger
              value="settings"
              icon={<Settings className="h-3.5 w-3.5" />}
              label={t18n('help_page.settings')}
            />
          </TabsList>

          <div className="flex-1 min-w-0 w-full pl-10">
            <TabsContent
              value="quickstart"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Rocket className="h-6 w-6" />}
                title={t18n('help_page.quick_start_2')}
                description={t18n('help_page.fast_timeflow_setup_for_a_new_install_and_first_launch')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.step_by_step_guidance_from_exe_preparation_to_launching'),
                  t18n('help_page.configuration_of_project_folders_and_app_processes_to_be'),
                  t18n('help_page.your_monitored_applications_list_should_not_stay_empty_i'),
                  t18n('help_page.first_session_assignment_and_local_ai_onboarding_instruc'),
                  t18n('help_page.accessible_from_the_sidebar_rocket_icon_and_from_the_hel'),
                  t18n('help_page.automatically_clears_the_first_run_hint_after_finishing'),
                ]}
              >
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p className="text-muted-foreground">
                    {t18n('help_page.the_full_tutorial_walks_through_installation_and_configu')}
                  </p>
                  <Button
                    variant="ghost"
                    className="mt-3 h-8 px-2 text-primary hover:bg-primary/10"
                    onClick={() => setCurrentPage('quickstart')}
                  >
                    <Rocket className="mr-2 h-3.5 w-3.5" />
                    {t18n('help_page.launch_quick_start')}
                  </Button>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="dashboard"
              className="m-0 focus-visible:outline-none"
            >
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
                ]}
              />
            </TabsContent>

            <TabsContent
              value="sessions"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<List className="h-6 w-6" />}
                title={t18n('help_page.sessions_2')}
                description={t18n('help_page.detailed_list_of_all_activity_blocks_registered_in_the_s')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.adding_comments_and_notes_right_click_a_session_to_creat'),
                  t18n('help_page.rate_multipliers_define_rate_x2_or_custom_for_higher_val'),
                  t18n('help_page.ai_suggestions_review_and_approve_or_reject_project_sugg'),
                  t18n('help_page.manual_session_addition_register_meetings_calls_or_offli'),
                  t18n('help_page.multi_day_manual_sessions_the_allow_session_across_multi'),
                  t18n('help_page.batch_assign_select_multiple_sessions_and_assign_them_to'),
                  t18n('help_page.session_badges_show_ai_assignment_confidence_and_split_rea'),
                  t18n('help_page.split_session_from_the_context_menu_or_scissors_icon_spl'),
                  t18n('help_page.split_ai_uses_overlap_first_then_learned_patterns_and_yo'),
                  t18n('help_page.view_modes_detailed_full_file_logs_compact_apps_and_sess'),
                  t18n('help_page.daily_weekly_range_mode_switch_the_sessions_list_between'),
                  t18n('help_page.sorting_and_filtering_by_application_project_date_and_du'),
                  t18n('help_page.batch_assign_from_project_header_the_group_context_menu'),
                  t18n('help_page.unassigned_only_filter_quickly_focus_on_sessions_that_st'),
                  t18n('help_page.session_split_settings_tolerance_coefficient_0_2_1_0_max'),
                  t18n('help_page.project_list_modes_in_the_assignment_menu_active_a_z_new'),
                  t18n('help_page.scissors_icon_appears_on_sessions_where_ai_detected_file'),
                  t18n('help_page.auto_split_runs_in_cycles_it_starts_after_import_and_rep'),
                  t18n('help_page.sessions_refresh_when_filters_or_data_change_and_when_yo'),
                ]}
              >
                <div className="text-sm space-y-4 text-foreground/90 leading-relaxed border-t border-border/10 pt-4">
                  <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                    {t18n('help_page.ai_data_view_interpretation')}
                  </h4>
                  <p className="text-muted-foreground">
                    {t18n('help_page.the_ai_data_view_presents_the_model_s_train_of_thought_f')}
                  </p>
                  <ul className="list-disc ml-5 space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">
                        {t18n('help_page.confidence')}
                      </strong>{' '}
                      {t18n('help_page.expressed_in_percentage_0_100_it_s_the_model_s_certainty')}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        {t18n('help_page.evidence_count')}
                      </strong>{' '}
                      {t18n('help_page.the_number_of_similar_past_sessions_you_manually_approve')}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        {t18n('help_page.score_and_base_log_prob')}
                      </strong>{' '}
                      {t18n('help_page.raw_mathematical_and_probabilistic_match_scores_calculat')}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        {t18n('help_page.matched_tokens_and_context_matches')}
                      </strong>{' '}
                      {t18n('help_page.keywords_from_filenames_windows_or_website_titles_and_ge')}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        {t18n('help_page.penalty')}
                      </strong>{' '}
                      {t18n('help_page.negative_points_if_the_model_detected_traits_suggesting')}
                    </li>
                  </ul>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="projects"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<FolderKanban className="h-6 w-6" />}
                title={t18n('help_page.projects_2')}
                description={t18n('help_page.managing_task_structure_and_intelligent_automation_of_pr')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.freezing_hide_inactive_projects_to_keep_them_from_clutte'),
                  t18n('help_page.auto_freezing_the_system_automatically_freezes_projects'),
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
            </TabsContent>

            <TabsContent
              value="estimates"
              className="m-0 focus-visible:outline-none"
            >
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
            </TabsContent>

            <TabsContent
              value="apps"
              className="m-0 focus-visible:outline-none"
            >
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
            </TabsContent>

            <TabsContent
              value="analysis"
              className="m-0 focus-visible:outline-none"
            >
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
            </TabsContent>

            <TabsContent value="ai" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Brain className="h-6 w-6" />}
                title={t18n('help_page.ai_model')}
                description={t18n('help_page.proprietary_local_ml_engine_rust_analyzing_app_context_t')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.auto_safe_mode_secure_batch_session_assignment_requires'),
                  t18n('help_page.rollback_ability_to_undo_the_last_batch_assignment_run_b'),
                  t18n('help_page.confidence_policy_set_how_certain_the_model_must_be_to_a'),
                  t18n('help_page.learning_center_every_manual_correction_of_yours_becomes'),
                  t18n('help_page.training_notifications_the_system_notifies_you_when_new'),
                  t18n('help_page.train_now_button_is_highlighted_when_sidebar_ai_status_shows_new_data'),
                  t18n('help_page.snooze_training_reminder_postpone_the_training_reminder'),
                  t18n('help_page.modes_off_manual_only_suggest_ai_hints_auto_safe_automat'),
                  t18n('help_page.ai_progress_quality_metrics_panel_shows_feedback_trends'),
                  t18n('help_page.training_horizon_set_how_many_days_of_history_e_g_30_730'),
                  t18n('help_page.auto_safe_limit_control_the_maximum_number_of_sessions_p'),
                  t18n('help_page.session_indicators_configure_indicators_displayed_on_ses'),
                  t18n('help_page.k_100_privacy_the_ml_engine_runs_locally_in_rust_doesn_t'),
                  t18n('help_page.model_status_card_diagnostic_panel_with_6_tiles_current'),
                  t18n('help_page.ai_progress_charts_two_charts_1_feedback_trend_stacked_b'),
                  t18n('help_page.summary_metrics_4_tiles_ai_precision_correct_suggestions'),
                  t18n('help_page.reset_ai_knowledge_button_that_clears_all_learned_model'),
                  t18n('help_page.how_to_train_and_configure_card_built_in_guide_with_thre'),
                  t18n('help_page.ai_status_uses_central_background_diagnostics_and_the_me'),
                ]}
              >
                <div className="text-sm space-y-4 text-foreground/90 leading-relaxed">
                  <p>
                    {t18n('help_page.timeflow_uses_a_proprietary_local_machine_learning_model')}
                  </p>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t18n('help_page.k_1_what_does_it_learn_from')}
                    </h4>
                    <p>
                      {t18n('help_page.the_model_analyzes_your_historical_manual_session_assign')}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>
                          {t18n('help_page.application_context')}:
                        </strong>{' '}
                        {t18n('help_page.which_programs_you_assign_to_which_projects')}
                      </li>
                      <li>
                        <strong>
                          {t18n('help_page.time_context')}:
                        </strong>{' '}
                        {t18n('help_page.time_of_day_and_day_of_the_week_your_work_habits')}
                      </li>
                      <li>
                        <strong>
                          {t18n('help_page.token_analysis')}:
                        </strong>{' '}
                        {t18n('help_page.keywords_extracted_from_file_names_and_windows_the_stron')}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t18n('help_page.k_2_decision_algorithm')}
                    </h4>
                    <p>
                      {t18n('help_page.the_model_doesn_t_guess_blindly_for_each_unassigned_sess')}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>
                          {t18n('help_page.confidence_2')}:
                        </strong>{' '}
                        {t18n('help_page.a_value_from_0_to_1_determined_by_a_sigmoid_function')}
                      </li>
                      <li>
                        <strong>
                          {t18n('help_page.evidence_count_2')}:
                        </strong>{' '}
                        {t18n('help_page.the_number_of_historical_proofs_confirming_the_decision')}
                      </li>
                      <li>
                        <strong>{t18n('help_page.margin')}:</strong>{' '}
                        {t18n('help_page.the_difference_between_the_best_and_second_match_protect')}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t18n('help_page.k_3_operating_modes')}
                    </h4>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>{t18n('help_page.suggest')}</strong>{' '}
                        {t18n('help_page.suggests_a_project_in_the_menu_requires_60_confidence')}
                      </li>
                      <li>
                        <strong>{t18n('help_page.auto_safe')}</strong>{' '}
                        {t18n('help_page.automatically_assigns_sessions_requires_85_confidence_an')}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t18n('help_page.k_4_optimal_learning_settings')}
                    </h4>
                    <div className="space-y-3 pl-2 text-muted-foreground">
                      <div>
                        <strong>
                          {t18n('help_page.k_1_model_operation_mode_suggest')}
                        </strong>
                        <p className="mt-1 leading-relaxed">
                          {t18n('help_page.keep_this_mode_the_ai_will_suggest_connections_categorie')}
                        </p>
                      </div>

                      <div>
                        <strong>
                          {t18n(
                            'help_page.suggest_min_confidence_0_4_0_5_lower_current_0_6',
                          )}
                        </strong>
                        <p className="mt-1 leading-relaxed">
                          {t18n('help_page.lowering_this_threshold_means_the_model_will_make_sugges')}
                        </p>
                      </div>

                      <div>
                        <strong>
                          {t18n('help_page.k_3_feedback_weight_10_15_increase_the_current_5')}
                        </strong>
                        <p className="mt-1 leading-relaxed">
                          {t18n('help_page.feedback_weight_determines_how_strongly_a_single_correct')}
                        </p>
                      </div>

                      <div>
                        <strong>
                          {t18n('help_page.k_4_criteria_for_auto_safe_for_the_future_safety')}
                        </strong>
                        <p className="mt-1 mb-1 leading-relaxed">
                          {t18n('help_page.if_after_the_learning_period_you_want_to_enable_auto_saf')}
                        </p>
                        <ul className="list-disc ml-5 space-y-1">
                          <li>
                            <strong>
                              {t18n(
                                'help_page.auto_safe_min_confidence_0_85_0_95',
                              )}
                            </strong>{' '}
                            {t18n('help_page.keep_it_high_let_it_automate_only_absolute_certainties')}
                          </li>
                          <li>
                            <strong>
                              {t18n('help_page.auto_safe_min_evidence_5')}
                            </strong>{' '}
                            {t18n('help_page.increase_from_3_this_means_the_model_must_have_strong_co')}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs italic text-muted-foreground pt-2 border-t border-border/10">
                    {t18n('help_page.all_model_data_is_stored_in_your_local_sqlite_database_a')}
                  </p>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="data"
              className="m-0 focus-visible:outline-none"
            >
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
            </TabsContent>

            <TabsContent
              value="reports"
              className="m-0 focus-visible:outline-none"
            >
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
            </TabsContent>

            <TabsContent
              value="daemon"
              className="m-0 focus-visible:outline-none"
            >
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
                ]}
              />
            </TabsContent>

            <TabsContent
              value="online-sync"
              className="m-0 focus-visible:outline-none"
            >
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
                  'Od wersji z Delta Sync: system przesyła tylko zmodyfikowane pakiety synchronizacji dla starych i nowych sesji, oszczędzając do 95% zużycia łącza.',
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
            </TabsContent>

            <TabsContent
              value="lan-sync"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Wifi className="h-6 w-6" />}
                title={t18n('help_page.lan_sync_setup_title')}
                description={t18n('help_page.lan_sync_description')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.lan_sync_master_slave'),
                  t18n('help_page.lan_sync_udp_discovery'),
                  t18n('help_page.lan_sync_http_server'),
                  t18n('help_page.lan_sync_delta_merge'),
                  t18n('help_page.lan_sync_sync_markers'),
                  t18n('help_page.lan_sync_scheduled'),
                  t18n('help_page.lan_sync_freeze'),
                  t18n('help_page.lan_sync_backup'),
                  t18n('help_page.lan_sync_auto_sync'),
                  t18n('help_page.lan_sync_peer_notification'),
                  t18n('help_page.lan_sync_sidebar_indicator'),
                  t18n('help_page.lan_sync_port_config'),
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
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="bughunter"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Bug className="h-6 w-6" />}
                title={t18n('help_page.bughunter_detail_title')}
                description={t18n('help_page.bughunter_the_bug_icon_in_the_sidebar_allows_quick_bug_r')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.bughunter_detail_what_it_does'),
                  t18n('help_page.bughunter_detail_when_to_use'),
                  t18n('help_page.bughunter_detail_limitations'),
                ]}
              >
                <HelpDetailsBlock
                  title={t18n('help_page.bughunter_detail_title')}
                  items={[
                    t18n('help_page.bughunter_detail_what_it_does'),
                    t18n('help_page.bughunter_detail_when_to_use'),
                    t18n('help_page.bughunter_detail_limitations'),
                  ]}
                />
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="settings"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Settings className="h-6 w-6" />}
                title={t18n('help_page.settings_2')}
                description={t18n('help_page.full_control_over_application_configuration_and_security')}
                footer={t18n('help_page.key_functionalities')}
                features={[
                  t18n('help_page.working_hours_define_work_hours_affects_timeline_color_s'),
                  t18n('help_page.session_management_set_session_merging_threshold_gap_fil'),
                  t18n('help_page.auto_rebuild_on_startup_automatically_rebuild_merge_sess'),
                  t18n('help_page.freeze_threshold_configure_the_number_of_days_after_whic'),
                  t18n('help_page.currency_choose_valuation_currency_pln_usd_eur_used_acro'),
                  t18n('help_page.ui_language_pl_en_language_switch_for_the_whole_dashboar'),
                  t18n('help_page.online_sync_set_up_synchronization_with_an_external_serv'),
                  t18n('help_page.lan_sync_description'),
                  t18n('help_page.device_id_a_device_identifier_is_generated_when_sync_set'),
                  t18n('help_page.the_sync_token_is_stored_in_rust_side_secure_storage_the'),
                  t18n('help_page.sync_on_startup_runs_only_when_online_sync_is_en'),
                  t18n('help_page.auto_sync_interval_configure_automatic_synchronization_i'),
                  t18n('help_page.ack_statuses_in_online_sync_the_status_area_shows_whethe'),
                  t18n('help_page.online_sync_status_panel_shows_revision_hash_and_retr'),
                  t18n('help_page.server_snapshot_pruned_scenario_if_the_server_payload_wa'),
                  t18n('help_page.sync_logging_you_can_enable_file_logging_for_synchroniza'),
                  t18n('help_page.demo_mode_switch_to_a_demo_database_test_without_affecti'),
                  t18n('help_page.demo_mode_and_sync_when_switched_to_the_demo_database_on'),
                  t18n('help_page.demo_mode_uses_a_separate_sqlite_file_and_reads_live_dai'),
                  t18n('help_page.auto_optimize_db_schedule_automatic_sqlite_optimization'),
                  t18n('help_page.emergency_clear_option_to_completely_clear_the_database'),
                  t18n('help_page.appearance_performance_disable_chart_animations_to_impro'),
                  t18n('help_page.highlight_color_choose_the_highlight_color_for_working_h'),
                  t18n('help_page.bughunter_the_bug_icon_in_the_sidebar_allows_quick_bug_r'),
                  t18n('help_page.session_split_settings_in_a_dedicated_card_tolerance_coe'),
                  t18n('help_page.danger_zone_two_step_confirmation_first_arm_the_button_t'),
                  t18n('help_page.manual_session_rebuild_button_in_the_session_management'),
                  t18n('help_page.unsaved_changes_warning_before_leaving_settings'),
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
                <HelpDetailsBlock
                  title={t18n('help_page.bughunter_detail_title')}
                  items={[
                    t18n('help_page.bughunter_detail_what_it_does'),
                    t18n('help_page.bughunter_detail_when_to_use'),
                    t18n('help_page.bughunter_detail_limitations'),
                  ]}
                />
              </SectionHelp>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

function HelpTabTrigger({
  value,
  icon,
  label,
}: {
  value: HelpTabId;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-all group rounded-l-lg',
        'data-[state=active]:bg-primary/10 data-[state=active]:text-primary',
        'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-accent/30 data-[state=inactive]:hover:text-accent-foreground',
      )}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight className="h-3 w-3 opacity-0 data-[state=active]:opacity-100 transition-opacity" />
    </TabsTrigger>
  );
}
function SectionHelp({
  icon,
  title,
  description,
  features,
  footer,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  footer: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="flex flex-row items-center gap-4 pb-4 px-0">
        <div className="p-3 rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
          {icon}
        </div>
        <div>
          <CardTitle className="text-xl font-medium tracking-tight">
            {title}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            {description}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-0">
        {children}

        <div className="mt-8">
          <h4 className="text-[10px] font-bold mb-4 uppercase tracking-[0.15em] text-muted-foreground/60 border-b border-border/10 pb-2">
            {footer}
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 text-sm group">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                <span className="text-foreground/80 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function HelpDetailsBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="text-sm space-y-4 text-foreground/90 leading-relaxed border-t border-border/10 pt-4">
      <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
        {title}
      </h4>
      <ul className="list-disc ml-5 space-y-2 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
