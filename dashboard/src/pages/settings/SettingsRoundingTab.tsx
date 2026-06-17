import { RoundingCard } from '@/components/settings/RoundingCard';
import { saveRoundingSettings } from '@/lib/user-settings';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsRoundingTabProps = Pick<
  SettingsPageController,
  'roundingSettings' | 'setStoreRoundingSettings' | 'triggerRefresh'
>;

export function SettingsRoundingTab({
  roundingSettings,
  setStoreRoundingSettings,
  triggerRefresh,
}: SettingsRoundingTabProps) {
  return (
    <div className="space-y-4">
      <RoundingCard
        settings={roundingSettings}
        onChange={(next) => {
          const saved = saveRoundingSettings(next);
          setStoreRoundingSettings(saved);
          triggerRefresh('settings_saved');
        }}
      />
    </div>
  );
}
