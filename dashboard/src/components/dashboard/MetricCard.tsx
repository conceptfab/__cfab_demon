import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon: LucideIcon;
  className?: string;
}

export function MetricCard({ title, value, subtitle, icon: Icon, className }: MetricCardProps) {
  return (
    <Card className={cn('h-full w-full min-w-0 border-border/70', className)}>
      <CardContent className="p-2.5 sm:p-4">
        <div className="flex min-w-0 items-start justify-between gap-1.5 sm:gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[10px] font-medium text-muted-foreground sm:text-[11px]">
              {title}
            </p>
            <p className="text-base font-semibold tracking-tight tabular-nums sm:text-xl">{value}</p>
            {subtitle && (
              <p className="hidden text-[10px] text-muted-foreground sm:block">{subtitle}</p>
            )}
          </div>
          <div className="max-sm:hidden shrink-0 rounded-md border border-border/80 bg-accent/35 p-1 text-muted-foreground sm:block sm:p-1.5">
            <Icon className="size-3.5 sm:size-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
