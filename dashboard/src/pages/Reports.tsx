import { useState, useCallback, useMemo } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2, Copy, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInlineT } from '@/lib/inline-i18n';
import { loadTemplates, saveTemplate, deleteTemplate, duplicateTemplate, getSelectedTemplateId, setSelectedTemplateId } from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';

// ─── Section definitions ────────────────────────────────────────────
interface SectionDef {
  id: string;
  pl: string;
  en: string;
  preview: (tt: ReturnType<typeof useInlineT>) => React.ReactNode;
}

const ALL_SECTIONS: SectionDef[] = [
  {
    id: 'header',
    pl: 'Nagłówek i tytuł',
    en: 'Header & title',
    preview: (tt) => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          {tt('Nazwa Projektu — Raport', 'Project Name — Report')}
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          {tt(
            '● Projekt · 2026-01-01 — 2026-03-06 · Wygenerowano: 2026-03-06',
            '● Project · 2026-01-01 — 2026-03-06 · Generated: 2026-03-06',
          )}
        </div>
      </div>
    ),
  },
  {
    id: 'stats',
    pl: 'Statystyki główne',
    en: 'Main statistics',
    preview: (tt) => (
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {tt('CZAS', 'TIME')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {tt('SESJE', 'SESSIONS')}
          </div>
          <div className="font-bold text-foreground/60">142</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {tt('APLIKACJE', 'APPLICATIONS')}
          </div>
          <div className="font-bold text-foreground/60">8</div>
        </div>
      </div>
    ),
  },
  {
    id: 'financials',
    pl: 'Dane finansowe',
    en: 'Financial data',
    preview: (tt) => (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {tt('WARTOŚĆ', 'VALUE')}
          </div>
          <div className="font-bold text-emerald-400/60">4 500,00 PLN</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">
            {tt('CZAS PRACY', 'WORK TIME')}
          </div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
      </div>
    ),
  },
  {
    id: 'apps',
    pl: 'Top aplikacje',
    en: 'Top applications',
    preview: (tt) => (
      <div className="space-y-1">
        {[
          tt('VS Code ██████████ 8h 20m', 'VS Code ██████████ 8h 20m'),
          tt('Chrome   ████████   6h 10m', 'Chrome   ████████   6h 10m'),
          tt('Terminal ████       3h 05m', 'Terminal ████       3h 05m'),
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
    pl: 'Pliki / aktywność',
    en: 'Files / activity',
    preview: (tt) => (
      <div className="text-sm text-muted-foreground/40">
        <div className="text-[9px]">
          {tt('ZAREJESTROWANE PLIKI', 'TRACKED FILES')}
        </div>
        <div className="font-bold">{tt('47 plików', '47 files')}</div>
      </div>
    ),
  },
  {
    id: 'ai',
    pl: 'Dane AI (sugestie)',
    en: 'AI data (suggestions)',
    preview: (tt) => (
      <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground/40">
        <div>
          <div className="text-[9px]">{tt('SUGESTIE AI', 'AI SUGGESTIONS')}</div>
          <div className="font-bold">23</div>
        </div>
        <div>
          <div className="text-[9px]">
            {tt('PRZYPISANE PRZEZ AI', 'ASSIGNED BY AI')}
          </div>
          <div className="font-bold">18</div>
        </div>
      </div>
    ),
  },
  {
    id: 'sessions',
    pl: 'Lista sesji',
    en: 'Session list',
    preview: (tt) => (
      <div className="space-y-0.5">
        {[
          tt(
            '03-06  VS Code   1h 20m  Refaktoryzacja głównego modułu',
            '03-06  VS Code   1h 20m  Refactoring main module',
          ),
          tt(
            '03-05  Chrome    0h 45m  Research',
            '03-05  Chrome    0h 45m  Research',
          ),
          tt('03-05  Terminal  0h 30m', '03-05  Terminal  0h 30m'),
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
        <div className="text-[9px] text-muted-foreground/20">
          {tt('+139 więcej...', '+139 more...')}
        </div>
      </div>
    ),
  },
  {
    id: 'comments',
    pl: 'Komentarze',
    en: 'Comments',
    preview: (tt) => (
      <div className="space-y-0.5">
        {[
          tt(
            '03-06  Zakończono refaktoring modułu AI',
            '03-06  AI module refactor completed',
          ),
          tt(
            '03-04  Poprawiono wydajność zapytań DB',
            '03-04  Improved DB query performance',
          ),
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
    pl: 'Sesje z mnożnikiem (Boosty)',
    en: 'Boosted sessions',
    preview: (tt) => (
      <div className="space-y-0.5">
        {[
          tt('03-06  VS Code   1h 20m  2×', '03-06  VS Code   1h 20m  2×'),
          tt('03-05  Chrome    0h 45m  1.5×', '03-05  Chrome    0h 45m  1.5×'),
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
    pl: 'Sesje manualne',
    en: 'Manual sessions',
    preview: (tt) => (
      <div className="space-y-0.5">
        {[
          tt(
            '03-06  Spotkanie z klientem  meeting  1h 30m',
            '03-06  Client meeting        meeting  1h 30m',
          ),
          tt(
            '03-05  Code review           review   0h 45m',
            '03-05  Code review           review   0h 45m',
          ),
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
    pl: 'Stopka',
    en: 'Footer',
    preview: (tt) => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        {tt(
          'Nazwa Projektu — Raport · 2026-03-06 14:30',
          'Project Name — Report · 2026-03-06 14:30',
        )}
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

// ─── Template editor component ──────────────────────────────────────
export function Reports() {
  const tt = useInlineT();

  const [templates, setTemplates] = useState<ReportTemplate[]>(() => loadTemplates());
  const [activeTemplateId, setActiveTemplateId] = useState(() => getSelectedTemplateId());
  const activeTemplate = templates.find(t => t.id === activeTemplateId) || templates[0];
  const activeIds = activeTemplate.sections;

  const saveSections = useCallback((sections: string[]) => {
    const updated = { ...activeTemplate, sections };
    const newList = saveTemplate(updated);
    setTemplates(newList);
  }, [activeTemplate]);

  const patchTemplate = useCallback((patch: Partial<ReportTemplate>) => {
    const updated = { ...activeTemplate, ...patch };
    const newList = saveTemplate(updated);
    setTemplates(newList);
  }, [activeTemplate]);

  const handleSelectTemplate = (id: string) => {
    setActiveTemplateId(id);
    setSelectedTemplateId(id);
  };

  const handleNewTemplate = () => {
    const newTpl: ReportTemplate = {
      id: crypto.randomUUID ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: tt('Nowy szablon', 'New template'),
      sections: [...DEFAULT_IDS],
      fontFamily: 'system',
      baseFontSize: 13,
      showLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newList = saveTemplate(newTpl);
    setTemplates(newList);
    handleSelectTemplate(newTpl.id);
  };

  const handleDuplicate = () => {
    const newList = duplicateTemplate(activeTemplate.id, tt('kopia', 'copy'));
    setTemplates(newList);
    const newest = newList[newList.length - 1];
    if (newest) handleSelectTemplate(newest.id);
  };

  const handleDelete = () => {
    if (templates.length <= 1) return;
    const newList = deleteTemplate(activeTemplate.id);
    setTemplates(newList);
    handleSelectTemplate(newList[0].id);
  };

  const availableSections = ALL_SECTIONS.filter(
    (s) => !activeIds.includes(s.id),
  );

  const addSection = (id: string) => saveSections([...activeIds, id]);
  const removeSection = (id: string) => saveSections(activeIds.filter((x) => x !== id));
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
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/30 shrink-0">
        <h1 className="text-base font-semibold text-foreground">
          {tt('Edytor szablonow raportow', 'Report Template Editor')}
        </h1>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground/40">
          {tt('Szablon zapisywany automatycznie', 'Template auto-saved')}
        </span>
      </div>

      {/* Template tabs */}
      <div className="flex items-center gap-2 pt-3 pb-2 shrink-0 overflow-x-auto">
        {templates.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => handleSelectTemplate(tpl.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              tpl.id === activeTemplate.id
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                : 'border-border/20 text-muted-foreground/50 hover:border-border/40 hover:text-foreground/70'
            }`}
          >
            <FileText className="h-3 w-3" />
            {tpl.name}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewTemplate}
          className="h-7 px-2 text-muted-foreground/40 hover:text-sky-300"
          title={tt('Nowy szablon', 'New template')}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDuplicate}
          className="h-7 px-2 text-muted-foreground/40 hover:text-sky-300"
          title={tt('Duplikuj szablon', 'Duplicate template')}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {templates.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-7 px-2 text-muted-foreground/40 hover:text-destructive"
            title={tt('Usun szablon', 'Delete template')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-3 rounded-lg border border-border/20 bg-card/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-muted-foreground/70">
            {tt('Nazwa szablonu', 'Template name')}
          </span>
          <input
            value={activeTemplate.name}
            onChange={(e) => patchTemplate({ name: e.target.value })}
            className="rounded border border-border/40 bg-secondary/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
            placeholder={tt('Nazwa', 'Name')}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-muted-foreground/70">
            {tt('Font bazowy', 'Base font')}
          </span>
          <select
            value={activeTemplate.fontFamily}
            onChange={(e) => patchTemplate({ fontFamily: e.target.value as ReportTemplate['fontFamily'] })}
            className="rounded border border-border/40 bg-secondary/20 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="system">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-semibold text-muted-foreground/70">
            {tt('Rozmiar bazowy', 'Base size')}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={18}
              value={activeTemplate.baseFontSize}
              onChange={(e) => patchTemplate({ baseFontSize: Number(e.target.value) })}
              className="w-full accent-sky-500"
            />
            <span className="w-8 text-[10px] font-mono text-muted-foreground/70">
              {activeTemplate.baseFontSize}px
            </span>
          </div>
        </label>
        <label className="flex items-center gap-2 rounded border border-border/40 bg-secondary/10 px-2 py-2 text-[11px]">
          <input
            type="checkbox"
            checked={activeTemplate.showLogo}
            onChange={(e) => patchTemplate({ showLogo: e.target.checked })}
            className="h-3.5 w-3.5 accent-sky-500"
          />
          <span className="font-semibold text-muted-foreground/80">
            {tt('Pokaż logo TIMEFLOW', 'Show TIMEFLOW logo')}
          </span>
        </label>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 mt-3 gap-4">
        {/* ── LEFT: Section manager ── */}
        <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Active sections */}
          <div>
            <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-1.5">
              {tt('Aktywne sekcje', 'Active sections')}
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
                    <span className="flex-1 truncate">
                      {tt(def.pl, def.en)}
                    </span>
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

          {/* Available sections to add */}
          {availableSections.length > 0 && (
            <div>
              <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-1.5">
                {tt('Dostępne sekcje', 'Available sections')}
              </div>
              <div className="space-y-1">
                {availableSections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => addSection(s.id)}
                    className="flex items-center gap-1.5 w-full rounded-md border border-border/20 bg-secondary/5 px-2 py-1.5 text-[11px] text-muted-foreground/40 hover:border-sky-500/30 hover:text-sky-300 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    <span>{tt(s.pl, s.en)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Live wireframe preview ── */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-border/20 bg-card/30 p-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {activeIds.map((id) => {
              const def = getSectionDef(id);
              if (!def) return null;
              return (
                <div
                  key={id}
                  className="rounded-lg border border-dashed border-muted-foreground/15 p-3 hover:border-sky-500/30 transition-colors"
                >
                  <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/25 mb-2">
                    {tt(def.pl, def.en)}
                  </div>
                  {def.preview(tt)}
                </div>
              );
            })}

            {activeIds.length === 0 && (
              <div className="text-center text-muted-foreground/30 py-16 text-sm">
                {tt(
                  'Dodaj sekcje z listy po lewej',
                  'Add sections from the list on the left',
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
