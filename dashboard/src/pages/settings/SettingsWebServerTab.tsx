import { WebServerCard } from '@/components/settings/WebServerCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsWebServerTabProps = Pick<SettingsPageController, 'myIp' | 't'>;

export function SettingsWebServerTab({ myIp, t }: SettingsWebServerTabProps) {
  return (
    <div className="space-y-4">
      <WebServerCard
        myIp={myIp}
        title={t('settings.webserver.title')}
        description={t('settings.webserver.description')}
      />
    </div>
  );
}
