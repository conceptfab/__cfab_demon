import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { useCancellableAsync } from '@/lib/async-utils';
import type { ProjectReportData } from '@/lib/db-types';
import {
  buildPeriodFileSuffix,
  formatPeriodLabel,
  isOpenEndedRange,
} from '@/lib/report-period';
import { logger } from '@/lib/logger';
import {
  computeReportDisplayValues,
  createReportDurationFormatter,
  scaleAppSecondsToRounded,
} from '@/lib/report-view-formatting';
import { getProjectTemplate } from '@/lib/report-templates';
import {
  buildReportCommentRows,
  buildReportSessionRows,
  mergeTimelineDays,
} from '@/lib/report-merge';
import { buildTimelineDays } from '@/lib/report-timeline';
import { distributeReportRounding, roundSeconds } from '@/lib/rounding';
import { formatDurationRaw, formatDurationSlimRaw } from '@/lib/utils';
import { printCurrentView } from '@/lib/print';
import { getDaemonRuntimeStatus, getProjectReportData } from '@/lib/tauri';
import { useProjectDateBounds } from '@/hooks/useProjectDateBounds';
import { REPORT_VIEW_SCREEN_LIMIT } from '@/pages/report-view/report-view-constants';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';

export function useReportViewController() {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const projectPageId = useUIStore((s) => s.projectPageId);
  const reportTemplateId = useUIStore((s) => s.reportTemplateId);
  const period = useUIStore((s) => s.reportPeriod);
  const setPeriod = useUIStore((s) => s.setReportPeriod);
  // Faktyczne granice projektu — picker okresu podmienia nimi wartownik 2020..2100.
  const projectDateBounds = useProjectDateBounds(projectPageId ?? null);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const roundingSettings = useSettingsStore((s) => s.roundingSettings);
  const reportViewSettings = useSettingsStore((s) => s.reportViewSettings);
  const setReportViewSettings = useSettingsStore((s) => s.setReportViewSettings);
  const [rounded, setRounded] = useState(roundingSettings.enabled);
  // Scalanie powtórzeń: start z zapamiętanego ustawienia, przełącznik w toolbarze
  // od razu je utrwala — kolejne raporty mają tę samą postać co ostatnio wybrana.
  const merged = reportViewSettings.mergeIdenticalEntries;
  const setMerged = useCallback(
    (next: boolean) => setReportViewSettings({ mergeIdenticalEntries: next }),
    [setReportViewSettings],
  );
  const runReportRequest = useCancellableAsync();
  const runDaemonRequest = useCancellableAsync();

  const [reportState, setReportState] = useState<{
    report: ProjectReportData | null;
    loadedProjectId: number | null;
    error: string | null;
  }>({ report: null, loadedProjectId: null, error: null });
  const { report, loadedProjectId, error: reportError } = reportState;
  const [appVersion, setAppVersion] = useState('');
  const [showAll, setShowAll] = useState(false);
  const template = useMemo(
    () => getProjectTemplate(reportTemplateId),
    [reportTemplateId],
  );
  const [generatedAt] = useState(() => format(new Date(), 'yyyy-MM-dd HH:mm'));
  // Rozbite na prymitywy — obiekt `period` z zustand jest stabilny referencyjnie,
  // ale efekt ma się przeładować dokładnie przy zmianie granic okresu.
  const { start: periodStart, end: periodEnd } = period.range;
  const dateRange = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );

  const sections = template.sections;
  const has = useCallback(
    (id: string) => sections.includes(id),
    [sections],
  );

  const handlePrint = useCallback(() => {
    if (!report) return;
    const originalTitle = document.title;
    const safeName = report.project.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
    const periodSuffix = buildPeriodFileSuffix(period);
    document.title = `${t('report_view.pdf_prefix', 'timeflow_report')}_${safeName}${
      periodSuffix ? `_${periodSuffix}` : ''
    }`;
    if (
      report.sessions.length <= REPORT_VIEW_SCREEN_LIMIT &&
      report.manual_sessions.length <= REPORT_VIEW_SCREEN_LIMIT
    ) {
      void printCurrentView().finally(() => {
        document.title = originalTitle;
      });
    } else {
      setShowAll(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void printCurrentView().finally(() => {
            document.title = originalTitle;
          });
        });
      });
    }
  }, [report, period, t]);

  useEffect(() => {
    if (!projectPageId) return;
    void runReportRequest(() => getProjectReportData(projectPageId, dateRange), {
      onSuccess: (data) => {
        startTransition(() => {
          setReportState({
            report: data,
            loadedProjectId: projectPageId,
            error: null,
          });
        });
      },
      onError: (err) => {
        logger.error('Report error:', err);
        const errStr = String(err);
        if (errStr.includes('not found')) {
          setCurrentPage('projects');
          return;
        }
        startTransition(() => {
          setReportState({
            report: null,
            loadedProjectId: projectPageId,
            error: errStr,
          });
        });
      },
    });
  }, [projectPageId, dateRange, runReportRequest, setCurrentPage]);

  useEffect(() => {
    void runDaemonRequest(() => getDaemonRuntimeStatus(), {
      onSuccess: (status) => {
        setAppVersion(status.dashboard_version ?? '');
      },
    });
  }, [runDaemonRequest]);

  const timelineDays = useMemo(() => {
    if (!report) return null;
    const days = buildTimelineDays(report.sessions, report.manual_sessions);
    // Scalamy PRZED zaokrąglaniem, żeby `reportRounding.entrySeconds` trzymało się
    // wierszy widocznych w dokumencie (indeksy muszą się zgadzać).
    return merged ? mergeTimelineDays(days) : days;
  }, [report, merged]);

  const sessionRows = useMemo(() => {
    if (!report) return null;
    return buildReportSessionRows(report.sessions, merged);
  }, [report, merged]);

  const reportRounding = useMemo(() => {
    if (!timelineDays) return null;
    return distributeReportRounding(
      timelineDays.map((day) => ({
        date: day.date,
        sessionSeconds: day.entries.map((entry) => entry.durationSeconds),
      })),
      rounded ? roundingSettings : { ...roundingSettings, enabled: false },
    );
  }, [timelineDays, rounded, roundingSettings]);

  const displayValues = useMemo(() => {
    if (!report) return null;
    return computeReportDisplayValues(
      report,
      rounded,
      roundingSettings,
      reportRounding,
    );
  }, [report, rounded, roundingSettings, reportRounding]);

  // React Compiler nie jest w buildzie (Vite plugin-react) — useMemo działa
  // runtime'owo; hint „could not preserve" jest informacyjny, bez wpływu na działanie.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const fmtDur = useMemo(() => {
    if (!displayValues) {
      return (seconds: number) => String(seconds);
    }
    return createReportDurationFormatter(
      rounded,
      displayValues.usePerDay,
      roundingSettings,
      displayValues.interval,
    );
  }, [displayValues, rounded, roundingSettings]);

  const fmtSessionDur = useCallback(
    (seconds: number) =>
      formatDurationRaw(
        rounded && roundingSettings.mode === 'per_session'
          ? roundSeconds(seconds, roundingSettings.intervalMinutes)
          : seconds,
      ),
    [rounded, roundingSettings],
  );

  // Czas aplikacji (MOST USED APPLICATIONS) przy zaokrąglaniu: udział aplikacji
  // (proporcja wśród top_apps) mapowany na zdeduplikowany czas sesji auto,
  // przeskalowany współczynnikiem displayTotal/realTotal i kwantyzowany do
  // najbliższego interwału — spójny z sumami dziennymi timeline. Ślad poniżej
  // pół interwału pokazujemy jako "<1h", nie zawyżamy do pełnej godziny.
  const appShareBase = useMemo(() => {
    if (!report) return null;
    return {
      appsTotal: report.extra.top_apps.reduce((acc, a) => acc + a.seconds, 0),
      autoEffective: report.sessions.reduce(
        (acc, s) => acc + (s.effective_seconds ?? s.duration_seconds),
        0,
      ),
    };
  }, [report]);

  const fmtAppDur = useCallback(
    (seconds: number) => {
      if (!rounded || !displayValues || !report || !appShareBase) {
        return formatDurationRaw(seconds);
      }
      const value = scaleAppSecondsToRounded(
        seconds,
        appShareBase.appsTotal,
        appShareBase.autoEffective,
        report.project.total_seconds,
        displayValues.displayTotal,
        displayValues.interval,
      );
      const format = displayValues.fullHour
        ? formatDurationSlimRaw
        : formatDurationRaw;
      if (value <= 0) return `<${format(displayValues.interval * 60)}`;
      return format(value);
    },
    [rounded, displayValues, report, appShareBase],
  );

  const commentRows = useMemo(() => {
    if (!report) return null;
    return buildReportCommentRows(
      report.sessions.filter((s) => s.comment?.trim()),
      merged,
    );
  }, [report, merged]);

  const sessionStats = useMemo(() => {
    if (!report) return null;
    return {
      totalSessions: report.sessions.length + report.manual_sessions.length,
      sessionsWithAI: report.sessions.filter((s) => s.suggested_project_id)
        .length,
      sessionsAIAssigned: report.sessions.filter((s) => s.ai_assigned).length,
      boostedSessions: report.sessions.filter(
        (s) => (s.rate_multiplier ?? 1) > 1,
      ),
    };
  }, [report]);

  const goToProject = () => setCurrentPage('project-card');

  return {
    appVersion,
    currencyCode,
    displayValues,
    fmtAppDur,
    fmtDur,
    fmtSessionDur,
    generatedAt,
    goToProject,
    handlePrint,
    has,
    loadedProjectId,
    merged,
    setMerged,
    commentRows,
    sessionRows,
    period,
    // Wartownik 2020..2100 nic nie mówi o projekcie — takiej etykiety nie drukujemy.
    periodLabel: isOpenEndedRange(period.range) ? null : formatPeriodLabel(period),
    projectDateBounds,
    projectPageId,
    report,
    setPeriod,
    reportError,
    reportRounding,
    rounded,
    screenLimit: REPORT_VIEW_SCREEN_LIMIT,
    sessionStats,
    setCurrentPage,
    setRounded,
    setShowAll,
    showAll,
    t,
    template,
    timelineDays,
  };
}

export type ReportViewController = ReturnType<typeof useReportViewController>;
