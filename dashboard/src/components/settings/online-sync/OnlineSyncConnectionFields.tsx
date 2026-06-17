import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

type OnlineSyncConnectionFieldsProps = Pick<
  OnlineSyncCardProps,
  | 'defaultServerUrl'
  | 'labelClassName'
  | 'onApiTokenChange'
  | 'onResetServerUrl'
  | 'onServerUrlChange'
  | 'onShowTokenChange'
  | 'onUserIdChange'
  | 'settings'
  | 'showToken'
>;

export function OnlineSyncConnectionFields({
  defaultServerUrl,
  labelClassName,
  onApiTokenChange,
  onResetServerUrl,
  onServerUrlChange,
  onShowTokenChange,
  onUserIdChange,
  settings,
  showToken,
}: OnlineSyncConnectionFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <label className="grid gap-1.5 text-sm">
        <span className={labelClassName}>{t('settings_page.server_url')}</span>
        <input
          type="text"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder={defaultServerUrl}
          value={settings.serverUrl}
          onChange={(e) => onServerUrlChange(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onResetServerUrl}
          >
            {t('settings.online_sync.useRailwayDefault')}
          </Button>
          <span className="text-xs text-muted-foreground break-all">
            {defaultServerUrl}
          </span>
        </div>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className={labelClassName}>{t('settings_page.user_id')}</span>
        <input
          type="text"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          placeholder={t('settings_page.user_id_placeholder')}
          value={settings.userId}
          onChange={(e) => onUserIdChange(e.target.value)}
        />
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className={labelClassName}>
          {t('settings_page.api_token_bearer')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder={t(
              'settings_page.paste_the_raw_token_without_bearer_prefix_and_without_qu',
            )}
            value={settings.apiToken}
            onChange={(e) => onApiTokenChange(e.target.value)}
          />
          <AppTooltip
            content={
              showToken
                ? t('settings_page.hide_token')
                : t('settings_page.show_token')
            }
          >
            <Button
              type="button"
              variant="outline"
              className="h-9 w-10 px-0"
              onClick={() => onShowTokenChange(!showToken)}
              aria-label={
                showToken
                  ? t('settings_page.hide_token')
                  : t('settings_page.show_token')
              }
            >
              {showToken ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </Button>
          </AppTooltip>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings.apiToken
            ? t('settings_page.token_set_auto')
            : t(
                'settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a',
              )}
        </p>
      </label>

      <div className="grid gap-1.5 text-sm">
        <span className={labelClassName}>{t('settings_page.device_id')}</span>
        <div className="rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs break-all">
          {settings.deviceId || t('settings_page.generated_on_save')}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            'settings_page.generated_automatically_and_used_to_identify_this_machin',
          )}
        </p>
      </div>
    </>
  );
}
