import { useState } from 'react';
import { FileText, Check, Edit2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportPeriodPicker } from '@/components/reports/ReportPeriodPicker';
import { loadProjectTemplates, getProjectTemplate, getSelectedTemplateId, setSelectedTemplateId } from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';
import { ALL_TIME_PERIOD, type ReportPeriod } from '@/lib/report-period';
import { useTranslation } from 'react-i18next';

interface Props {
  onSelect: (templateId: string, period: ReportPeriod) => void;
  onCancel: () => void;
  onEditTemplates: () => void;
}

export function ReportTemplateSelector({ onSelect, onCancel, onEditTemplates }: Props) {
  const { t } = useTranslation();
  // Selektor jest otwierany tylko z karty projektu → pokazujemy wyłącznie
  // szablony projektowe. Szablon estymacji dałby pusty raport (sekcje `est_*`
  // nie pasują do sekcji projektu).
  const [templates] = useState<ReportTemplate[]>(() => loadProjectTemplates());
  // Zachowaj ostatni projektowy wybór; gdy zapisany id jest estymacyjny lub
  // nieznany — getProjectTemplate spada na 'default'.
  const [selectedId, setSelectedId] = useState(
    () => getProjectTemplate(getSelectedTemplateId()).id,
  );
  // Okres celowo NIE jest zapamiętywany między raportami — start zawsze od całego
  // okresu, żeby nie wystawić dokumentu za miesiąc wybrany poprzednim razem.
  const [period, setPeriod] = useState<ReportPeriod>(ALL_TIME_PERIOD);

  const handleSelect = () => {
    setSelectedTemplateId(selectedId);
    onSelect(selectedId, period);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0">
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-sky-400" />
            <h2 className="text-base font-semibold">{t('reports.template_selector.choose_template')}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} className="size-7 p-0">
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {templates.map((tpl) => (
            <button type="button"
              key={tpl.id}
              onClick={() => setSelectedId(tpl.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedId === tpl.id
                  ? 'border-sky-500/50 bg-sky-500/10'
                  : 'border-border/30 hover:border-border/60 hover:bg-secondary/20'
              }`}
            >
              <div className="flex items-center gap-2">
                {selectedId === tpl.id && <Check className="size-4 text-sky-400 shrink-0" />}
                <span className="text-sm font-medium">{tpl.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1 pl-6">
                {tpl.sections.length} {t('reports.template_selector.sections_label')}
              </p>
            </button>
          ))}
        </div>

        <div className="border-t border-border/30 pt-3">
          <ReportPeriodPicker period={period} onChange={setPeriod} />
        </div>

        <div className="flex justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={onEditTemplates}>
            <Edit2 className="mr-1.5 size-3.5" />
            {t('reports.template_selector.edit_templates')}
          </Button>
          <Button
            size="sm"
            onClick={handleSelect}
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            {t('reports.template_selector.generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
