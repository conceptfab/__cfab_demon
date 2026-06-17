import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
export { TabsContent } from '@/components/ui/tabs-content';
export { TabsTrigger } from '@/components/ui/tabs-trigger';

const Tabs = TabsPrimitive.Root;

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.List>>;
};

function TabsList({ ref, className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-muted/50 p-0.5 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList };
