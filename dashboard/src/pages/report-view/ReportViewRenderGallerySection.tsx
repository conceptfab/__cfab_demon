import { convertFileSrc } from '@tauri-apps/api/core';
import type { ReportViewController } from '@/hooks/useReportViewController';
import { formatDurationSlimRaw } from '@/lib/utils';

type ReportViewRenderGallerySectionProps = Pick<
  ReportViewController,
  'has' | 'report' | 't'
>;

export function ReportViewRenderGallerySection({
  has,
  report,
  t,
}: ReportViewRenderGallerySectionProps) {
  const renders = report?.cfab_renders ?? [];

  if (!report || !has('renders') || renders.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 print:border-purple-200 print:bg-purple-50 print:break-inside-avoid">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 print:text-gray-500">
          {t('report_view.renders')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
          {renders.length} {t('report_view.renders_count', { count: renders.length })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {renders.map((render) => {
          const fileName = render.working_path.split('/').pop() || render.working_path;
          const imgSrc = convertFileSrc(render.thumbnail_path);

          return (
            <div
              key={`${render.hub_instance_id}-${render.ledger_id}`}
              className="flex flex-col rounded border border-purple-500/10 bg-background/50 overflow-hidden print:border-gray-200 print:bg-white"
            >
              <div className="aspect-video w-full bg-black/40 relative overflow-hidden flex items-center justify-center">
                <img
                  src={imgSrc}
                  alt={fileName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to placeholder if thumbnail failed loading
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <div className="p-2 text-[11px] space-y-0.5">
                <div className="font-medium truncate text-foreground/90 print:text-black" title={render.working_path}>
                  {fileName}
                </div>
                <div className="text-[10px] text-muted-foreground print:text-gray-600 flex justify-between">
                  <span>{formatDurationSlimRaw(Math.round(render.render_seconds))}</span>
                  <span>{render.hub_instance_id}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
