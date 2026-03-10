import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Copy,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import {
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  duplicateTemplate,
  getSelectedTemplateId,
  setSelectedTemplateId,
} from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';

type ReportTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

interface SectionDef {
  id: string;
  labelKey: string;
  preview: (t: ReportTranslator) => React.ReactNode;
}

const ALL_SECTIONS: SectionDef[] = [
  {
    id: 'header',
    labelKey: 'reports_page.sections.header',
    preview: (t) => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          {t('reports_page.preview.header.project_report_title')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          {t('reports_page.preview.header.meta_line')}
        </div>
      </div>
    ),
  },
  {
    id: 'stats',
    labelKey: 'reports_page.sections.stats',
    preview: (t) => (
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.time_label')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.sessions_label')}
          </div>
          <div className="font-bold text-foreground/60">142</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.stats.apps_label')}
          </div>
          <div className="font-bold text-foreground/60">8</div>
        </div>
      </div>
    ),
  },
  {
    id: 'financials',
    labelKey: 'reports_page.sections.financials',
    preview: (t) => (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.financials.value_label')}
          </div>
          <div className="font-bold text-emerald-400/60">4 500,00 PLN</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {t('reports_page.preview.financials.work_time_label')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
      </div>
    ),
  },
  {
    id: 'apps',
    labelKey: 'reports_page.sections.apps',
    preview: (t) => (
      <div className="space-y-1">
        {[
          t('reports_page.preview.apps.line_vscode'),
          t('reports_page.preview.apps.line_chrome'),
          t('reports_page.preview.apps.line_terminal'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'files',
    labelKey: 'reports_page.sections.files',
    preview: (t) => (
      <div className="text-sm text-muted-foreground/40">
        <div className="text-[9px]">{t('reports_page.preview.files.title')}</div>
        <div className="font-bold">{t('reports_page.preview.files.count')}</div>
      </div>
    ),
  },
  {
    id: 'ai',
    labelKey: 'reports_page.sections.ai',
    preview: (t) => (
      <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground/40">
        <div>
          <div className="text-[9px]">
            {t('reports_page.preview.ai.suggestions')}
          </div>
          <div className="font-bold">23</div>
        </div>
        <div>
          <div className="text-[9px]">
            {t('reports_page.preview.ai.assigned')}
          </div>
          <div className="font-bold">18</div>
        </div>
      </div>
    ),
  },
  {
    id: 'sessions',
    labelKey: 'reports_page.sections.sessions',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.sessions.line_1'),
          t('reports_page.preview.sessions.line_2'),
          t('reports_page.preview.sessions.line_3'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
        <div className="text-[9px] text-muted-foreground/20">
          {t('reports_page.preview.sessions.more')}
        </div>
      </div>
    ),
  },
  {
    id: 'comments',
    labelKey: 'reports_page.sections.comments',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.comments.line_1'),
          t('reports_page.preview.comments.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'boosts',
    labelKey: 'reports_page.sections.boosts',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.boosts.line_1'),
          t('reports_page.preview.boosts.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'manual_sessions',
    labelKey: 'reports_page.sections.manual_sessions',
    preview: (t) => (
      <div className="space-y-0.5">
        {[
          t('reports_page.preview.manual_sessions.line_1'),
          t('reports_page.preview.manual_sessions.line_2'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'footer',
    labelKey: 'reports_page.sections.footer',
    preview: (t) => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        {t('reports_page.preview.footer.line')}
      </div>
    ),
  },
];

const DEFAULT_IDS = [
  'header',
  'stats',
  'financials',
  'apps',
  'sessions',
  'comments',
  'footer',
];

export function Reports() {
  const { t } = useTranslation();

  const [templates, setTemplates] = useState<ReportTemplate[]>(() =>
    loadTemplates(),
  );
  const [activeTemplateId, setActiveTemplateId] = useState(() =>
    getSelectedTemplateId(),
  );
  const activeTemplate =
    templates.find((template) => template.id === activeTemplateId) ??
    templates[0] ??
    null;
  const activeIds = activeTemplate?.sections ?? [];
  const deferredActiveTemplate = useDeferredValue(activeTemplate);
  const previewTemplate = deferredActiveTemplate ?? activeTemplate;
  const previewLoading = deferredActiveTemplate !== activeTemplate;
  const previewIds = previewTemplate?.sections ?? [];

  const saveSections = useCallback(
    (sections: string[]) => {
      if (!activeTemplate) return;
      const updated = { ...activeTemplate, sections };
      const newList = saveTemplate(updated);
      setTemplates(newList);
    },
    [activeTemplate],
  );

  const patchTemplate = useCallback(
    (patch: Partial<ReportTemplate>) => {
      if (!activeTemplate) return;
      const updated = { ...activeTemplate, ...patch };
      const newList = saveTemplate(updated);
      setTemplates(newList);
    },
    [activeTemplate],
  );

  const handleSelectTemplate = (id: string) => {
    setActiveTemplateId(id);
    setSelectedTemplateId(id);
  };

  const handleNewTemplate = () => {
    const newTpl: ReportTemplate = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: t('reports_page.template.new_template'),
      sections: [...DEFAULT_IDS],
      showLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newList = saveTemplate(newTpl);
    setTemplates(newList);
    handleSelectTemplate(newTpl.id);
  };

  const handleDuplicate = () => {
    if (!activeTemplate) return;
    const newList = duplicateTemplate(
      activeTemplate.id,
      t('reports_page.template.copy_suffix'),
    );
    setTemplates(newList);
    const newest = newList[newList.length - 1];
    if (newest) handleSelectTemplate(newest.id);
  };

  const handleDelete = () => {
    if (!activeTemplate || templates.length <= 1) return;
    const newList = deleteTemplate(activeTemplate.id);
    setTemplates(newList);
    handleSelectTemplate(newList[0].id);
  };

  const availableSections = ALL_SECTIONS.filter(
    (section) => !activeIds.includes(section.id),
  );

  const addSection = (id: string) => saveSections([...activeIds, id]);
  const removeSection = (id: string) =>
    saveSections(activeIds.filter((x) => x !== id));
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...activeIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    saveSections(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= activeIds.length - 1) return;
    const next = [...activeIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    saveSections(next);
  };

  const sectionDefById = useMemo(
    () => new Map(ALL_SECTIONS.map((section) => [section.id, section])),
    [],
  );
  const getSectionDef = useCallback(
    (id: string) => sectionDefById.get(id),
    [sectionDefById],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 pb-3 border-b border-border/30 shrink-0">
        <h1 className="text-base font-semibold text-foreground">
          {t('reports_page.editor.title')}
        </h1>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground/40">
          {t('reports_page.editor.autosave_hint')}
        </span>
      </div>

      <div className="flex items-center gap-2 pt-3 pb-2 shrink-0 overflow-x-auto">
        {templates.length > 0 ? (
          templates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleSelectTemplate(template.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                template.id === activeTemplate?.id
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                  : 'border-border/20 text-muted-foreground/50 hover:border-border/40 hover:text-foreground/70'
              }`}
            >
              <FileText className="h-3 w-3" />
              {template.name}
            </button>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border/30 px-3 py-1.5 text-xs text-muted-foreground/60">
            {t('reports_page.empty.templates')}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewTemplate}
          className="h-7 px-2 text-muted-foreground/40 hover:text-sky-300"
          title={t('reports_page.tooltips.new_template')}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDuplicate}
          className="h-7 px-2 text-muted-foreground/40 hover:text-sky-300"
          title={t('reports_page.tooltips.duplicate_template')}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {templates.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-7 px-2 text-muted-foreground/40 hover:text-destructive"
            title={t('reports_page.tooltips.delete_template')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {activeTemplate ? (
        <>
          <div className="mt-3 grid gap-3 rounded-lg border border-border/20 bg-card/20 p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-semibold text-muted-foreground/70">
                {t('reports_page.fields.template_name')}
              </span>
              <input
                value={activeTemplate.name}
                onChange={(e) => patchTemplate({ name: e.target.value })}
                className="rounded border border-border/40 bg-secondary/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder={t('reports_page.fields.name_placeholder')}
              />
            </label>
            <label className="flex items-center gap-2 rounded border border-border/40 bg-secondary/10 px-2 py-2 text-[11px]">
              <input
                type="checkbox"
                checked={activeTemplate.showLogo}
                onChange={(e) => patchTemplate({ showLogo: e.target.checked })}
                className="h-3.5 w-3.5 accent-sky-500"
              />
              <span className="font-semibold text-muted-foreground/80">
                {t('reports_page.fields.show_logo')}
              </span>
            </label>
          </div>

          <div className="flex flex-1 min-h-0 mt-3 gap-4">
            <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
              <div>
                <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-1.5">
                  {t('reports_page.panel.active_sections')}
                </div>
                <div className="space-y-1">
                  {activeIds.map((id, idx) => {
                    const def = getSectionDef(id);
                    if (!def) return null;
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[11px] text-sky-300"
                      >
                        <span className="flex-1 truncate">{t(def.labelKey)}</span>
                        <button
                          onClick={() => moveUp(idx)}
                          className="text-muted-foreground/30 hover:text-foreground"
                          title="↑"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => moveDown(idx)}
                          className="text-muted-foreground/30 hover:text-foreground"
                          title="↓"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => removeSection(id)}
                          className="text-muted-foreground/30 hover:text-destructive"
                          title="×"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {availableSections.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-1.5">
                    {t('reports_page.panel.available_sections')}
                  </div>
                  <div className="space-y-1">
                    {availableSections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => addSection(section.id)}
                        className="flex items-center gap-1.5 w-full rounded-md border border-border/20 bg-secondary/5 px-2 py-1.5 text-[11px] text-muted-foreground/40 hover:border-sky-500/30 hover:text-sky-300 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>{t(section.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative flex-1 overflow-y-auto rounded-xl border border-border/20 bg-card/30 p-6">
              {previewLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
                  <div className="rounded-full border border-border/40 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground">
                    {t('reports_page.empty.preview_loading')}
                  </div>
                </div>
              )}
              <div className="max-w-2xl mx-auto space-y-4">
                {previewIds.map((id) => {
                  const def = getSectionDef(id);
                  if (!def) return null;
                  return (
                    <div
                      key={id}
                      className="rounded-lg border border-dashed border-muted-foreground/15 p-3 hover:border-sky-500/30 transition-colors"
                    >
                      <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/25 mb-2">
                        {t(def.labelKey)}
                      </div>
                      {def.preview(t)}
                    </div>
                  );
                })}

                {previewIds.length === 0 && !previewLoading && (
                  <div className="text-center text-muted-foreground/30 py-16 text-sm">
                    {t('reports_page.empty.add_sections')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-border/30 bg-card/20 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {t('reports_page.empty.templates')}
          </p>
          <Button className="mt-4" onClick={handleNewTemplate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('reports_page.empty.create_template')}
          </Button>
        </div>
      )}
    </div>
  );
}
