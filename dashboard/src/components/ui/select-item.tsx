import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type SelectItemProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Item>>;
};

export function SelectItem({ ref, className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-[4px] py-1 pl-2 pr-7 text-xs outline-none focus:bg-accent/80 focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-1.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
