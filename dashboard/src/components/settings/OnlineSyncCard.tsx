import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OnlineSyncConnectionFields } from '@/components/settings/online-sync/OnlineSyncConnectionFields';
import { OnlineSyncLicenseSection } from '@/components/settings/online-sync/OnlineSyncLicenseSection';
import { OnlineSyncStatusPanel } from '@/components/settings/online-sync/OnlineSyncStatusPanel';
import { OnlineSyncToggleOptions } from '@/components/settings/online-sync/OnlineSyncToggleOptions';
import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

export type { OnlineSyncCardProps };

export function OnlineSyncCard(props: OnlineSyncCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">
          {t('settings_page.online_sync')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'settings_page.startup_synchronization_with_remote_server_using_snapsho',
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <OnlineSyncLicenseSection {...props} />
        <OnlineSyncToggleOptions {...props} />

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
          <OnlineSyncConnectionFields {...props} />
          <OnlineSyncStatusPanel {...props} />
        </div>
      </CardContent>
    </Card>
  );
}
