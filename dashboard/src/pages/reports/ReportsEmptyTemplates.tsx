import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReportsPageController } from '@/hooks/useReportsPageController';

type ReportsEmptyTemplatesProps = Pick<
  ReportsPageController,
  'handleNewTemplate' | 't'
>;

export function ReportsEmptyTemplates({
  handleNewTemplate,
  t,
}: ReportsEmptyTemplatesProps) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-border/30 bg-card/20 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        {t('reports_page.empty.templates')}
      </p>
      <Button className="mt-4" onClick={handleNewTemplate}>
        <Plus className="mr-2 size-4" />
        {t('reports_page.empty.create_template')}
      </Button>
    </div>
  );
}
