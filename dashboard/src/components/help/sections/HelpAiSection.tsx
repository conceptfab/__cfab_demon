import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SectionHelp } from '@/components/help/help-shared';

export function HelpAiSection() {
  const { t: t18n } = useTranslation();

  return (
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
        t18n('help_page.decay_half_life_controls_how_quickly_old_training_data'),
        t18n('help_page.auto_safe_limit_control_the_maximum_number_of_sessions_p'),
        t18n('help_page.session_indicators_configure_indicators_displayed_on_ses'),
        t18n('help_page.k_100_privacy_the_ml_engine_runs_locally_in_rust_doesn_t'),
        t18n('help_page.model_status_card_diagnostic_panel_with_6_tiles_current'),
        t18n('help_page.ai_progress_charts_two_charts_1_feedback_trend_stacked_b'),
        t18n('help_page.summary_metrics_4_tiles_ai_precision_correct_suggestions'),
        t18n('help_page.reset_ai_knowledge_button_that_clears_all_learned_model'),
        t18n('help_page.how_to_train_and_configure_card_built_in_guide_with_thre'),
        t18n('help_page.ai_status_uses_central_background_diagnostics_and_the_me'),
        t18n('help_page.training_blacklists_exclude_selected_applications_and_fo'),
        t18n('help_page.ai_path_inference'),
        t18n('help_page.ai_deterministic_guard'),
        t18n('help_page.ai_balanced_scoring'),
        t18n('help_page.ai_training_blacklists_config'),
        t18n('help_page.ai_folder_scan_boost'),
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
  );
}
