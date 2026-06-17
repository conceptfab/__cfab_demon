import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';

export interface SidebarStatusIndicatorProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  statusText: string;
  colorClass?: string;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  pulse?: boolean;
}

export function SidebarStatusIndicator({
  icon: Icon,
  label,
  statusText,
  colorClass,
  onClick,
  title,
  pulse,
}: SidebarStatusIndicatorProps) {
  return (
    <AppTooltip content={title} side="right">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1 transition-all text-[11px] font-medium',
          onClick ? 'hover:bg-accent/40' : 'cursor-default',
        )}
      >
        <div className="relative shrink-0">
          <Icon
            className={cn(
              'size-3.5',
              colorClass || 'text-muted-foreground/70',
            )}
          />
          {pulse && (
            <span className="absolute -right-0.5 -top-0.5 flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex size-1.5 rounded-full bg-sky-500"></span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-0.5 leading-none">
          <span className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/45">
            {label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground/90">
            {statusText}
          </span>
        </div>
      </button>
    </AppTooltip>
  );
}
