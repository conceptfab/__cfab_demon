import type { ReportSectionDef } from '@/pages/reports/reports-page-sections';

export const ESTIMATE_REPORT_SECTIONS: ReportSectionDef[] = [
  {
    id: 'est_header',
    labelKey: 'reports_page.sections.est_header',
    preview: (t) => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          {t('reports_page.preview.est_header.title')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          {t('reports_page.preview.est_header.meta_line')}
        </div>
      </div>
    ),
  },
  {
    id: 'est_summary',
    labelKey: 'reports_page.sections.est_summary',
    preview: (t) => (
      <div className="space-y-1 text-[10px] text-muted-foreground/50 font-mono">
        <div className="flex justify-between">
          <span>{t('reports_page.preview.est_summary.project_a')}</span>
          <span>12h 30m · 1 250,00 PLN</span>
        </div>
        <div className="flex justify-between">
          <span>{t('reports_page.preview.est_summary.project_b')}</span>
          <span>4h 00m · 400,00 PLN</span>
        </div>
        <div className="flex justify-between border-t border-dashed border-muted-foreground/20 pt-1 font-semibold text-foreground/60">
          <span>{t('reports_page.preview.est_summary.total')}</span>
          <span>16h 30m · 1 650,00 PLN</span>
        </div>
      </div>
    ),
  },
  {
    id: 'est_per_day',
    labelKey: 'reports_page.sections.est_per_day',
    preview: (t) => (
      <div className="space-y-0.5 text-[10px] text-muted-foreground/40 font-mono">
        <div className="font-semibold text-foreground/60">
          {t('reports_page.preview.est_per_day.project_a')}
        </div>
        <div className="flex justify-between pl-2">
          <span>2026-06-10</span>
          <span>3h 00m</span>
        </div>
        <div className="flex justify-between pl-2">
          <span>2026-06-11</span>
          <span>2h 30m</span>
        </div>
      </div>
    ),
  },
  {
    id: 'est_footer',
    labelKey: 'reports_page.sections.est_footer',
    preview: (t) => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        {t('reports_page.preview.est_footer.line')}
      </div>
    ),
  },
];
