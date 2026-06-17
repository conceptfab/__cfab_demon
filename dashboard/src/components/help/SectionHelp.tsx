import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
      <CardHeader className="flex flex-col items-start gap-4 px-0 pb-4 sm:flex-row sm:items-center">
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
          <h4 className="text-[10px] font-semibold mb-4 uppercase tracking-[0.15em] text-muted-foreground/60 border-b border-border/10 pb-2">
            {footer}
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm group">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                <span className="text-foreground/80 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
