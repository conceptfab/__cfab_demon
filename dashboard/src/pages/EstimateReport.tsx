import { useEstimateReportController } from '@/hooks/useEstimateReportController';
import { EstimateReportPage } from '@/pages/estimate-report/EstimateReportPage';

export function EstimateReport() {
  const controller = useEstimateReportController();
  return <EstimateReportPage controller={controller} />;
}
