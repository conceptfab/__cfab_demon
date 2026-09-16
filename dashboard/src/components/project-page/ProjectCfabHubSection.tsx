import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { CfabRenderProjectState } from '@/lib/tauri/cfab-render';
import { formatDurationRaw, formatMoney } from '@/lib/utils';

type ProjectCfabHubSectionProps = {
  state: CfabRenderProjectState;
  coefficientInput: string;
  currencyCode: string;
  ingesting: boolean;
  ingestError: string | null;
  ingestInfo: string | null;
  loadError: string | null;
  saving: boolean;
  settingsError: string | null;
  integrationEnabled: boolean;
  onCoefficientInputChange: (value: string) => void;
  onSaveSettings: () => void;
  onToggleBilling: (includeInBilling: boolean) => void;
  onIngest: () => void;
};

function formatRbh(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

export function ProjectCfabHubSection({
  state,
  coefficientInput,
  currencyCode,
  ingesting,
  ingestError,
  ingestInfo,
  loadError,
  saving,
  settingsError,
  integrationEnabled,
  onCoefficientInputChange,
  onSaveSettings,
  onToggleBilling,
  onIngest,
}: ProjectCfabHubSectionProps) {
  const { t } = useTranslation();
  const days = state.days ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('project_page.cfab_hub_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="cfab-coefficient"
                className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
              >
                {t('project_page.cfab_coefficient')}
              </Label>
              <Input
                id="cfab-coefficient"
                type="number"
                min={0.0001}
                max={100}
                step="0.01"
                value={coefficientInput}
                onChange={(e) => onCoefficientInputChange(e.target.value)}
                className="h-9 w-32"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t('project_page.cfab_hourly_rate')}
              </p>
              <p className="h-9 text-lg font-light leading-9 text-emerald-400">
                {formatMoney(state.effective_hourly_rate, currencyCode)}
              </p>
            </div>
            <Button
              size="sm"
              onClick={onSaveSettings}
              disabled={saving}
            >
              {saving
                ? t('project_page.cfab_saving')
                : t('project_page.cfab_save')}
            </Button>
          </div>
          {settingsError && (
            <p className="text-xs text-destructive">{settingsError}</p>
          )}
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-secondary/20 px-4 py-3">
            <Label htmlFor="cfab-include-billing" className="text-sm">
              {t('project_page.cfab_include_in_billing')}
            </Label>
            <Switch
              id="cfab-include-billing"
              checked={state.include_in_billing}
              onCheckedChange={onToggleBilling}
              disabled={saving}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('project_page.cfab_renders_title')}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onIngest}
            disabled={ingesting || !integrationEnabled}
          >
            {ingesting && (
              <RefreshCw className="mr-2 size-3.5 animate-spin" />
            )}
            {t('project_page.cfab_ingest')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!integrationEnabled && (
            <p className="text-xs text-muted-foreground">
              {t('project_page.cfab_integration_disabled')}
            </p>
          )}
          {loadError && (
            <p className="text-xs text-destructive">{loadError}</p>
          )}
          {ingestError && (
            <p className="text-xs text-destructive">{ingestError}</p>
          )}
          {ingestInfo && (
            <p className="text-xs text-muted-foreground">{ingestInfo}</p>
          )}
          {ingesting && days.length === 0 && !ingestError && (
            <p className="py-4 text-center text-sm italic text-muted-foreground">
              {t('project_page.cfab_loading')}
            </p>
          )}
          {!ingesting && days.length === 0 && (
            <p className="py-4 text-center text-sm italic text-muted-foreground">
              {t('project_page.cfab_empty')}
            </p>
          )}
          {days.map((day) => (
            <div key={day.date} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1">
                <p className="text-sm font-medium">{day.date}</p>
                <p className="font-mono text-xs text-emerald-400">
                  {formatDurationRaw(day.render_seconds)} · {formatRbh(day.rbh)}{' '}
                  {t('project_page.cfab_rbh')} · {formatMoney(day.value, currencyCode)}
                </p>
              </div>
              <div className="space-y-1">
                {(day.rows ?? []).map((row) => (
                  <div
                    key={row.ledger_id}
                    className="grid grid-cols-1 gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/20 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3"
                  >
                    <p
                      className="truncate font-mono"
                      title={row.working_path}
                    >
                      {row.working_path}
                    </p>
                    <span className="font-mono text-muted-foreground">
                      {formatDurationRaw(row.render_seconds)}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatRbh(row.rbh)}
                    </span>
                    <span className="font-mono text-emerald-400">
                      {formatMoney(row.value, currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
