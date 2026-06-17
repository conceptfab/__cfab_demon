import {
  CircleDollarSign,
  Clock3,
  FolderOpen,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { DateRangeToolbar } from '@/components/ui/DateRangeToolbar';
import { mobileLayout } from '@/lib/mobile-layout';
import { EstimatesProjectsSection } from '@/components/estimates/EstimatesProjectsSection';
import { EstimatesClientFilter } from '@/components/estimates/EstimatesClientFilter';
import { EstimatesReportButton } from '@/components/estimates/EstimatesReportButton';
import { EstimatesRangePicker } from '@/components/estimates/EstimatesRangePicker';
import { roundedEstimatesSummary } from '@/lib/estimate-report';
import { loadRoundingSettings } from '@/lib/user-settings';
import { MAX_ESTIMATE_RATE } from '@/pages/estimates-page-state';
import type { EstimatesPageController } from '@/hooks/useEstimatesPageController';

interface EstimatesViewProps {
  controller: EstimatesPageController;
}

export function EstimatesView({ controller }: EstimatesViewProps) {
  const { t } = useTranslation();
  const {
    canShiftForward,
    clearClientFilter,
    clientOptions,
    currency,
    dateRange,
    decimal,
    filteredRows,
    filteredSummary,
    generateEstimateReport,
    globalError,
    globalMessage,
    globalRateInput,
    handleSaveGlobalRate,
    loading,
    savingGlobal,
    selectedClients,
    setDateRange,
    setTimePreset,
    settings,
    shiftDateRange,
    timePreset,
    toggleClient,
    updateGlobalRateInput,
  } = controller;

  // Zaokrąglona alternatywa dla sumy — spójnie z tabelą (czytane przy renderze).
  const roundedSummary = loading
    ? null
    : roundedEstimatesSummary(filteredRows, loadRoundingSettings());

  return (
    <div className={mobileLayout.pageStack}>
      <DateRangeToolbar
        dateRange={dateRange}
        timePreset={timePreset}
        setTimePreset={setTimePreset}
        shiftDateRange={shiftDateRange}
        canShiftForward={canShiftForward}
      >
        <EstimatesRangePicker dateRange={dateRange} setDateRange={setDateRange} />
      </DateRangeToolbar>

      <div className="flex justify-end">
        <EstimatesReportButton onGenerate={generateEstimateReport} />
      </div>

      <div className={mobileLayout.metricGrid}>
        <MetricCard
          title={t('estimates_page.metrics.total_hours')}
          value={
            loading ? (
              '...'
            ) : (
              <>
                {`${decimal.format(filteredSummary.total_hours)} ${t('estimates_page.units.hours_short')}`}
                {roundedSummary && (
                  <span className="ml-1 text-xs font-normal opacity-60">
                    ≈{decimal.format(roundedSummary.seconds / 3600)}
                  </span>
                )}
              </>
            )
          }
          icon={Clock3}
        />
        <MetricCard
          title={t('estimates_page.metrics.estimated_value')}
          value={
            loading ? (
              '...'
            ) : (
              <>
                {currency.format(filteredSummary.total_value)}
                {roundedSummary && (
                  <span className="ml-1 text-xs font-normal opacity-60">
                    ≈{currency.format(roundedSummary.value)}
                  </span>
                )}
              </>
            )
          }
          icon={CircleDollarSign}
        />
        <MetricCard
          title={t('estimates_page.metrics.active_projects')}
          value={loading ? '...' : String(filteredSummary.projects_count)}
          icon={FolderOpen}
        />
        <MetricCard
          title={t('estimates_page.metrics.rate_overrides')}
          value={loading ? '...' : String(filteredSummary.overrides_count)}
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
              max={MAX_ESTIMATE_RATE}
              step="0.01"
              aria-label={t('estimates_page.sections.global_hourly_rate')}
              value={globalRateInput}
              onChange={(e) => updateGlobalRateInput(e.target.value)}
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

      <EstimatesClientFilter
        clientOptions={clientOptions}
        selectedClients={selectedClients}
        toggleClient={toggleClient}
        clearClientFilter={clearClientFilter}
      />

      <EstimatesProjectsSection controller={controller} />
    </div>
  );
}
