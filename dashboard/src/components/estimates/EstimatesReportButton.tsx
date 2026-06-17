import { useState } from 'react';
import { FileText, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { loadTemplates } from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';
import { useUIStore } from '@/store/ui-store';

interface EstimatesReportButtonProps {
  onGenerate: (templateId: string) => void;
}

export function EstimatesReportButton({ onGenerate }: EstimatesReportButtonProps) {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  const openSelector = () => {
    const estimateTemplates = loadTemplates().filter((tpl) => tpl.kind === 'estimate');
    setTemplates(estimateTemplates);
    setSelectedId(estimateTemplates[0]?.id ?? '');
    setOpen(true);
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={openSelector}>
        <FileText className="mr-1.5 size-4" />
        {t('estimates_page.report.generate')}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-popover p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {t('estimates_page.report.choose_variant')}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="size-7 p-0"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selectedId === tpl.id
                      ? 'border-sky-500/50 bg-sky-500/10'
                      : 'border-border/30 hover:border-border/60 hover:bg-secondary/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {selectedId === tpl.id && (
                      <Check className="size-4 shrink-0 text-sky-400" />
                    )}
                    <span className="text-sm font-medium">{tpl.name}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setCurrentPage('reports');
                }}
              >
                {t('estimates_page.report.edit_templates')}
              </Button>
              <Button
                size="sm"
                disabled={!selectedId}
                onClick={() => {
                  setOpen(false);
                  onGenerate(selectedId);
                }}
                className="bg-sky-600 text-white hover:bg-sky-700"
              >
                {t('estimates_page.report.generate_action')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
