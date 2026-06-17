import type { EstimateReportController } from '@/hooks/useEstimateReportController';
import { EstimateReportDocument } from '@/pages/estimate-report/EstimateReportDocument';
import { EstimateReportToolbar } from '@/pages/estimate-report/EstimateReportToolbar';

interface Props {
  controller: EstimateReportController;
}

export function EstimateReportPage({ controller }: Props) {
  const { config, error, goBack, model, t } = controller;

  if (!config || error || !model) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          {error ? t('estimate_report.error') : t('estimate_report.empty')}
        </p>
        <button
          type="button"
          onClick={goBack}
          className="text-sm font-medium text-sky-500 hover:underline"
        >
          {t('estimate_report.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background pt-8 print:h-auto print:bg-white print:pt-0">
      <EstimateReportToolbar {...controller} />
      <EstimateReportDocument controller={controller} />
    </div>
  );
}
