import type { ReportTemplate } from '@/lib/report-templates';
import type { ReportsPageController } from '@/hooks/useReportsPageController';
import { ReportsPreviewPanel } from '@/pages/reports/ReportsPreviewPanel';
import { ReportsSectionsPanel } from '@/pages/reports/ReportsSectionsPanel';

interface ReportsTemplateEditorProps {
  activeTemplate: ReportTemplate;
  controller: ReportsPageController;
}

export function ReportsTemplateEditor({
  activeTemplate,
  controller,
}: ReportsTemplateEditorProps) {
  const { patchTemplate, t } = controller;

  return (
    <>
      <div className="mt-3 grid gap-3 rounded-lg border border-border/20 bg-card/20 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-muted-foreground/70">
            {t('reports_page.fields.template_name')}
          </span>
          <input
            value={activeTemplate.name}
            onChange={(e) => patchTemplate({ name: e.target.value })}
            className="rounded border border-border/40 bg-secondary/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
            placeholder={t('reports_page.fields.name_placeholder')}
          />
        </label>
        <label className="flex items-center gap-2 rounded border border-border/40 bg-secondary/10 p-2 text-[11px]">
          <input
            type="checkbox"
            checked={activeTemplate.showLogo}
            onChange={(e) => patchTemplate({ showLogo: e.target.checked })}
            className="size-3.5 accent-sky-500"
          />
          <span className="font-semibold text-muted-foreground/80">
            {t('reports_page.fields.show_logo')}
          </span>
        </label>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4">
        <ReportsSectionsPanel {...controller} />
        <ReportsPreviewPanel {...controller} />
      </div>
    </>
  );
}
