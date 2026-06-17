import { useEstimatesPageController } from '@/hooks/useEstimatesPageController';
import { EstimatesView } from '@/pages/EstimatesView';

export function Estimates() {
  const controller = useEstimatesPageController();
  return <EstimatesView controller={controller} />;
}
