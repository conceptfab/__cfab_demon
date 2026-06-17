import type { SettingsPageController } from '@/hooks/useSettingsPageController';
import { SETTINGS_TAB_IDS } from '@/pages/settings/settings-page-constants';

type SettingsTabNavProps = Pick<
  SettingsPageController,
  'activeTab' | 'setActiveTab' | 'tabMeta'
>;

export function SettingsTabNav({
  activeTab,
  setActiveTab,
  tabMeta,
}: SettingsTabNavProps) {
  return (
    <div
      className="grid max-w-full grid-cols-2 gap-1 border-b border-border/50 px-1 pb-1 sm:flex sm:overflow-x-auto"
      role="tablist"
    >
      {SETTINGS_TAB_IDS.map((id) => (
        <button
          type="button"
          key={id}
          role="tab"
          aria-selected={activeTab === id}
          aria-controls={`settings-tabpanel-${id}`}
          className={`min-h-9 rounded-t border-b-2 px-2 py-2 text-center text-xs font-medium transition-colors sm:-mb-px sm:shrink-0 sm:px-4 sm:text-sm ${
            activeTab === id
              ? tabMeta[id].active
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab(id)}
        >
          {tabMeta[id].label}
        </button>
      ))}
    </div>
  );
}
