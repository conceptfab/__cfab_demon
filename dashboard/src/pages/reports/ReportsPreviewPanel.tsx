import type { ReportsPageController } from '@/hooks/useReportsPageController';

type ReportsPreviewPanelProps = Pick<
  ReportsPageController,
  'getSectionDef' | 'previewIds' | 'previewLoading' | 't'
>;

export function ReportsPreviewPanel({
  getSectionDef,
  previewIds,
  previewLoading,
  t,
}: ReportsPreviewPanelProps) {
  return (
    <div className="relative min-h-[18rem] min-w-0 flex-1 overflow-y-auto rounded-lg border border-border/20 bg-card/30 p-3 md:p-6">
      {previewLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
          <div className="rounded-full border border-border/40 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground">
            {t('reports_page.empty.preview_loading')}
          </div>
        </div>
      )}
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {previewIds.map((id) => {
          const def = getSectionDef(id);
          if (!def) return null;
          return (
            <div
              key={id}
              className="rounded-lg border border-dashed border-muted-foreground/15 p-3 hover:border-sky-500/30 transition-colors"
            >
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/25 mb-2">
                {t(def.labelKey)}
              </div>
              {def.preview(t)}
            </div>
          );
        })}

        {previewIds.length === 0 && !previewLoading && (
          <div className="text-center text-muted-foreground/30 py-16 text-sm">
            {t('reports_page.empty.add_sections')}
          </div>
        )}
      </div>
    </div>
  );
}
