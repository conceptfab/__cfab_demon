import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { getErrorMessage, formatMoney, formatDecimal } from '@/lib/utils';
import { clientFilterOptions, filterRowsByClients } from '@/lib/estimate-report';
import { parseRateInput } from '@/lib/form-validation';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { shouldRefreshEstimatesPage } from '@/lib/page-refresh-reasons';
import {
  applyEstimatesReloadResults,
  initialEstimatesData,
  MAX_ESTIMATE_RATE,
  patchEstimatesData,
  patchEstimatesErrors,
} from '@/pages/estimates-page-state';

export function useEstimatesPageController() {
  const { t, i18n } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const setSessionsFocusRange = useUIStore((s) => s.setSessionsFocusRange);
  const setSessionsFocusProject = useUIStore((s) => s.setSessionsFocusProject);
  const setEstimateReport = useUIStore((s) => s.setEstimateReport);
  const dateRange = useDataStore((s) => s.dateRange);
  const timePreset = useDataStore((s) => s.timePreset);
  const setTimePreset = useDataStore((s) => s.setTimePreset);
  const setDateRange = useDataStore((s) => s.setDateRange);
  const shiftDateRange = useDataStore((s) => s.shiftDateRange);
  const canShiftForward = useDataStore((s) => s.canShiftForward);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const currencyCode = useSettingsStore((s) => s.currencyCode);

  const [page, setPage] = useState({
    loading: true,
    data: initialEstimatesData,
  });
  const loading = page.loading;
  const {
    settings,
    summary,
    rows,
    drafts,
    globalRateInput,
    pageErrors,
  } = page.data;
  const globalError = pageErrors.global;
  const tableError = pageErrors.table;
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [tableMessage, setTableMessage] = useState<string | null>(null);
  const reloadEstimatesRef = useRef<(() => void) | null>(null);

  const locale = i18n.resolvedLanguage;
  const currency = useMemo(
    () => ({ format: (v: number) => formatMoney(v, currencyCode, locale) }),
    [currencyCode, locale],
  );
  const decimal = useMemo(
    () => ({ format: (v: number) => formatDecimal(v, locale) }),
    [locale],
  );

  const clientOptions = useMemo(() => clientFilterOptions(rows), [rows]);
  const filteredRows = useMemo(
    () => filterRowsByClients(rows, selectedClients),
    [rows, selectedClients],
  );
  const filteredSummary = useMemo(() => {
    const totalSeconds = filteredRows.reduce((acc, r) => acc + r.seconds, 0);
    return {
      total_hours: totalSeconds / 3600,
      total_value: filteredRows.reduce((acc, r) => acc + r.estimated_value, 0),
      projects_count: filteredRows.length,
      overrides_count: filteredRows.filter((r) => r.project_hourly_rate != null).length,
    };
  }, [filteredRows]);

  usePageRefreshListener((reasons) => {
    if (reasons.some((reason) => shouldRefreshEstimatesPage(reason))) {
      reloadEstimatesRef.current?.();
    }
  });

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      Promise.allSettled([
        getEstimateSettings(),
        getProjectEstimates(dateRange),
        getEstimatesSummary(dateRange),
      ])
        .then((results) => {
          if (cancelled) return;
          setPage({
            loading: false,
            data: applyEstimatesReloadResults(results, t),
          });
        })
        .catch(() => {
          if (!cancelled) {
            setPage((prev) => ({ ...prev, loading: false }));
          }
        });
    };

    reloadEstimatesRef.current = reload;
    reload();

    return () => {
      cancelled = true;
      reloadEstimatesRef.current = null;
    };
  }, [dateRange, t]);

  const handleSaveGlobalRate = async () => {
    const parsed = parseRateInput(globalRateInput);
    if (parsed === null || parsed < 0 || parsed > MAX_ESTIMATE_RATE) {
      setPage((prev) =>
        patchEstimatesErrors(prev, {
          global: t('estimates_page.validation.global_rate_range', {
            maxRate: MAX_ESTIMATE_RATE,
          }),
        }),
      );
      setGlobalMessage(null);
      return;
    }

    setSavingGlobal(true);
    setPage((prev) => patchEstimatesErrors(prev, { global: null }));
    setGlobalMessage(null);
    try {
      await updateGlobalHourlyRate(parsed);
      setGlobalMessage(t('estimates_page.messages.global_rate_saved'));
      triggerRefresh('estimates_global_rate_saved');
    } catch (error) {
      setPage((prev) =>
        patchEstimatesErrors(prev, {
          global: getErrorMessage(
            error,
            t('estimates_page.errors.save_global_rate'),
          ),
        }),
      );
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveProjectRate = async (projectId: number) => {
    const raw = drafts[projectId] ?? '';
    const parsed = parseRateInput(raw);
    if (
      raw.trim() &&
      (parsed === null || parsed < 0 || parsed > MAX_ESTIMATE_RATE)
    ) {
      setPage((prev) =>
        patchEstimatesErrors(prev, {
          table: t('estimates_page.validation.project_rate_range', {
            maxRate: MAX_ESTIMATE_RATE,
          }),
        }),
      );
      setTableMessage(null);
      return;
    }

    setSavingProjectId(projectId);
    setPage((prev) => patchEstimatesErrors(prev, { table: null }));
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, parsed);
      setTableMessage(t('estimates_page.messages.project_rate_updated'));
      triggerRefresh('estimates_project_rate_updated');
    } catch (error) {
      setPage((prev) =>
        patchEstimatesErrors(prev, {
          table: getErrorMessage(
            error,
            t('estimates_page.errors.update_project_rate'),
          ),
        }),
      );
    } finally {
      setSavingProjectId(null);
    }
  };

  const handleResetProjectRate = async (projectId: number) => {
    setSavingProjectId(projectId);
    setPage((prev) => patchEstimatesErrors(prev, { table: null }));
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, null);
      setPage((prev) =>
        patchEstimatesData(prev, {
          drafts: { ...prev.data.drafts, [projectId]: '' },
        }),
      );
      setTableMessage(t('estimates_page.messages.project_rate_reset'));
      triggerRefresh('estimates_project_rate_reset');
    } catch (error) {
      setPage((prev) =>
        patchEstimatesErrors(prev, {
          table: getErrorMessage(
            error,
            t('estimates_page.errors.reset_project_rate'),
          ),
        }),
      );
    } finally {
      setSavingProjectId(null);
    }
  };

  const updateGlobalRateInput = (value: string) => {
    setPage((prev) =>
      patchEstimatesData(prev, {
        globalRateInput: value,
        pageErrors: { ...prev.data.pageErrors, global: null },
      }),
    );
    setGlobalMessage(null);
  };

  const updateProjectDraft = (projectId: number, value: string) => {
    setPage((prev) =>
      patchEstimatesData(prev, {
        drafts: { ...prev.data.drafts, [projectId]: value },
      }),
    );
  };

  const openProjectPage = (projectId: number) => {
    setProjectPageId(projectId);
    setCurrentPage('project-card');
  };

  const openBoostedSessions = (projectId: number) => {
    setSessionsFocusRange(dateRange);
    setSessionsFocusProject(projectId);
    setCurrentPage('sessions');
  };

  const toggleClient = (key: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearClientFilter = () => setSelectedClients(new Set());

  const generateEstimateReport = (templateId: string) => {
    setEstimateReport({
      clients: Array.from(selectedClients),
      dateRange,
      templateId,
    });
    setCurrentPage('estimate-report');
  };

  return {
    canShiftForward,
    clearClientFilter,
    clientOptions,
    currency,
    dateRange,
    decimal,
    drafts,
    filteredRows,
    filteredSummary,
    generateEstimateReport,
    globalError,
    globalMessage,
    globalRateInput,
    handleResetProjectRate,
    handleSaveGlobalRate,
    handleSaveProjectRate,
    loading,
    openBoostedSessions,
    openProjectPage,
    rows,
    savingGlobal,
    savingProjectId,
    selectedClients,
    setCurrentPage,
    setDateRange,
    setTimePreset,
    settings,
    shiftDateRange,
    summary,
    tableError,
    tableMessage,
    timePreset,
    t,
    toggleClient,
    updateGlobalRateInput,
    updateProjectDraft,
  };
}

export type EstimatesPageController = ReturnType<typeof useEstimatesPageController>;
