import { useEffect, useMemo, useState } from 'react';
import {
  CircleDollarSign,
  Clock3,
  FolderOpen,
  RefreshCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { useUIStore } from '@/store/ui-store';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import {
  getEstimateSettings,
  getEstimatesSummary,
  getProjectEstimates,
  updateGlobalHourlyRate,
  updateProjectHourlyRate,
} from '@/lib/tauri';
import type {
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
} from '@/lib/db-types';
import { getErrorMessage } from '@/lib/utils';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { useTranslation } from 'react-i18next';
import { formatRateInput, parseRateInput } from '@/lib/form-validation';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { shouldRefreshEstimatesPage } from '@/lib/page-refresh-reasons';

const MAX_RATE = 100000;

export function Estimates() {
  const { t, i18n } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setSessionsFocusRange = useUIStore((s) => s.setSessionsFocusRange);
  const setSessionsFocusProject = useUIStore((s) => s.setSessionsFocusProject);
  const dateRange = useDataStore((s) => s.dateRange);
  const timePreset = useDataStore((s) => s.timePreset);
  const setTimePreset = useDataStore((s) => s.setTimePreset);
  const shiftDateRange = useDataStore((s) => s.shiftDateRange);
  const canShiftForward = useDataStore((s) => s.canShiftForward);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const currencyCode = useSettingsStore((s) => s.currencyCode);

  const [settings, setSettings] = useState<EstimateSettings | null>(null);
  const [summary, setSummary] = useState<EstimateSummary | null>(null);
  const [rows, setRows] = useState<EstimateProjectRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [globalRateInput, setGlobalRateInput] = useState('100');
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [tableMessage, setTableMessage] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  // force-refresh via useState — deliberately triggers re-render on increment
  const [dataReloadVersion, setDataReloadVersion] = useState(0);

  const locale = i18n.resolvedLanguage;
  const currency = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        maximumFractionDigits: 2,
      }),
    [currencyCode, locale],
  );
  const decimal = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [locale],
  );

  usePageRefreshListener((reasons) => {
    if (reasons.some((reason) => shouldRefreshEstimatesPage(reason))) {
      setDataReloadVersion((prev) => prev + 1);
    }
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGlobalError(null);
    setTableError(null);

    Promise.allSettled([
      getEstimateSettings(),
      getProjectEstimates(dateRange),
      getEstimatesSummary(dateRange),
    ])
      .then(([settingsRes, rowsRes, summaryRes]) => {
        if (cancelled) return;

        if (settingsRes.status === 'fulfilled') {
          setSettings(settingsRes.value);
          setGlobalRateInput(
            formatRateInput(settingsRes.value.global_hourly_rate),
          );
        } else {
          setGlobalError(
            getErrorMessage(
              settingsRes.reason,
              t('estimates_page.errors.load_global_rate'),
            ),
          );
        }

        if (rowsRes.status === 'fulfilled') {
          setRows(rowsRes.value);
          const nextDrafts: Record<number, string> = {};
          for (const row of rowsRes.value) {
            nextDrafts[row.project_id] =
              row.project_hourly_rate === null
                ? ''
                : formatRateInput(row.project_hourly_rate);
          }
          setDrafts(nextDrafts);
        } else {
          setRows([]);
          setTableError(
            getErrorMessage(
              rowsRes.reason,
              t('estimates_page.errors.load_project_estimates'),
            ),
          );
        }

        if (summaryRes.status === 'fulfilled') {
          setSummary(summaryRes.value);
        } else {
          setSummary(null);
          setTableError(
            getErrorMessage(
              summaryRes.reason,
              t('estimates_page.errors.load_summary'),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, dataReloadVersion, t]);

  const handleSaveGlobalRate = async () => {
    const parsed = parseRateInput(globalRateInput);
    if (parsed === null || parsed < 0 || parsed > MAX_RATE) {
      setGlobalError(
        t('estimates_page.validation.global_rate_range', {
          maxRate: MAX_RATE,
        }),
      );
      setGlobalMessage(null);
      return;
    }

    setSavingGlobal(true);
    setGlobalError(null);
    setGlobalMessage(null);
    try {
      await updateGlobalHourlyRate(parsed);
      setGlobalMessage(t('estimates_page.messages.global_rate_saved'));
      triggerRefresh('estimates_global_rate_saved');
    } catch (error) {
      setGlobalError(
        getErrorMessage(error, t('estimates_page.errors.save_global_rate')),
      );
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveProjectRate = async (projectId: number) => {
    const raw = drafts[projectId] ?? '';
    const parsed = parseRateInput(raw);
    if (raw.trim() && (parsed === null || parsed < 0 || parsed > MAX_RATE)) {
      setTableError(
        t('estimates_page.validation.project_rate_range', {
          maxRate: MAX_RATE,
        }),
      );
      setTableMessage(null);
      return;
    }

    setSavingProjectId(projectId);
    setTableError(null);
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, parsed);
      setTableMessage(t('estimates_page.messages.project_rate_updated'));
      triggerRefresh('estimates_project_rate_updated');
    } catch (error) {
      setTableError(
        getErrorMessage(error, t('estimates_page.errors.update_project_rate')),
      );
    } finally {
      setSavingProjectId(null);
    }
  };

  const handleResetProjectRate = async (projectId: number) => {
    setSavingProjectId(projectId);
    setTableError(null);
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, null);
      setDrafts((prev) => ({ ...prev, [projectId]: '' }));
      setTableMessage(t('estimates_page.messages.project_rate_reset'));
      triggerRefresh('estimates_project_rate_reset');
    } catch (error) {
      setTableError(
        getErrorMessage(error, t('estimates_page.errors.reset_project_rate')),
      );
    } finally {
      setSavingProjectId(null);
    }
  };

  return (
    <div className="space-y-6">
      <DateRangeToolbar
        dateRange={dateRange}
        timePreset={timePreset}
        setTimePreset={setTimePreset}
        shiftDateRange={shiftDateRange}
        canShiftForward={canShiftForward}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('estimates_page.metrics.total_hours')}
          value={
            summary
              ? `${decimal.format(summary.total_hours)} ${t('estimates_page.units.hours_short')}`
              : loading
                ? '...'
                : `0.00 ${t('estimates_page.units.hours_short')}`
          }
          icon={Clock3}
        />
        <MetricCard
          title={t('estimates_page.metrics.estimated_value')}
          value={
            summary
              ? currency.format(summary.total_value)
              : loading
                ? '...'
                : currency.format(0)
          }
          icon={CircleDollarSign}
        />
        <MetricCard
          title={t('estimates_page.metrics.active_projects')}
          value={
            summary ? String(summary.projects_count) : loading ? '...' : '0'
          }
          icon={FolderOpen}
        />
        <MetricCard
          title={t('estimates_page.metrics.rate_overrides')}
          value={
            summary ? String(summary.overrides_count) : loading ? '...' : '0'
          }
          icon={SlidersHorizontal}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            {t('estimates_page.sections.global_hourly_rate')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              max={MAX_RATE}
              step="0.01"
              value={globalRateInput}
              onChange={(e) => {
                setGlobalRateInput(e.target.value);
                setGlobalError(null);
                setGlobalMessage(null);
              }}
              className="h-9 w-48 rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="100"
            />
            <Button
              size="sm"
              onClick={handleSaveGlobalRate}
              disabled={savingGlobal}
            >
              <Save className="mr-1.5 size-3.5" />
              {savingGlobal
                ? t('estimates_page.actions.saving')
                : t('estimates_page.actions.save')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('estimates_page.labels.current')}{' '}
              {currency.format(settings?.global_hourly_rate ?? 100)}
            </span>
          </div>
          {globalError && (
            <p className="text-xs text-destructive">{globalError}</p>
          )}
          {globalMessage && !globalError && (
            <p className="text-xs text-emerald-400">{globalMessage}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            {t('estimates_page.sections.project_estimates')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tableError && (
            <p className="text-xs text-destructive">{tableError}</p>
          )}
          {tableMessage && !tableError && (
            <p className="text-xs text-emerald-400">{tableMessage}</p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t('estimates_page.states.loading_estimates')}
            </p>
          ) : rows.length === 0 ? (
            <div className="space-y-3 rounded-md border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                {t('estimates_page.empty.no_active_time')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage('projects')}
              >
                {t('estimates_page.actions.open_projects')}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1080px] space-y-2">
                <div className="grid grid-cols-[minmax(220px,1.5fr)_90px_90px_120px_130px_130px_260px] gap-2 px-2 text-xs text-muted-foreground">
                  <span>{t('estimates_page.table.project')}</span>
                  <span className="text-right">
                    {t('estimates_page.table.hours')}
                  </span>
                  <span className="text-right">
                    {t('estimates_page.table.billable')}
                  </span>
                  <span className="text-right">
                    {t('estimates_page.table.sessions')}
                  </span>
                  <span className="text-right">
                    {t('estimates_page.table.effective_rate')}
                  </span>
                  <span className="text-right">
                    {t('estimates_page.table.value')}
                  </span>
                  <span>{t('estimates_page.table.project_rate_override')}</span>
                </div>

                {rows.map((row) => {
                  const draft = drafts[row.project_id] ?? '';
                  const isSaving = savingProjectId === row.project_id;
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
                        <span
                          className="truncate text-sm font-medium"
                          title={row.project_name}
                        >
                          {row.project_name}
                        </span>
                        {row.multiplied_session_count > 0 && (
                          <AppTooltip
                            content={t(
                              'estimates_page.tooltips.multiplied_sessions',
                              { count: row.multiplied_session_count },
                            )}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-pointer shrink-0"
                              onClick={() => {
                                setSessionsFocusRange(dateRange);
                                setSessionsFocusProject(row.project_id);
                                setCurrentPage('sessions');
                              }}
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
                      </span>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={MAX_RATE}
                          step="0.01"
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.project_id]: e.target.value,
                            }))
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
