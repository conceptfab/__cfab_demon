import { Copy, FileText, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReportsPageController } from '@/hooks/useReportsPageController';

type ReportsTemplateToolbarProps = Pick<
  ReportsPageController,
  | 'activeTemplate'
  | 'handleDelete'
  | 'handleDuplicate'
  | 'handleNewTemplate'
  | 'handleSelectTemplate'
  | 't'
  | 'templates'
>;

export function ReportsTemplateToolbar({
  activeTemplate,
  handleDelete,
  handleDuplicate,
  handleNewTemplate,
  handleSelectTemplate,
  t,
  templates,
}: ReportsTemplateToolbarProps) {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-b border-border/30 pb-3">
        <span className="text-[10px] text-muted-foreground/40">
          {t('reports_page.editor.autosave_hint')}
        </span>
      </div>

      <div className="flex max-w-full shrink-0 items-center gap-2 overflow-x-auto pt-3 pb-2">
        {templates.length > 0 ? (
          templates.map((template) => (
            <button
              type="button"
              key={template.id}
              onClick={() => handleSelectTemplate(template.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                template.id === activeTemplate?.id
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                  : 'border-border/20 text-muted-foreground/50 hover:border-border/40 hover:text-foreground/70'
              }`}
            >
              <FileText className="size-3" />
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
          <Plus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDuplicate}
          className="h-7 px-2 text-muted-foreground/40 hover:text-sky-300"
          title={t('reports_page.tooltips.duplicate_template')}
        >
          <Copy className="size-3.5" />
        </Button>
        {templates.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-7 px-2 text-muted-foreground/40 hover:text-destructive"
            title={t('reports_page.tooltips.delete_template')}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </>
  );
}
