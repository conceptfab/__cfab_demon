import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SegmentedGroup({
  'aria-label': ariaLabel,
  className,
  children,
}: {
  'aria-label': string;
  className?: string;
  children: ReactNode;
}) {
  return (
      <fieldset
        className={cn(
          'm-0 flex w-full min-w-0 max-w-full rounded-lg border border-border/70 bg-muted/15 p-0.5',
          className,
        )}
      >
        <legend className="sr-only">{ariaLabel}</legend>
        {children}
      </fieldset>
  );
}

export function SegmentedItem({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 min-w-0 flex-1 rounded-md px-0.5 text-[9px] leading-tight whitespace-normal shadow-none sm:text-[10px]',
        active
          ? 'border border-primary/30 bg-primary/14 text-foreground'
          : 'border border-transparent text-muted-foreground hover:bg-accent/50',
        className,
      )}
    >
      {children}
    </Button>
  );
}
