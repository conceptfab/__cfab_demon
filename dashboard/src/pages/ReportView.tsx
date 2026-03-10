import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getProjectReportData, getDaemonStatus } from '@/lib/tauri';
import logoSrc from '@/assets/logo.png';
import { formatDuration, formatMoney } from '@/lib/utils';
import { useCancellableAsync } from '@/lib/async-utils';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { getTemplate } from '@/lib/report-templates';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-ranges';
import type {
  ProjectReportData,
} from '@/lib/db-types';

export function ReportView() {
  const { t } = useTranslation();

  const { setCurrentPage, projectPageId, reportTemplateId } = useUIStore();
  const { currencyCode } = useSettingsStore();
  const runReportRequest = useCancellableAsync();
  const runDaemonRequest = useCancellableAsync();

  const [report, setReport] = useState<ProjectReportData | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<number | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const template = useMemo(() => getTemplate(reportTemplateId || 'default'), [reportTemplateId]);
  const sections = template.sections;
  const has = (id: string) => sections.includes(id);


  const generatedAt = useMemo(() => format(new Date(), 'yyyy-MM-dd HH:mm'), []);

  useEffect(() => {
    if (!projectPageId) return;
    const dr = ALL_TIME_DATE_RANGE;
    void runReportRequest(
      () => getProjectReportData(projectPageId, dr),
      {
        onSuccess: (data) => {
        setReport(data);
        setLoadedProjectId(projectPageId);
        },
        onError: (err) => {
          console.error('Report error:', err);
          setReport(null);
          setLoadedProjectId(projectPageId);
        },
      },
    );
  }, [projectPageId, runReportRequest]);

  useEffect(() => {
    void runDaemonRequest(() => getDaemonStatus(), {
      onSuccess: (status) => {
        setAppVersion(status.dashboard_version ?? '');
      },
    });
  }, [runDaemonRequest]);

  if (!projectPageId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('report_view.no_project_selected')}
      </div>
    );
  }

  if (loadedProjectId !== projectPageId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('report_view.generating_report')}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('report_view.no_data_found')}
      </div>
    );
  }

  const totalSessions = report.sessions.length + report.manual_sessions.length;
  const sessionsWithAI = report.sessions.filter(
    (s) => s.suggested_project_id,
  ).length;
  const sessionsAIAssigned = report.sessions.filter(
    (s) => s.ai_assigned,
  ).length;
  const sessionsWithComments = report.sessions.filter((s) => s.comment?.trim());

  return (
    <div className="flex flex-col h-screen bg-background pt-8 print:pt-0 print:bg-white">
      {/* Toolbar — hidden in print */}
      <div className="flex items-center gap-2 pb-3 border-b border-border/30 print:hidden shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage('project-card')}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('report_view.back_to_project')}
        </Button>
        <div className="flex-1" />

        <Button
          size="sm"
          onClick={() => window.print()}
          className="bg-sky-600 hover:bg-sky-700 text-white"
        >
          <Printer className="mr-1.5 h-4 w-4" />
          {t('report_view.print_pdf')}
        </Button>
      </div>

      {/* Report body — print-optimized */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 print:px-0 print:pt-0 print:overflow-visible print:text-black print:bg-white">
        <div className="max-w-[700px] mx-auto space-y-6 print:space-y-5">
          {/* ═══ HEADER ═══ */}
          {has('header') && (
            <div className="border-b-2 border-foreground/10 pb-4 print:border-black/20">
              {template.showLogo && (
                <div className="flex items-center gap-2 mb-3">
                  <img
                    src={logoSrc}
                    alt="TIMEFLOW"
                    className="h-8 w-8 print:block"
                  />
                  <span className="text-sm font-semibold uppercase tracking-wide print:text-black">
                    TIMEFLOW
                  </span>
                  {appVersion && (
                    <span className="text-xs text-muted-foreground/50 print:text-gray-400">
                      v{appVersion}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3 mb-1">
                <div
                  className="h-5 w-5 rounded-full ring-2 ring-offset-2 ring-offset-background print:ring-offset-white"
                  style={{
                    backgroundColor: report.project.color,
                    boxShadow: 'none',
                  }}
                />
                <h1 className="text-2xl font-bold tracking-tight print:text-black">
                  {report.project.name}
                </h1>
              </div>
              <p className="text-xs text-muted-foreground print:text-gray-500 mt-1">
                {t('report_view.report_generated')}: {generatedAt}
                {report.project.frozen_at &&
                  ` · ${t('report_view.project_frozen')}`}
              </p>
            </div>
          )}

          {/* ═══ STATS ═══ */}
          {has('stats') && (
            <div className="grid grid-cols-4 gap-4">
              {[
                {
                  label: t('report_view.total_time'),
                  value: formatDuration(report.project.total_seconds),
                  accent: true,
                },
                {
                  label: t('report_view.sessions'),
                  value: String(totalSessions),
                },
                {
                  label: t('report_view.apps'),
                  value: String(report.extra.top_apps.length),
                },
                {
                  label: t('report_view.unique_files'),
                  value: String(
                    report.extra.db_stats?.file_activity_count ?? 0,
                  ),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-border/20 p-3 print:border-gray-200"
                >
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 print:text-gray-500">
                    {item.label}
                  </div>
                  <div
                    className={`text-xl font-bold mt-0.5 ${item.accent ? 'text-sky-400 print:text-blue-700' : 'print:text-black'}`}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ═══ FINANCIALS ═══ */}
          {has('financials') && report.estimate > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 print:border-green-200 print:bg-green-50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                {t('report_view.financials')}
              </div>
              <div className="flex items-baseline gap-6">
                <div>
                  <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
                    {t('report_view.estimated_value')}
                  </div>
                  <div className="text-2xl font-bold text-emerald-400 print:text-green-700">
                    {formatMoney(report.estimate, currencyCode)}
                  </div>
                </div>
                <div className="text-muted-foreground/20 text-xl print:text-gray-300">
                  /
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
                    {t('report_view.work_time')}
                  </div>
                  <div className="text-xl font-bold print:text-black">
                    {formatDuration(report.project.total_seconds)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TOP APPS ═══ */}
          {has('apps') && report.extra.top_apps.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3 print:text-gray-500">
                {t('report_view.most_used_applications')}
              </h2>
              <div className="space-y-2">
                {report.extra.top_apps.slice(0, 10).map((app) => {
                  const maxSec = report.extra.top_apps[0]?.seconds || 1;
                  const pct = Math.max(
                    3,
                    Math.round((app.seconds / maxSec) * 100),
                  );
                  return (
                    <div key={app.name} className="flex items-center gap-3">
                      <span className="w-28 text-xs font-medium truncate text-foreground print:text-black">
                        {app.name}
                      </span>
                      <div className="flex-1 h-5 rounded bg-secondary/20 overflow-hidden print:bg-gray-100">
                        <div
                          className="h-full bg-sky-500/30 rounded print:bg-blue-200 flex items-center pl-2"
                          style={{ width: `${pct}%` }}
                        >
                          <span className="text-[10px] font-mono text-foreground/70 print:text-black whitespace-nowrap">
                            {formatDuration(app.seconds)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ FILES ═══ */}
          {has('files') &&
            (report.extra.db_stats?.file_activity_count ?? 0) > 0 && (
              <div className="rounded-lg border border-border/20 p-4 print:border-gray-200">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1 print:text-gray-500">
                  {t('report_view.file_activity')}
                </h2>
                <div className="text-sm print:text-black">
                  {t('report_view.tracked')}:{' '}
                  <strong>
                    {report.extra.db_stats?.file_activity_count ?? 0}
                  </strong>{' '}
                  {t('report_view.unique_files_2')}
                </div>
              </div>
            )}

          {/* ═══ AI DATA ═══ */}
          {has('ai') && (
            <div className="rounded-lg border border-border/20 p-4 print:border-gray-200">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                {t('report_view.ai_model')}
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
                    {t('report_view.ai_suggestions')}
                  </div>
                  <div className="font-bold text-lg print:text-black">
                    {sessionsWithAI}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
                    {t('report_view.auto_assigned')}
                  </div>
                  <div className="font-bold text-lg print:text-black">
                    {sessionsAIAssigned}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ SESSION TABLE ═══ */}
          {has('sessions') && report.sessions.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                {t('report_view.sessions')} ({report.sessions.length})
              </h2>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
                    <th className="py-1 pr-2 font-medium">
                      {t('report_view.date')}
                    </th>
                    <th className="py-1 pr-2 font-medium">
                      {t('report_view.app')}
                    </th>
                    <th className="py-1 pr-2 font-medium text-right">
                      {t('report_view.time')}
                    </th>
                    <th className="py-1 font-medium">
                      {t('report_view.comment')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.sessions.slice(0, 50).map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border/10 print:border-gray-100"
                    >
                      <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap">
                        {format(parseISO(s.start_time), 'yyyy-MM-dd')}
                      </td>
                      <td className="py-1 pr-2 truncate max-w-[120px] print:text-black">
                        {s.app_name}
                      </td>
                      <td className="py-1 pr-2 font-mono text-right print:text-black">
                        {formatDuration(s.duration_seconds)}
                      </td>
                      <td className="py-1 text-muted-foreground/50 truncate max-w-[200px] print:text-gray-600">
                        {s.comment?.trim() || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.sessions.length > 50 && (
                <p className="text-[10px] text-muted-foreground/30 mt-1 print:text-gray-400">
                  +{report.sessions.length - 50}{' '}
                  {t('report_view.more_sessions')}...
                </p>
              )}
            </div>
          )}

          {/* ═══ COMMENTS ═══ */}
          {has('comments') && sessionsWithComments.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                {t('report_view.comments')} ({sessionsWithComments.length})
              </h2>
              <div className="space-y-1.5">
                {sessionsWithComments.slice(0, 25).map((s) => (
                  <div
                    key={s.id}
                    className="flex gap-3 text-xs print:text-black"
                  >
                    <span className="text-muted-foreground/40 font-mono shrink-0 print:text-gray-500">
                      {format(parseISO(s.start_time), 'yyyy-MM-dd')}
                    </span>
                    <span>{s.comment}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ BOOSTS ═══ */}
          {has('boosts') && (() => {
            const boostedSessions = report.sessions.filter(s => (s.rate_multiplier ?? 1) > 1);
            if (boostedSessions.length === 0) return null;
            return (
              <div>
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                  {t('report_view.boosted_sessions')} ({boostedSessions.length})
                </h2>
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
                      <th className="py-1 pr-2 font-medium">
                        {t('report_view.date')}
                      </th>
                      <th className="py-1 pr-2 font-medium">
                        {t('report_view.app')}
                      </th>
                      <th className="py-1 pr-2 font-medium text-right">
                        {t('report_view.time')}
                      </th>
                      <th className="py-1 pr-2 font-medium text-right">
                        {t('report_view.multiplier')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {boostedSessions.slice(0, 25).map((s) => (
                      <tr
                        key={s.id}
                        className="border-b border-border/10 print:border-gray-100"
                      >
                        <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap">
                          {format(parseISO(s.start_time), 'yyyy-MM-dd')}
                        </td>
                        <td className="py-1 pr-2 truncate max-w-[120px] print:text-black">
                          {s.app_name}
                        </td>
                        <td className="py-1 pr-2 font-mono text-right print:text-black">
                          {formatDuration(s.duration_seconds)}
                        </td>
                        <td className="py-1 font-mono text-right text-amber-400 print:text-amber-700">
                          {s.rate_multiplier}×
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {boostedSessions.length > 25 && (
                  <p className="text-[10px] text-muted-foreground/30 mt-1 print:text-gray-400">
                    +{boostedSessions.length - 25}{' '}
                    {t('report_view.more_sessions')}...
                  </p>
                )}
              </div>
            );
          })()}

          {/* ═══ MANUAL SESSIONS ═══ */}
          {has('manual_sessions') && report.manual_sessions.length > 0 && (
            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
                {t('report_view.manual_sessions')} ({report.manual_sessions.length})
              </h2>
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
                    <th className="py-1 pr-2 font-medium">
                      {t('report_view.date')}
                    </th>
                    <th className="py-1 pr-2 font-medium">
                      {t('report_view.title')}
                    </th>
                    <th className="py-1 pr-2 font-medium">
                      {t('report_view.type')}
                    </th>
                    <th className="py-1 pr-2 font-medium text-right">
                      {t('report_view.time')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.manual_sessions.slice(0, 50).map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border/10 print:border-gray-100"
                    >
                      <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap">
                        {format(parseISO(s.start_time), 'yyyy-MM-dd')}
                      </td>
                      <td className="py-1 pr-2 truncate max-w-[180px] print:text-black">
                        {s.title}
                      </td>
                      <td className="py-1 pr-2 text-muted-foreground/50 print:text-gray-600">
                        {s.session_type}
                      </td>
                      <td className="py-1 font-mono text-right print:text-black">
                        {formatDuration(s.duration_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.manual_sessions.length > 50 && (
                <p className="text-[10px] text-muted-foreground/30 mt-1 print:text-gray-400">
                  +{report.manual_sessions.length - 50}{' '}
                  {t('report_view.more_sessions')}...
                </p>
              )}
            </div>
          )}

          {/* ═══ FOOTER ═══ */}
          {has('footer') && (
            <div className="text-center text-[10px] text-muted-foreground/30 pt-6 pb-8 border-t border-border/10 print:text-gray-400 print:border-gray-200">
              TIMEFLOW{appVersion ? ` v${appVersion}` : ''} · {report.project.name} · {generatedAt}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
