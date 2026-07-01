import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { generateGroupPassphrase } from '@/lib/tauri/online-sync';
import { decodeGroupSecret, encodeGroupSecret } from '@/lib/group-secret-codec';
import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

type OnlineSyncLicenseSectionProps = Pick<
  OnlineSyncCardProps,
  | 'licenseActivating'
  | 'licenseError'
  | 'licenseInfo'
  | 'licenseKeyInput'
  | 'groupPassphrase'
  | 'onGroupPassphraseChange'
  | 'onActivateLicense'
  | 'onDeactivateLicense'
  | 'onLicenseKeyChange'
>;

function PassphraseSection({
  groupPassphrase,
  onGroupPassphraseChange,
}: Pick<OnlineSyncLicenseSectionProps, 'groupPassphrase' | 'onGroupPassphraseChange'>) {
  const { t } = useTranslation();
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasPassphrase = groupPassphrase.length > 0;
  const exportCode = hasPassphrase ? encodeGroupSecret(groupPassphrase) : '';

  const handleCopy = () => {
    void navigator.clipboard?.writeText(exportCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleImport = () => {
    const decoded = decodeGroupSecret(importValue);
    if (!decoded) {
      setImportError(t('settings.license.passphrase_import_invalid'));
      return;
    }
    setImportError(null);
    setImportValue('');
    onGroupPassphraseChange(decoded);
  };

  return (
    <div className="grid gap-2 rounded-md border border-border/50 bg-background/20 p-2.5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t('settings.license.passphrase_title')}</span>
        <span
          className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            hasPassphrase
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border border-zinc-600/40 bg-zinc-700/20 text-zinc-400'
          }`}
        >
          {hasPassphrase
            ? t('settings.license.passphrase_set')
            : t('settings.license.passphrase_none')}
        </span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {t('settings.license.passphrase_desc')}
      </p>

      {hasPassphrase ? (
        <div className="grid gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {t('settings.license.passphrase_export_label')}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground focus-visible:outline-none"
              value={exportCode}
              aria-label={t('settings.license.passphrase_export_label')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" className="h-8 whitespace-nowrap" onClick={handleCopy}>
              {copied ? t('settings.license.passphrase_copied') : t('settings.license.passphrase_copy')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 whitespace-nowrap"
              onClick={() => onGroupPassphraseChange(generateGroupPassphrase())}
            >
              {t('settings.license.passphrase_regenerate')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 whitespace-nowrap text-red-400 hover:text-red-300"
              onClick={() => onGroupPassphraseChange('')}
            >
              {t('settings.license.passphrase_clear')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="h-8 w-fit whitespace-nowrap"
            onClick={() => onGroupPassphraseChange(generateGroupPassphrase())}
          >
            {t('settings.license.passphrase_generate')}
          </Button>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={t('settings.license.passphrase_import_placeholder')}
              aria-label={t('settings.license.passphrase_import_placeholder')}
              value={importValue}
              onChange={(e) => {
                setImportValue(e.target.value);
                setImportError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && importValue.trim()) handleImport();
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-8 whitespace-nowrap"
              onClick={handleImport}
              disabled={!importValue.trim()}
            >
              {t('settings.license.passphrase_import')}
            </Button>
          </div>
          {importError && <p className="text-[11px] text-destructive">{importError}</p>}
        </div>
      )}
    </div>
  );
}

export function OnlineSyncLicenseSection({
  licenseActivating,
  licenseError,
  licenseInfo,
  licenseKeyInput,
  groupPassphrase,
  onGroupPassphraseChange,
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
        <>
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
          <PassphraseSection
            groupPassphrase={groupPassphrase}
            onGroupPassphraseChange={onGroupPassphraseChange}
          />
        </>
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
