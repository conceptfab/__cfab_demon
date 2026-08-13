import { ArrowUp, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { HIGH_PRIORITY_ICON } from '@/lib/todo-priority';

/**
 * Legenda oznaczeń kalendarza zadań.
 *
 * Powód istnienia: kolorowy pasek przy zadaniu bez wyjaśnienia czyta się jak
 * usterka, a nie jak informacja. Trzy pozycje to komplet — w kalendarzu nie ma
 * innych oznaczeń kolorem poza kolorem encji, który jest wspólny dla całej
 * aplikacji i tłumaczy się sam.
 */
export function TodoCalendarLegend() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <ArrowUp className={cn('size-3', HIGH_PRIORITY_ICON)} />
        {t('todo.priority_high')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm ring-1 ring-sky-400/60" />
        {t('ui.date_presets.today')}
      </span>
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="size-3 text-emerald-400" />
        {t('todo.legend_done')}
      </span>
    </div>
  );
}
