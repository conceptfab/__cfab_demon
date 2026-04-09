import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
        'flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-all group rounded-l-lg',
        'data-[state=active]:bg-primary/10 data-[state=active]:text-primary',
        'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-accent/30 data-[state=inactive]:hover:text-accent-foreground',
      )}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight className="h-3 w-3 opacity-0 data-[state=active]:opacity-100 transition-opacity" />
    </TabsTrigger>
  );
}

export function SectionHelp({
  icon,
  title,
  description,
  features,
  footer,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  footer: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="flex flex-row items-center gap-4 pb-4 px-0">
        <div className="p-3 rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
          {icon}
        </div>
        <div>
          <CardTitle className="text-xl font-medium tracking-tight">
            {title}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            {description}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-0">
        {children}

        <div className="mt-8">
          <h4 className="text-[10px] font-bold mb-4 uppercase tracking-[0.15em] text-muted-foreground/60 border-b border-border/10 pb-2">
            {footer}
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 text-sm group">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                <span className="text-foreground/80 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function HelpDetailsBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="text-sm space-y-4 text-foreground/90 leading-relaxed border-t border-border/10 pt-4">
      <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
        {title}
      </h4>
      <ul className="list-disc ml-5 space-y-2 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
