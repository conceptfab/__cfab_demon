import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
export { SelectContent } from '@/components/ui/select-content';
export { SelectItem } from '@/components/ui/select-item';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Trigger>>;
};

function SelectTrigger({ ref, className, children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex h-8 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background/40 px-2.5 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export { Select, SelectGroup, SelectValue, SelectTrigger };
