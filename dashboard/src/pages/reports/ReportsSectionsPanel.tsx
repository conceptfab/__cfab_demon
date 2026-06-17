import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import type { ReportsPageController } from '@/hooks/useReportsPageController';

type ReportsSectionsPanelProps = Pick<
  ReportsPageController,
  | 'activeIds'
  | 'addSection'
  | 'availableSections'
  | 'getSectionDef'
  | 'moveDown'
  | 'moveUp'
  | 'removeSection'
  | 't'
>;

export function ReportsSectionsPanel({
  activeIds,
  addSection,
  availableSections,
  getSectionDef,
  moveDown,
  moveUp,
  removeSection,
  t,
}: ReportsSectionsPanelProps) {
  return (
    <div className="flex max-h-56 w-full shrink-0 flex-col gap-3 overflow-y-auto pr-1 md:max-h-none md:w-56">
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
                  type="button"
                  onClick={() => moveUp(idx)}
                  className="text-muted-foreground/30 hover:text-foreground"
                  title="↑"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(idx)}
                  className="text-muted-foreground/30 hover:text-foreground"
                  title="↓"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSection(id)}
                  className="text-muted-foreground/30 hover:text-destructive"
                  title="×"
                >
                  <Trash2 className="size-3" />
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
                type="button"
                key={section.id}
                onClick={() => addSection(section.id)}
                className="flex items-center gap-1.5 w-full rounded-md border border-border/20 bg-secondary/5 px-2 py-1.5 text-[11px] text-muted-foreground/40 hover:border-sky-500/30 hover:text-sky-300 transition-colors"
              >
                <Plus className="size-3" />
                <span>{t(section.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
