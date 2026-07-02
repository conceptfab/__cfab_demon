import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { mobileLayout } from '@/lib/mobile-layout';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';
import { SettingsAdvancedTab } from '@/pages/settings/SettingsAdvancedTab';
import { SettingsAlgorithmTab } from '@/pages/settings/SettingsAlgorithmTab';
import { SettingsGeneralTab } from '@/pages/settings/SettingsGeneralTab';
import { SettingsPmTab } from '@/pages/settings/SettingsPmTab';
import { SettingsRoundingTab } from '@/pages/settings/SettingsRoundingTab';
import { SettingsSessionsTab } from '@/pages/settings/SettingsSessionsTab';
import { SettingsSyncTab } from '@/pages/settings/SettingsSyncTab';
import { SettingsTabNav } from '@/pages/settings/SettingsTabNav';
import { SettingsWebServerTab } from '@/pages/settings/SettingsWebServerTab';
import { SettingsMcpTab } from '@/pages/settings/SettingsMcpTab';

interface SettingsViewProps {
  controller: SettingsPageController;
}

export function SettingsView({ controller }: SettingsViewProps) {
  const {
    activeTab,
    confirmDialogProps,
    handleSaveSettings,
    savedSettings,
    t,
  } = controller;

  return (
    <div
      className={`${mobileLayout.pageContainer} max-w-3xl overflow-x-hidden sm:space-y-8`}
    >
      <SettingsTabNav
        activeTab={controller.activeTab}
        setActiveTab={controller.setActiveTab}
        tabMeta={controller.tabMeta}
      />

      {activeTab === 'general' && <SettingsGeneralTab {...controller} />}
      {activeTab === 'sessions' && <SettingsSessionsTab {...controller} />}
      {activeTab === 'algorithm' && <SettingsAlgorithmTab {...controller} />}
      {activeTab === 'rounding' && <SettingsRoundingTab {...controller} />}
      {activeTab === 'sync' && <SettingsSyncTab {...controller} />}
      {activeTab === 'pm' && <SettingsPmTab />}
      {activeTab === 'webserver' && <SettingsWebServerTab {...controller} />}
      {activeTab === 'mcp' && <SettingsMcpTab {...controller} />}
      {activeTab === 'advanced' && <SettingsAdvancedTab {...controller} />}

      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {!savedSettings && (
          <Button
            className="h-8 min-w-[7rem] rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 animate-shine text-white border-none font-black text-[10px] uppercase tracking-wider"
            onClick={handleSaveSettings}
          >
            {t('settings_page.save_changes')}
          </Button>
        )}
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
