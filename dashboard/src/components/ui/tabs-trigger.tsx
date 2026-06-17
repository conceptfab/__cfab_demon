import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.Trigger>>;
};

export function TabsTrigger({ ref, className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-[5px] px-2.5 py-1 text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border data-[state=active]:border-border/80 data-[state=active]:bg-card data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}
