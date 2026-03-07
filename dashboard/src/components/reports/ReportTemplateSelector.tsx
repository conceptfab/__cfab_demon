import { useState } from 'react';
import { FileText, Check, Edit2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadTemplates, getSelectedTemplateId, setSelectedTemplateId } from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';
import { useInlineT } from '@/lib/inline-i18n';

interface Props {
  onSelect: (templateId: string) => void;
  onCancel: () => void;
  onEditTemplates: () => void;
}

export function ReportTemplateSelector({ onSelect, onCancel, onEditTemplates }: Props) {
  const tt = useInlineT();
  const [templates] = useState<ReportTemplate[]>(() => loadTemplates());
  const [selectedId, setSelectedId] = useState(() => getSelectedTemplateId());

  const handleSelect = () => {
    setSelectedTemplateId(selectedId);
    onSelect(selectedId);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0">
      <div className="w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-sky-400" />
            <h2 className="text-base font-bold">{tt('Wybierz szablon', 'Choose template')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => setSelectedId(tpl.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedId === tpl.id
                  ? 'border-sky-500/50 bg-sky-500/10'
                  : 'border-border/30 hover:border-border/60 hover:bg-secondary/20'
              }`}
            >
              <div className="flex items-center gap-2">
                {selectedId === tpl.id && <Check className="h-4 w-4 text-sky-400 shrink-0" />}
                <span className="text-sm font-medium">{tpl.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1 pl-6">
                {tpl.sections.length} {tt('sekcji', 'sections')} · {tpl.fontFamily} · {tpl.baseFontSize}px
              </p>
            </button>
          ))}
        </div>

        <div className="flex justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={onEditTemplates}>
            <Edit2 className="mr-1.5 h-3.5 w-3.5" />
            {tt('Edytuj szablony', 'Edit templates')}
          </Button>
          <Button
            size="sm"
            onClick={handleSelect}
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            {tt('Generuj', 'Generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
