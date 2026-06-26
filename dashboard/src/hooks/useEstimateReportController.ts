import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { useCancellableAsync } from '@/lib/async-utils';
import { formatDurationRaw, formatDurationSlimRaw, formatMoney } from '@/lib/utils';
import {
  buildEstimateReportModel,
  filterRowsByClients,
  NO_CLIENT_KEY,
  type EstimateReportModel,
} from '@/lib/estimate-report';
import { getTemplate } from '@/lib/report-templates';
import { printCurrentView } from '@/lib/print';
import { getDaemonRuntimeStatus, getProjectEstimates } from '@/lib/tauri';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import type { EstimateProjectRow } from '@/lib/db-types';

export function useEstimateReportController() {
  const { t, i18n } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const config = useUIStore((s) => s.estimateReport);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const roundingSettings = useSettingsStore((s) => s.roundingSettings);
  const [rounded, setRounded] = useState(roundingSettings.enabled);
  const runRequest = useCancellableAsync();
  const runDaemonRequest = useCancellableAsync();

  const [rows, setRows] = useState<EstimateProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [generatedAt] = useState(() => format(new Date(), 'yyyy-MM-dd HH:mm'));

  const template = useMemo(
    () => (config ? getTemplate(config.templateId) : null),
    [config],
  );
  const has = useCallback(
    (id: string) => !!template && template.sections.includes(id),
    [template],
  );

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const fmtMoney = useCallback(
    (v: number) => formatMoney(v, currencyCode, locale),
    [currencyCode, locale],
  );
  // Zaokrąglanie do PEŁNEJ godziny (interwał 60 min lub tryb per_day) → wartości są
  // zawsze wielokrotnością godziny, więc minuty ("0m") są zbędne i je ukrywamy.
  const interval =
    roundingSettings.mode === 'per_day' ? 60 : roundingSettings.intervalMinutes;
  const fullHour = rounded && interval === 60;
  const fmtDur = useCallback(
    (seconds: number) =>
      (fullHour ? formatDurationSlimRaw : formatDurationRaw)(seconds),
    [fullHour],
  );

  useEffect(() => {
    if (!config) return;
    void runRequest(() => getProjectEstimates(config.dateRange), {
      onSuccess: (data) => {
        startTransition(() => {
          setRows(data);
          setError(null);
        });
      },
      onError: (err) => {
        startTransition(() => {
          setRows(null);
          setError(String(err));
        });
      },
    });
  }, [config, runRequest]);

  useEffect(() => {
    void runDaemonRequest(() => getDaemonRuntimeStatus(), {
      onSuccess: (status) => setAppVersion(status.dashboard_version ?? ''),
    });
  }, [runDaemonRequest]);

  const model: EstimateReportModel | null = useMemo(() => {
    if (!rows || !config) return null;
    const selected = new Set(config.clients);
    const filtered = filterRowsByClients(rows, selected);
    return buildEstimateReportModel(filtered, rounded, roundingSettings);
  }, [rows, config, rounded, roundingSettings]);

  const clientLabels = useMemo(() => {
    if (!config || config.clients.length === 0) {
      return [t('estimate_report.all_clients')];
    }
    return config.clients.map((key) =>
      key === NO_CLIENT_KEY ? t('estimate_report.no_client') : key,
    );
  }, [config, t]);

  const goBack = () => setCurrentPage('estimates');

  const handlePrint = useCallback(() => {
    const originalTitle = document.title;
    document.title = t('estimate_report.pdf_filename');
    void printCurrentView().finally(() => {
      document.title = originalTitle;
    });
  }, [t]);

  return {
    appVersion,
    clientLabels,
    config,
    error,
    fmtDur,
    fmtMoney,
    generatedAt,
    goBack,
    handlePrint,
    has,
    interval,
    model,
    rounded,
    setRounded,
    t,
    template,
  };
}

export type EstimateReportController = ReturnType<typeof useEstimateReportController>;
