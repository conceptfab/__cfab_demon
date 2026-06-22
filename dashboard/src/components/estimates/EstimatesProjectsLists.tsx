import { CircleDollarSign, RefreshCw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { roundedAlternativeFromDaily } from '@/lib/utils';
import { MAX_ESTIMATE_RATE } from '@/pages/estimates-page-state';
import type { EstimatesPageController } from '@/hooks/useEstimatesPageController';

type EstimatesProjectsListProps = Pick<
  EstimatesPageController,
  | 'currency'
  | 'decimal'
  | 'drafts'
  | 'handleResetProjectRate'
  | 'handleSaveProjectRate'
  | 'openBoostedSessions'
  | 'openProjectPage'
  | 'rows'
  | 'savingProjectId'
  | 'updateProjectDraft'
>;

export function EstimatesProjectsMobileList({
  currency,
  decimal,
  drafts,
  handleResetProjectRate,
  handleSaveProjectRate,
  openProjectPage,
  rows,
  savingProjectId,
  updateProjectDraft,
}: EstimatesProjectsListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 md:hidden">
      {rows.map((row) => {
        const draft = drafts[row.project_id] ?? '';
        const isSaving = savingProjectId === row.project_id;
        const altSec = roundedAlternativeFromDaily(
          row.seconds,
          row.daily_seconds,
        );
        const altHours = altSec !== null ? altSec / 3600 : null;
        // Wartość skalujemy względem NIEZAOKRĄGLONYCH sekund (row.hours*3600), spójnie z
        // backendowym estimated_value. Mianownik row.seconds (= round) dawał np. 799,99 zamiast 800.
        const altValue =
          altSec !== null && row.hours > 0
            ? row.estimated_value * (altSec / (row.hours * 3600))
            : null;
        return (
          <div
            key={row.project_id}
            className="space-y-3 rounded-md border border-border/60 p-3"
          >
            <div className="flex min-w-0 items-start gap-2">
              <span
                className="mt-1 size-3 shrink-0 rounded-full"
                style={{ backgroundColor: row.project_color }}
              />
              <button
                type="button"
                onClick={() => openProjectPage(row.project_id)}
                className="min-h-9 min-w-0 flex-1 break-words py-1 text-left text-sm font-medium hover:text-sky-400"
              >
                {row.project_name}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">
                  {t('estimates_page.table.hours')}
                </p>
                <p className="font-mono text-sm">
                  {decimal.format(row.hours)}
                  {altHours !== null && (
                    <span className="ml-1 text-[10px] opacity-60">
                      ≈{decimal.format(altHours)}
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t('estimates_page.table.billable')}
                </p>
                <p className="font-mono text-sm">
                  {row.weighted_hours !== row.hours ? (
                    <span className="text-emerald-400">
                      {decimal.format(row.weighted_hours)}
                    </span>
                  ) : (
                    decimal.format(row.weighted_hours)
                  )}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t('estimates_page.table.sessions')}
                </p>
                <p className="font-mono text-sm">{row.session_count}</p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t('estimates_page.table.value')}
                </p>
                <p className="font-mono text-sm">
                  {currency.format(row.estimated_value)}
                  {altValue !== null && (
                    <span className="ml-1 text-[10px] opacity-60">
                      ≈{currency.format(altValue)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t('estimates_page.table.project_rate_override')}
              </p>
              <div className="flex flex-col gap-2">
                <input
                  type="number"
                  min={0}
                  max={MAX_ESTIMATE_RATE}
                  step="0.01"
                  aria-label={t('estimates_page.table.project_rate_override')}
                  value={draft}
                  onChange={(e) =>
                    updateProjectDraft(row.project_id, e.target.value)
                  }
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={t('estimates_page.placeholders.global')}
                  disabled={isSaving}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 sm:h-8"
                    onClick={() => handleSaveProjectRate(row.project_id)}
                    disabled={isSaving}
                  >
                    {isSaving
                      ? t('estimates_page.actions.saving')
                      : t('estimates_page.actions.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 sm:h-8"
                    onClick={() => handleResetProjectRate(row.project_id)}
                    disabled={isSaving}
                  >
                    {t('estimates_page.actions.reset')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EstimatesProjectsDesktopTable({
  currency,
  decimal,
  drafts,
  handleResetProjectRate,
  handleSaveProjectRate,
  openBoostedSessions,
  openProjectPage,
  rows,
  savingProjectId,
  updateProjectDraft,
}: EstimatesProjectsListProps) {
  const { t } = useTranslation();

  return (
    <div className="hidden overflow-x-auto md:block">
      <div className="min-w-[1080px] space-y-2">
        <div className="grid grid-cols-[minmax(220px,1.5fr)_90px_90px_120px_130px_130px_260px] gap-2 px-2 text-xs text-muted-foreground">
          <span>{t('estimates_page.table.project')}</span>
          <span className="text-right">{t('estimates_page.table.hours')}</span>
          <span className="text-right">
            {t('estimates_page.table.billable')}
          </span>
          <span className="text-right">
            {t('estimates_page.table.sessions')}
          </span>
          <span className="text-right">
            {t('estimates_page.table.effective_rate')}
          </span>
          <span className="text-right">{t('estimates_page.table.value')}</span>
          <span>{t('estimates_page.table.project_rate_override')}</span>
        </div>

        {rows.map((row) => {
          const draft = drafts[row.project_id] ?? '';
          const isSaving = savingProjectId === row.project_id;
          const altSec = roundedAlternativeFromDaily(
            row.seconds,
            row.daily_seconds,
          );
          const altHours = altSec !== null ? altSec / 3600 : null;
          // Wartość skalujemy względem NIEZAOKRĄGLONYCH sekund (row.hours*3600), spójnie z
          // backendowym estimated_value. Mianownik row.seconds (= round) dawał np. 799,99 zamiast 800.
          const altValue =
            altSec !== null && row.hours > 0
              ? row.estimated_value * (altSec / (row.hours * 3600))
              : null;
          return (
            <div
              key={row.project_id}
              className="grid grid-cols-[minmax(220px,1.5fr)_90px_90px_120px_130px_130px_260px] gap-2 rounded-md border p-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.project_color }}
                />
                <button
                  type="button"
                  onClick={() => openProjectPage(row.project_id)}
                  className="truncate text-left text-sm font-medium hover:text-sky-400"
                  title={row.project_name}
                >
                  {row.project_name}
                </button>
                {row.multiplied_session_count > 0 && (
                  <AppTooltip
                    content={t('estimates_page.tooltips.multiplied_sessions', {
                      count: row.multiplied_session_count,
                    })}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer shrink-0"
                      onClick={() => openBoostedSessions(row.project_id)}
                    >
                      <CircleDollarSign className="size-3" />
                      {row.multiplied_session_count}{' '}
                      {t('estimates_page.labels.boosted')}
                    </button>
                  </AppTooltip>
                )}
              </div>

              <span className="text-right font-mono text-sm">
                {decimal.format(row.hours)}
                {altHours !== null && (
                  <span className="block text-[10px] opacity-60">
                    ≈{decimal.format(altHours)}
                  </span>
                )}
              </span>

              <span
                className="text-right font-mono text-sm"
                title={
                  row.weighted_hours !== row.hours
                    ? t('estimates_page.tooltips.bonus_hours', {
                        bonusHours: decimal.format(
                          row.multiplier_extra_seconds / 3600,
                        ),
                      })
                    : undefined
                }
              >
                {row.weighted_hours !== row.hours ? (
                  <span className="text-emerald-400">
                    {decimal.format(row.weighted_hours)}
                  </span>
                ) : (
                  decimal.format(row.weighted_hours)
                )}
              </span>

              <span className="text-right font-mono text-sm">
                {row.session_count}
              </span>

              <span className="text-right font-mono text-sm">
                {currency.format(row.effective_hourly_rate)}
              </span>

              <span className="text-right font-mono text-sm">
                {currency.format(row.estimated_value)}
                {altValue !== null && (
                  <span className="block text-[10px] opacity-60">
                    ≈{currency.format(altValue)}
                  </span>
                )}
              </span>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={MAX_ESTIMATE_RATE}
                  step="0.01"
                  aria-label={t('estimates_page.table.project_rate_override')}
                  value={draft}
                  onChange={(e) =>
                    updateProjectDraft(row.project_id, e.target.value)
                  }
                  className="h-8 w-24 rounded-md border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={t('estimates_page.placeholders.global')}
                  disabled={isSaving}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSaveProjectRate(row.project_id)}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                      {t('estimates_page.actions.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="mr-1.5 size-3.5" />
                      {t('estimates_page.actions.save')}
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleResetProjectRate(row.project_id)}
                  disabled={isSaving}
                >
                  {t('estimates_page.actions.reset')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
