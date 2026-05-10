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
  Rocket,
  ArrowRight,
  FileText,
  Briefcase,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import {
  normalizeHelpTab,
  pageForHelpTab,
} from '@/lib/help-navigation';
import { useTranslation } from 'react-i18next';
import { getDaemonRuntimeStatus } from '@/lib/tauri';

import { HelpTabTrigger } from '@/components/help/help-shared';
import { HelpQuickStartSection } from '@/components/help/sections/HelpQuickStartSection';
import { HelpSessionsSection } from '@/components/help/sections/HelpSessionsSection';
import { HelpProjectsSection } from '@/components/help/sections/HelpProjectsSection';
import { HelpAiSection } from '@/components/help/sections/HelpAiSection';
import { HelpDataSection } from '@/components/help/sections/HelpDataSection';
import { HelpReportsSection } from '@/components/help/sections/HelpReportsSection';
import { HelpOnlineSyncSection } from '@/components/help/sections/HelpOnlineSyncSection';
import { HelpLanSyncSection } from '@/components/help/sections/HelpLanSyncSection';
import { HelpBughunterSection } from '@/components/help/sections/HelpBughunterSection';
import { HelpSettingsSection } from '@/components/help/sections/HelpSettingsSection';
import {
  HelpDashboardSection,
  HelpEstimatesSection,
  HelpAppsSection,
  HelpAnalysisSection,
  HelpDaemonSection,
  HelpPmSection,
} from '@/components/help/sections/HelpSimpleSections';

export function Help() {
  const { t: t18n } = useTranslation();
  const activeTab = useUIStore((s) => s.helpTab);
  const setActiveTab = useUIStore((s) => s.setHelpTab);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);

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
                className="size-11 object-contain"
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
            <Info className="size-5 text-primary" />
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
                <Activity className="size-4 text-emerald-500" />
                {t18n('help_page.automatic_tracking')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.the_timeflow_daemon_monitors_used_applications_and_activ')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Brain className="size-4 text-purple-400" />
                {t18n('help_page.intelligent_categorization')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.a_local_machine_learning_ml_engine_learns_your_habits_wi')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <CircleDollarSign className="size-4 text-amber-500" />
                {t18n('help_page.financial_analysis')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t18n('help_page.get_instant_insight_into_the_actual_value_of_your_work_t')}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Settings className="size-4 text-blue-400" />
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
              <Rocket className="size-4" />
              {t18n('help_page.launch_quick_start_tutorial')}
            </span>
            <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
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
            <ArrowRight className="ml-2 size-3.5" />
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
            <HelpTabTrigger value="quickstart" icon={<Rocket className="size-3.5" />} label={t18n('help_page.quick_start')} />
            <HelpTabTrigger value="dashboard" icon={<LayoutDashboard className="size-3.5" />} label={t18n('help_page.dashboard')} />
            <HelpTabTrigger value="sessions" icon={<List className="size-3.5" />} label={t18n('help_page.sessions')} />
            <HelpTabTrigger value="projects" icon={<FolderKanban className="size-3.5" />} label={t18n('help_page.projects')} />
            <HelpTabTrigger value="estimates" icon={<CircleDollarSign className="size-3.5" />} label={t18n('help_page.estimates')} />
            <HelpTabTrigger value="apps" icon={<AppWindow className="size-3.5" />} label={t18n('help_page.applications')} />
            <HelpTabTrigger value="analysis" icon={<BarChart3 className="size-3.5" />} label={t18n('help_page.time_analysis')} />
            <HelpTabTrigger value="ai" icon={<Brain className="size-3.5" />} label={t18n('help_page.ai_model')} />
            <HelpTabTrigger value="data" icon={<Import className="size-3.5" />} label={t18n('help_page.data')} />
            <HelpTabTrigger value="reports" icon={<FileText className="size-3.5" />} label={t18n('help_page.reports')} />
            <HelpTabTrigger value="pm" icon={<Briefcase className="size-3.5" />} label={t18n('help_page.pm')} />
            <HelpTabTrigger value="daemon" icon={<Cpu className="size-3.5" />} label={t18n('help_page.daemon')} />
            <HelpTabTrigger value="online-sync" icon={<Activity className="size-3.5" />} label={t18n('help_page.online_sync')} />
            <HelpTabTrigger value="lan-sync" icon={<Wifi className="size-3.5" />} label={t18n('help_page.lan_sync_title')} />
            <HelpTabTrigger value="bughunter" icon={<Bug className="size-3.5" />} label={t18n('help_page.bughunter')} />
            <HelpTabTrigger value="settings" icon={<Settings className="size-3.5" />} label={t18n('help_page.settings')} />
          </TabsList>

          <div className="flex-1 min-w-0 w-full pl-10">
            <TabsContent value="quickstart" className="m-0 focus-visible:outline-none">
              <HelpQuickStartSection />
            </TabsContent>
            <TabsContent value="dashboard" className="m-0 focus-visible:outline-none">
              <HelpDashboardSection />
            </TabsContent>
            <TabsContent value="sessions" className="m-0 focus-visible:outline-none">
              <HelpSessionsSection />
            </TabsContent>
            <TabsContent value="projects" className="m-0 focus-visible:outline-none">
              <HelpProjectsSection />
            </TabsContent>
            <TabsContent value="estimates" className="m-0 focus-visible:outline-none">
              <HelpEstimatesSection />
            </TabsContent>
            <TabsContent value="apps" className="m-0 focus-visible:outline-none">
              <HelpAppsSection />
            </TabsContent>
            <TabsContent value="analysis" className="m-0 focus-visible:outline-none">
              <HelpAnalysisSection />
            </TabsContent>
            <TabsContent value="ai" className="m-0 focus-visible:outline-none">
              <HelpAiSection />
            </TabsContent>
            <TabsContent value="data" className="m-0 focus-visible:outline-none">
              <HelpDataSection />
            </TabsContent>
            <TabsContent value="reports" className="m-0 focus-visible:outline-none">
              <HelpReportsSection />
            </TabsContent>
            <TabsContent value="pm" className="m-0 focus-visible:outline-none">
              <HelpPmSection />
            </TabsContent>
            <TabsContent value="daemon" className="m-0 focus-visible:outline-none">
              <HelpDaemonSection />
            </TabsContent>
            <TabsContent value="online-sync" className="m-0 focus-visible:outline-none">
              <HelpOnlineSyncSection />
            </TabsContent>
            <TabsContent value="lan-sync" className="m-0 focus-visible:outline-none">
              <HelpLanSyncSection />
            </TabsContent>
            <TabsContent value="bughunter" className="m-0 focus-visible:outline-none">
              <HelpBughunterSection />
            </TabsContent>
            <TabsContent value="settings" className="m-0 focus-visible:outline-none">
              <HelpSettingsSection />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
