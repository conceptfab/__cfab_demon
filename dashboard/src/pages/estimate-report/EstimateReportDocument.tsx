import logoSrc from '@/assets/logo.png';
import type { EstimateReportController } from '@/hooks/useEstimateReportController';

interface Props {
  controller: EstimateReportController;
}

export function EstimateReportDocument({ controller }: Props) {
  const {
    appVersion,
    clientLabels,
    config,
    fmtDur,
    fmtMoney,
    generatedAt,
    has,
    model,
    t,
    template,
  } = controller;

  if (!model || !config || !template) return null;

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 print:overflow-visible print:bg-white print:px-0 print:pt-0 print:text-black print:!h-auto print:!max-h-none print:!flex-none">
      <div className="mx-auto max-w-[700px] space-y-6 print:space-y-5">
        {has('est_header') && (
          <div className="border-b-2 border-foreground/10 pb-4 print:border-black/20">
            {template.showLogo && (
              <div className="mb-3 flex items-center gap-2">
                <img src={logoSrc} alt="TIMEFLOW" className="size-8 print:block" />
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
            <h1 className="mb-1 text-2xl font-semibold tracking-tight print:text-black">
              {t('estimate_report.title')}
            </h1>
            <p className="text-xs text-muted-foreground print:text-gray-500">
              {t('estimate_report.range', {
                start: config.dateRange.start,
                end: config.dateRange.end,
              })}
            </p>
            <p className="text-xs text-muted-foreground print:text-gray-500">
              {t('estimate_report.clients_label')}: {clientLabels.join(', ')}
            </p>
          </div>
        )}

        {has('est_summary') && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              {t('estimate_report.summary_heading')}
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                  <th className="py-1.5">{t('estimate_report.col_project')}</th>
                  <th className="py-1.5 text-right">{t('estimate_report.col_time')}</th>
                  <th className="py-1.5 text-right">{t('estimate_report.col_value')}</th>
                </tr>
              </thead>
              <tbody>
                {model.projects.map((p) => (
                  <tr key={p.projectId} className="border-b border-border/20">
                    <td className="py-1.5">{p.projectName}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtDur(p.displaySeconds)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtMoney(p.displayValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-1.5">{t('estimate_report.total')}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtDur(model.totalSeconds)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {fmtMoney(model.totalValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {has('est_per_day') && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">
              {t('estimate_report.per_day_heading')}
            </h2>
            {model.projects.map((p) => (
              <div key={p.projectId} className="print:break-inside-avoid">
                <div className="mb-1 flex items-center justify-between text-sm font-medium">
                  <span>{p.projectName}</span>
                  <span className="tabular-nums">{fmtDur(p.displaySeconds)}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {p.days.map((d) => (
                      <tr key={d.date} className="border-b border-border/10">
                        <td className="py-1 text-muted-foreground">{d.date}</td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtDur(d.displaySeconds)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {fmtMoney(d.displayValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {has('est_footer') && (
          <footer className="border-t border-dashed border-muted-foreground/10 pt-3 text-center text-[10px] text-muted-foreground/60">
            {t('estimate_report.footer', { version: appVersion, generatedAt })}
          </footer>
        )}
      </div>
    </div>
  );
}
