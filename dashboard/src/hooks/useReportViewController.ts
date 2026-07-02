import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { useCancellableAsync } from '@/lib/async-utils';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import type { ProjectReportData } from '@/lib/db-types';
import { logger } from '@/lib/logger';
import {
  computeReportDisplayValues,
  createReportDurationFormatter,
} from '@/lib/report-view-formatting';
import { getTemplate } from '@/lib/report-templates';
import { buildTimelineDays } from '@/lib/report-timeline';
import { printCurrentView } from '@/lib/print';
import { getDaemonRuntimeStatus, getProjectReportData } from '@/lib/tauri';
import { REPORT_VIEW_SCREEN_LIMIT } from '@/pages/report-view/report-view-constants';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';

export function useReportViewController() {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const projectPageId = useUIStore((s) => s.projectPageId);
  const reportTemplateId = useUIStore((s) => s.reportTemplateId);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const roundingSettings = useSettingsStore((s) => s.roundingSettings);
  const [rounded, setRounded] = useState(roundingSettings.enabled);
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
    () => getTemplate(reportTemplateId || 'default'),
    [reportTemplateId],
  );
  const [generatedAt] = useState(() => format(new Date(), 'yyyy-MM-dd HH:mm'));

  const sections = template.sections;
  const has = useCallback(
    (id: string) => sections.includes(id),
    [sections],
  );

  const handlePrint = useCallback(() => {
    if (!report) return;
    const originalTitle = document.title;
    const safeName = report.project.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
    document.title = `${t('report_view.pdf_prefix', 'timeflow_report')}_${safeName}`;
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
  }, [report, t]);

  useEffect(() => {
    if (!projectPageId) return;
    const dr = ALL_TIME_DATE_RANGE;
    void runReportRequest(() => getProjectReportData(projectPageId, dr), {
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
  }, [projectPageId, runReportRequest, setCurrentPage]);

  useEffect(() => {
    void runDaemonRequest(() => getDaemonRuntimeStatus(), {
      onSuccess: (status) => {
        setAppVersion(status.dashboard_version ?? '');
      },
    });
  }, [runDaemonRequest]);

  const displayValues = useMemo(() => {
    if (!report) return null;
    return computeReportDisplayValues(report, rounded, roundingSettings);
  }, [report, rounded, roundingSettings]);

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

  const sessionStats = useMemo(() => {
    if (!report) return null;
    return {
      totalSessions: report.sessions.length + report.manual_sessions.length,
      sessionsWithAI: report.sessions.filter((s) => s.suggested_project_id)
        .length,
      sessionsAIAssigned: report.sessions.filter((s) => s.ai_assigned).length,
      sessionsWithComments: report.sessions.filter((s) => s.comment?.trim()),
      boostedSessions: report.sessions.filter(
        (s) => (s.rate_multiplier ?? 1) > 1,
      ),
    };
  }, [report]);

  const timelineDays = useMemo(() => {
    if (!report) return null;
    return buildTimelineDays(report.sessions, report.manual_sessions);
  }, [report]);

  const goToProject = () => setCurrentPage('project-card');

  return {
    appVersion,
    currencyCode,
    displayValues,
    fmtDur,
    generatedAt,
    goToProject,
    handlePrint,
    has,
    loadedProjectId,
    projectPageId,
    report,
    reportError,
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
