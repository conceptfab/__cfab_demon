import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp } from '@/components/help/help-shared';

export function HelpSessionsSection() {
  const { t: t18n } = useTranslation();

  return (
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
        t18n('help_page.merge_sessions_select_two_or_more_adjacent_sessions_from'),
        t18n('help_page.sessions_multi_split_modal'),
        t18n('help_page.sessions_project_context_menu'),
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
  );
}
