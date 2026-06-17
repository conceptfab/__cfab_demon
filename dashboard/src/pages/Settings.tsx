import { useSettingsPageController } from '@/hooks/useSettingsPageController';
import { SettingsView } from '@/pages/settings/SettingsView';

export function Settings() {
  const controller = useSettingsPageController();
  return <SettingsView controller={controller} />;
}
