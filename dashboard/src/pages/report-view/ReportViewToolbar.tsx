import { ChevronLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewToolbarProps = Pick<
  ReportViewController,
  'displayValues' | 'goToProject' | 'handlePrint' | 'rounded' | 'setRounded' | 't'
>;

export function ReportViewToolbar({
  displayValues,
  goToProject,
  handlePrint,
  rounded,
  setRounded,
  t,
}: ReportViewToolbarProps) {
  const interval = displayValues?.interval ?? 0;

  return (
    <div className="border-b border-border/30 print:hidden shrink-0 px-4">
      <div className="mx-auto flex w-full max-w-[700px] flex-wrap items-center justify-between gap-2 pb-3">
        <Button variant="ghost" size="sm" onClick={goToProject}>
          <ChevronLeft className="mr-1 size-4" />
          {t('report_view.back_to_project')}
        </Button>

        <div className="flex items-center gap-2">
          <fieldset
            className="m-0 flex overflow-hidden rounded-md border border-border/60 p-0 text-xs"
            aria-label={t('report_view.rounding_mode')}
          >
            <legend className="sr-only">{t('report_view.rounding_mode')}</legend>
            <button
              type="button"
              aria-pressed={!rounded}
              onClick={() => setRounded(false)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                !rounded
                  ? 'bg-sky-600 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_full')}
            </button>
            <button
              type="button"
              aria-pressed={rounded}
              onClick={() => setRounded(true)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                rounded
                  ? 'bg-sky-600 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_rounded', { value: interval })}
            </button>
          </fieldset>

          <Button
            size="sm"
            onClick={handlePrint}
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            <Printer className="mr-1.5 size-4" />
            {t('report_view.print_pdf')}
          </Button>
        </div>
      </div>
    </div>
  );
}
