import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusBadgeClass } from '@/lib/project-status';

interface StatusBadgeProps {
  /** Surowy status projektu (active/frozen/excluded/archived). Steruje kolorem. */
  status: string;
  /** Tekst etykiety — przekazywany przez wywołującego, bo namespace i18n bywa różny. */
  children: React.ReactNode;
  className?: string;
}

/** Spójny badge statusu projektu — używany wszędzie, gdzie status jest read-only. */
export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn('text-[10px]', statusBadgeClass(status), className)}>
      {children}
    </Badge>
  );
}
