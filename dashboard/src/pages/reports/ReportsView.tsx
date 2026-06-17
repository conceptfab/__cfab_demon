import type { ReportsPageController } from '@/hooks/useReportsPageController';
import { ReportsEmptyTemplates } from '@/pages/reports/ReportsEmptyTemplates';
import { ReportsTemplateEditor } from '@/pages/reports/ReportsTemplateEditor';
import { ReportsTemplateToolbar } from '@/pages/reports/ReportsTemplateToolbar';

interface ReportsViewProps {
  controller: ReportsPageController;
}

export function ReportsView({ controller }: ReportsViewProps) {
  const { activeTemplate } = controller;

  return (
    <div className="flex flex-col h-full">
      <ReportsTemplateToolbar {...controller} />
      {activeTemplate ? (
        <ReportsTemplateEditor
          activeTemplate={activeTemplate}
          controller={controller}
        />
      ) : (
        <ReportsEmptyTemplates {...controller} />
      )}
    </div>
  );
}
