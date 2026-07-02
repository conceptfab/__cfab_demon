import { McpServerCard } from '@/components/settings/McpServerCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsMcpTabProps = Pick<SettingsPageController, 't'>;

export function SettingsMcpTab({ t }: SettingsMcpTabProps) {
  return (
    <div className="space-y-4">
      <McpServerCard
        title={t('settings.mcp.title')}
        description={t('settings.mcp.description')}
      />
    </div>
  );
}
