import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { TabsTrigger } from '@/components/ui/tabs';
import type { HelpTabId } from '@/lib/help-navigation';

export function HelpTabTrigger({
  value,
  icon,
  label,
}: {
  value: HelpTabId;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'group flex w-auto shrink-0 items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all md:w-full md:rounded-l-lg',
        'data-[state=active]:bg-primary/10 data-[state=active]:text-primary',
        'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-accent/30 data-[state=inactive]:hover:text-accent-foreground',
      )}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight className="hidden size-3 opacity-0 transition-opacity data-[state=active]:opacity-100 md:block" />
    </TabsTrigger>
  );
}
