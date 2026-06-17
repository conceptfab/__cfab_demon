import { usePmPageController } from '@/hooks/usePmPageController';
import { PmPageView } from '@/pages/pm/PmPageView';

export type { PmTfMatch } from '@/lib/pm-page-match';

export function PM() {
  const controller = usePmPageController();
  return <PmPageView {...controller} />;
}
