import { convertFileSrc } from '@tauri-apps/api/core';
import type { ReportViewController } from '@/hooks/useReportViewController';
import { formatDurationSlimRaw, formatMoney } from '@/lib/utils';

type ReportViewRenderGallerySectionProps = Pick<
  ReportViewController,
  'currencyCode' | 'has' | 'report' | 't'
>;

export function ReportViewRenderGallerySection({
  currencyCode,
  has,
  report,
  t,
}: ReportViewRenderGallerySectionProps) {
  const renders = report?.cfab_renders ?? [];

  if (!report || !has('renders') || renders.length === 0) {
    return null;
  }

  const totalSeconds = renders.reduce(
    (acc, r) => acc + (r.render_seconds || 0),
    0,
  );
  const totalRbh = renders.reduce(
    (acc, r) =>
      acc + (r.rbh ?? (r.render_seconds ? r.render_seconds / 3600 : 0)),
    0,
  );
  const totalValue = renders.reduce((acc, r) => acc + (r.value ?? 0), 0);
  const hasThumbnails = renders.some(
    (r) => r.thumbnail_path && r.thumbnail_path.trim() !== '',
  );

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 print:border-purple-200 print:bg-purple-50 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 print:text-gray-500">
          {t('report_view.renders')}
        </div>
        <div className="font-mono text-xs font-semibold text-purple-400 print:text-purple-800">
          <span>
            {t('report_view.renders_total_time')}:{' '}
            {formatDurationSlimRaw(Math.round(totalSeconds))}
          </span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>
            {totalRbh.toFixed(2)} {t('report_view.renders_rbh', 'RBH')}
          </span>
          {totalValue > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{formatMoney(totalValue, currencyCode)}</span>
            </>
          )}
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-sans font-normal text-muted-foreground/70 print:text-gray-600">
            {renders.length}{' '}
            {t('report_view.renders_count', { count: renders.length })}
          </span>
        </div>
      </div>

      {hasThumbnails ? (
        <div className="grid grid-cols-3 gap-3">
          {renders.map((render) => {
            const fileName =
              render.working_path.split(/[/\\]/).pop() || render.working_path;
            const imgSrc = render.thumbnail_path
              ? convertFileSrc(render.thumbnail_path)
              : '';
            const rbhVal =
              render.rbh ??
              (render.render_seconds ? render.render_seconds / 3600 : 0);

            return (
              <div
                key={`${render.hub_instance_id}-${render.ledger_id}`}
                className="flex flex-col rounded border border-purple-500/10 bg-background/50 overflow-hidden print:border-gray-200 print:bg-white"
              >
                {imgSrc ? (
                  <div className="aspect-video w-full bg-black/40 relative overflow-hidden flex items-center justify-center">
                    <img
                      src={imgSrc}
                      alt={fileName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                ) : null}
                <div className="p-2 text-[11px] space-y-0.5">
                  <div
                    className="font-medium truncate text-foreground/90 print:text-black"
                    title={render.working_path}
                  >
                    {fileName}
                  </div>
                  <div className="text-[10px] text-muted-foreground print:text-gray-600 flex justify-between">
                    <span>
                      {formatDurationSlimRaw(Math.round(render.render_seconds))}
                    </span>
                    <span>
                      {rbhVal > 0
                        ? `${rbhVal.toFixed(2)} RBH`
                        : render.hub_instance_id}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-purple-500/20 print:border-gray-300 text-left text-muted-foreground/60 print:text-gray-500">
              <th className="py-1 pr-2 font-medium">
                {t('report_view.renders_file', 'Plik / Scena')}
              </th>
              <th className="py-1 pr-2 font-medium text-right">
                {t('report_view.renders_total_time', 'Czas')}
              </th>
              <th className="py-1 pr-2 font-medium text-right">
                {t('report_view.renders_rbh', 'RBH')}
              </th>
              {totalValue > 0 && (
                <th className="py-1 pr-2 font-medium text-right">
                  {t('report_view.renders_value', 'Wartość')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-purple-500/10 print:divide-gray-100">
            {renders.map((render) => {
              const fileName =
                render.working_path.split(/[/\\]/).pop() || render.working_path;
              const rbhVal =
                render.rbh ??
                (render.render_seconds ? render.render_seconds / 3600 : 0);
              return (
                <tr key={`${render.hub_instance_id}-${render.ledger_id}`}>
                  <td
                    className="py-1 pr-2 truncate max-w-[280px] font-mono print:text-black"
                    title={render.working_path}
                  >
                    {fileName}
                  </td>
                  <td className="py-1 pr-2 font-mono text-right text-muted-foreground print:text-gray-700">
                    {formatDurationSlimRaw(Math.round(render.render_seconds))}
                  </td>
                  <td className="py-1 pr-2 font-mono text-right text-muted-foreground print:text-gray-700">
                    {rbhVal.toFixed(2)}
                  </td>
                  {totalValue > 0 && (
                    <td className="py-1 pr-2 font-mono text-right text-emerald-500 print:text-green-700 font-medium">
                      {formatMoney(render.value ?? 0, currencyCode)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
