import { ChevronLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { EstimateReportController } from '@/hooks/useEstimateReportController';

type Props = Pick<
  EstimateReportController,
  'goBack' | 'handlePrint' | 'rounded' | 'setRounded' | 'interval' | 't'
>;

export function EstimateReportToolbar({
  goBack,
  handlePrint,
  rounded,
  setRounded,
  interval,
  t,
}: Props) {
  return (
    <div className="shrink-0 border-b border-border/30 px-4 print:hidden">
      <div className="mx-auto flex w-full max-w-[700px] flex-wrap items-center justify-between gap-2 pb-3">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ChevronLeft className="mr-1 size-4" />
          {t('estimate_report.back')}
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
                !rounded ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_full')}
            </button>
            <button
              type="button"
              aria-pressed={rounded}
              onClick={() => setRounded(true)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                rounded ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('report_view.view_rounded', { value: interval })}
            </button>
          </fieldset>

          <Button
            size="sm"
            onClick={handlePrint}
            className="bg-sky-600 text-white hover:bg-sky-700"
          >
            <Printer className="mr-1.5 size-4" />
            {t('report_view.print_pdf')}
          </Button>
        </div>
      </div>
    </div>
  );
}
