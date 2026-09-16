import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { databaseApi, settingsApi, cfabRenderApi } from '@/lib/tauri';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsIntegrationTabProps = SettingsPageController;

const STATUS_KEYS: Record<string, string> = {
  disabled: 'settings_page.integration_status_disabled',
  ok: 'settings_page.integration_status_ok',
  missing: 'settings_page.integration_status_missing',
  unreadable: 'settings_page.integration_status_unreadable',
  missing_table: 'settings_page.integration_status_missing_table',
};

export function SettingsIntegrationTab({
  cfabHubIntegration,
  labelClassName,
  savedSettings,
  t,
  updateCfabHubIntegration,
}: SettingsIntegrationTabProps) {
  const [ownDbPath, setOwnDbPath] = useState('');
  const [status, setStatus] = useState('ok');

  const refreshStatus = async (
    enabled = cfabHubIntegration.enabled,
    hubDbPath = cfabHubIntegration.hubDbPath,
  ) => {
    if (!enabled) {
      setStatus('disabled');
      return;
    }
    try {
      const next = await cfabRenderApi.probeCfabHubDb(hubDbPath || null);
      setStatus(next);
    } catch {
      setStatus('unreadable');
    }
  };

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getDemoModeStatus()
      .then((info) => {
        if (!cancelled) setOwnDbPath(info.primaryDbPath);
      })
      .catch(() => {
        if (!cancelled) setOwnDbPath('');
      });
    void refreshStatus();
    return () => {
      cancelled = true;
    };
    // Tab mount = open: probe once, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (savedSettings) {
      void refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSettings]);

  const copyOwnPath = () => {
    if (ownDbPath) void navigator.clipboard.writeText(ownDbPath);
  };

  const chooseHubDb = async () => {
    const selected = await open({
      filters: [
        {
          name: t('settings_page.integration_sqlite_filter'),
          extensions: ['db'],
        },
      ],
      multiple: false,
      title: t('settings_page.integration_choose_file'),
    });
    if (selected && typeof selected === 'string') {
      updateCfabHubIntegration({
        ...cfabHubIntegration,
        hubDbPath: selected,
      });
      void refreshStatus(cfabHubIntegration.enabled, selected);
    }
  };

  const restoreDefault = () => {
    updateCfabHubIntegration({ ...cfabHubIntegration, hubDbPath: '' });
    void refreshStatus(cfabHubIntegration.enabled, '');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">
            {t('settings_page.integration_title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('settings_page.integration_description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="cfabHubIntegrationEnabled"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t('settings_page.integration_enable_title')}
              </p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {t('settings_page.integration_enable_description')}
              </p>
            </div>
            <Switch
              id="cfabHubIntegrationEnabled"
              checked={cfabHubIntegration.enabled}
              onCheckedChange={(enabled) => {
                updateCfabHubIntegration({ ...cfabHubIntegration, enabled });
                void refreshStatus(enabled, cfabHubIntegration.hubDbPath);
              }}
            />
          </label>

          <div className="space-y-2 rounded-md border border-border/70 bg-background/35 p-3">
            <Label className={labelClassName}>
              {t('settings_page.integration_own_db')}
            </Label>
            <p className="truncate font-mono text-xs" title={ownDbPath}>
              {ownDbPath || t('settings_page.integration_own_db_unknown')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyOwnPath}>
                {t('settings_page.integration_copy')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void databaseApi.openDbFolder();
                }}
              >
                {t('settings_page.integration_open_folder')}
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border/70 bg-background/35 p-3">
            <Label htmlFor="cfabHubDbPath" className={labelClassName}>
              {t('settings_page.integration_hub_db')}
            </Label>
            <Input
              id="cfabHubDbPath"
              value={cfabHubIntegration.hubDbPath}
              placeholder={t('settings_page.integration_hub_placeholder')}
              onChange={(event) => {
                updateCfabHubIntegration({
                  ...cfabHubIntegration,
                  hubDbPath: event.target.value,
                });
              }}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void chooseHubDb()}>
                {t('settings_page.integration_choose_file')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={restoreDefault}>
                {t('settings_page.integration_restore_default')}
              </Button>
            </div>
          </div>

          <p
            className={`text-sm ${
              status === 'ok'
                ? 'text-emerald-400'
                : status === 'disabled'
                  ? 'text-muted-foreground'
                  : 'text-destructive'
            }`}
            data-state={status}
          >
            {t(STATUS_KEYS[status] ?? STATUS_KEYS.unreadable)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
