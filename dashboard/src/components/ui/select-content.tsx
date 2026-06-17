import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/lib/utils';

type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Content>>;
};

export function SelectContent({
  ref,
  className,
  children,
  position = 'popper',
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border border-border/90 bg-popover/98 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.35)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-0.5',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
