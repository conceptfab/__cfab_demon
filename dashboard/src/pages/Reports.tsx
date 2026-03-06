import { useState, useCallback } from 'react';
import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { useInlineT } from '@/lib/inline-i18n';

// ─── Section definitions ────────────────────────────────────────────
interface SectionDef {
  id: string;
  pl: string;
  en: string;
  preview: () => React.ReactNode;
}

const ALL_SECTIONS: SectionDef[] = [
  {
    id: 'header',
    pl: 'Nagłówek i tytuł',
    en: 'Header & title',
    preview: () => (
      <div className="text-center py-3 border-b border-dashed border-muted-foreground/20">
        <div className="text-lg font-bold text-foreground/80">
          Nazwa Projektu — Report
        </div>
        <div className="text-[10px] text-muted-foreground/50 mt-1">
          ● Projekt · 2026-01-01 — 2026-03-06 · Wygenerowano: 2026-03-06
        </div>
      </div>
    ),
  },
  {
    id: 'stats',
    pl: 'Statystyki główne',
    en: 'Main statistics',
    preview: () => (
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">CZAS</div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">SESJE</div>
          <div className="font-bold text-foreground/60">142</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">APLIKACJE</div>
          <div className="font-bold text-foreground/60">8</div>
        </div>
      </div>
    ),
  },
  {
    id: 'financials',
    pl: 'Dane finansowe',
    en: 'Financial data',
    preview: () => (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[9px] text-muted-foreground/40">WARTOŚĆ</div>
          <div className="font-bold text-emerald-400/60">4 500,00 PLN</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/40">CZAS PRACY</div>
          <div className="font-bold text-foreground/60">24h 15m</div>
        </div>
      </div>
    ),
  },
  {
    id: 'apps',
    pl: 'Top aplikacje',
    en: 'Top applications',
    preview: () => (
      <div className="space-y-1">
        {[
          'VS Code ██████████ 8h 20m',
          'Chrome   ████████   6h 10m',
          'Terminal ████       3h 05m',
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
    preview: () => (
      <div className="text-sm text-muted-foreground/40">
        <div className="text-[9px]">ZAREJESTROWANE PLIKI</div>
        <div className="font-bold">47 plików</div>
      </div>
    ),
  },
  {
    id: 'ai',
    pl: 'Dane AI (sugestie)',
    en: 'AI data (suggestions)',
    preview: () => (
      <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground/40">
        <div>
          <div className="text-[9px]">SUGESTIE AI</div>
          <div className="font-bold">23</div>
        </div>
        <div>
          <div className="text-[9px]">PRZYPISANE PRZEZ AI</div>
          <div className="font-bold">18</div>
        </div>
      </div>
    ),
  },
  {
    id: 'sessions',
    pl: 'Lista sesji',
    en: 'Session list',
    preview: () => (
      <div className="space-y-0.5">
        {[
          '03-06  VS Code   1h 20m  Refactoring main module',
          '03-05  Chrome    0h 45m  Research',
          '03-05  Terminal  0h 30m',
        ].map((line) => (
          <div
            key={line}
            className="text-[10px] text-muted-foreground/40 font-mono"
          >
            {line}
          </div>
        ))}
        <div className="text-[9px] text-muted-foreground/20">
          +139 więcej...
        </div>
      </div>
    ),
  },
  {
    id: 'comments',
    pl: 'Komentarze',
    en: 'Comments',
    preview: () => (
      <div className="space-y-0.5">
        {[
          '03-06  Zakończono refaktoring modułu AI',
          '03-04  Poprawiono wydajność zapytań DB',
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
    preview: () => (
      <div className="text-center text-[9px] text-muted-foreground/20 border-t border-dashed border-muted-foreground/10 pt-2">
        Nazwa Projektu — Report · 2026-03-06 14:30
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

  // Active section IDs in order
  const [activeIds, setActiveIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('timeflow_report_template');
      return saved ? JSON.parse(saved) : DEFAULT_IDS;
    } catch {
      return DEFAULT_IDS;
    }
  });

  const save = useCallback((ids: string[]) => {
    setActiveIds(ids);
    localStorage.setItem('timeflow_report_template', JSON.stringify(ids));
  }, []);

  const availableSections = ALL_SECTIONS.filter(
    (s) => !activeIds.includes(s.id),
  );

  const addSection = (id: string) => save([...activeIds, id]);
  const removeSection = (id: string) => save(activeIds.filter((x) => x !== id));
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...activeIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    save(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= activeIds.length - 1) return;
    const next = [...activeIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    save(next);
  };

  const getSectionDef = (id: string) => ALL_SECTIONS.find((s) => s.id === id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/30 shrink-0">
        <h1 className="text-base font-semibold text-foreground">
          {tt('Edytor szablonu raportu', 'Report Template Editor')}
        </h1>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground/40">
          {tt('Szablon zapisywany automatycznie', 'Template auto-saved')}
        </span>
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
                  {def.preview()}
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
