import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

type OnlineSyncLicenseSectionProps = Pick<
  OnlineSyncCardProps,
  | 'licenseActivating'
  | 'licenseError'
  | 'licenseInfo'
  | 'licenseKeyInput'
  | 'onActivateLicense'
  | 'onDeactivateLicense'
  | 'onLicenseKeyChange'
>;

export function OnlineSyncLicenseSection({
  licenseActivating,
  licenseError,
  licenseInfo,
  licenseKeyInput,
  onActivateLicense,
  onDeactivateLicense,
  onLicenseKeyChange,
}: OnlineSyncLicenseSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('settings.license.title')}</span>
      </div>
      {licenseInfo ? (
        <div className="grid gap-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              {t('settings.license.active')}
            </span>
            <span className="font-mono text-muted-foreground">
              {licenseInfo.plan.toUpperCase()}
            </span>
            <button
              type="button"
              className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
              onClick={onDeactivateLicense}
            >
              {t('settings.license.deactivate', 'Change license')}
            </button>
          </div>
          <div className="text-muted-foreground">
            {t('settings.license.group')}:{' '}
            <span className="text-foreground">{licenseInfo.groupName}</span>
          </div>
          <div className="text-muted-foreground">
            {t('settings.license.devices')}:{' '}
            <span className="text-foreground">
              {licenseInfo.activeDevices}/{licenseInfo.maxDevices}
            </span>
          </div>
          {licenseInfo.expiresAt && (
            <div className="text-muted-foreground">
              {/* eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app) */}
              {t('settings.license.expires')}:{' '}
              <span className="text-foreground">
                {new Date(licenseInfo.expiresAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm shadow-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={t('settings.license.key_placeholder')}
              aria-label={t('settings.license.key_placeholder')}
              value={licenseKeyInput}
              onChange={(e) => onLicenseKeyChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && licenseKeyInput.trim()) {
                  onActivateLicense();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 whitespace-nowrap"
              onClick={onActivateLicense}
              disabled={licenseActivating || !licenseKeyInput.trim()}
            >
              {licenseActivating
                ? t('settings.license.activating')
                : t('settings.license.activate')}
            </Button>
          </div>
          {licenseError && (
            <p className="text-xs text-destructive">{licenseError}</p>
          )}
        </div>
      )}
    </div>
  );
}
