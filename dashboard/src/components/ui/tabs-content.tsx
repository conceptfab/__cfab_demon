import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

type TabsContentProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.Content>>;
};

export function TabsContent({ ref, className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        'mt-1.5 ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
