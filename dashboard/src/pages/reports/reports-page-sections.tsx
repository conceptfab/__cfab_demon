import type { ReactNode } from 'react';

export type ReportTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface ReportSectionDef {
  id: string;
  labelKey: string;
  preview: (t: ReportTranslator) => ReactNode;
}

export const REPORT_PAGE_SECTIONS: ReportSectionDef[] = [
  {
    id: 'header',
    labelKey: 'reports_page.sections.header',
    preview: (t) => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          {t('reports_page.preview.header.project_report_title')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          {t('reports_page.preview.header.meta_line')}
        </div>
      </div>
    ),
  },
  {
    id: 'stats',
    labelKey: 'reports_page.sections.stats',
    preview: (t) => (
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.time_label')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.sessions_label')}
          </div>
          <div className="font-bold text-foreground/60">142</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.apps_label')}
          </div>
          <div className="font-bold text-foreground/60">8</div>
        </div>
      </div>
    ),
  },
  {
    id: 'financials',
    labelKey: 'reports_page.sections.financials',
    preview: (t) => (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.financials.value_label')}
          </div>
          <div className="font-bold text-emerald-400/60">4 500,00 PLN</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.financials.work_time_label')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
      </div>
    ),
  },
  {
    id: 'apps',
    labelKey: 'reports_page.sections.apps',
    preview: (t) => (
      <div className="space-y-1">
        {[
          t('reports_page.preview.apps.line_vscode'),
          t('reports_page.preview.apps.line_chrome'),
          t('reports_page.preview.apps.line_terminal'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'ai',
    labelKey: 'reports_page.sections.ai',
    preview: (t) => (
      <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground/40">
        <div>
          <div className="text-[9px]">
            {t('reports_page.preview.ai.suggestions')}
          </div>
          <div className="font-bold">23</div>
        </div>
        <div>
          <div className="text-[9px]">
            {t('reports_page.preview.ai.assigned')}
          </div>
          <div className="font-bold">18</div>
        </div>
      </div>
    ),
  },
  {
    id: 'sessions',
    labelKey: 'reports_page.sections.sessions',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.sessions.line_1'),
          t('reports_page.preview.sessions.line_2'),
          t('reports_page.preview.sessions.line_3'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
        <div className="text-[9px] text-muted-foreground/20">
          {t('reports_page.preview.sessions.more')}
        </div>
      </div>
    ),
  },
  {
    id: 'comments',
    labelKey: 'reports_page.sections.comments',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.comments.line_1'),
          t('reports_page.preview.comments.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'boosts',
    labelKey: 'reports_page.sections.boosts',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.boosts.line_1'),
          t('reports_page.preview.boosts.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'manual_sessions',
    labelKey: 'reports_page.sections.manual_sessions',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.manual_sessions.line_1'),
          t('reports_page.preview.manual_sessions.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'footer',
    labelKey: 'reports_page.sections.footer',
    preview: (t) => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        {t('reports_page.preview.footer.line')}
      </div>
    ),
  },
];
