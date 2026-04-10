import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import { SectionHelp } from '@/components/help/help-shared';

export function HelpQuickStartSection() {
  const { t: t18n } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);

  return (
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
        t18n('help_page.quickstart_sync_overview'),
        t18n('help_page.quickstart_reports_overview'),
        t18n('help_page.quickstart_pm_overview'),
        t18n('help_page.quickstart_backup_export'),
        t18n('help_page.quickstart_f1_shortcut'),
        t18n('help_page.quickstart_rerun_info'),
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
  );
}
