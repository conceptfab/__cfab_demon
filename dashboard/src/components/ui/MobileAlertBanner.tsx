import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { mobileLayout } from '@/lib/mobile-layout';

interface MobileAlertBannerProps {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function MobileAlertBanner({
  children,
  icon,
  action,
  className,
}: MobileAlertBannerProps) {
  return (
    <Card className={cn(mobileLayout.alertCard, className)}>
      <CardContent className={mobileLayout.alertContent}>
        <div className="flex min-w-0 items-start gap-2">
          {icon}
          <div className={mobileLayout.alertText}>{children}</div>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
